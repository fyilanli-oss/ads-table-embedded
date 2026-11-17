begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Staging lives for one PostgreSQL transaction. An interrupted transaction
-- leaves neither staged rows nor a visible change to the previous report.
create function analytics.stage_klaviyo_daily_report_package(
  o jsonb, p jsonb, c jsonb, d timestamptz, ordinal integer, package_count integer
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  workspace uuid := (o->>'workspaceId')::uuid;
  generation bigint := (o->>'generation')::bigint;
  account text := o->>'accountId';
  job text := c->'sourceContext'->>'job_id';
  claim_fence bigint := (c->'sourceContext'->>'fence')::bigint;
  day date := (c->>'businessDate')::date;
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
  if d is null or d<=clock_timestamp()
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
reset role;
commit;
