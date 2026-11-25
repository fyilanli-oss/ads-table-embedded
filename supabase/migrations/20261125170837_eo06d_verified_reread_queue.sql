begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

create table operations.refresh_historical_rereads (
  workspace_id uuid not null,
  install_generation bigint not null,
  provider text not null,
  account_id text not null,
  business_date date not null,
  source_batch_id bigint not null references evidence.source_batches(id) on delete cascade,
  first_job_id text not null,
  first_fence bigint not null,
  first_digest text not null,
  due_at timestamptz not null,
  admitted_job_id text,
  admitted_at timestamptz,
  primary key (workspace_id,install_generation,provider,account_id,business_date),
  check ((admitted_job_id is null) = (admitted_at is null))
);
create index refresh_historical_rereads_source_idx
  on operations.refresh_historical_rereads(source_batch_id);
create index refresh_historical_rereads_due_idx on operations.refresh_historical_rereads
  (workspace_id,install_generation,provider,account_id,due_at,business_date) where admitted_at is null;
create index refresh_historical_rereads_admitted_idx on operations.refresh_historical_rereads
  (workspace_id,install_generation,provider,account_id,admitted_at) where admitted_at is not null;

alter table operations.refresh_historical_rereads enable row level security;
alter table operations.refresh_historical_rereads force row level security;
create policy refresh_historical_rereads_owner on operations.refresh_historical_rereads
  to adstable_owner using (true) with check (true);
revoke all on operations.refresh_historical_rereads
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;

-- Only the three verified report close functions call this owner-only hook.
create function operations.record_refresh_historical_reread(o jsonb,j text,f bigint,receipt jsonb)
returns void language plpgsql security definer set search_path='' as $fn$
declare
  finished timestamptz;
  anchor bigint;
  day date;
  tz text;
begin
  if receipt->'revision' is distinct from '1'::jsonb then return; end if;
  day:=(receipt->>'businessDate')::date;
  tz:=receipt->>'timeZone';
  select r.finished_at into finished from operations.refresh_runs r
    join operations.refresh_work_bindings w using(workspace_id,install_generation,provider,account_id,job_id,fence)
    where r.workspace_id=(o->>'workspaceId')::uuid and r.install_generation=(o->>'generation')::bigint
      and r.provider=o->>'provider' and r.account_id=o->>'accountId' and r.job_id=j and r.fence=f
      and r.status='completed' and w.from_date=day and w.to_date=day and w.source->>'timezone'=tz
      and left(w.partition_id,10)<>'v1-reread:';
  if finished is null or day >= (finished at time zone tz)::date then return; end if;
  select b.id into anchor from jsonb_array_elements_text(receipt->'batchIds') ids
    join evidence.source_batches b on b.id=ids.value::bigint
    where b.authority=o and b.storage_state='committed' and b.handoff_state='consumed'
      and b.handoff_receipt=receipt->>'digest' and not (b.manifest ? 'datasetSupersededBy')
      and b.manifest->'privacyRedacted' is distinct from 'true'::jsonb
      and (b.manifest->'googleDailyReceipt'=receipt or b.manifest->'klaviyoDailyReceipt'=receipt
        or (b.manifest->'datasetReconciliation'=receipt and b.manifest->'scheduledDatasetClaim'=
          jsonb_build_object('job',j,'fence',f::text,'digest',receipt->>'digest')))
    order by b.id limit 1;
  if anchor is null then return; end if;
  insert into operations.refresh_historical_rereads(workspace_id,install_generation,provider,account_id,business_date,
    source_batch_id,first_job_id,first_fence,first_digest,due_at)
    values((o->>'workspaceId')::uuid,(o->>'generation')::bigint,o->>'provider',o->>'accountId',day,
      anchor,j,f,receipt->>'digest',((finished at time zone tz)+interval '7 days') at time zone tz)
    on conflict (workspace_id,install_generation,provider,account_id,business_date) do nothing;
end $fn$;

-- The same eligibility query is used for the snapshot and under the existing
-- coordinator lock when the work binding is inserted.
create function operations.next_refresh_historical_reread(p_source jsonb,p_at timestamptz)
returns date language sql stable security definer set search_path='' as $fn$
  select r.business_date from operations.refresh_historical_rereads r
  join evidence.source_batches b on b.id=r.source_batch_id
  join operations.refresh_work_bindings first_binding
    on first_binding.workspace_id=r.workspace_id and first_binding.install_generation=r.install_generation
    and first_binding.provider=r.provider and first_binding.account_id=r.account_id
    and first_binding.job_id=r.first_job_id and first_binding.fence=r.first_fence
  where r.workspace_id=(p_source->>'workspaceId')::uuid and r.install_generation=(p_source->>'installGeneration')::bigint
    and r.provider=p_source->>'provider' and r.account_id=p_source->>'accountId'
    and first_binding.source=(p_source-array['scheduledHour','queuedAt'])
    and r.admitted_at is null and r.due_at<=p_at
    and b.storage_state='committed' and b.handoff_state='consumed' and b.handoff_receipt=r.first_digest
    and b.retain_until>p_at and not (b.manifest ? 'datasetSupersededBy')
    and b.manifest->'privacyRedacted' is distinct from 'true'::jsonb
    and not exists(select 1 from privacy.deletion_runs deletion where deletion.workspace_id=r.workspace_id
      and deletion.install_generation=r.install_generation and deletion.kind in ('customer_redact','shop_redact','merchant_delete_my_data')
      and deletion.status in ('pending','running','failed'))
    and not exists(select 1 from operations.refresh_historical_rereads today
      where today.workspace_id=r.workspace_id and today.install_generation=r.install_generation
        and today.provider=r.provider and today.account_id=r.account_id
        and today.admitted_at >= date_trunc('day',p_at,p_source->>'timezone'))
  order by r.due_at,r.business_date limit 1
$fn$;

create function operations.read_refresh_reread_preflight_snapshot()
returns jsonb language sql stable security definer set search_path='' as $fn$
  with snapshot as materialized(select operations.read_refresh_preflight_snapshot() as data)
  select case when data->'configured' is distinct from 'true'::jsonb then data else
    jsonb_set(data,'{candidates}',coalesce((
      select jsonb_agg(source||jsonb_build_object('historicalDate',operations.next_refresh_historical_reread(source,statement_timestamp())) order by ordinal)
      from jsonb_array_elements(data->'candidates') with ordinality c(source,ordinal)
    ),'[]'::jsonb)) end from snapshot
$fn$;

-- Admission has already checked the latest queue revision, authority, budget
-- and single-flight. Claiming the due day rolls back with its work binding.
create function operations.claim_refresh_historical_reread()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare started timestamptz:=clock_timestamp();
begin
  if new.from_date<>new.to_date or new.partition_id<>'v1-reread:'||new.from_date::text
    or operations.next_refresh_historical_reread(new.source,started) is distinct from new.from_date then
    raise exception 'REFRESH_HISTORICAL_REREAD_NOT_DUE';
  end if;
  update operations.refresh_historical_rereads set admitted_job_id=new.job_id,admitted_at=started
    where workspace_id=new.workspace_id and install_generation=new.install_generation
      and provider=new.provider and account_id=new.account_id and business_date=new.from_date and admitted_at is null;
  if not found then raise exception 'REFRESH_HISTORICAL_REREAD_ALREADY_ADMITTED'; end if;
  return new;
end $fn$;
create trigger claim_refresh_historical_reread before insert on operations.refresh_work_bindings
  for each row when (left(new.partition_id,10)='v1-reread:')
  execute function operations.claim_refresh_historical_reread();

revoke all on function operations.record_refresh_historical_reread(jsonb,text,bigint,jsonb),
  operations.next_refresh_historical_reread(jsonb,timestamptz),operations.read_refresh_reread_preflight_snapshot(),
  operations.claim_refresh_historical_reread()
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;
grant execute on function operations.read_refresh_reread_preflight_snapshot() to adstable_refresh_coordinator;

create or replace function analytics.finish_scheduled_dataset_reconciliation(o jsonb,j text,f bigint,op uuid,h text) returns boolean
language plpgsql security definer set search_path='' as $fn$
declare
  w uuid := (o->>'workspaceId')::uuid;
  g bigint := (o->>'generation')::bigint;
  p text := o->>'provider';
  a text := o->>'accountId';
  r jsonb;
begin
  perform 1 from operations.refresh_control where singleton for update;
  if not found then return false; end if;
  perform evidence.assert_source_owner(o);
  if h is null or h !~ '^[0-9a-f]{64}$' or operations.refresh_claim_is_current(w,g,p,a,j,f) is not true
    or not exists(select 1 from evidence.source_batches b where b.authority=o and b.handoff_state='consumed'
      and b.manifest->'datasetReconciliation'->>'operationId'=op::text
      and b.manifest->'scheduledDatasetClaim'=jsonb_build_object('job',j,'fence',f::text,'digest',h)) then return false; end if;
  r:=analytics.inspect_dataset_reconciliation(o,op);
  if r->>'status' is distinct from 'consumed' or r->>'digest' is distinct from h
    or r->'consumerReceipt' is distinct from 'true'::jsonb or r->'checkpointAdvanced' is distinct from 'true'::jsonb
    or r->>'comparison' is distinct from 'matched'
    or not exists(select 1 from operations.refresh_work_progress s where s.fence=f and s.workspace_id=w
      and s.install_generation=g and s.provider=p and s.account_id=a and s.job_id=j and s.stage='ready_for_dataset'
      and s.from_date=(r->>'businessDate')::date and s.to_date=s.from_date)
    or operations.refresh_claim_is_current(w,g,p,a,j,f) is not true then return false; end if;
  if not operations.finish_refresh_work_before_stops(w,g,p,a,j,f,'completed') then return false; end if;
  perform operations.record_refresh_historical_reread(o,j,f,r);
  return true;
end $fn$;

create or replace function analytics.finish_google_daily_report_job(o jsonb,j text,f bigint,op uuid,h text)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare
  w uuid := (o->>'workspaceId')::uuid;
  g bigint := (o->>'generation')::bigint;
  a text := o->>'accountId';
  r jsonb;
begin
  perform 1 from operations.refresh_control where singleton for update;
  if not found then return false; end if;
  perform evidence.assert_source_owner(o);
  if o->>'provider' is distinct from 'google_ads' or op is null or h is null or h !~ '^[0-9a-f]{64}$'
    or operations.refresh_claim_is_current(w,g,'google_ads',a,j,f) is not true then return false; end if;
  r:=analytics.inspect_google_daily_report(o,op);
  if r->>'status' is distinct from 'consumed' or r->>'comparison' is distinct from 'matched'
    or r->'consumerReceipt' is distinct from 'true'::jsonb or r->'checkpointAdvanced' is distinct from 'true'::jsonb
    or r->>'digest' is distinct from h or r->>'jobId' is distinct from j or r->>'fence' is distinct from f::text
    or not exists(select 1 from operations.refresh_work_progress s where s.workspace_id=w and s.install_generation=g
      and s.provider='google_ads' and s.account_id=a and s.job_id=j and s.fence=f and s.stage='ready_for_dataset'
      and s.from_date=(r->>'businessDate')::date and s.to_date=s.from_date)
    or operations.refresh_claim_is_current(w,g,'google_ads',a,j,f) is not true then return false; end if;
  if not operations.finish_refresh_work_before_stops(w,g,'google_ads',a,j,f,'completed') then return false; end if;
  perform operations.record_refresh_historical_reread(o,j,f,r);
  return true;
end $fn$;

create or replace function analytics.finish_klaviyo_daily_report_job(o jsonb,j text,f bigint,op uuid,h text)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare
  w uuid := (o->>'workspaceId')::uuid;
  g bigint := (o->>'generation')::bigint;
  a text := o->>'accountId';
  r jsonb;
begin
  perform 1 from operations.refresh_control where singleton for update;
  if not found then return false; end if;
  perform evidence.assert_source_owner(o);
  if o->>'provider' is distinct from 'klaviyo' or op is null or h is null or h !~ '^[0-9a-f]{64}$'
    or operations.refresh_claim_is_current(w,g,'klaviyo',a,j,f) is not true then return false; end if;
  r:=analytics.inspect_klaviyo_daily_report(o,op);
  if r->>'status' is distinct from 'consumed' or r->>'comparison' is distinct from 'matched'
    or r->'consumerReceipt' is distinct from 'true'::jsonb or r->'checkpointAdvanced' is distinct from 'true'::jsonb
    or r->>'digest' is distinct from h or r->>'jobId' is distinct from j or r->>'fence' is distinct from f::text
    or not exists(select 1 from operations.refresh_work_progress s where s.workspace_id=w and s.install_generation=g
      and s.provider='klaviyo' and s.account_id=a and s.job_id=j and s.fence=f and s.stage='ready_for_dataset'
      and s.from_date=(r->>'businessDate')::date and s.to_date=s.from_date)
    or operations.refresh_claim_is_current(w,g,'klaviyo',a,j,f) is not true then return false; end if;
  if not operations.finish_refresh_work_before_stops(w,g,'klaviyo',a,j,f,'completed') then return false; end if;
  perform operations.record_refresh_historical_reread(o,j,f,r);
  return true;
end $fn$;
reset role;
commit;
