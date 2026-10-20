begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

-- Metadata only; immutable per claim/fence. No token, response payload or Dataset facts.
create table operations.refresh_work_bindings (
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  install_generation bigint not null,
  provider text not null,
  account_id text not null,
  job_id text not null,
  fence bigint not null,
  source jsonb not null,
  from_date date not null,
  to_date date not null check(to_date>=from_date),
  partition_id text not null check(length(partition_id) between 1 and 256),
  primary key(workspace_id,install_generation,provider,account_id,job_id,fence)
);
alter table operations.refresh_work_bindings enable row level security;
alter table operations.refresh_work_bindings force row level security;
create policy refresh_work_bindings_owner on operations.refresh_work_bindings to adstable_owner using(true) with check(true);
revoke all on operations.refresh_work_bindings from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- Indexed single-account authority recheck, NOT a full inventory scan per worker page.
-- Selection row ID is an epoch: switching away and back does not restore an older job.
create function operations.refresh_preflight_source(p_workspace uuid,p_generation bigint,p_provider text,p_account text) returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('workspaceId',w.id::text,'installGeneration',i.install_generation::text,'provider',c.provider,
    'accountId',a.provider_account_id,'connectionId',c.id::text,'connectionVersion',c.connection_version,
    'accountRowId',a.id::text,'selectionId',b.id::text,'eligibleFromMs',floor(extract(epoch from greatest(c.connected_at,b.effective_from))*1000)::bigint,
    'timezone',a.timezone_name,'currency',a.currency_code)
  from app.workspaces w join shopify.installations i on i.workspace_id=w.id
    join integrations.provider_connections c on c.installation_id=i.id and c.workspace_id=w.id and c.install_generation=i.install_generation
    join integrations.provider_accounts a on a.connection_id=c.id and a.workspace_id=w.id and a.install_generation=i.install_generation and a.provider=c.provider
    left join integrations.reporting_account_bindings b on b.connection_id=c.id and b.workspace_id=w.id and b.install_generation=i.install_generation
      and b.provider=c.provider and b.account_id=a.id and b.effective_to is null
  where w.id=p_workspace and i.install_generation=p_generation and c.provider=p_provider and a.provider_account_id=p_account
    and w.status='active' and i.status='active' and c.lifecycle_status='connected' and a.active
    and c.connected_at<=statement_timestamp() and (b.effective_from is null or b.effective_from<=statement_timestamp())
    and exists(select 1 from integrations.provider_credential_envelopes ce where ce.id=c.credential_id and ce.installation_id=i.id
      and ce.workspace_id=w.id and ce.install_generation=i.install_generation and ce.provider=c.provider)
    and a.currency_code is not null and exists(select 1 from pg_timezone_names tz where tz.name=a.timezone_name)
    and ((c.provider='meta' and b.id is not null and a.account_kind='advertiser' and a.reporting_eligible and a.provider_account_id ~ '^act_[0-9]+$' and c.granted_scopes @> array['ads_read'])
      or (c.provider='google_ads' and b.id is not null and a.account_kind='advertiser' and a.reporting_eligible and a.provider_account_id ~ '^[0-9]+$' and c.granted_scopes @> array['https://www.googleapis.com/auth/adwords'])
      or (c.provider='klaviyo' and a.account_kind='account' and a.provider_status='active'
        and c.granted_scopes @> array['campaigns:read','events:read','flows:read','metrics:read']
        and (select count(*) from (select 1 from integrations.provider_accounts ka where ka.connection_id=c.id and ka.active limit 2) k)=1))
$fn$;

create function operations.read_refresh_preflight_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $fn$
  with cfg as materialized(select * from operations.refresh_queue_control where singleton),
  admission as materialized(select operations.read_refresh_admission_snapshot() as value),
  pending as materialized(
    select q.*,operations.refresh_preflight_source(q.workspace_id,q.install_generation,q.provider,q.account_id) as source
    from operations.refresh_queue_accounts q left join operations.refresh_service_order so on so.workspace_id=q.workspace_id
    where q.state='pending' and q.connection_open
      and not operations.refresh_account_is_held(q.workspace_id,q.install_generation,q.provider,q.account_id)
      and not exists(select 1 from operations.refresh_runs r where r.workspace_id=q.workspace_id and r.install_generation=q.install_generation
        and r.provider=q.provider and r.account_id=q.account_id and r.status='running')
    order by coalesce(so.turn,-1),q.first_queued_at_ms,q.workspace_id,q.provider,q.account_id
    limit coalesce((select (value->'bounds'->>'maxCandidates')::integer from admission),0)
  )
  select admission.value || jsonb_build_object('queueRevision',cfg.revision,'configured',
    coalesce(admission.value->'budget'<>'null'::jsonb and admission.value->'bounds'<>'null'::jsonb and cfg.max_snapshot_age_ms is not null
      and cfg.last_success_at_ms<=floor(extract(epoch from statement_timestamp())*1000)::bigint
      and floor(extract(epoch from statement_timestamp())*1000)::bigint-cfg.last_success_at_ms<=cfg.max_snapshot_age_ms,false),
    'candidates',coalesce((select jsonb_agg(source||jsonb_build_object('scheduledHour',first_due_hour_ms,'queuedAt',first_queued_at_ms)
      order by first_queued_at_ms,workspace_id,provider,account_id) from pending where source is not null
      and source->>'connectionId'=connection_id and (source->>'connectionVersion')::bigint=connection_version
      and (source->>'eligibleFromMs')::bigint=eligible_from_ms),'[]'::jsonb)) from admission,cfg
$fn$;

-- Reserve one job AND bind it to current native authority/date period in one short transaction.
-- This never makes a Shopify/provider request and does not mark a queue need complete.
create function operations.commit_refresh_preflight(p_revision bigint,p_queue_revision bigint,p_state jsonb,p_source jsonb,p_window jsonb,p_partition text)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare q operations.refresh_queue_accounts%rowtype; cfg operations.refresh_queue_control%rowtype; selected jsonb; actual jsonb;
  base_source jsonb; start_day date; end_day date; now_ms bigint; additions integer;
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
    or (base_source->>'connectionVersion')::bigint<>q.connection_version or (base_source->>'eligibleFromMs')::bigint<>q.eligible_from_ms
    then return false; end if;
  if jsonb_typeof(p_window) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_window))<>2
    or coalesce(p_window->>'from','')!~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_window->>'to','')!~ '^\d{4}-\d{2}-\d{2}$'
    or length(coalesce(p_partition,'')) not between 1 and 256 then return false; end if;
  start_day:=(p_window->>'from')::date; end_day:=(p_window->>'to')::date;
  -- Daily queries cannot straddle a connection/selection boundary. No implicit recovery/backfill policy.
  if end_day<start_day or start_day::timestamp at time zone (base_source->>'timezone')<to_timestamp(q.eligible_from_ms::double precision/1000)
    or end_day>(statement_timestamp() at time zone (base_source->>'timezone'))::date then return false; end if;
  select count(*) into additions from jsonb_array_elements(p_state->'claims') c(value)
    where not exists(select 1 from operations.refresh_runs r where r.fence=(c.value->>'fence')::bigint and r.status='running');
  if additions<>1 then return false; end if;
  select value into selected from jsonb_array_elements(p_state->'claims') c(value)
    where not exists(select 1 from operations.refresh_runs r where r.fence=(c.value->>'fence')::bigint and r.status='running');
  if selected->>'workspaceId'<>q.workspace_id::text or selected->>'installGeneration'<>q.install_generation::text
    or selected->>'provider'<>q.provider or selected->>'accountId'<>q.account_id or (selected->'cost'->>'requests')::bigint<2
    or exists(select 1 from operations.refresh_runs r where r.workspace_id=q.workspace_id and r.install_generation=q.install_generation
      and r.provider=q.provider and r.account_id=q.account_id and r.job_id=selected->>'id') then return false; end if;
  if not operations.commit_refresh_admissions(p_revision,p_state) then return false; end if;
  insert into operations.refresh_work_bindings values(q.workspace_id,q.install_generation,q.provider,q.account_id,
    selected->>'id',(selected->>'fence')::bigint,base_source,start_day,end_day,p_partition);
  return true;
end
$fn$;

alter function operations.refresh_claim_is_current(uuid,bigint,text,text,text,bigint) rename to refresh_claim_is_current_before_binding;
revoke all on function operations.refresh_claim_is_current_before_binding(uuid,bigint,text,text,text,bigint)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.refresh_claim_is_current(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select operations.refresh_claim_is_current_before_binding(p_workspace,p_generation,p_provider,p_account,p_job,p_fence)
    and (not exists(select 1 from operations.refresh_work_bindings b where b.workspace_id=p_workspace and b.install_generation=p_generation
      and b.provider=p_provider and b.account_id=p_account and b.job_id=p_job)
    or exists(select 1 from operations.refresh_work_bindings b where b.workspace_id=p_workspace and b.install_generation=p_generation
      and b.provider=p_provider and b.account_id=p_account and b.job_id=p_job and b.fence=p_fence
      and b.source=operations.refresh_preflight_source(p_workspace,p_generation,p_provider,p_account)))
$fn$;

create function operations.load_refresh_bound_authority(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint,p_from date,p_to date)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select b.source||jsonb_build_object('installationVerified',true,'connected',true,'setupComplete',true,'allowedWindow',true)
  from operations.refresh_work_bindings b where b.workspace_id=p_workspace and b.install_generation=p_generation
    and b.provider=p_provider and b.account_id=p_account and b.job_id=p_job and b.fence=p_fence and b.from_date=p_from and b.to_date=p_to
    and operations.refresh_claim_is_current(p_workspace,p_generation,p_provider,p_account,p_job,p_fence)
$fn$;

-- Stage writes must use the reserved window; changing the worker's input cannot widen it.
alter function operations.advance_refresh_work_stage(uuid,bigint,text,text,text,bigint,text,text,bigint,bigint,date,date)
  rename to advance_refresh_work_stage_before_binding;
revoke all on function operations.advance_refresh_work_stage_before_binding(uuid,bigint,text,text,text,bigint,text,text,bigint,bigint,date,date)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.advance_refresh_work_stage(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint,
  p_expected text,p_stage text,p_rows bigint,p_bytes bigint,p_from date,p_to date)
returns boolean language plpgsql security definer set search_path = '' as $fn$
begin
  perform 1 from operations.refresh_control where singleton for update;
  if exists(select 1 from operations.refresh_work_bindings b where b.workspace_id=p_workspace and b.install_generation=p_generation
    and b.provider=p_provider and b.account_id=p_account and b.job_id=p_job)
    and operations.load_refresh_bound_authority(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_from,p_to) is null then return false; end if;
  return operations.advance_refresh_work_stage_before_binding(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_expected,p_stage,p_rows,p_bytes,p_from,p_to);
end
$fn$;

-- Internal coordinator may not bypass native binding with arbitrary generic admissions.
-- Existing owner-context synthetic lineage probes retain the generic test path.
revoke all on function operations.commit_refresh_admissions(bigint,jsonb) from adstable_refresh_coordinator;
revoke all on function operations.refresh_preflight_source(uuid,bigint,text,text),operations.read_refresh_preflight_snapshot(),
  operations.commit_refresh_preflight(bigint,bigint,jsonb,jsonb,jsonb,text),operations.load_refresh_bound_authority(uuid,bigint,text,text,text,bigint,date,date),
  operations.refresh_claim_is_current(uuid,bigint,text,text,text,bigint),
  operations.advance_refresh_work_stage(uuid,bigint,text,text,text,bigint,text,text,bigint,bigint,date,date)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.read_refresh_preflight_snapshot(),operations.commit_refresh_preflight(bigint,bigint,jsonb,jsonb,jsonb,text),
  operations.load_refresh_bound_authority(uuid,bigint,text,text,text,bigint,date,date),operations.refresh_claim_is_current(uuid,bigint,text,text,text,bigint),
  operations.advance_refresh_work_stage(uuid,bigint,text,text,text,bigint,text,text,bigint,bigint,date,date) to adstable_refresh_coordinator;
reset role;
commit;
