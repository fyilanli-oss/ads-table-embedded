begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Private metadata receipt: a known NOT-SENT first HTTP boundary, not a provider error or timer expiry.
create table operations.refresh_quota_waits (
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  install_generation bigint not null,
  provider text not null check(provider in ('meta','google_ads','klaviyo')),
  account_id text not null,
  job_id text not null,
  fence bigint primary key,
  boundary text not null check(boundary in ('entitlement','provider_page')),
  state text not null default 'waiting' check(state in ('waiting','consumed')),
  observed_at timestamptz not null default statement_timestamp()
);
create index refresh_quota_waits_job_idx on operations.refresh_quota_waits(workspace_id,install_generation,provider,account_id,job_id);
alter table operations.refresh_quota_waits enable row level security;
alter table operations.refresh_quota_waits force row level security;
create policy refresh_quota_waits_owner on operations.refresh_quota_waits to adstable_owner using(true) with check(true);
revoke all on operations.refresh_quota_waits from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function operations.defer_refresh_quota_wait(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint,p_from date,p_to date,p_boundary text)
returns boolean language plpgsql security definer set search_path='' as $fn$
begin
  perform 1 from operations.refresh_control where singleton for update;
  if p_boundary is null or p_boundary not in ('entitlement','provider_page')
    or operations.load_refresh_bound_authority(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_from,p_to) is null
    or not exists(select 1 from operations.refresh_work_progress where fence=p_fence and stage='request_intent'
      and rows_observed=0 and bytes_observed=0)
    or exists(select 1 from operations.refresh_work_stops where workspace_id=p_workspace and install_generation=p_generation
      and provider=p_provider and account_id=p_account and job_id=p_job and state<>'resolved') then return false; end if;
  -- Only trusted coordinator code may call this after its private first-boundary wait proof.
  -- Release bounded worker capacity, NOT API debit units; queue age and period remain untouched.
  insert into operations.refresh_quota_waits(workspace_id,install_generation,provider,account_id,job_id,fence,boundary)
    values(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_boundary);
  update operations.refresh_runs set status='paused',finished_at=statement_timestamp()
    where workspace_id=p_workspace and install_generation=p_generation and provider=p_provider and account_id=p_account
      and job_id=p_job and fence=p_fence and status='running';
  if not found then raise exception 'REFRESH_QUOTA_WAIT_CONFLICT'; end if;
  update operations.refresh_control set revision=revision+1 where singleton;
  return true;
end
$fn$;

-- Same native admission gates; only an exact previously deferred quota job may acquire a NEW fence.
create or replace function operations.commit_refresh_preflight(p_revision bigint,p_queue_revision bigint,p_state jsonb,p_source jsonb,p_window jsonb,p_partition text)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare q operations.refresh_queue_accounts%rowtype; cfg operations.refresh_queue_control%rowtype; selected jsonb; actual jsonb;
  base_source jsonb; start_day date; end_day date; now_ms bigint; additions integer; prior operations.refresh_runs%rowtype;
begin
  perform 1 from operations.refresh_control where singleton for update;
  select * into strict cfg from operations.refresh_queue_control where singleton for update;
  if p_revision is null or p_queue_revision is null or p_revision<>(select revision from operations.refresh_control where singleton)
    or p_queue_revision<>cfg.revision then return false; end if;
  now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if cfg.max_snapshot_age_ms is null or cfg.last_success_at_ms is null or cfg.last_success_at_ms>now_ms
    or now_ms-cfg.last_success_at_ms>cfg.max_snapshot_age_ms then return false; end if;
  select * into q from operations.refresh_queue_accounts where workspace_id=(p_source->>'workspaceId')::uuid
    and install_generation=(p_source->>'installGeneration')::bigint and provider=p_source->>'provider' and account_id=p_source->>'accountId';
  if not found or q.state<>'pending' or not q.connection_open then return false; end if;
  base_source:=operations.refresh_preflight_source(q.workspace_id,q.install_generation,q.provider,q.account_id);
  actual:=base_source||jsonb_build_object('scheduledHour',q.first_due_hour_ms,'queuedAt',q.first_queued_at_ms);
  if base_source is null or actual is distinct from p_source or base_source->>'connectionId'<>q.connection_id
    or (base_source->>'connectionVersion')::bigint<>q.connection_version or (base_source->>'eligibleFromMs')::bigint<>q.eligible_from_ms then return false; end if;
  if jsonb_typeof(p_window) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_window))<>2
    or coalesce(p_window->>'from','')!~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_window->>'to','')!~ '^\d{4}-\d{2}-\d{2}$'
    or length(coalesce(p_partition,'')) not between 1 and 256 then return false; end if;
  start_day:=(p_window->>'from')::date; end_day:=(p_window->>'to')::date;
  if end_day<start_day or start_day::timestamp at time zone (base_source->>'timezone')<to_timestamp(q.eligible_from_ms::double precision/1000)
    or end_day>(statement_timestamp() at time zone (base_source->>'timezone'))::date then return false; end if;
  select count(*) into additions from jsonb_array_elements(p_state->'claims') c(value)
    where not exists(select 1 from operations.refresh_runs r where r.fence=(c.value->>'fence')::bigint and r.status='running');
  if additions<>1 then return false; end if;
  select value into selected from jsonb_array_elements(p_state->'claims') c(value)
    where not exists(select 1 from operations.refresh_runs r where r.fence=(c.value->>'fence')::bigint and r.status='running');
  if selected->>'workspaceId'<>q.workspace_id::text or selected->>'installGeneration'<>q.install_generation::text
    or selected->>'provider'<>q.provider or selected->>'accountId'<>q.account_id or (selected->'cost'->>'requests')::bigint<2 then return false; end if;
  select * into prior from operations.refresh_runs where workspace_id=q.workspace_id and install_generation=q.install_generation
    and provider=q.provider and account_id=q.account_id and job_id=selected->>'id';
  if found and (prior.status<>'paused' or not exists(
    select 1 from operations.refresh_quota_waits wait join operations.refresh_work_bindings b using(workspace_id,install_generation,provider,account_id,job_id,fence)
    where wait.fence=prior.fence and wait.state='waiting' and b.source=base_source and b.from_date=start_day and b.to_date=end_day and b.partition_id=p_partition)) then return false; end if;
  if not operations.commit_refresh_admissions(p_revision,p_state) then return false; end if;
  insert into operations.refresh_work_bindings values(q.workspace_id,q.install_generation,q.provider,q.account_id,
    selected->>'id',(selected->>'fence')::bigint,base_source,start_day,end_day,p_partition);
  if prior.fence is not null then update operations.refresh_quota_waits set state='consumed' where fence=prior.fence and state='waiting'; end if;
  return true;
end
$fn$;

revoke all on function operations.defer_refresh_quota_wait(uuid,bigint,text,text,text,bigint,date,date,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.defer_refresh_quota_wait(uuid,bigint,text,text,text,bigint,date,date,text) to adstable_refresh_coordinator;
reset role;
commit;
