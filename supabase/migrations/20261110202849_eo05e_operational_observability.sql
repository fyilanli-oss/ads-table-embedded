begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

create function operations.read_refresh_queue_witness() returns jsonb
language sql stable security definer set search_path='' as $fn$
 select case when t.enabled and t.generation is not null and t.sequence>0 then
  jsonb_build_object('generation',t.generation,'sequence',t.sequence,'queueRevision',t.queue_revision,'checkedAtMs',t.last_checked_at_ms)
  else null end from operations.refresh_tick_control t where singleton
$fn$;
revoke all on function operations.read_refresh_queue_witness()
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- Read existing durable evidence only. No new tables, history, grants, counters,
-- claims, inspection of ambiguous operations, reservation release or activation.
create function operations.read_refresh_observation(o jsonb,d date,tz text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare q operations.refresh_queue_control%rowtype; t operations.refresh_tick_control%rowtype;
 head jsonb; proof jsonb; freshness jsonb; jobs jsonb; n integer; observed bigint; stats jsonb;
 item record; maturity jsonb; nonfinal_age bigint:=0; maturity_count integer:=0; maturity_unknown boolean:=false;
begin
 perform evidence.assert_source_owner(o);
 if d is null or tz is null or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=tz)
 or o->>'provider' not in ('google_ads','meta','klaviyo') then raise exception 'OBSERVATION_SCOPE_INVALID';end if;
 observed:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 select * into strict q from operations.refresh_queue_control where singleton;
 select * into strict t from operations.refresh_tick_control where singleton;

 select coalesce(jsonb_agg(j.v order by j.fence),'[]'::jsonb),count(*) into jobs,n from (
  select r.fence,jsonb_build_object('fence',r.fence::text,'state',r.status,'startedAt',r.started_at,
   'finishedAt',r.finished_at,'stage',p.stage,'progressAt',p.observed_at,'rowsObserved',p.rows_observed::text,
   'bytesObserved',p.bytes_observed::text,'stopState',s.state,'callState',s.call_state,
   'reservedBudget',r.cost,'budgetIsActualUsage',false) v
  from operations.refresh_runs r
  left join operations.refresh_work_progress p on p.fence=r.fence
  left join operations.refresh_work_stops s on s.workspace_id=r.workspace_id and s.install_generation=r.install_generation
   and s.provider=r.provider and s.account_id=r.account_id and s.job_id=r.job_id
  where r.workspace_id=(o->>'workspaceId')::uuid and r.install_generation=(o->>'generation')::bigint
   and r.provider=o->>'provider' and r.account_id=o->>'accountId'
  order by r.fence desc limit 101
 ) j;

 -- Only an already-known consumed day head can be verified for freshness.
 -- A pending/ambiguous operation is never inspected or recovered by this monitor.
 select b.manifest->'datasetReconciliation' into head from evidence.source_batches b
 where b.authority=o and b.workspace_id=(o->>'workspaceId')::uuid and b.primary_source=o->>'provider'
 and b.manifest ? 'datasetReconciliation' and not b.manifest ? 'datasetSupersededBy'
 and b.manifest->'datasetReconciliation'->>'businessDate'=d::text
 and b.manifest->'datasetReconciliation'->>'timeZone'=tz
 and b.handoff_state='consumed' and b.storage_state='committed'
 and b.retain_until>clock_timestamp() and b.manifest->'privacyRedacted' is distinct from 'true'::jsonb
 order by (b.manifest->'datasetReconciliation'->>'revision')::bigint desc,b.id desc limit 1;
 freshness:=jsonb_build_object('status','missing','lastVerifiedAtMs',null,'rowCount',null,'isZero',null);
 if head is not null then
  begin
   proof:=analytics.inspect_dataset_reconciliation(o,(head->>'operationId')::uuid);
   if proof->>'status'='consumed' and proof->'consumerReceipt'='true'::jsonb
    and proof->'checkpointAdvanced'='true'::jsonb and proof->>'comparison'='matched'
    and (proof->>'completedAt')::timestamptz<=clock_timestamp() then
    freshness:=jsonb_build_object('status','verified','lastVerifiedAtMs',floor(extract(epoch from (proof->>'completedAt')::timestamptz)*1000)::bigint,
     'rowCount',(proof->>'rowCount')::integer,'isZero',(proof->>'rowCount')::integer=0);
   else freshness:=jsonb_build_object('status','mismatch','lastVerifiedAtMs',null,'rowCount',null,'isZero',null);end if;
  exception when others then freshness:=jsonb_build_object('status','unavailable','lastVerifiedAtMs',null,'rowCount',null,'isZero',null);end;
 end if;
 -- Bounded existing maturity receipts; a missing/truncated/invalid inventory is
 -- UNKNOWN, never final or zero. No business history is generated or updated.
 for item in select b.attempt_id,b.manifest->'maturityHead' h from evidence.source_batches b
  where b.authority=o and b.workspace_id=(o->>'workspaceId')::uuid and b.primary_source=o->>'provider'
   and b.manifest ? 'maturityHead' and not b.manifest ? 'datasetSupersededBy'
   and b.manifest->'maturityHead'->>'timeZone'=tz
   and (b.manifest->'maturityHead'->>'businessDate')::date<d
   and b.storage_state='committed' and b.retain_until>clock_timestamp()
   and b.manifest->'privacyRedacted' is distinct from 'true'::jsonb
  order by (b.manifest->'maturityHead'->>'businessDate')::date limit 101 loop
  maturity_count:=maturity_count+1;
  if maturity_count>100 then maturity_unknown:=true;exit;end if;
  begin
   maturity:=evidence.read_maturity_decision(o,item.attempt_id);
   if maturity->>'state' is null then maturity_unknown:=true;
   elsif maturity->>'state'<>'final' then
    nonfinal_age:=greatest(nonfinal_age,observed-floor(extract(epoch from (((maturity->>'businessDate')::date+1)::timestamp at time zone tz))*1000)::bigint);
   end if;
  exception when others then maturity_unknown:=true;end;
 end loop;
 select jsonb_build_object('scope','database_cumulative_not_tenant_attribution','statsReset',s.stats_reset,
  'databaseBytes',pg_catalog.pg_database_size(current_database())::text,'backends',s.numbackends,
  'blocksRead',s.blks_read::text,'blocksHit',s.blks_hit::text,'tempBytes',s.temp_bytes::text,
  'commits',s.xact_commit::text,'rollbacks',s.xact_rollback::text,'deadlocks',s.deadlocks::text,
  'poolerConnections','unknown','diskIOPS','unknown','queryLatency','unknown','WALBytes','unknown') into stats
 from pg_catalog.pg_stat_database s where s.datname=current_database();
 return jsonb_build_object('version','eo05e-observability-v1','observedAtMs',observed,'businessDate',d,'timeZone',tz,
  'queue',jsonb_build_object('enabled',t.enabled,'generation',t.generation,'sequence',t.sequence,'queueRevision',t.queue_revision,
   'checkedAtMs',t.last_checked_at_ms,'activatedAtMs',q.activated_at_ms,'lastSuccessAtMs',q.last_success_at_ms),
  'jobs',jobs,'jobsTruncated',n>100,'freshness',freshness,'resources',stats,
  'reconciliation',jsonb_build_object('status',case when maturity_count=0 or maturity_unknown then 'unknown' else 'bounded_receipts_observed' end,
   'oldestNonfinalAgeMs',case when maturity_count=0 or maturity_unknown then null else nonfinal_age end,
   'coverage','existing_receipts_only_requires_expected_date_manifest','truncated',maturity_count>100),
  'liveMonitoringActive',false);
end $fn$;
revoke all on function operations.read_refresh_observation(jsonb,date,text)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
