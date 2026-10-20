begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

-- Bounds are deliberately unset. Owner configuration and activation need separate approval.
create table operations.refresh_queue_control (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  max_workspaces integer check (max_workspaces > 0),
  max_accounts integer check (max_accounts > 0),
  max_snapshot_bytes integer check (max_snapshot_bytes > 0),
  max_snapshot_age_ms integer check (max_snapshot_age_ms > 0),
  activated_at_ms bigint,
  last_success_at_ms bigint,
  last_observed_at_ms bigint,
  checked_workspaces integer,
  checked_accounts integer
);
create table operations.refresh_queue_accounts (
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  install_generation bigint not null check (install_generation > 0),
  provider text not null check (provider in ('meta','google_ads','klaviyo')),
  account_id text not null check (length(account_id) between 1 and 256),
  connection_id text not null check (length(connection_id) between 1 and 256),
  connection_version bigint not null check (connection_version > 0),
  eligible_from_ms bigint not null check (eligible_from_ms >= 0),
  connection_open boolean not null,
  state text not null check (state in ('not_due','pending','ineligible','held')),
  first_due_hour_ms bigint,
  latest_due_hour_ms bigint,
  first_queued_at_ms bigint,
  checked_at_ms bigint not null,
  primary key (workspace_id,install_generation,provider,account_id),
  check ((first_due_hour_ms is null) = (latest_due_hour_ms is null)),
  check ((first_due_hour_ms is null) = (first_queued_at_ms is null)),
  check (latest_due_hour_ms >= first_due_hour_ms)
);
alter table operations.refresh_queue_control enable row level security;
alter table operations.refresh_queue_control force row level security;
alter table operations.refresh_queue_accounts enable row level security;
alter table operations.refresh_queue_accounts force row level security;
create policy refresh_queue_control_owner on operations.refresh_queue_control to adstable_owner using (true) with check (true);
create policy refresh_queue_accounts_owner on operations.refresh_queue_accounts to adstable_owner using (true) with check (true);
revoke all on operations.refresh_queue_control,operations.refresh_queue_accounts from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
insert into operations.refresh_queue_control(singleton) values (true);

create function operations.read_refresh_queue_check() returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('revision',revision,'configured',
    max_workspaces is not null and max_accounts is not null and max_snapshot_bytes is not null and max_snapshot_age_ms is not null,
    'activatedAtMs',activated_at_ms,'lastSuccessAtMs',last_success_at_ms,
    'checkedWorkspaces',checked_workspaces,'checkedAccounts',checked_accounts,
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('workspaceId',q.workspace_id::text,'installGeneration',q.install_generation::text,
      'provider',q.provider,'accountId',q.account_id,'state',q.state,'firstDueHourMs',q.first_due_hour_ms,
      'latestDueHourMs',q.latest_due_hour_ms,'firstQueuedAtMs',q.first_queued_at_ms,'checkedAtMs',q.checked_at_ms)
      order by q.first_queued_at_ms nulls last,q.workspace_id,q.provider,q.account_id) from operations.refresh_queue_accounts q),'[]'::jsonb))
  from operations.refresh_queue_control where singleton
$fn$;

-- Whole bounded inventory + resulting needs + successful-check signal commit together.
-- A true/complete flag is NOT proof of production inventory scope; the internal loader is a separate gate.
create function operations.commit_refresh_queue_check(p_revision bigint,p_inventory jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  c operations.refresh_queue_control%rowtype;
  old operations.refresh_queue_accounts%rowtype;
  a jsonb; w jsonb; identity_key text; seen text[] := '{}'; workspace_keys text[] := '{}';
  now_ms bigint; observed_ms bigint; due_hour bigint; first_hour bigint; offset_ms bigint;
  wid uuid; generation bigint; version bigint; eligible_from bigint; eligible boolean; status text;
  hashed bytea; pending_count integer; held_count integer;
begin
  -- Same lock order as admission/stop/progress: authority holds cannot race this classification.
  perform 1 from operations.refresh_control where singleton for update;
  select * into strict c from operations.refresh_queue_control where singleton for update;
  if p_revision is null or c.revision <> p_revision then return jsonb_build_object('committed',false); end if;
  if c.max_workspaces is null or c.max_accounts is null or c.max_snapshot_bytes is null or c.max_snapshot_age_ms is null then
    raise exception 'REFRESH_QUEUE_NOT_CONFIGURED';
  end if;
  now_ms := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if jsonb_typeof(p_inventory) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_inventory)) <> 3
    or jsonb_typeof(p_inventory->'workspaces') is distinct from 'array' or jsonb_typeof(p_inventory->'accounts') is distinct from 'array'
    or jsonb_array_length(p_inventory->'workspaces') > c.max_workspaces
    or jsonb_array_length(p_inventory->'accounts') > c.max_accounts or octet_length(p_inventory::text) > c.max_snapshot_bytes
    or coalesce(p_inventory->>'observedAtMs','') !~ '^[0-9]+$' then raise exception 'REFRESH_QUEUE_INPUT_INVALID'; end if;
  observed_ms := (p_inventory->>'observedAtMs')::bigint;
  if observed_ms > now_ms or now_ms-observed_ms > c.max_snapshot_age_ms
    or observed_ms < coalesce(c.last_observed_at_ms,0) or now_ms < coalesce(c.last_success_at_ms,0) then
    raise exception 'REFRESH_QUEUE_STALE_OR_FUTURE';
  end if;
  for w in select value from jsonb_array_elements(p_inventory->'workspaces') loop
    if jsonb_typeof(w) is distinct from 'string' or w#>>'{}' = any(workspace_keys) then raise exception 'REFRESH_QUEUE_INPUT_INVALID'; end if;
    wid := (w#>>'{}')::uuid;
    if wid::text <> w#>>'{}' or not exists(select 1 from app.workspaces where id=wid) then raise exception 'REFRESH_QUEUE_INPUT_INVALID'; end if;
    workspace_keys := array_append(workspace_keys,wid::text);
  end loop;
  for a in select value from jsonb_array_elements(p_inventory->'accounts') loop
    if jsonb_typeof(a) is distinct from 'object' or (select count(*) from jsonb_object_keys(a)) <> 10
      or not coalesce((a->>'workspaceId') = any(workspace_keys),false)
      or coalesce(a->>'provider','') not in ('meta','google_ads','klaviyo')
      or jsonb_typeof(a->'eligible') is distinct from 'boolean'
      or jsonb_typeof(a->'connectionOpen') is distinct from 'boolean'
      or (a->>'eligible'='true' and a->>'connectionOpen'<>'true')
      or coalesce(a->>'installGeneration','') !~ '^[1-9][0-9]*$'
      or coalesce(a->>'connectionVersion','') !~ '^[1-9][0-9]*$'
      or coalesce(a->>'eligibleFromMs','') !~ '^[0-9]+$'
      or coalesce(a->>'offsetMs','') !~ '^[0-9]+$'
      or length(coalesce(a->>'accountId','')) not between 1 and 256 or a->>'accountId' <> btrim(a->>'accountId')
      or length(coalesce(a->>'connectionId','')) not between 1 and 256 or a->>'connectionId' <> btrim(a->>'connectionId')
      then raise exception 'REFRESH_QUEUE_INPUT_INVALID'; end if;
    wid := (a->>'workspaceId')::uuid; generation := (a->>'installGeneration')::bigint;
    version := (a->>'connectionVersion')::bigint; eligible_from := (a->>'eligibleFromMs')::bigint;
    eligible := (a->>'eligible')::boolean; offset_ms := (a->>'offsetMs')::bigint;
    hashed := sha256(convert_to(format('[%s,%s,%s]',to_json(wid::text)::text,to_json(a->>'provider')::text,to_json(a->>'accountId')::text),'UTF8'));
    if offset_ms <> ((get_byte(hashed,0)::bigint*16777216 + get_byte(hashed,1)::bigint*65536 + get_byte(hashed,2)::bigint*256 + get_byte(hashed,3)) % 3600000)
      then raise exception 'REFRESH_QUEUE_OFFSET_INVALID'; end if;
    identity_key := jsonb_build_array(wid::text,generation::text,a->>'provider',a->>'accountId')::text;
    if identity_key = any(seen) then raise exception 'REFRESH_QUEUE_DUPLICATE'; end if;
    seen := array_append(seen,identity_key);
    select * into old from operations.refresh_queue_accounts where workspace_id=wid and install_generation=generation
      and provider=a->>'provider' and account_id=a->>'accountId';
    if found and (old.connection_version>version or eligible_from<old.eligible_from_ms
      or (old.connection_version=version and (old.connection_id<>a->>'connectionId' or old.eligible_from_ms<>eligible_from
        or (not old.connection_open and (a->>'connectionOpen')::boolean)))) then raise exception 'REFRESH_QUEUE_STALE_CONNECTION'; end if;
    if old.connection_open is false and (a->>'connectionOpen')::boolean and eligible_from < old.checked_at_ms then
      raise exception 'REFRESH_QUEUE_CLOSED_WINDOW';
    end if;
    if old.connection_id is distinct from a->>'connectionId' or old.connection_version is distinct from version
      or old.eligible_from_ms is distinct from eligible_from then
      old.first_due_hour_ms := null; old.latest_due_hour_ms := null; old.first_queued_at_ms := null;
    end if;
    status := 'not_due';
    if not eligible then
      status := 'ineligible'; old.first_due_hour_ms := null; old.latest_due_hour_ms := null; old.first_queued_at_ms := null;
    elsif operations.refresh_account_is_held(wid,generation,a->>'provider',a->>'accountId') then status := 'held';
    else
      due_hour := floor((now_ms-offset_ms)::numeric/3600000)::bigint*3600000;
      first_hour := ceil((eligible_from-offset_ms)::numeric/3600000)::bigint*3600000;
      if due_hour >= first_hour and due_hour >= 0 then
        old.first_due_hour_ms := coalesce(old.first_due_hour_ms,first_hour);
        old.latest_due_hour_ms := due_hour;
        old.first_queued_at_ms := coalesce(old.first_queued_at_ms,now_ms);
        status := 'pending';
      end if;
    end if;
    insert into operations.refresh_queue_accounts values(wid,generation,a->>'provider',a->>'accountId',a->>'connectionId',version,eligible_from,(a->>'connectionOpen')::boolean,
      status,old.first_due_hour_ms,old.latest_due_hour_ms,old.first_queued_at_ms,now_ms)
    on conflict(workspace_id,install_generation,provider,account_id) do update set
      connection_id=excluded.connection_id,connection_version=excluded.connection_version,eligible_from_ms=excluded.eligible_from_ms,connection_open=excluded.connection_open,state=excluded.state,
      first_due_hour_ms=excluded.first_due_hour_ms,latest_due_hour_ms=excluded.latest_due_hour_ms,first_queued_at_ms=excluded.first_queued_at_ms,checked_at_ms=excluded.checked_at_ms;
  end loop;
  -- Authoritative complete inventory only: retired account/generation metadata is invalidated, never carried to a new connection.
  delete from operations.refresh_queue_accounts q where not (jsonb_build_array(q.workspace_id::text,q.install_generation::text,q.provider,q.account_id)::text = any(seen));
  select count(*) filter(where state='pending'), count(*) filter(where state='held') into pending_count,held_count from operations.refresh_queue_accounts;
  update operations.refresh_queue_control set revision=revision+1,last_success_at_ms=now_ms,last_observed_at_ms=observed_ms,
    checked_workspaces=cardinality(workspace_keys),checked_accounts=cardinality(seen) where singleton;
  return jsonb_build_object('committed',true,'checkedWorkspaces',cardinality(workspace_keys),'checkedAccounts',cardinality(seen),
    'pendingAccounts',pending_count,'heldAccounts',held_count,'lastSuccessAtMs',now_ms);
end
$fn$;
revoke all on function operations.read_refresh_queue_check(),operations.commit_refresh_queue_check(bigint,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime;
grant execute on function operations.read_refresh_queue_check(),operations.commit_refresh_queue_check(bigint,jsonb) to adstable_refresh_coordinator;
reset role;
commit;
