begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

create function analytics.assert_klaviyo_daily_report_claim(o jsonb,c jsonb,d timestamptz) returns void
language plpgsql security definer set search_path='' as $fn$
declare
  workspace uuid := (o->>'workspaceId')::uuid;
  generation bigint := (o->>'generation')::bigint;
  account text := o->>'accountId';
  job text := c->'sourceContext'->>'job_id';
  claim_fence bigint := (c->'sourceContext'->>'fence')::bigint;
  day date := (c->>'businessDate')::date;
begin
  if o->>'provider' is distinct from 'klaviyo' or d is null or d<=clock_timestamp()
    or operations.refresh_claim_is_current(workspace,generation,'klaviyo',account,job,claim_fence) is not true
    or not exists (
      select 1 from operations.refresh_work_bindings b
      join operations.refresh_work_progress s on s.fence=b.fence and s.workspace_id=b.workspace_id
        and s.install_generation=b.install_generation and s.provider=b.provider and s.account_id=b.account_id and s.job_id=b.job_id
      where b.workspace_id=workspace and b.install_generation=generation and b.provider='klaviyo'
        and b.account_id=account and b.job_id=job and b.fence=claim_fence
        and b.from_date=day and b.to_date=day and s.from_date=day and s.to_date=day
        and s.stage='ready_for_dataset' and b.source=c->'sourceContext'->'snapshot'
        and extract(epoch from d)*1000<=b.deadline_at_ms
    ) then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'; end if;
end $fn$;

revoke all on function analytics.assert_klaviyo_daily_report_claim(jsonb,jsonb,timestamptz)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- Staging lives for one PostgreSQL transaction. An interrupted transaction
-- leaves neither staged rows nor a visible change to the previous report.
create function analytics.stage_klaviyo_daily_report_package(
  o jsonb, p jsonb, c jsonb, d timestamptz, ordinal integer, package_count integer
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  operation uuid := (p->>'operationId')::uuid;
  staged_count integer;
  row_count integer;
  binding text;
  package_digest text;
  staging_relation oid;
begin
  perform evidence.assert_source_owner(o);
  if o->>'provider' is distinct from 'klaviyo' or operation is null
    or package_count is null or package_count not between 2 and 20
    or ordinal is null or ordinal<0 or ordinal>=package_count
    or jsonb_typeof(p) is distinct from 'object' or p->>'version' is distinct from 'eo05b-storage-v1'
    or jsonb_typeof(p->'rows') is distinct from 'array' then
    raise exception 'KLAVIYO_REPORT_PACKAGE_INVALID';
  end if;
  row_count:=jsonb_array_length(p->'rows');
  if row_count not between 1 and 200
    or octet_length(analytics.dataset_json(jsonb_build_object('write',p,'context',c)))>1048576 then
    raise exception 'KLAVIYO_REPORT_PACKAGE_LIMIT';
  end if;
  perform analytics.assert_klaviyo_daily_report_claim(o,c,d);

  staging_relation:=pg_catalog.to_regclass('pg_temp.adstable_klaviyo_daily_report_stage');
  if staging_relation is null and ordinal=0 then
    create temporary table pg_temp.adstable_klaviyo_daily_report_stage (
      package_ordinal integer primary key,
      day_binding text not null,
      body jsonb not null,
      digest text not null
    ) on commit drop;
    staging_relation:=pg_catalog.to_regclass('pg_temp.adstable_klaviyo_daily_report_stage');
  end if;
  if not exists (select 1 from pg_catalog.pg_class
    where oid=staging_relation and relnamespace=pg_catalog.pg_my_temp_schema()
      and relowner=current_user::regrole and relpersistence='t' and relkind='r') then
    raise exception 'KLAVIYO_REPORT_STAGE_REQUIRED';
  end if;
  binding:=analytics.dataset_digest(jsonb_build_object(
    'owner',o,'context',c,'deadline',d,'operationId',operation,'policy',p->'policy','packageCount',package_count));
  select count(*) into staged_count from pg_temp.adstable_klaviyo_daily_report_stage;
  if staged_count<>ordinal or exists (select 1 from pg_temp.adstable_klaviyo_daily_report_stage where day_binding<>binding) then
    raise exception 'KLAVIYO_REPORT_PACKAGE_SEQUENCE';
  end if;
  package_digest:=analytics.dataset_digest(jsonb_build_object('write',p,'context',c));
  insert into pg_temp.adstable_klaviyo_daily_report_stage (package_ordinal,day_binding,body,digest)
  values (ordinal,binding,p,package_digest);
  return jsonb_build_object('status','staged','operationId',operation,'ordinal',ordinal,
    'packageCount',package_count,'rowCount',row_count,'digest',package_digest);
end $fn$;

revoke all on function analytics.stage_klaviyo_daily_report_package(jsonb,jsonb,jsonb,timestamptz,integer,integer)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- Verify the acknowledged staged writes before a future publication call.
-- This summary is transaction-local evidence, never a report receipt.
create function analytics.verify_klaviyo_daily_report_stage(
  o jsonb, c jsonb, d timestamptz, operation uuid, policy jsonb, digests jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  package_count integer;
  row_count integer;
  binding text;
  packages jsonb;
  summary jsonb;
begin
  perform evidence.assert_source_owner(o);
  if o->>'provider' is distinct from 'klaviyo' or d is null or d<=clock_timestamp()
    or operation is null or jsonb_typeof(digests) is distinct from 'array' then
    raise exception 'KLAVIYO_REPORT_PACKAGE_INVALID';
  end if;
  package_count:=jsonb_array_length(digests);
  if package_count not between 2 and 20
    or exists(select 1 from jsonb_array_elements(digests) value
      where jsonb_typeof(value) is distinct from 'string' or (value#>>'{}') !~ '^[0-9a-f]{64}$') then
    raise exception 'KLAVIYO_REPORT_PACKAGE_INVALID';
  end if;
  if not exists (select 1 from pg_catalog.pg_class
    where oid=pg_catalog.to_regclass('pg_temp.adstable_klaviyo_daily_report_stage')
      and relnamespace=pg_catalog.pg_my_temp_schema() and relowner=current_user::regrole
      and relpersistence='t' and relkind='r') then
    raise exception 'KLAVIYO_REPORT_STAGE_REQUIRED';
  end if;
  binding:=analytics.dataset_digest(jsonb_build_object(
    'owner',o,'context',c,'deadline',d,'operationId',operation,'policy',policy,'packageCount',package_count));
  if (select count(*) from pg_temp.adstable_klaviyo_daily_report_stage)<>package_count
    or exists(select 1 from pg_temp.adstable_klaviyo_daily_report_stage s
      where s.package_ordinal not between 0 and package_count-1 or s.day_binding<>binding
        or s.digest is distinct from digests->>s.package_ordinal
        or s.digest is distinct from analytics.dataset_digest(jsonb_build_object('write',s.body,'context',c))) then
    raise exception 'KLAVIYO_REPORT_PACKAGE_VERIFICATION_FAILED';
  end if;
  if exists(
    select 1 from pg_temp.adstable_klaviyo_daily_report_stage s
    cross join lateral jsonb_array_elements(s.body->'rows') item
    group by item->>'table',item->'row'->>'native_key_hash'
    having count(*)>1 or coalesce(item->'row'->>'native_key_hash','') !~ '^[0-9a-f]{64}$'
  ) then raise exception 'KLAVIYO_REPORT_PACKAGE_ROW_IDENTITY_INVALID'; end if;
  select sum(jsonb_array_length(body->'rows'))::integer,
    jsonb_agg(jsonb_build_object('ordinal',package_ordinal,'rowCount',jsonb_array_length(body->'rows'),'digest',digest)
      order by package_ordinal)
    into row_count,packages
    from pg_temp.adstable_klaviyo_daily_report_stage;
  summary:=jsonb_build_object('status','stage_verified','operationId',operation,'rowCount',row_count,
    'packageCount',package_count,'packages',packages,'consumerReceipt',false,'checkpointAdvanced',false);
  return summary||jsonb_build_object('digest',analytics.dataset_digest(summary));
end $fn$;

revoke all on function analytics.verify_klaviyo_daily_report_stage(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- Compare the proposed day with physical facts without including individual
-- rows or change entries in the compact daily evidence.
create function analytics.check_klaviyo_daily_report_facts(
  o jsonb, c jsonb, d timestamptz, operation uuid, policy jsonb, digests jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  summary jsonb;
  item jsonb;
  fact jsonb;
  table_name text;
  day date := (c->>'businessDate')::date;
  total integer:=0;
  n integer;
  w uuid := (o->>'workspaceId')::uuid;
  i bigint := (o->>'installationId')::bigint;
  g bigint := (o->>'generation')::bigint;
  a text := o->>'accountId';
begin
  -- Take the existing scheduled-writer lock only at the physical day check,
  -- after all package transfers. A later handoff must share this transaction.
  perform 1 from operations.refresh_control where singleton for update;
  if not found then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'; end if;
  perform analytics.assert_klaviyo_daily_report_claim(o,c,d);
  summary:=analytics.verify_klaviyo_daily_report_stage(o,c,d,operation,policy,digests);
  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    execute format('select count(*)::int from (select id from analytics.%I where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''klaviyo'' and platform_account_id=$4 and business_date=$5 limit 4001) actual',table_name)
      into n using w,i,g,a,day;
    total:=total+n;
  end loop;
  if total<>(summary->>'rowCount')::integer then raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH'; end if;
  for item in
    select value from pg_temp.adstable_klaviyo_daily_report_stage s
    cross join lateral jsonb_array_elements(s.body->'rows')
  loop
    table_name:=item->>'table';
    if table_name not in ('pd_facts','cpd_product_sales_facts') or table_name is null then
      raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH';
    end if;
    execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''klaviyo'' and platform_account_id=$4 and business_date=$5 and grain_version=$6 and native_key_hash=$7 for share',table_name)
      into fact using w,i,g,a,day,item->'row'->>'grain_version',item->'row'->>'native_key_hash';
    if fact is null or fact->>'provider_connection_id' is distinct from o->>'connectionId'
      or fact->>'native_key_canonical' is distinct from item->'row'->>'native_key_canonical'
      or (fact->>'retain_until')::timestamptz<=clock_timestamp()
      or fact->>'payload_digest' is distinct from item->'row'->>'payload_digest'
      or analytics.reconciliation_fact_digest(table_name,fact) is distinct from item->'row'->>'payload_digest' then
      raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH';
    end if;
  end loop;
  if d<=clock_timestamp() then raise exception 'DATASET_RECONCILIATION_DEADLINE'; end if;
  summary:=(summary-'digest')||jsonb_build_object('comparison','matched','status','facts_verified');
  return summary||jsonb_build_object('digest',analytics.dataset_digest(summary));
end $fn$;

revoke all on function analytics.check_klaviyo_daily_report_facts(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- Private insertion step for a day without a prior report. Completion is a
-- separate step of the same transaction. No runtime grant is installed here.
create function analytics.write_klaviyo_staged_first_report_day(
  o jsonb, c jsonb, d timestamptz, operation uuid, policy jsonb, digests jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  s record;
  row_body jsonb;
  written jsonb;
  table_name text;
  has_facts boolean;
  day date := (c->>'businessDate')::date;
  w uuid := (o->>'workspaceId')::uuid;
  i bigint := (o->>'installationId')::bigint;
  g bigint := (o->>'generation')::bigint;
  a text := o->>'accountId';
begin
  perform 1 from operations.refresh_control where singleton for update;
  if not found then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'; end if;
  perform analytics.assert_klaviyo_daily_report_claim(o,c,d);
  perform analytics.verify_klaviyo_daily_report_stage(o,c,d,operation,policy,digests);
  if c->'expectedRevision' is distinct from '0'::jsonb
    or exists(select 1 from evidence.source_batches b where b.workspace_id=w and b.installation_id=i
      and b.installation_generation=g and b.primary_source='klaviyo' and b.authority=o
      and b.manifest->'datasetReconciliation'->>'businessDate'=c->>'businessDate') then
    raise exception 'KLAVIYO_REPORT_FIRST_DAY_REQUIRED';
  end if;
  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    execute format('select exists(select 1 from analytics.%I where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''klaviyo'' and platform_account_id=$4 and business_date=$5)',table_name)
      into has_facts using w,i,g,a,day;
    if has_facts then raise exception 'KLAVIYO_REPORT_FIRST_DAY_REQUIRED'; end if;
  end loop;
  for s in select body from pg_temp.adstable_klaviyo_daily_report_stage order by package_ordinal loop
    for row_body in select value->'row' from jsonb_array_elements(s.body->'rows') loop
      if row_body->>'business_date' is distinct from day::text
        or row_body->'provenance'->'source_context' is distinct from c->'sourceContext' then
        raise exception 'KLAVIYO_REPORT_PACKAGE_SCOPE_INVALID';
      end if;
    end loop;
    -- Reuse the bounded physical writer, retention rules and row triggers.
    written:=analytics.commit_dataset_storage(o,s.body||jsonb_build_object('operationId',gen_random_uuid()));
    if written->>'status' is distinct from 'stored'
      or jsonb_array_length(written->'rows') is distinct from jsonb_array_length(s.body->'rows') then
      raise exception 'KLAVIYO_REPORT_PACKAGE_WRITE_INVALID';
    end if;
  end loop;
  return analytics.check_klaviyo_daily_report_facts(o,c,d,operation,policy,digests);
end $fn$;

revoke all on function analytics.write_klaviyo_staged_first_report_day(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- Check what must change before replacing a published day. No fact or receipt
-- is changed here. The write must use the same transaction and coordinator lock.
create function analytics.plan_klaviyo_staged_report_replacement(
  o jsonb, c jsonb, d timestamptz, operation uuid, policy jsonb, digests jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  staged jsonb;
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
  replacement_count integer:=0;
  removal_count integer:=0;
  staged_keys jsonb;
  plan jsonb;
begin
  perform 1 from operations.refresh_control where singleton for update;
  if not found then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'; end if;
  perform analytics.assert_klaviyo_daily_report_claim(o,c,d);
  staged:=analytics.verify_klaviyo_daily_report_stage(o,c,d,operation,policy,digests);
  select candidate.receipt into head
   from evidence.source_batches b
   cross join lateral (select coalesce(b.manifest->'klaviyoDailyReceipt',b.manifest->'datasetReconciliation') receipt) candidate
   where b.workspace_id=w and b.installation_id=i and b.installation_generation=g
     and b.primary_source='klaviyo' and b.authority=o and not (b.manifest ? 'datasetSupersededBy')
     and candidate.receipt->>'businessDate'=day::text and candidate.receipt->>'timeZone'=timezone
   order by (candidate.receipt->>'revision')::bigint desc,b.id desc limit 1;
  if head is null or head->'revision' is distinct from c->'expectedRevision' then
    raise exception 'KLAVIYO_REPORT_REVISION_CONFLICT';
  end if;
  if head->>'version'='klaviyo-daily-receipt-v1' then
    prior:=analytics.inspect_klaviyo_daily_report(o,(head->>'operationId')::uuid);
  else
    prior:=analytics.inspect_dataset_reconciliation(o,(head->>'operationId')::uuid);
  end if;
  if prior->>'status' is distinct from 'consumed' or prior->>'comparison' is distinct from 'matched'
    or prior->>'digest' is distinct from head->>'digest'
    or started is null or started>clock_timestamp()
    or (prior->>'completedAt')::timestamptz>started then
    raise exception 'KLAVIYO_REPORT_PREVIOUS_REVISION_UNAVAILABLE';
  end if;
  select jsonb_object_agg((item->>'table')||':'||(item->'row'->>'native_key_hash'),true)
    into staged_keys from pg_temp.adstable_klaviyo_daily_report_stage s
    cross join lateral jsonb_array_elements(s.body->'rows') item;
  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    for old_fact in execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''klaviyo'' and platform_account_id=$4 and business_date=$5 order by id limit 4001 for update',table_name)
      using w,i,g,a,day
    loop
      row_total:=row_total+1;
      if row_total>4000 or old_fact->>'source_timezone' is distinct from timezone
        or old_fact->>'provider_connection_id' is distinct from o->>'connectionId'
        or (old_fact->>'retain_until')::timestamptz<=clock_timestamp() then
        raise exception 'KLAVIYO_REPORT_REPLACEMENT_SCOPE_INVALID';
      end if;
      for ref in select value from jsonb_array_elements(old_fact->'provenance'->'sources') loop
        perform analytics.assert_dataset_source(o,ref);
        select (b.manifest->'klaviyoDatasetRead'->>'completedAt')::timestamptz into completed
          from evidence.source_batches b where b.id=(ref->>'batch_id')::bigint and b.authority=o;
        if completed is null or completed>started then raise exception 'KLAVIYO_REPORT_REPLACEMENT_STALE'; end if;
      end loop;
      if staged_keys ? (table_name||':'||(old_fact->>'native_key_hash')) then
        replacement_count:=replacement_count+1;
      else
        if analytics.dataset_retention_has_dependents(table_name,old_fact) then raise exception 'DATASET_RECONCILIATION_DEPENDENT'; end if;
        removal_count:=removal_count+1;
      end if;
    end loop;
  end loop;
  if row_total is distinct from (prior->>'rowCount')::integer or d<=clock_timestamp() then
    raise exception 'KLAVIYO_REPORT_REPLACEMENT_SCOPE_INVALID';
  end if;
  plan:=jsonb_build_object('status','replacement_planned','operationId',operation,'previousDigest',prior->>'digest',
    'stageDigest',staged->>'digest','replaced',replacement_count,'removed',removal_count,
    'inserted',(staged->>'rowCount')::integer-replacement_count);
  return plan||jsonb_build_object('digest',analytics.dataset_digest(plan));
end $fn$;

revoke all on function analytics.plan_klaviyo_staged_report_replacement(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- Isolated replacement step. Reuse the normal row revision permit, retention
-- checks and package writer. Publication still requires a separate receipt.
create function analytics.replace_klaviyo_staged_report_day(
  o jsonb,c jsonb,d timestamptz,operation uuid,policy jsonb,digests jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  s record;
  item jsonb;
  r jsonb;
  old_fact jsonb;
  written jsonb;
  table_name text;
  allowed text[];
  assignments text;
  staged_keys jsonb;
  source_id bigint;
  day date := (c->>'businessDate')::date;
  w uuid := (o->>'workspaceId')::uuid;
  i bigint := (o->>'installationId')::bigint;
  g bigint := (o->>'generation')::bigint;
  a text := o->>'accountId';
begin
  perform analytics.plan_klaviyo_staged_report_replacement(o,c,d,operation,policy,digests);
  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    select coalesce(jsonb_object_agg(item->'row'->>'native_key_hash',true),'{}'::jsonb)
      into staged_keys from pg_temp.adstable_klaviyo_daily_report_stage staged
      cross join lateral jsonb_array_elements(staged.body->'rows') entry
      where entry->>'table'=table_name;
    execute format('delete from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''klaviyo'' and platform_account_id=$4 and business_date=$5
      and not ($6 ? x.native_key_hash)',table_name)
      using w,i,g,a,day,staged_keys;
  end loop;
  for s in select body from pg_temp.adstable_klaviyo_daily_report_stage order by package_ordinal loop
    for item in select value from jsonb_array_elements(s.body->'rows') loop
      table_name:=item->>'table';
      r:=item->'row';
      if table_name is null or table_name not in ('pd_facts','cpd_product_sales_facts')
        or r->>'business_date' is distinct from day::text
        or r->'provenance'->'source_context' is distinct from c->'sourceContext' then
        raise exception 'KLAVIYO_REPORT_PACKAGE_SCOPE_INVALID';
      end if;
      execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''klaviyo'' and platform_account_id=$4 and grain_version=$5 and native_key_hash=$6 for update',table_name)
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
        or r->>'payload_digest' is distinct from analytics.dataset_digest(r-array['native_key_canonical','native_key_hash','grain_version','row_schema_version','payload_digest']) then
        raise exception 'DATASET_ROW_SHAPE_INVALID';
      end if;
      for source_id in select distinct (ref->>'batch_id')::bigint from jsonb_array_elements(r->'provenance'->'sources') ref loop
        perform analytics.hold_report_source_batch(o,source_id,(policy->>'until')::timestamptz);
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
    written:=analytics.commit_dataset_storage(o,s.body||jsonb_build_object('operationId',gen_random_uuid()));
    if written->>'status' is distinct from 'stored'
      or jsonb_array_length(written->'rows') is distinct from jsonb_array_length(s.body->'rows') then
      raise exception 'KLAVIYO_REPORT_PACKAGE_WRITE_INVALID';
    end if;
  end loop;
  return analytics.check_klaviyo_daily_report_facts(o,c,d,operation,policy,digests);
end $fn$;

revoke all on function analytics.replace_klaviyo_staged_report_day(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- A compact, reproducible fingerprint of physical rows. Rebuild their
-- payload digests, rather than trusting the digest stored beside each row.
create function analytics.klaviyo_daily_report_fingerprint(o jsonb,d date,tz text,expected integer) returns text
language plpgsql security definer set search_path='' as $fn$
declare
  fact jsonb;
  payload_digest text;
  table_name text;
  leaves text[]:='{}';
  w uuid := (o->>'workspaceId')::uuid;
  i bigint := (o->>'installationId')::bigint;
  g bigint := (o->>'generation')::bigint;
begin
  perform evidence.assert_source_owner(o);
  if o->>'provider' is distinct from 'klaviyo' or d is null or tz is null
    or expected is null or expected not between 1 and 4000 then raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH'; end if;
  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    for fact in execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''klaviyo'' and platform_account_id=$4 and business_date=$5 order by native_key_hash collate "C" limit 4001',table_name)
      using w,i,g,o->>'accountId',d
    loop
      if cardinality(leaves)>=expected or fact->>'source_timezone' is distinct from tz
        or fact->>'provider_connection_id' is distinct from o->>'connectionId'
        or (fact->>'retain_until')::timestamptz<=clock_timestamp() then raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH'; end if;
      payload_digest:=analytics.reconciliation_fact_digest(table_name,fact);
      if fact->>'payload_digest' is distinct from payload_digest then raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH'; end if;
      leaves:=array_append(leaves,analytics.dataset_digest(jsonb_build_array(table_name,fact->>'native_key_hash',payload_digest)));
    end loop;
  end loop;
  if cardinality(leaves)<>expected then raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH'; end if;
  return analytics.dataset_digest(to_jsonb(leaves));
end $fn$;

revoke all on function analytics.klaviyo_daily_report_fingerprint(jsonb,date,text,integer)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function analytics.inspect_klaviyo_daily_report(o jsonb,op uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  b evidence.source_batches%rowtype;
  receipt jsonb;
  ref jsonb;
begin
  perform evidence.assert_source_owner(o);
  select * into b from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid
    and installation_id=(o->>'installationId')::bigint and installation_generation=(o->>'generation')::bigint
    and authority=o and manifest->'klaviyoDailyReceipt'->>'operationId'=op::text for share;
  if not found then return null; end if;
  receipt:=b.manifest->'klaviyoDailyReceipt';
  if b.storage_state<>'committed' or b.retain_until<=clock_timestamp()
    or b.manifest->'privacyRedacted'='true'::jsonb
    or receipt->>'digest' is distinct from analytics.dataset_digest(receipt-'digest') then
    raise exception 'KLAVIYO_REPORT_RECEIPT_INVALID';
  end if;
  if b.manifest ? 'datasetSupersededBy' then
    return receipt||jsonb_build_object('status','superseded','checkpointAdvanced',false);
  end if;
  for ref in select value from jsonb_array_elements(receipt->'sources') loop
    perform analytics.assert_dataset_source(o,ref);
    if not exists(select 1 from evidence.source_batches x where x.id=(ref->>'batch_id')::bigint and x.authority=o
      and x.handoff_state='consumed' and x.handoff_receipt=receipt->>'digest'
      and x.manifest->'privacyRedacted' is distinct from 'true'::jsonb) then raise exception 'KLAVIYO_REPORT_RECEIPT_INVALID'; end if;
  end loop;
  if analytics.klaviyo_daily_report_fingerprint(o,(receipt->>'businessDate')::date,receipt->>'timeZone',
    (receipt->>'rowCount')::integer) is distinct from receipt->>'factsDigest' then raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH';end if;
  return receipt;
end $fn$;

revoke all on function analytics.inspect_klaviyo_daily_report(jsonb,uuid)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function analytics.publish_klaviyo_staged_report_day(
  o jsonb,c jsonb,d timestamptz,operation uuid,policy jsonb,digests jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  v text;
  b evidence.source_batches%rowtype;
  products jsonb:='[]';
  config integer:=0;
  accounts integer:=0;
  proof jsonb;
  receipt jsonb;
  previous jsonb;
  native_read jsonb;
  completed_at timestamptz;
  revision integer;
  anchor bigint;
  day date := (c->>'businessDate')::date;
  tz text := c->'sourceContext'->'snapshot'->>'timezone';
begin
  perform 1 from operations.refresh_control where singleton for update;
  if not found then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'; end if;
  perform analytics.assert_klaviyo_daily_report_claim(o,c,d);
  if jsonb_typeof(c->'batchIds') is distinct from 'array' or jsonb_array_length(c->'batchIds') not between 3 and 22
    or c->'sourceContext'->'window' is distinct from jsonb_build_object('from',day,'to',day)
    or policy->>'version' is distinct from 'report-source-3y-v1'
    or jsonb_typeof(c->'expectedRevision') is distinct from 'number'
    or coalesce(c->>'expectedRevision','') !~ '^[0-9]{1,9}$'
    or exists(select 1 from evidence.source_batches where authority=o and manifest ? 'klaviyoDailyReceipt'
      and (manifest->'klaviyoDailyReceipt'->>'operationId'=operation::text
        or (c->'expectedRevision'='0'::jsonb and manifest->'klaviyoDailyReceipt'->>'businessDate'=day::text))) then
    raise exception 'KLAVIYO_REPORT_RECEIPT_SCOPE_INVALID';
  end if;
  perform analytics.assert_report_source_context(o,c->'sourceContext',(policy->>'until')::timestamptz,c->'sources');
  if (select count(distinct value) from jsonb_array_elements_text(c->'batchIds'))<>jsonb_array_length(c->'batchIds')
    or (select count(distinct value->>'page_id') from jsonb_array_elements(c->'sources'))<>jsonb_array_length(c->'sources')
    or exists(select 1 from jsonb_array_elements(c->'sources') ref where not (c->'batchIds' ? (ref->>'batch_id'))) then
    raise exception 'KLAVIYO_REPORT_RECEIPT_SCOPE_INVALID';
  end if;
  perform id from evidence.source_batches where authority=o
    and id in (select value::bigint from jsonb_array_elements_text(c->'batchIds')) order by id for update;
  for v in select value from jsonb_array_elements_text(c->'batchIds') loop
    select * into strict b from evidence.source_batches where id=v::bigint and authority=o;
    native_read:=b.manifest->'klaviyoDatasetRead';
    if b.storage_state<>'committed' or b.handoff_state<>'pending' or b.retain_until<=clock_timestamp()
      or b.manifest->'privacyRedacted'='true'::jsonb or b.manifest ? 'datasetReconciliationMismatch'
      or (select count(*) from evidence.source_pages where batch_id=b.id) <>
        (select count(*) from jsonb_array_elements(c->'sources') ref where ref->>'batch_id'=v) then
      raise exception 'KLAVIYO_REPORT_RECEIPT_SCOPE_INVALID';
    end if;
    if native_read->>'completedAt' is null or (native_read->>'completedAt')::timestamptz>clock_timestamp() then
      raise exception 'KLAVIYO_REPORT_RECEIPT_SCOPE_INVALID';
    end if;
    completed_at:=greatest(completed_at,(native_read->>'completedAt')::timestamptz);
    case native_read->>'dataset'
      when 'configuration' then
        if b.source_state<>'complete' then raise exception 'KLAVIYO_REPORT_RECEIPT_SCOPE_INVALID';end if;
        config:=config+1;anchor:=b.id;
      when 'account_performance' then
        if b.source_state<>'complete' then raise exception 'KLAVIYO_REPORT_RECEIPT_SCOPE_INVALID';end if;
        accounts:=accounts+1;
      when 'product_performance' then products:=products||jsonb_build_array(v);
      else raise exception 'KLAVIYO_REPORT_RECEIPT_SCOPE_INVALID';
    end case;
    perform analytics.hold_report_source_batch(o,b.id,(policy->>'until')::timestamptz);
  end loop;
  if config<>1 or accounts<>1 or jsonb_array_length(products)<1 then raise exception 'KLAVIYO_REPORT_RECEIPT_SCOPE_INVALID';end if;
  if jsonb_array_length(products)>1 then
    perform evidence.assert_klaviyo_daily_product_packages(o,c->'sourceContext'->>'job_id',(c->'sourceContext'->>'fence')::bigint,day,products);
  elsif not exists(select 1 from evidence.source_batches where id=(products->>0)::bigint
    and source_state='complete' and not (manifest->'klaviyoDatasetRead' ? 'packageCount')) then
    raise exception 'KLAVIYO_REPORT_RECEIPT_SCOPE_INVALID';
  end if;
  if exists(select 1 from pg_temp.adstable_klaviyo_daily_report_stage s
    cross join lateral jsonb_array_elements(s.body->'rows') item
    cross join lateral jsonb_array_elements(item->'row'->'provenance'->'sources') ref
    where not (c->'sources' @> jsonb_build_array(ref))) then raise exception 'KLAVIYO_REPORT_RECEIPT_SCOPE_INVALID';end if;
  revision:=(c->>'expectedRevision')::integer+1;
  if revision=1 then
    proof:=analytics.write_klaviyo_staged_first_report_day(o,c,d,operation,policy,digests);
  else
    select candidate.receipt into previous
      from evidence.source_batches old
      cross join lateral (select coalesce(old.manifest->'klaviyoDailyReceipt',old.manifest->'datasetReconciliation') receipt) candidate
      where old.authority=o and not (old.manifest ? 'datasetSupersededBy')
        and candidate.receipt->>'businessDate'=day::text and candidate.receipt->>'timeZone'=tz
        and candidate.receipt->'revision'=c->'expectedRevision' for update of old;
    if previous is null then raise exception 'KLAVIYO_REPORT_REVISION_CONFLICT'; end if;
    proof:=analytics.replace_klaviyo_staged_report_day(o,c,d,operation,policy,digests);
  end if;
  receipt:=jsonb_build_object('version','klaviyo-daily-receipt-v1','operationId',operation,
    'status','consumed','comparison','matched','consumerReceipt',true,'checkpointAdvanced',true,
    'businessDate',day,'timeZone',tz,'revision',revision,'completedAt',completed_at,
    'rowCount',proof->'rowCount','packages',proof->'packages',
    'batchIds',c->'batchIds','sources',c->'sources','jobId',c->'sourceContext'->>'job_id','fence',c->'sourceContext'->>'fence',
    'factsDigest',analytics.klaviyo_daily_report_fingerprint(o,day,tz,(proof->>'rowCount')::integer));
  receipt:=receipt||jsonb_build_object('digest',analytics.dataset_digest(receipt));
  if octet_length(receipt::text)>262144 or d<=clock_timestamp() then raise exception 'KLAVIYO_REPORT_RECEIPT_INVALID';end if;
  update evidence.source_batches set handoff_state='consumed',handoff_receipt=receipt->>'digest',
    manifest=manifest||jsonb_build_object('datasetConsumerReceipt',jsonb_build_object(
      'operationId',operation,'anchorBatchId',anchor::text,'digest',receipt->>'digest'))
    where authority=o and id in (select value::bigint from jsonb_array_elements_text(c->'batchIds'));
  update evidence.source_batches set manifest=manifest||jsonb_build_object('klaviyoDailyReceipt',receipt)
    where id=anchor and authority=o;
  if previous is not null then
    update evidence.source_batches set manifest=manifest||jsonb_build_object('datasetSupersededBy',operation::text)
      where authority=o and id in (select value::bigint from jsonb_array_elements_text(previous->'batchIds'));
  end if;
  if exists(select 1 from evidence.source_batches where authority=o
    and id in (select value::bigint from jsonb_array_elements_text(c->'batchIds')) and octet_length(manifest::text)>1048576) then
    raise exception 'KLAVIYO_REPORT_RECEIPT_INVALID';
  end if;
  return receipt;
end $fn$;

revoke all on function analytics.publish_klaviyo_staged_report_day(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- The worker calls this only after it has received and read back a known
-- publication. Recheck the persistent proof and claim under the queue lock.
create function analytics.finish_klaviyo_daily_report_job(o jsonb,j text,f bigint,op uuid,h text)
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
  return operations.finish_refresh_work_before_stops(w,g,'klaviyo',a,j,f,'completed');
end $fn$;

revoke all on function analytics.finish_klaviyo_daily_report_job(jsonb,text,bigint,uuid,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
