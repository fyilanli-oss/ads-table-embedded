begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

create or replace function analytics.commit_dataset_storage(o jsonb,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare item jsonb; r jsonb; row_input jsonb; injected jsonb; b evidence.source_batches%rowtype; primary_id bigint;
 operation uuid; h text; prior jsonb; result jsonb; ids jsonb:='[]'; found_row jsonb; rid bigint; name text; cols text; allowed text[]; k text;
 bulk_rows jsonb:='{}'; bulk_ids jsonb:='{}'; stored record;
 staged_klaviyo boolean:=false; verified_day_sources boolean:=false; grouped record;
begin
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 if o->>'provider'='shopify' or jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>4
 or not p ?& array['version','operationId','policy','rows'] or p->>'version'<>'eo05b-storage-v1'
 or jsonb_typeof(p->'rows') is distinct from 'array' or jsonb_array_length(p->'rows') not between 1 and 200
 or octet_length(analytics.dataset_json(p))>1048576 then raise exception 'DATASET_INPUT_INVALID';end if;
 operation:=(p->>'operationId')::uuid;
 if jsonb_typeof(p->'policy') is distinct from 'object' or (select count(*) from jsonb_object_keys(p->'policy'))<>2
 or not p->'policy' ?& array['version','until'] or coalesce(p->'policy'->>'version','')=''
 or not coalesce(isfinite((p->'policy'->>'until')::timestamptz) and (p->'policy'->>'until')::timestamptz>clock_timestamp(),false)
 then raise exception 'DATASET_RETENTION_REQUIRED';end if;
 primary_id:=(p->'rows'->0->'row'->>'source_batch_id')::bigint;
 select * into strict b from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
 and installation_generation=(o->>'generation')::bigint and id=primary_id for update;
 if b.authority is distinct from o or b.storage_state<>'committed' or b.retain_until<=clock_timestamp() then raise exception 'DATASET_SOURCE_NOT_CURRENT';end if;
 h:=analytics.dataset_digest(p);prior:=b.manifest->'datasetStorageReceipts'->operation::text;
 if prior is not null then
  if prior->>'digest' is distinct from h then raise exception 'DATASET_OPERATION_CONFLICT';end if;
  if analytics.inspect_dataset_storage(o,primary_id,operation)->>'status' is distinct from 'stored' then raise exception 'DATASET_RECEIPT_INVALIDATED';end if;
  return prior;
 end if;
 if (select count(*) from jsonb_object_keys(coalesce(b.manifest->'datasetStorageReceipts','{}')) )>=32 then raise exception 'DATASET_RECEIPT_CAPACITY';end if;
 -- A private, owner-created stage cannot be spoofed by a caller's temp table.
 if o->>'provider'='klaviyo' and exists(select 1 from pg_catalog.pg_class
   where oid=pg_catalog.to_regclass('pg_temp.adstable_klaviyo_daily_report_stage')
     and relnamespace=pg_catalog.pg_my_temp_schema() and relowner=current_user::regrole
     and relpersistence='t' and relkind='r') then
  select true,stage.daily_sources_verified into staged_klaviyo,verified_day_sources
    from pg_temp.adstable_klaviyo_daily_report_stage stage
    where stage.body-'operationId'=p-'operationId' limit 1;
  staged_klaviyo:=coalesce(staged_klaviyo,false);
  verified_day_sources:=coalesce(verified_day_sources,false);
 end if;
 if p->'policy'->>'version'='report-source-3y-v1' then
  if exists(select 1 from privacy.deletion_runs where workspace_id=(o->>'workspaceId')::uuid and install_generation=(o->>'generation')::bigint and status in ('pending','running','failed')) then raise exception 'REPORT_RETENTION_PRIVACY_PENDING';end if;
  for item in select value from jsonb_array_elements(p->'rows') loop
   r:=item->'row';
   if analytics.report_retention_until((r->>'business_date')::date,r->>'source_timezone') is distinct from (p->'policy'->>'until')::timestamptz
    or r->>'business_date' is distinct from r->'provenance'->'source_context'->'window'->>'from'
    or r->>'source_timezone' is distinct from r->'provenance'->'source_context'->'snapshot'->>'timezone'
   then raise exception 'REPORT_RETENTION_POLICY_MISMATCH';end if;
   if not staged_klaviyo then
    perform analytics.assert_report_source_context(o,r->'provenance'->'source_context',(p->'policy'->>'until')::timestamptz,r->'provenance'->'sources');
    for k in select distinct x->>'batch_id' from jsonb_array_elements(r->'provenance'->'sources') x loop
     perform analytics.hold_report_source_batch(o,k::bigint,(p->'policy'->>'until')::timestamptz);
    end loop;
   end if;
   foreach k in array array['product_mapping_id','sold_product_mapping_id','advertised_product_mapping_id'] loop
    if r->>k is not null then perform analytics.hold_report_mapping(o,(r->>k)::bigint,(p->'policy'->>'until')::timestamptz);end if;
   end loop;
  end loop;
  if staged_klaviyo and not verified_day_sources then
   -- Verify the same context and page references and retain each source once
   -- per package. Individual scopes, mapping holds and row triggers remain.
   for grouped in
    select entry.value->'row'->'provenance'->'source_context' context,
      jsonb_agg(distinct refs.value) pages
    from jsonb_array_elements(p->'rows') entry
    cross join lateral jsonb_array_elements(entry.value->'row'->'provenance'->'sources') refs
    group by 1
   loop
    perform analytics.assert_report_source_context(o,grouped.context,(p->'policy'->>'until')::timestamptz,grouped.pages);
   end loop;
   for k in select distinct refs.value->>'batch_id' from jsonb_array_elements(p->'rows') entry
    cross join lateral jsonb_array_elements(entry.value->'row'->'provenance'->'sources') refs loop
    perform analytics.hold_report_source_batch(o,k::bigint,(p->'policy'->>'until')::timestamptz);
   end loop;
  end if;
 end if;
 if (select count(*) from jsonb_array_elements(p->'rows'))<>(select count(distinct (value->>'table',value->'row'->>'native_key_hash')) from jsonb_array_elements(p->'rows'))
 then raise exception 'DATASET_DUPLICATE_NATIVE_KEY';end if;
 for item in select value from jsonb_array_elements(p->'rows') loop
  name:=item->>'table';r:=item->'row';
  if name not in ('pd_facts','cpd_product_performance_facts','cpd_product_sales_facts') or name is null
  or jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>2 or not item ?& array['table','row']
  or jsonb_typeof(r) is distinct from 'object' then raise exception 'DATASET_TABLE_INVALID';end if;
  select array_agg(attname::text order by attnum) into allowed from pg_catalog.pg_attribute where attrelid=('analytics.'||name)::regclass and attnum>0 and not attisdropped
  and attname not in ('id','workspace_id','installation_id','installation_generation','provider_connection_id','platform','platform_account_id','canonical_reporting_account_id','revision','created_at','updated_at','retention_policy_version','retain_until');
  if (select count(*) from jsonb_object_keys(r))<>cardinality(allowed) or not r ?& allowed then raise exception 'DATASET_ROW_SHAPE_INVALID';end if;
  for k in select attname::text from pg_catalog.pg_attribute where attrelid=('analytics.'||name)::regclass and atttypid='numeric'::regtype and attnum>0 loop
   if r->k<>'null'::jsonb and (jsonb_typeof(r->k)<>'string' or length(r->>k)>128 or r->>k !~ '^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$') then raise exception 'DATASET_DECIMAL_INVALID';end if;
  end loop;
  row_input:=r-array['native_key_canonical','native_key_hash','grain_version','row_schema_version','payload_digest'];
  if r->>'payload_digest' is distinct from analytics.dataset_digest(row_input) then raise exception 'DATASET_PAYLOAD_DIGEST_INVALID';end if;
  injected:=r||jsonb_build_object('workspace_id',o->>'workspaceId','installation_id',o->>'installationId','installation_generation',o->>'generation',
   'provider_connection_id',o->>'connectionId','platform',o->>'provider','platform_account_id',o->>'accountId',
   'canonical_reporting_account_id',case when o->>'provider'='klaviyo' then null else o->>'accountId' end,
   'retention_policy_version',p->'policy'->>'version','retain_until',p->'policy'->>'until');
  if staged_klaviyo then
   bulk_rows:=jsonb_set(bulk_rows,array[name],coalesce(bulk_rows->name,'[]')||jsonb_build_array(injected));
   continue;
  end if;
  -- Serialize all accepted writes against current installation/control authority.
  -- Different content is a conflict; EO05C/D correction is never guessed here.
  execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=$4 and platform_account_id=$5 and grain_version=$6 and native_key_hash=$7 for update',name)
   into found_row using (o->>'workspaceId')::uuid,(o->>'installationId')::bigint,(o->>'generation')::bigint,o->>'provider',o->>'accountId',r->>'grain_version',r->>'native_key_hash';
  if found_row is not null then
   if found_row->>'native_key_canonical' is distinct from r->>'native_key_canonical' or found_row->>'payload_digest' is distinct from r->>'payload_digest'
   or (found_row->>'retain_until')::timestamptz<=clock_timestamp() then raise exception 'DATASET_NATIVE_CONFLICT';end if;
   if p->'policy'->>'version'='report-source-3y-v1' and (found_row->>'retention_policy_version' is distinct from 'report-source-3y-v1' or (found_row->>'retain_until')::timestamptz is distinct from (p->'policy'->>'until')::timestamptz) then raise exception 'DATASET_RETENTION_POLICY_CONFLICT';end if;
   rid:=(found_row->>'id')::bigint;
  else
   select string_agg(quote_ident(key),',' order by key) into cols from jsonb_object_keys(injected) key;
   execute format('insert into analytics.%I(%s) select %s from jsonb_populate_record(null::analytics.%I,$1) returning id',name,cols,cols,name) into rid using injected;
  end if;
  ids:=ids||jsonb_build_array(jsonb_build_object('table',name,'id',rid::text,'nativeKeyHash',r->>'native_key_hash'));
 end loop;
 if staged_klaviyo then
  -- Table names and input columns come from the checks above. Keep the existing
  -- per-row triggers and receipt semantics while issuing one insert per table.
  for name in select jsonb_object_keys(bulk_rows) order by 1 loop
   select string_agg(quote_ident(key),',' order by key) into cols from jsonb_object_keys(bulk_rows->name->0) key;
   for stored in execute format($bulk$
    with incoming as materialized (
     select * from jsonb_populate_recordset(null::analytics.%1$I,$1)
    ), existing as materialized (
     select target.id,target.native_key_hash,
      target.native_key_canonical is distinct from candidate.native_key_canonical
        or target.payload_digest is distinct from candidate.payload_digest
        or target.retain_until<=clock_timestamp() as native_conflict,
      target.retention_policy_version is distinct from candidate.retention_policy_version
        or target.retain_until is distinct from candidate.retain_until as retention_conflict
     from analytics.%1$I target join incoming candidate
      using (workspace_id,installation_id,installation_generation,platform,platform_account_id,grain_version,native_key_hash)
     for update of target
    ), inserted as (
     insert into analytics.%1$I (%2$s)
     select %2$s from incoming candidate
     where not exists(select 1 from existing prior where prior.native_key_hash=candidate.native_key_hash)
       and not exists(select 1 from existing prior where prior.native_conflict or ($2 and prior.retention_conflict))
     returning id,native_key_hash
    )
    select id,native_key_hash,native_conflict,retention_conflict from existing
    union all
    select id,native_key_hash,false,false from inserted
   $bulk$,name,cols) using bulk_rows->name,p->'policy'->>'version'='report-source-3y-v1'
   loop
    if stored.native_conflict then raise exception 'DATASET_NATIVE_CONFLICT';end if;
    if p->'policy'->>'version'='report-source-3y-v1' and stored.retention_conflict then raise exception 'DATASET_RETENTION_POLICY_CONFLICT';end if;
    bulk_ids:=bulk_ids||jsonb_build_object(name||':'||stored.native_key_hash,stored.id::text);
   end loop;
  end loop;
  if (select count(*) from jsonb_object_keys(bulk_ids))<>jsonb_array_length(p->'rows') then
   raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH';
  end if;
  -- Return the stored IDs in the same order as the bounded input package.
  select jsonb_agg(jsonb_build_object('table',entry.value->>'table',
    'id',bulk_ids->>((entry.value->>'table')||':'||(entry.value->'row'->>'native_key_hash')),
    'nativeKeyHash',entry.value->'row'->>'native_key_hash') order by entry.ordinality)
   into ids from jsonb_array_elements(p->'rows') with ordinality entry;
 end if;
 result:=jsonb_build_object('status','stored','operationId',operation,'digest',h,'rows',ids,'consumerReceipt',false);
 update evidence.source_batches set manifest=jsonb_set(manifest,'{datasetStorageReceipts}',coalesce(manifest->'datasetStorageReceipts','{}')||jsonb_build_object(operation::text,result)) where id=primary_id;
 return result;
end $fn$;

reset role;
commit;
