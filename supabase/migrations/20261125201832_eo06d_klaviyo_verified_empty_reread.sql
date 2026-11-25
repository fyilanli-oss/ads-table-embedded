begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

create or replace function analytics.stage_klaviyo_daily_report_package(
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
    or package_count is null or package_count not between 1 and 20
    or ordinal is null or ordinal<0 or ordinal>=package_count
    or jsonb_typeof(p) is distinct from 'object' or p->>'version' is distinct from 'eo05b-storage-v1'
    or jsonb_typeof(p->'rows') is distinct from 'array' then
    raise exception 'KLAVIYO_REPORT_PACKAGE_INVALID';
  end if;
  row_count:=jsonb_array_length(p->'rows');
  if row_count>200 or (row_count=0 and (package_count<>1
    or jsonb_typeof(c->'expectedRevision') is distinct from 'number'
    or coalesce(c->>'expectedRevision','') !~ '^[1-9][0-9]{0,8}$'))
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
      digest text not null,
      daily_sources_verified boolean not null default false
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

create or replace function analytics.replace_klaviyo_staged_report_day(
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
  replacement_plan jsonb;
  source_id bigint;
  day date := (c->>'businessDate')::date;
  w uuid := (o->>'workspaceId')::uuid;
  i bigint := (o->>'installationId')::bigint;
  g bigint := (o->>'generation')::bigint;
  a text := o->>'accountId';
begin
  replacement_plan:=analytics.plan_klaviyo_staged_report_replacement(o,c,d,operation,policy,digests);
  if exists(select 1 from pg_temp.adstable_klaviyo_daily_report_stage where not daily_sources_verified) then
    raise exception 'KLAVIYO_REPORT_RECEIPT_SCOPE_INVALID';
  end if;
  -- A zero-row stage is accepted only when the verified native day itself
  -- has no report records. A missing source or a caller's empty stage cannot
  -- turn a nonempty day into an empty publication.
  if (replacement_plan->>'replaced')::int+(replacement_plan->>'inserted')::int=0 then
    if jsonb_array_length(c->'batchIds')<>3 or exists(
      select 1 from jsonb_array_elements_text(c->'batchIds') ids
      join evidence.source_batches b on b.id=ids.value::bigint
      cross join lateral (select b.manifest->'klaviyoDatasetRead' as proof) native
      where b.authority=o
        and (b.source_state<>'complete' or native.proof ? 'packageCount'
          or native.proof->>'jobId' is distinct from c->'sourceContext'->>'job_id'
          or native.proof->>'fence' is distinct from c->'sourceContext'->>'fence'
          or native.proof->'window' is distinct from c->'sourceContext'->'window'
          or (native.proof->>'dataset' in ('account_performance','product_performance') and (
            jsonb_typeof(native.proof->'coverage') is distinct from 'array'
            or case when native.proof->>'dataset'='account_performance'
              then jsonb_array_length(native.proof->'coverage') not in (2,6)
              else jsonb_array_length(native.proof->'coverage')<>1 end
            or exists(select 1 from jsonb_array_elements(native.proof->'coverage') as coverage(entry)
              where coverage.entry->>'state' is distinct from 'present'
                or coverage.entry->'recordCount' is distinct from '0'::jsonb)
            or exists(select 1 from evidence.source_references ref
              join evidence.source_pages page on page.id=ref.page_id
              where page.batch_id=b.id and page.family in
                ('klaviyo_campaign_report','klaviyo_flow_report','klaviyo_ordered_product_events'))
          )))
    ) then raise exception 'KLAVIYO_REPORT_EMPTY_SOURCE_UNVERIFIED'; end if;
  end if;
  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    select coalesce(jsonb_object_agg(entry.value->'row'->>'native_key_hash',true),'{}'::jsonb)
      into staged_keys from pg_temp.adstable_klaviyo_daily_report_stage staged
      cross join lateral jsonb_array_elements(staged.body->'rows') entry
      where entry.value->>'table'=table_name;
    execute format('delete from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''klaviyo'' and platform_account_id=$4 and business_date=$5
      and not ($6 ? x.native_key_hash)',table_name)
      using w,i,g,a,day,staged_keys;
  end loop;
  for s in select body,day_binding,package_ordinal from pg_temp.adstable_klaviyo_daily_report_stage
    where jsonb_array_length(body->'rows')>0 order by package_ordinal loop
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
      -- Publication has already verified and retained all of this day's source batches.
      source_id:=(r->>'source_batch_id')::bigint;
      update evidence.source_batches set manifest=manifest||jsonb_build_object('datasetRevisionPermit',jsonb_build_object(
        'transactionId',pg_catalog.txid_current()::text,'dailyOperation',operation::text,'dailyBinding',s.day_binding,
        'stageOrdinal',s.package_ordinal,'table',table_name,'id',old_fact->>'id',
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

create or replace function analytics.klaviyo_daily_report_fingerprint(o jsonb,d date,tz text,expected integer,verified_in_tx boolean default false) returns text
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
    or expected is null or expected not between 0 and 4000 then raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH'; end if;
  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    for fact in execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''klaviyo'' and platform_account_id=$4 and business_date=$5 order by native_key_hash collate "C" limit 4001',table_name)
      using w,i,g,o->>'accountId',d
    loop
      if cardinality(leaves)>=expected or fact->>'source_timezone' is distinct from tz
        or fact->>'provider_connection_id' is distinct from o->>'connectionId'
        or (fact->>'retain_until')::timestamptz<=clock_timestamp() then raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH'; end if;
      payload_digest:=case when verified_in_tx then fact->>'payload_digest' else analytics.reconciliation_fact_digest(table_name,fact) end;
      if fact->>'payload_digest' is distinct from payload_digest then raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH'; end if;
      leaves:=array_append(leaves,analytics.dataset_digest(jsonb_build_array(table_name,fact->>'native_key_hash',payload_digest)));
    end loop;
  end loop;
  if cardinality(leaves)<>expected then raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH'; end if;
  return analytics.dataset_digest(to_jsonb(leaves));
end $fn$;

reset role;
commit;
