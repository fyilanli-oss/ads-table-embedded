begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Internal coordinator only: no login, credential or runtime membership is created.
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'adstable_refresh_coordinator') then
    create role adstable_refresh_coordinator nologin noinherit nosuperuser
      nocreatedb nocreaterole noreplication nobypassrls;
  elsif exists (select 1 from pg_roles where rolname = 'adstable_refresh_coordinator'
    and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
    raise exception 'REFRESH_COORDINATOR_ROLE_UNSAFE';
  end if;
end
$role$;

set local role adstable_owner;

create table operations.refresh_control (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  next_fence bigint not null default 1 check (next_fence between 1 and 9007199254740991),
  next_turn bigint not null default 1 check (next_turn between 1 and 9007199254740991),
  budget jsonb,
  bounds jsonb,
  constraint refresh_control_configuration_pair check ((budget is null) = (bounds is null))
);
create table operations.refresh_runs (
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  install_generation bigint not null check (install_generation > 0),
  provider text not null check (provider in ('meta','google_ads','klaviyo')),
  account_id text not null check (length(account_id) between 1 and 256),
  job_id text not null check (length(job_id) between 1 and 256),
  fence bigint not null unique check (fence between 1 and 9007199254740991),
  cost jsonb not null,
  status text not null check (status in ('running','completed','paused')),
  started_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  primary key (workspace_id,install_generation,provider,account_id,job_id),
  check ((status = 'running') = (finished_at is null))
);
create unique index refresh_runs_one_active_account_idx
  on operations.refresh_runs (workspace_id,install_generation,provider,account_id)
  where status = 'running';
create index refresh_runs_active_fence_idx on operations.refresh_runs(fence) where status = 'running';
create table operations.refresh_service_order (
  workspace_id uuid primary key references app.workspaces(id) on delete cascade,
  turn bigint not null check (turn between 1 and 9007199254740991)
);

alter table operations.refresh_control enable row level security;
alter table operations.refresh_control force row level security;
alter table operations.refresh_runs enable row level security;
alter table operations.refresh_runs force row level security;
alter table operations.refresh_service_order enable row level security;
alter table operations.refresh_service_order force row level security;
create policy refresh_control_owner on operations.refresh_control to adstable_owner using (true) with check (true);
create policy refresh_runs_owner on operations.refresh_runs to adstable_owner using (true) with check (true);
create policy refresh_service_order_owner on operations.refresh_service_order to adstable_owner using (true) with check (true);
revoke all on operations.refresh_control, operations.refresh_runs, operations.refresh_service_order
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
insert into operations.refresh_control(singleton) values (true);

create function operations.refresh_vector_valid(value jsonb) returns boolean
language sql immutable set search_path = '' as $fn$
  select jsonb_typeof(value) = 'object'
    and (select count(*) = 5 from jsonb_object_keys(value))
    and not exists (select 1 from unnest(array['requests','dbWrites','connections','rows','bytes']) as r(name)
      where jsonb_typeof(value->r.name) is distinct from 'number'
        or coalesce(value->>r.name,'') !~ '^[0-9]+$'
        or (value->>r.name)::numeric > 9007199254740991)
$fn$;

create function operations.read_refresh_admission_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('state',jsonb_build_object(
    'revision',c.revision,'nextFence',c.next_fence,'nextTurn',c.next_turn,
    'claims',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.job_id,'workspaceId',r.workspace_id::text,'installGeneration',r.install_generation::text,
      'provider',r.provider,'accountId',r.account_id,'fence',r.fence,'cost',r.cost) order by r.fence)
      from (select * from operations.refresh_runs where status='running' order by fence
        limit coalesce((c.bounds->>'maxClaims')::integer,0)+1) as r),'[]'::jsonb),
    'lastServed',coalesce((select jsonb_agg(jsonb_build_object('workspaceId',s.workspace_id::text,'turn',s.turn) order by s.workspace_id)
      from (select * from operations.refresh_service_order order by workspace_id
        limit coalesce((c.bounds->>'maxWorkspaces')::integer,0)+1) as s),'[]'::jsonb)),
    'budget',c.budget,'bounds',c.bounds)
  from operations.refresh_control as c where c.singleton
$fn$;

create function operations.commit_refresh_admissions(expected_revision bigint, proposed jsonb) returns boolean
language plpgsql security definer set search_path = '' as $fn$
declare
  control operations.refresh_control%rowtype;
  previous jsonb;
  claim jsonb;
  old_claim jsonb;
  service jsonb;
  cap jsonb;
  scope_entry jsonb;
  dimension text;
  resource text;
  maximum numeric;
  consumed numeric;
  additions integer;
  position integer := 0;
begin
  select * into strict control from operations.refresh_control where singleton for update;
  if control.revision <> expected_revision then return false; end if;
  if control.budget is null or control.bounds is null then raise exception 'REFRESH_BUDGET_NOT_CONFIGURED'; end if;
  foreach resource in array array['maxCandidates','maxClaims','maxAdmissions','maxWorkspaces'] loop
    if jsonb_typeof(control.bounds->resource) is distinct from 'number'
      or coalesce(control.bounds->>resource,'') !~ '^[1-9][0-9]*$'
      or (control.bounds->>resource)::numeric > 2147483646 then raise exception 'REFRESH_BOUNDS_INVALID'; end if;
  end loop;
  previous := operations.read_refresh_admission_snapshot()->'state';
  if jsonb_typeof(proposed) is distinct from 'object'
    or jsonb_typeof(proposed->'claims') is distinct from 'array'
    or jsonb_typeof(proposed->'lastServed') is distinct from 'array' then raise exception 'REFRESH_STATE_INVALID'; end if;
  additions := jsonb_array_length(proposed->'claims') - jsonb_array_length(previous->'claims');
  if additions < 1 or additions > (control.bounds->>'maxAdmissions')::integer
    or jsonb_array_length(proposed->'claims') > (control.bounds->>'maxClaims')::integer
    or jsonb_array_length(proposed->'lastServed') > (control.bounds->>'maxWorkspaces')::integer
    or proposed->>'revision' is distinct from (control.revision+1)::text
    or proposed->>'nextFence' is distinct from (control.next_fence+additions)::text
    or proposed->>'nextTurn' is distinct from (control.next_turn+additions)::text then raise exception 'REFRESH_STATE_INVALID'; end if;
  for old_claim in select value from jsonb_array_elements(previous->'claims') loop
    if proposed->'claims'->position is distinct from old_claim then raise exception 'REFRESH_EXISTING_CLAIM_CHANGED'; end if;
    position := position+1;
  end loop;
  for claim in select value from jsonb_array_elements(proposed->'claims') loop
    if operations.refresh_vector_valid(claim->'cost') is not true then raise exception 'REFRESH_WORKLOAD_INVALID'; end if;
  end loop;
  -- Recheck the stored budget while holding the same short global lock as the claim.
  for dimension in select unnest(array['global','providers','workspaces','accounts']) loop
    for scope_entry in select value from jsonb_array_elements(case when dimension='global'
      then jsonb_build_array(jsonb_build_object('limit',control.budget->'global')) else control.budget->dimension end) loop
      cap := scope_entry->'limit';
      if operations.refresh_vector_valid(cap) is not true then raise exception 'REFRESH_BUDGET_INVALID'; end if;
      if dimension='global' and operations.refresh_vector_valid(control.budget->'interactiveReserve') is not true then raise exception 'REFRESH_BUDGET_INVALID'; end if;
      foreach resource in array array['requests','dbWrites','connections','rows','bytes'] loop
        maximum := (cap->>resource)::numeric;
        if dimension='global' then maximum := maximum-(control.budget->'interactiveReserve'->>resource)::numeric; end if;
        select coalesce(sum((value->'cost'->>resource)::numeric),0) into consumed
          from jsonb_array_elements(proposed->'claims')
          where dimension='global'
            or (dimension='providers' and value->>'provider'=scope_entry->>'provider')
            or (dimension='workspaces' and value->>'workspaceId'=scope_entry->>'workspaceId')
            or (dimension='accounts' and value->>'provider'=scope_entry->>'provider' and value->>'accountId'=scope_entry->>'accountId');
        if consumed > maximum then raise exception 'REFRESH_BUDGET_EXCEEDED'; end if;
      end loop;
    end loop;
  end loop;
  for claim in select value from jsonb_array_elements(proposed->'claims') offset position loop
    if (claim->>'fence')::bigint <> control.next_fence then raise exception 'REFRESH_FENCE_INVALID'; end if;
    if not exists (select 1 from shopify.installations as i join app.workspaces as w on w.id=i.workspace_id
      where i.workspace_id=(claim->>'workspaceId')::uuid and i.install_generation=(claim->>'installGeneration')::bigint
        and i.status='active' and w.status='active') then raise exception 'REFRESH_INSTALLATION_INVALID'; end if;
    if not exists (select 1 from jsonb_array_elements(control.budget->'providers') where value->>'provider'=claim->>'provider')
      or not exists (select 1 from jsonb_array_elements(control.budget->'workspaces') where value->>'workspaceId'=claim->>'workspaceId')
      or not exists (select 1 from jsonb_array_elements(control.budget->'accounts') where value->>'provider'=claim->>'provider' and value->>'accountId'=claim->>'accountId')
      then raise exception 'REFRESH_BUDGET_SCOPE_MISSING'; end if;
    insert into operations.refresh_runs(workspace_id,install_generation,provider,account_id,job_id,fence,cost,status)
      values ((claim->>'workspaceId')::uuid,(claim->>'installGeneration')::bigint,claim->>'provider',claim->>'accountId',claim->>'id',(claim->>'fence')::bigint,claim->'cost','running')
      on conflict (workspace_id,install_generation,provider,account_id,job_id) do update
        set fence=excluded.fence,cost=excluded.cost,status='running',started_at=statement_timestamp(),finished_at=null
        where operations.refresh_runs.status='paused';
    if not found then raise exception 'REFRESH_JOB_ALREADY_COMPLETED'; end if;
    control.next_fence := control.next_fence+1;
  end loop;
  for service in select value from jsonb_array_elements(proposed->'lastServed') loop
    if (service->>'turn')::bigint < 1 or (service->>'turn')::bigint >= (proposed->>'nextTurn')::bigint then raise exception 'REFRESH_SERVICE_ORDER_INVALID'; end if;
    insert into operations.refresh_service_order(workspace_id,turn) values ((service->>'workspaceId')::uuid,(service->>'turn')::bigint)
      on conflict (workspace_id) do update set turn=excluded.turn;
  end loop;
  update operations.refresh_control set revision=control.revision+1,next_fence=control.next_fence,next_turn=(proposed->>'nextTurn')::bigint where singleton;
  return true;
end
$fn$;

create function operations.finish_refresh_work(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint,p_outcome text)
returns boolean language plpgsql security definer set search_path = '' as $fn$
begin
  if p_outcome is null or p_outcome not in ('completed','paused') then raise exception 'REFRESH_OUTCOME_INVALID'; end if;
  perform 1 from operations.refresh_control where singleton for update;
  update operations.refresh_runs set status=p_outcome,finished_at=statement_timestamp()
    where workspace_id=p_workspace and install_generation=p_generation and provider=p_provider
      and account_id=p_account and job_id=p_job and fence=p_fence and status='running';
  if not found then return false; end if;
  update operations.refresh_control set revision=revision+1 where singleton;
  return true;
end
$fn$;

revoke all on function operations.refresh_vector_valid(jsonb) from public,anon,authenticated,service_role,adstable_runtime;
revoke all on function operations.read_refresh_admission_snapshot() from public,anon,authenticated,service_role,adstable_runtime;
revoke all on function operations.commit_refresh_admissions(bigint,jsonb) from public,anon,authenticated,service_role,adstable_runtime;
revoke all on function operations.finish_refresh_work(uuid,bigint,text,text,text,bigint,text) from public,anon,authenticated,service_role,adstable_runtime;
grant usage on schema operations to adstable_refresh_coordinator;
grant execute on function operations.read_refresh_admission_snapshot(),operations.commit_refresh_admissions(bigint,jsonb),
  operations.finish_refresh_work(uuid,bigint,text,text,text,bigint,text) to adstable_refresh_coordinator;
reset role;
commit;
