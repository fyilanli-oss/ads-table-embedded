begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Hold the same coordinator lock used by admission and interruption review
-- from the current-claim check through the existing report transaction.
create function analytics.commit_scheduled_dataset_reconciliation(o jsonb,p jsonb,c jsonb,d timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  workspace uuid := (o->>'workspaceId')::uuid;
  generation bigint := (o->>'generation')::bigint;
  provider_name text := o->>'provider';
  account text := o->>'accountId';
  job text := c->'sourceContext'->>'job_id';
  claim_fence bigint := (c->'sourceContext'->>'fence')::bigint;
  day date := (c->>'businessDate')::date;
  receipt jsonb;
begin
  perform 1 from operations.refresh_control where singleton for update;
  if not found then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'; end if;
  perform evidence.assert_source_owner(o);

  if d is null or d<=clock_timestamp()
    or operations.refresh_claim_is_current(workspace,generation,provider_name,account,job,claim_fence) is not true
    or not exists (
      select 1 from operations.refresh_work_bindings b
      join operations.refresh_work_progress s on s.fence=b.fence and s.workspace_id=b.workspace_id
        and s.install_generation=b.install_generation and s.provider=b.provider and s.account_id=b.account_id and s.job_id=b.job_id
      where b.workspace_id=workspace and b.install_generation=generation and b.provider=provider_name
        and b.account_id=account and b.job_id=job and b.fence=claim_fence
        and b.from_date=day and b.to_date=day and s.from_date=day and s.to_date=day
        and s.stage='ready_for_dataset' and b.source=c->'sourceContext'->'snapshot'
        and extract(epoch from d)*1000<=b.deadline_at_ms
    ) then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'; end if;

  receipt:=analytics.commit_dataset_reconciliation(o,p,c,d);
  if receipt->>'status'='consumed' then
    update evidence.source_batches set manifest=manifest||jsonb_build_object('scheduledDatasetClaim',
      jsonb_build_object('job',job,'fence',claim_fence::text,'digest',receipt->>'digest'))
    where authority=o and manifest->'datasetReconciliation'=receipt
      and id in (select value::bigint from jsonb_array_elements_text(receipt->'batchIds'));
    if not found then raise exception 'SCHEDULED_DATASET_RECEIPT_REQUIRED'; end if;
    if exists(select 1 from evidence.source_batches where authority=o and manifest->'datasetReconciliation'=receipt
      and octet_length(manifest::text)>1048576) then raise exception 'SCHEDULED_DATASET_RECEIPT_LIMIT'; end if;
  end if;
  return receipt;
end $fn$;

-- Completion is separate from the write so a lost write acknowledgement cannot
-- release capacity. The caller presents the verified receipt; recheck it under
-- the same coordinator lock before changing the job's durable status.
create function analytics.finish_scheduled_dataset_reconciliation(o jsonb,j text,f bigint,op uuid,h text) returns boolean
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
  return operations.finish_refresh_work_before_stops(w,g,p,a,j,f,'completed');
end $fn$;

revoke all on function analytics.commit_scheduled_dataset_reconciliation(jsonb,jsonb,jsonb,timestamptz)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
revoke all on function analytics.finish_scheduled_dataset_reconciliation(jsonb,text,bigint,uuid,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
