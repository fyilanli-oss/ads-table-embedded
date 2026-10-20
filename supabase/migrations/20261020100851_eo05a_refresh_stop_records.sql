begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

-- Latest observation per job, not an unbounded polling/event log. No payload or token fields.
create table operations.refresh_work_stops (
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  install_generation bigint not null check (install_generation > 0),
  provider text not null check (provider in ('meta','google_ads','klaviyo')),
  account_id text not null check (length(account_id) between 1 and 256),
  job_id text not null check (length(job_id) between 1 and 256),
  fence bigint,
  version bigint not null check (version between 1 and 9007199254740991),
  state text not null check (state in ('waiting','blocked','paused','uncertain','resolved')),
  reason text not null,
  call_state text not null check (call_state in ('not_sent','settled','unknown')),
  source text not null check (source in ('system','merchant','provider','unknown')),
  action text not null check (action in ('wait','check_configuration','check_authority','reconnect','check_subscription','investigate','verify_execution_stopped')),
  observed_at timestamptz not null default statement_timestamp(),
  resolved_at timestamptz,
  primary key (workspace_id,install_generation,provider,account_id,job_id),
  check ((state='resolved') = (resolved_at is not null)),
  check (fence is null or fence between 1 and 9007199254740991)
);
create unique index refresh_work_stops_one_hold_idx
  on operations.refresh_work_stops(workspace_id,install_generation,provider,account_id)
  where state in ('blocked','paused','uncertain');
alter table operations.refresh_work_stops enable row level security;
alter table operations.refresh_work_stops force row level security;
create policy refresh_work_stops_owner on operations.refresh_work_stops to adstable_owner using (true) with check (true);
revoke all on operations.refresh_work_stops from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function operations.refresh_stop_classification(p_reason text) returns jsonb
language sql immutable set search_path = '' as $fn$
  select jsonb_build_object('state',s.state,'call_state',s.call_state,'source',s.source,'action',s.action)
  from (values
    ('not_due','waiting','not_sent','system','wait'),
    ('account_busy','waiting','not_sent','system','wait'),
    ('budget_full','waiting','not_sent','system','wait'),
    ('dispatch_limit','waiting','not_sent','system','wait'),
    ('configuration_missing','blocked','not_sent','system','check_configuration'),
    ('authority_required','blocked','not_sent','unknown','check_authority'),
    ('reauthorization_required','blocked','not_sent','unknown','reconnect'),
    ('connection_closed','blocked','not_sent','merchant','reconnect'),
    ('entitlement_required','blocked','not_sent','merchant','check_subscription'),
    ('budget_unknown','blocked','not_sent','system','check_configuration'),
    ('workload_unknown','blocked','not_sent','system','check_configuration'),
    ('provider_permission_denied','paused','settled','provider','check_authority'),
    ('provider_throttled','paused','settled','provider','investigate'),
    ('provider_rejected','paused','settled','provider','investigate'),
    ('provider_unknown_error','paused','settled','unknown','investigate'),
    ('stopped_before_call','paused','not_sent','system','investigate'),
    ('worker_stopped','paused','settled','system','investigate'),
    ('worker_lost','uncertain','unknown','unknown','verify_execution_stopped'),
    ('request_outcome_unknown','uncertain','unknown','unknown','verify_execution_stopped')
  ) as s(reason,state,call_state,source,action) where s.reason=p_reason
$fn$;

create function operations.refresh_account_is_held(p_workspace uuid,p_generation bigint,p_provider text,p_account text) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from operations.refresh_work_stops where workspace_id=p_workspace
    and install_generation=p_generation and provider=p_provider and account_id=p_account and state in ('blocked','paused','uncertain'))
$fn$;

create function operations.record_refresh_work_stop(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint,p_reason text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  c operations.refresh_control%rowtype;
  run operations.refresh_runs%rowtype;
  previous operations.refresh_work_stops%rowtype;
  classification jsonb;
begin
  select * into strict c from operations.refresh_control where singleton for update;
  if p_revision is null or c.revision <> p_revision then return jsonb_build_object('recorded',false,'reason','state_changed'); end if;
  classification := operations.refresh_stop_classification(p_reason);
  if classification is null or p_workspace is null or p_generation is null or p_generation < 1
    or p_provider is null or p_provider not in ('meta','google_ads','klaviyo')
    or p_account is null or length(p_account) not between 1 and 256 or p_account<>btrim(p_account)
    or p_job is null or length(p_job) not between 1 and 256 or p_job<>btrim(p_job)
    then raise exception 'REFRESH_STOP_INPUT_INVALID'; end if;
  select * into run from operations.refresh_runs where workspace_id=p_workspace and install_generation=p_generation
    and provider=p_provider and account_id=p_account and job_id=p_job;
  if p_fence is not null then
    if run.status is distinct from 'running' or run.fence is distinct from p_fence then
      return jsonb_build_object('recorded',false,'reason','claim_not_current'); end if;
  elsif run.job_id is not null or classification->>'call_state'<>'not_sent'
    or classification->>'state' in ('paused','uncertain') then
    return jsonb_build_object('recorded',false,'reason','claim_required');
  end if;
  if classification->>'state'='waiting' and p_fence is not null then raise exception 'REFRESH_STOP_INPUT_INVALID'; end if;
  -- A preflight report cannot cancel a different, already running job on this account.
  if p_fence is null and classification->>'state'<>'waiting' and exists (
    select 1 from operations.refresh_runs where workspace_id=p_workspace and install_generation=p_generation
      and provider=p_provider and account_id=p_account and status='running') then
    return jsonb_build_object('recorded',false,'reason','account_busy'); end if;
  if operations.refresh_account_is_held(p_workspace,p_generation,p_provider,p_account) then
    return jsonb_build_object('recorded',false,'reason','account_held'); end if;
  select * into previous from operations.refresh_work_stops where workspace_id=p_workspace and install_generation=p_generation
    and provider=p_provider and account_id=p_account and job_id=p_job;
  if previous.state='waiting' and previous.reason=p_reason then
    return jsonb_build_object('recorded',true,'version',previous.version,'state','waiting'); end if;
  insert into operations.refresh_work_stops(workspace_id,install_generation,provider,account_id,job_id,fence,version,state,reason,call_state,source,action)
    values (p_workspace,p_generation,p_provider,p_account,p_job,p_fence,c.revision+1,classification->>'state',p_reason,
      classification->>'call_state',classification->>'source',classification->>'action')
    on conflict (workspace_id,install_generation,provider,account_id,job_id) do update set
      fence=excluded.fence,version=excluded.version,state=excluded.state,reason=excluded.reason,call_state=excluded.call_state,
      source=excluded.source,action=excluded.action,observed_at=statement_timestamp(),resolved_at=null;
  -- Unknown external execution retains its entire reservation. No timeout-driven release.
  if p_fence is not null and classification->>'state'<>'uncertain' then
    update operations.refresh_runs set status='paused',finished_at=statement_timestamp()
      where workspace_id=p_workspace and install_generation=p_generation and provider=p_provider
        and account_id=p_account and job_id=p_job and fence=p_fence and status='running';
  end if;
  update operations.refresh_control set revision=revision+1 where singleton;
  return jsonb_build_object('recorded',true,'version',c.revision+1,'state',classification->>'state');
end
$fn$;

create function operations.read_refresh_work_stop(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text) returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select to_jsonb(s) from operations.refresh_work_stops as s where workspace_id=p_workspace and install_generation=p_generation
    and provider=p_provider and account_id=p_account and job_id=p_job
$fn$;

-- Explicit internal acknowledgement only; not a retry or a proof of current reporting authority.
-- Uncertain execution CANNOT be cleared by this API. A verified runtime recovery boundary is still required.
create function operations.resolve_refresh_work_stop(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_version bigint)
returns boolean language plpgsql security definer set search_path = '' as $fn$
begin
  perform 1 from operations.refresh_control where singleton for update;
  update operations.refresh_work_stops set state='resolved',resolved_at=statement_timestamp()
    where workspace_id=p_workspace and install_generation=p_generation and provider=p_provider and account_id=p_account
      and job_id=p_job and version=p_version and state in ('blocked','paused') and call_state<>'unknown';
  if not found then return false; end if;
  update operations.refresh_control set revision=revision+1 where singleton;
  return true;
end
$fn$;

-- This check is diagnostic on its own. Future writes MUST hold refresh_control FOR UPDATE
-- and perform this check plus the Dataset write in the same transaction; no check-then-write race.
create function operations.refresh_claim_is_current(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select not operations.refresh_account_is_held(p_workspace,p_generation,p_provider,p_account)
    and exists (select 1 from operations.refresh_runs where workspace_id=p_workspace and install_generation=p_generation
      and provider=p_provider and account_id=p_account and job_id=p_job and fence=p_fence and status='running')
    and exists (select 1 from shopify.installations as i join app.workspaces as w on w.id=i.workspace_id
      where i.workspace_id=p_workspace and i.install_generation=p_generation and i.status='active' and w.status='active')
$fn$;

-- Holds are bounded alongside claims; overflow makes the planner fail closed, never truncate silently.
alter function operations.read_refresh_admission_snapshot() rename to read_refresh_admission_snapshot_before_stops;
revoke all on function operations.read_refresh_admission_snapshot_before_stops() from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.read_refresh_admission_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select jsonb_set(s.snapshot,'{state,holds}',coalesce((select jsonb_agg(jsonb_build_object(
    'workspaceId',h.workspace_id::text,'installGeneration',h.install_generation::text,'provider',h.provider,'accountId',h.account_id))
    from (select workspace_id,install_generation,provider,account_id from operations.refresh_work_stops
      where state in ('blocked','paused','uncertain') order by workspace_id,install_generation,provider,account_id
      limit coalesce((s.snapshot->'bounds'->>'maxCandidates')::integer,0)+coalesce((s.snapshot->'bounds'->>'maxClaims')::integer,0)+1) as h),'[]'::jsonb))
  from (select operations.read_refresh_admission_snapshot_before_stops() as snapshot) as s
$fn$;

-- Preserve the tested admission/completion implementation, but close every coordinator bypass.
alter function operations.commit_refresh_admissions(bigint,jsonb) rename to commit_refresh_admissions_before_stops;
revoke all on function operations.commit_refresh_admissions_before_stops(bigint,jsonb) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.commit_refresh_admissions(expected_revision bigint,proposed jsonb) returns boolean
language plpgsql security definer set search_path = '' as $fn$
declare claim jsonb;
  committed boolean;
begin
  perform 1 from operations.refresh_control where singleton for update;
  if expected_revision is null or expected_revision<>(select revision from operations.refresh_control where singleton) then return false; end if;
  for claim in select value from jsonb_array_elements(proposed->'claims') loop
    if operations.refresh_account_is_held((claim->>'workspaceId')::uuid,(claim->>'installGeneration')::bigint,claim->>'provider',claim->>'accountId')
      and not exists (select 1 from operations.refresh_runs where fence=(claim->>'fence')::bigint and status='running') then return false; end if;
  end loop;
  committed := operations.commit_refresh_admissions_before_stops(expected_revision,proposed);
  if committed then
    update operations.refresh_work_stops as s set state='resolved',resolved_at=statement_timestamp()
      from jsonb_array_elements(proposed->'claims') as selected(value)
      where s.state='waiting' and s.workspace_id=(selected.value->>'workspaceId')::uuid
        and s.install_generation=(selected.value->>'installGeneration')::bigint and s.provider=selected.value->>'provider'
        and s.account_id=selected.value->>'accountId' and s.job_id=selected.value->>'id';
  end if;
  return committed;
end
$fn$;

alter function operations.finish_refresh_work(uuid,bigint,text,text,text,bigint,text) rename to finish_refresh_work_before_stops;
revoke all on function operations.finish_refresh_work_before_stops(uuid,bigint,text,text,text,bigint,text) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.finish_refresh_work(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint,p_outcome text)
returns boolean language plpgsql security definer set search_path = '' as $fn$
begin
  perform 1 from operations.refresh_control where singleton for update;
  if operations.refresh_account_is_held(p_workspace,p_generation,p_provider,p_account) then return false; end if;
  return operations.finish_refresh_work_before_stops(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_outcome);
end
$fn$;

revoke all on function operations.refresh_stop_classification(text),operations.refresh_account_is_held(uuid,bigint,text,text),
  operations.record_refresh_work_stop(uuid,bigint,text,text,text,bigint,text,bigint),operations.read_refresh_work_stop(uuid,bigint,text,text,text),
  operations.resolve_refresh_work_stop(uuid,bigint,text,text,text,bigint),operations.refresh_claim_is_current(uuid,bigint,text,text,text,bigint),
  operations.read_refresh_admission_snapshot(),operations.commit_refresh_admissions(bigint,jsonb),operations.finish_refresh_work(uuid,bigint,text,text,text,bigint,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.record_refresh_work_stop(uuid,bigint,text,text,text,bigint,text,bigint),
  operations.read_refresh_work_stop(uuid,bigint,text,text,text),operations.resolve_refresh_work_stop(uuid,bigint,text,text,text,bigint),
  operations.refresh_claim_is_current(uuid,bigint,text,text,text,bigint),operations.read_refresh_admission_snapshot(),operations.commit_refresh_admissions(bigint,jsonb),
  operations.finish_refresh_work(uuid,bigint,text,text,text,bigint,text) to adstable_refresh_coordinator;
reset role;
commit;
