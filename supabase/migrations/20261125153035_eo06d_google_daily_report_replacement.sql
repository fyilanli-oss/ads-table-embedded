begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

-- Check what must change before replacing a published day. No fact or receipt
-- is changed here. The write must use the same transaction and coordinator lock.
create function analytics.plan_google_staged_report_replacement(
  o jsonb, c jsonb, d timestamptz, operation uuid, policy jsonb, digests jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  head jsonb;
  prior jsonb;
  old_fact jsonb;
  ref jsonb;
  table_name text;
  completed timestamptz;
  day date := (c->>'businessDate')::date;
  timezone text := c->'sourceContext'->'snapshot'->>'timezone';
  started timestamptz := (c->>'startedAt')::timestamptz;
  w uuid := (o->>'workspaceId')::uuid;
  i bigint := (o->>'installationId')::bigint;
  g bigint := (o->>'generation')::bigint;
  a text := o->>'accountId';
  row_total integer:=0;
  staged_keys jsonb;
begin
  perform 1 from operations.refresh_control where singleton for update;
  if not found then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'; end if;
  perform analytics.assert_google_daily_report_claim(o,c,d);
  perform analytics.verify_google_daily_report_stage(o,c,d,operation,policy,digests);
  select candidate.receipt into head
   from evidence.source_batches b
   cross join lateral (select b.manifest->'googleDailyReceipt' receipt) candidate
   where b.workspace_id=w and b.installation_id=i and b.installation_generation=g
     and b.primary_source='google_ads' and b.authority=o and not (b.manifest ? 'datasetSupersededBy')
     and candidate.receipt->>'businessDate'=day::text and candidate.receipt->>'timeZone'=timezone
   order by (candidate.receipt->>'revision')::bigint desc,b.id desc limit 1;
  if head is null or head->'revision' is distinct from c->'expectedRevision'
    or head->>'jobId'=c->'sourceContext'->>'job_id' then
    raise exception 'GOOGLE_REPORT_REVISION_CONFLICT';
  end if;
  prior:=analytics.inspect_google_daily_report(o,(head->>'operationId')::uuid);
  if prior->>'status' is distinct from 'consumed' or prior->>'comparison' is distinct from 'matched'
    or prior->>'digest' is distinct from head->>'digest'
    or started is null or started>clock_timestamp()
    or (prior->>'completedAt')::timestamptz>started then
    raise exception 'GOOGLE_REPORT_PREVIOUS_REVISION_UNAVAILABLE';
  end if;
  select jsonb_object_agg((item->>'table')||':'||(item->'row'->>'native_key_hash'),true)
    into staged_keys from pg_temp.adstable_google_daily_report_stage s
    cross join lateral jsonb_array_elements(s.body->'rows') item;
  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    for old_fact in execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''google_ads'' and platform_account_id=$4 and business_date=$5 order by id limit 4001 for update',table_name)
      using w,i,g,a,day
    loop
      row_total:=row_total+1;
      if row_total>4000 or old_fact->>'source_timezone' is distinct from timezone
        or old_fact->>'provider_connection_id' is distinct from o->>'connectionId'
        or (old_fact->>'retain_until')::timestamptz<=clock_timestamp() then
        raise exception 'GOOGLE_REPORT_REPLACEMENT_SCOPE_INVALID';
      end if;
      for ref in select value from jsonb_array_elements(old_fact->'provenance'->'sources') loop
        perform analytics.assert_dataset_source(o,ref);
        select (b.manifest->'googleDatasetRead'->>'completedAt')::timestamptz into completed
          from evidence.source_batches b where b.id=(ref->>'batch_id')::bigint and b.authority=o;
        if completed is null or completed>started then raise exception 'GOOGLE_REPORT_REPLACEMENT_STALE'; end if;
      end loop;
      if not (coalesce(staged_keys,'{}'::jsonb) ? (table_name||':'||(old_fact->>'native_key_hash')))
        and analytics.dataset_retention_has_dependents(table_name,old_fact) then
        raise exception 'DATASET_RECONCILIATION_DEPENDENT';
      end if;
    end loop;
  end loop;
  if row_total is distinct from (prior->>'rowCount')::integer or d<=clock_timestamp() then
    raise exception 'GOOGLE_REPORT_REPLACEMENT_SCOPE_INVALID';
  end if;
  return prior->'batchIds';
end $fn$;

revoke all on function analytics.plan_google_staged_report_replacement(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;

-- Isolated replacement step. Reuse the normal row revision permit, retention
-- checks and package writer. Publication still requires a separate receipt.
create function analytics.replace_google_staged_report_day(
  o jsonb,c jsonb,d timestamptz,operation uuid,policy jsonb,digests jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  s record;
  item jsonb;
  r jsonb;
  old_fact jsonb;
  written jsonb;
  previous_batch_ids jsonb;
  proof jsonb;
  table_name text;
  allowed text[];
  assignments text;
  staged_keys jsonb;
  source_id bigint;
  mapping_column text;
  day date := (c->>'businessDate')::date;
  w uuid := (o->>'workspaceId')::uuid;
  i bigint := (o->>'installationId')::bigint;
  g bigint := (o->>'generation')::bigint;
  a text := o->>'accountId';
begin
  previous_batch_ids:=analytics.plan_google_staged_report_replacement(o,c,d,operation,policy,digests);
  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    select coalesce(jsonb_object_agg(entry.value->'row'->>'native_key_hash',true),'{}'::jsonb)
      into staged_keys from pg_temp.adstable_google_daily_report_stage staged
      cross join lateral jsonb_array_elements(staged.body->'rows') entry
      where entry.value->>'table'=table_name;
    execute format('delete from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''google_ads'' and platform_account_id=$4 and business_date=$5
      and not ($6 ? x.native_key_hash)',table_name)
      using w,i,g,a,day,staged_keys;
  end loop;
  for s in select body from pg_temp.adstable_google_daily_report_stage order by package_ordinal loop
    for item in select value from jsonb_array_elements(s.body->'rows') loop
      table_name:=item->>'table';
      r:=item->'row';
      if table_name is null or table_name not in ('pd_facts','cpd_product_performance_facts','cpd_product_sales_facts')
        or r->>'business_date' is distinct from day::text
        or r->'provenance'->'source_context' is distinct from c->'sourceContext' then
        raise exception 'GOOGLE_REPORT_PACKAGE_SCOPE_INVALID';
      end if;
      execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''google_ads'' and platform_account_id=$4 and grain_version=$5 and native_key_hash=$6 for update',table_name)
        into old_fact using w,i,g,a,r->>'grain_version',r->>'native_key_hash';
      if old_fact is null then continue; end if;
      if old_fact->>'native_key_canonical' is distinct from r->>'native_key_canonical'
        or old_fact->>'business_date' is distinct from day::text
        or old_fact->>'source_timezone' is distinct from r->>'source_timezone'
        or old_fact->>'provider_connection_id' is distinct from o->>'connectionId'
        or (old_fact->>'retain_until')::timestamptz<=clock_timestamp() then
        raise exception 'DATASET_RECONCILIATION_KEY_CONFLICT';
      end if;
      select array_agg(attname::text),string_agg(format('%I=v.%I',attname,attname),',')
        into allowed,assignments from pg_catalog.pg_attribute
        where attrelid=('analytics.'||table_name)::regclass and attnum>0 and not attisdropped
          and attname not in ('id','workspace_id','installation_id','installation_generation','provider_connection_id',
            'platform','platform_account_id','canonical_reporting_account_id','revision','created_at','updated_at',
            'retention_policy_version','retain_until');
      if (select count(*) from jsonb_object_keys(r))<>cardinality(allowed) or not r ?& allowed
        or r->>'payload_digest' is distinct from analytics.google_daily_digest(r-array['native_key_canonical','native_key_hash','grain_version','row_schema_version','payload_digest']) then
        raise exception 'DATASET_ROW_SHAPE_INVALID';
      end if;
      for source_id in select distinct (ref->>'batch_id')::bigint from jsonb_array_elements(r->'provenance'->'sources') ref loop
        perform analytics.hold_report_source_batch(o,source_id,(policy->>'until')::timestamptz);
      end loop;
      foreach mapping_column in array array['product_mapping_id','sold_product_mapping_id','advertised_product_mapping_id'] loop
        if r->>mapping_column is not null then
          perform analytics.hold_report_mapping(o,(r->>mapping_column)::bigint,(policy->>'until')::timestamptz);
        end if;
      end loop;
      source_id:=(r->>'source_batch_id')::bigint;
      update evidence.source_batches set manifest=manifest||jsonb_build_object('datasetRevisionPermit',jsonb_build_object(
        'transactionId',pg_catalog.txid_current()::text,'table',table_name,'id',old_fact->>'id',
        'fromRevision',old_fact->>'revision','toRevision',((old_fact->>'revision')::bigint+1)::text,
        'before',old_fact->>'payload_digest','after',r->>'payload_digest'))
        where id=source_id and authority=o and handoff_state='pending';
      if not found then raise exception 'DATASET_REVISION_PROTOCOL_REQUIRED'; end if;
      execute format('update analytics.%I x set %s,revision=x.revision+1,updated_at=clock_timestamp(),
        retention_policy_version=$3,retain_until=$4 from jsonb_populate_record(null::analytics.%I,$1) v where x.id=$2',
        table_name,assignments,table_name) using r,(old_fact->>'id')::bigint,policy->>'version',(policy->>'until')::timestamptz;
      update evidence.source_batches set manifest=manifest-'datasetRevisionPermit' where id=source_id and authority=o;
    end loop;
    if jsonb_array_length(s.body->'rows')=0 then continue; end if;
    written:=analytics.commit_google_daily_package(o,s.body||jsonb_build_object('operationId',gen_random_uuid()));
    if written->>'status' is distinct from 'stored'
      or jsonb_array_length(written->'rows') is distinct from jsonb_array_length(s.body->'rows') then
      raise exception 'GOOGLE_REPORT_PACKAGE_WRITE_INVALID';
    end if;
  end loop;
  proof:=analytics.check_google_daily_report_facts(o,c,d,operation,policy,digests);
  return proof || jsonb_build_object('previousBatchIds',previous_batch_ids);
end $fn$;

revoke all on function analytics.replace_google_staged_report_day(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;

create function analytics.correct_google_staged_report_day(o jsonb,c jsonb,d timestamptz,operation uuid,policy jsonb,digests jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype;r jsonb;v text;kind text;ids jsonb;proof jsonb;receipt jsonb;anchor bigint;
 day date:=(c->>'businessDate')::date;tz text:=c->'sourceContext'->'snapshot'->>'timezone';raw_operation text;completed timestamptz;started timestamptz;groups integer:=0;revision integer;
begin
 perform 1 from operations.refresh_control where singleton for update;
 perform analytics.assert_google_daily_report_claim(o,c,d);
 perform analytics.verify_google_daily_report_stage(o,c,d,operation,policy,digests);
 if jsonb_typeof(c->'expectedRevision') is distinct from 'number'
 or coalesce(c->>'expectedRevision','') !~ '^[1-9][0-9]{0,8}$' or policy->>'version' is distinct from 'report-source-3y-v1'
 or jsonb_typeof(c->'batchIds') is distinct from 'array' or jsonb_array_length(c->'batchIds') not between 2 and 41
 or c->'sourceContext'->'window' is distinct from jsonb_build_object('from',day,'to',day)
 or (select count(distinct value) from jsonb_array_elements_text(c->'batchIds'))<>jsonb_array_length(c->'batchIds')
 or (select count(distinct value->>'page_id') from jsonb_array_elements(c->'sources'))<>jsonb_array_length(c->'sources')
 or exists(select 1 from jsonb_array_elements(c->'sources') ref where not(c->'batchIds' ? (ref->>'batch_id')))
 or exists(select 1 from evidence.source_batches where authority=o
   and manifest->'googleDailyReceipt'->>'operationId'=operation::text)
 then raise exception 'GOOGLE_REPORT_CORRECTION_SCOPE_INVALID';end if;
 perform analytics.assert_report_source_context(o,c->'sourceContext',(policy->>'until')::timestamptz,c->'sources');
 perform id from evidence.source_batches where authority=o and id in(select value::bigint from jsonb_array_elements_text(c->'batchIds')) order by id for update;
 for v in select value from jsonb_array_elements_text(c->'batchIds') loop
  select * into strict b from evidence.source_batches where id=v::bigint and authority=o;
  r:=b.manifest->'googleDatasetRead';raw_operation:=coalesce(raw_operation,r->>'operationId');
  if b.storage_state<>'committed' or b.handoff_state<>'pending' or b.retain_until<=clock_timestamp()
   or b.manifest->'privacyRedacted'='true'::jsonb or b.manifest ? 'datasetReconciliationMismatch'
   or r->>'jobId' is distinct from c->'sourceContext'->>'job_id' or r->>'fence' is distinct from c->'sourceContext'->>'fence'
   or r->'window' is distinct from c->'sourceContext'->'window' or r->>'operationId' is distinct from raw_operation
   or r->>'observedAt' is null or r->>'completedAt' is null
   or (r->>'observedAt')::timestamptz>(r->>'completedAt')::timestamptz
   or (r->>'completedAt')::timestamptz>clock_timestamp()
   or (select count(*) from evidence.source_pages where batch_id=b.id)<>(select count(*) from jsonb_array_elements(c->'sources') ref where ref->>'batch_id'=v)
  then raise exception 'GOOGLE_REPORT_SOURCE_INVALID';end if;
  completed:=greatest(completed,(r->>'completedAt')::timestamptz);
  started:=least(started,(r->>'observedAt')::timestamptz);
  if r->>'dataset' not in ('account_performance','product_performance','merchant_identity') or r->>'dataset' is null then raise exception 'GOOGLE_REPORT_SOURCE_INVALID';end if;
 end loop;
 foreach kind in array array['account_performance','product_performance','merchant_identity'] loop
  select jsonb_agg(id::text order by batch_ordinal) into ids from evidence.source_batches where authority=o
   and id in(select value::bigint from jsonb_array_elements_text(c->'batchIds')) and manifest->'googleDatasetRead'->>'dataset'=kind;
  if ids is null then
   if kind<>'merchant_identity' then raise exception 'GOOGLE_REPORT_SOURCE_INVALID';end if;
   continue;
  end if;
  groups:=groups+1;
  if jsonb_array_length(ids)>1 then
   perform evidence.assert_google_daily_packages(o,c->'sourceContext'->>'job_id',(c->'sourceContext'->>'fence')::bigint,day,ids);
  elsif not exists(select 1 from evidence.source_batches where id=(ids->>0)::bigint and source_state='complete'
    and not (manifest->'googleDatasetRead' ? 'packageCount')) then raise exception 'GOOGLE_REPORT_SOURCE_INVALID';end if;
  if kind='account_performance' then anchor:=(ids->>0)::bigint;end if;
 end loop;
 if groups<2 then raise exception 'GOOGLE_REPORT_SOURCE_INVALID';end if;
 if exists(select 1 from pg_temp.adstable_google_daily_report_stage s cross join lateral jsonb_array_elements(s.body->'rows') item
  where item->'row'->'provenance'->'source_context' is distinct from c->'sourceContext'
   or jsonb_typeof(item->'row'->'provenance'->'sources') is distinct from 'array'
   or not(c->'sources' @> (item->'row'->'provenance'->'sources'))) then raise exception 'GOOGLE_REPORT_SOURCE_INVALID';end if;
 for v in select value from jsonb_array_elements_text(c->'batchIds') loop
  perform analytics.hold_report_source_batch(o,v::bigint,(policy->>'until')::timestamptz);
 end loop;
 update pg_temp.adstable_google_daily_report_stage set daily_sources_verified=true;
 revision:=(c->>'expectedRevision')::integer+1;
 if started is distinct from (c->>'startedAt')::timestamptz then raise exception 'GOOGLE_REPORT_SOURCE_INVALID'; end if;
 proof:=analytics.replace_google_staged_report_day(o,c,d,operation,policy,digests);
 receipt:=jsonb_build_object('version','google-daily-receipt-v1','operationId',operation,'status','consumed','comparison','matched',
  'consumerReceipt',true,'checkpointAdvanced',true,'businessDate',day,'timeZone',tz,'revision',revision,'completedAt',completed,
  'rowCount',proof->'rowCount','packages',proof->'packages','batchIds',c->'batchIds','sources',c->'sources',
  'jobId',c->'sourceContext'->>'job_id','fence',c->'sourceContext'->>'fence',
  'factsDigest',analytics.google_daily_report_fingerprint(o,day,tz,(proof->>'rowCount')::int,true));
 receipt:=receipt||jsonb_build_object('digest',analytics.google_daily_digest(receipt));
 if octet_length(receipt::text)>262144 or d<=clock_timestamp() then raise exception 'GOOGLE_REPORT_RECEIPT_INVALID';end if;
 update evidence.source_batches set handoff_state='consumed',handoff_receipt=receipt->>'digest',
  manifest=manifest||jsonb_build_object('datasetConsumerReceipt',jsonb_build_object('operationId',operation,'anchorBatchId',anchor::text,'digest',receipt->>'digest'))
  where authority=o and id in(select value::bigint from jsonb_array_elements_text(c->'batchIds'));
 update evidence.source_batches set manifest=manifest||jsonb_build_object('googleDailyReceipt',receipt) where id=anchor and authority=o;
 update evidence.source_batches set manifest=manifest||jsonb_build_object('datasetSupersededBy',operation::text)
   where authority=o and id in (select value::bigint from jsonb_array_elements_text(proof->'previousBatchIds'));
 if exists(select 1 from evidence.source_batches where authority=o and id in(select value::bigint from jsonb_array_elements_text(c->'batchIds'))
   and octet_length(manifest::text)>1048576) then raise exception 'GOOGLE_REPORT_RECEIPT_INVALID';end if;
 return receipt;
end $fn$;
revoke all on function analytics.correct_google_staged_report_day(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;
grant execute on function analytics.correct_google_staged_report_day(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)
  to adstable_refresh_dataset_runner;
reset role;
commit;
