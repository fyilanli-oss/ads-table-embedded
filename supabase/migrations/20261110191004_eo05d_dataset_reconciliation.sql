begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Reuse the accepted canonical serialization and fixed fact schemas. This
-- recomputes the digest from PHYSICAL values, not merely a stored hash column.
create function analytics.reconciliation_fact_digest(t text,j jsonb) returns text
language plpgsql stable set search_path='' as $fn$
declare v jsonb; k text;
begin
 if t not in ('pd_facts','cpd_product_performance_facts','cpd_product_sales_facts') then raise exception 'DATASET_TABLE_INVALID';end if;
 v:=j-array['id','workspace_id','installation_id','installation_generation','provider_connection_id','platform','platform_account_id','canonical_reporting_account_id','revision','created_at','updated_at','retention_policy_version','retain_until','native_key_canonical','native_key_hash','grain_version','row_schema_version','payload_digest'];
 for k in select attname::text from pg_catalog.pg_attribute where attrelid=('analytics.'||t)::regclass and atttypid in ('numeric'::regtype,'bigint'::regtype) and attnum>0 and not attisdropped loop
  if v ? k and v->k<>'null'::jsonb then v:=jsonb_set(v,array[k],to_jsonb(v->>k));end if;
 end loop;
 if v->>'occurred_at' is not null then v:=jsonb_set(v,'{occurred_at}',to_jsonb(to_char((v->>'occurred_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));end if;
 return analytics.dataset_digest(v);
end $fn$;

create function analytics.inspect_dataset_reconciliation(o jsonb,op uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype;r jsonb;item jsonb;fact jsonb;ref jsonb;t text;n int;total_rows int:=0;
begin
 perform evidence.assert_source_owner(o);
 select * into b from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
 and installation_generation=(o->>'generation')::bigint and primary_source=o->>'provider' and authority=o
 and (manifest->'datasetReconciliation'->>'operationId'=op::text or manifest->'datasetReconciliationMismatch'->>'operationId'=op::text) limit 1 for share;
 if not found then return null;end if;
 if b.storage_state<>'committed' or b.retain_until<=clock_timestamp() or b.manifest->'privacyRedacted'='true'::jsonb then raise exception 'DATASET_RECONCILIATION_UNAVAILABLE';end if;
 r:=coalesce(b.manifest->'datasetReconciliation',b.manifest->'datasetReconciliationMismatch');
 if b.manifest ? 'datasetSupersededBy' then return r||jsonb_build_object('status','superseded','checkpointAdvanced',false);end if;
 if r->>'status'='mismatch' then return r;end if;
 if r->>'digest' is distinct from analytics.dataset_digest(r-'digest') then raise exception 'DATASET_RECONCILIATION_RECEIPT_INVALID';end if;
 foreach t in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
  execute format('select count(*)::int from (select id from analytics.%I where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=$4 and platform_account_id=$5 and business_date=$6 limit 201) x',t)
   into n using (o->>'workspaceId')::uuid,(o->>'installationId')::bigint,(o->>'generation')::bigint,o->>'provider',o->>'accountId',(r->>'businessDate')::date;
  total_rows:=total_rows+n;
 end loop;
 if total_rows<>(r->>'rowCount')::int then return r||jsonb_build_object('status','mismatch','comparison','mismatch','checkpointAdvanced',false);end if;
 for ref in select value from jsonb_array_elements(r->'sources') loop
  perform analytics.assert_dataset_source(o,ref);
  if not exists(select 1 from evidence.source_batches x where x.authority=o and x.id=(ref->>'batch_id')::bigint
   and x.handoff_state='consumed' and x.handoff_receipt=r->>'digest' and x.manifest->'privacyRedacted' is distinct from 'true'::jsonb)
  then raise exception 'DATASET_RECONCILIATION_CONSUMPTION_INVALID';end if;
 end loop;
 for item in select value from jsonb_array_elements(r->'rows') loop
  if item->>'table' not in ('pd_facts','cpd_product_performance_facts','cpd_product_sales_facts') then raise exception 'DATASET_TABLE_INVALID';end if;
  execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and id=$4',item->>'table') into fact
  using (o->>'workspaceId')::uuid,(o->>'installationId')::bigint,(o->>'generation')::bigint,(item->>'id')::bigint;
  if fact is null or fact->>'native_key_hash' is distinct from item->>'nativeKeyHash'
  or fact->>'payload_digest' is distinct from item->>'payloadDigest' or (fact->>'retain_until')::timestamptz<=clock_timestamp()
  or analytics.reconciliation_fact_digest(item->>'table',fact) is distinct from item->>'payloadDigest'
  then return r||jsonb_build_object('status','mismatch','comparison','mismatch','checkpointAdvanced',false);end if;
 end loop;
 return r;
end $fn$;

create function analytics._commit_dataset_reconciliation(o jsonb,p jsonb,c jsonb,d timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare item jsonb; r jsonb; row_input jsonb; injected jsonb; b evidence.source_batches%rowtype; primary_id bigint;
 operation uuid; h text; prior jsonb; result jsonb; ids jsonb:='[]'; found_row jsonb; rid bigint; name text; cols text; allowed text[]; k text;
 head jsonb; old_fact jsonb; ref jsonb; native_read jsonb; read_key text; sets text[]:='{}'; expected_sets text[];
 batch_text text; obsolete bigint[]:='{}'; old_count int:=0; pages int:=0; old_id bigint; changes jsonb:='[]'; actual jsonb; summary jsonb:='[]';
 start_at text; finish_at text; prev_time timestamptz; removed int:=0; modified int:=0; scope_date date; scope_tz text;
begin
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 if o->>'provider'='shopify' or jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>4
 or not p ?& array['version','operationId','policy','rows'] or p->>'version'<>'eo05b-storage-v1'
 or jsonb_typeof(p->'rows') is distinct from 'array' or jsonb_array_length(p->'rows') not between 0 and 200
 or octet_length(analytics.dataset_json(p))>1048576 then raise exception 'DATASET_INPUT_INVALID';end if;
 operation:=(p->>'operationId')::uuid;
 if exists(select 1 from evidence.source_batches where authority=o and
 (manifest->'datasetReconciliation'->>'operationId'=operation::text or manifest->'datasetReconciliationMismatch'->>'operationId'=operation::text))
 then raise exception 'DATASET_RECONCILIATION_OPERATION_USED';end if;
 if jsonb_typeof(p->'policy') is distinct from 'object' or (select count(*) from jsonb_object_keys(p->'policy'))<>2
 or not p->'policy' ?& array['version','until'] or coalesce(p->'policy'->>'version','')=''
 or not coalesce(isfinite((p->'policy'->>'until')::timestamptz) and (p->'policy'->>'until')::timestamptz>clock_timestamp(),false)
 then raise exception 'DATASET_RETENTION_REQUIRED';end if;
 primary_id:=(c->'batchIds'->>0)::bigint;
 select * into strict b from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
 and installation_generation=(o->>'generation')::bigint and id=primary_id for update;
 if b.authority is distinct from o or b.storage_state<>'committed' or b.retain_until<=clock_timestamp() then raise exception 'DATASET_SOURCE_NOT_CURRENT';end if;
 h:=analytics.dataset_digest(jsonb_build_object('write',p,'context',c));
 if jsonb_typeof(c) is distinct from 'object' or (select count(*) from jsonb_object_keys(c))<>9
 or c->>'version' is distinct from 'eo05d-reconciliation-v1' or coalesce(c->>'expectedRevision','')!~ '^(0|[1-9][0-9]{0,8})$'
 or jsonb_typeof(c->'sources') is distinct from 'array' or jsonb_array_length(c->'sources') not between 1 and 300
 or jsonb_typeof(c->'batchIds') is distinct from 'array' or jsonb_array_length(c->'batchIds') not between 2 and 3
 or (select count(distinct value) from jsonb_array_elements_text(c->'batchIds'))<>jsonb_array_length(c->'batchIds')
 or d is null or not isfinite(d) or d<=clock_timestamp() or d>clock_timestamp()+interval '120 seconds'
 or octet_length(analytics.dataset_json(jsonb_build_object('write',p,'context',c)))>1048576
 or p->'policy'->>'version' is distinct from 'report-source-3y-v1'
 then raise exception 'DATASET_RECONCILIATION_INPUT_INVALID';end if;
 scope_date:=(c->>'businessDate')::date;scope_tz:=c->>'timeZone';
 if scope_date::text is distinct from c->>'businessDate' or scope_date not between date '1900-01-01' and date '9990-12-31'
 or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=scope_tz)
 or analytics.report_retention_until(scope_date,scope_tz) is distinct from (p->'policy'->>'until')::timestamptz
 then raise exception 'DATASET_RECONCILIATION_DATE_INVALID';end if;
 if exists(select 1 from privacy.deletion_runs where workspace_id=(o->>'workspaceId')::uuid and install_generation=(o->>'generation')::bigint and status in ('pending','running','failed')) then raise exception 'REPORT_RETENTION_PRIVACY_PENDING';end if;
 select manifest->'datasetReconciliation' into head from evidence.source_batches
 where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint and installation_generation=(o->>'generation')::bigint
 and primary_source=o->>'provider' and authority=o and manifest ? 'datasetReconciliation'
 and manifest->'datasetReconciliation'->>'businessDate'=c->>'businessDate' and manifest->'datasetReconciliation'->>'timeZone'=scope_tz
 order by (manifest->'datasetReconciliation'->>'revision')::bigint desc,id desc limit 1;
 if coalesce((head->>'revision')::bigint,0)<>(c->>'expectedRevision')::bigint then raise exception 'DATASET_RECONCILIATION_REVISION_CONFLICT';end if;
 if head is not null then
  prior:=analytics.inspect_dataset_reconciliation(o,(head->>'operationId')::uuid);
  if prior->>'status' is distinct from 'consumed' then raise exception 'DATASET_RECONCILIATION_PREVIOUS_UNVERIFIED';end if;
  if (c->>'startedAt')::timestamptz<(head->>'completedAt')::timestamptz then raise exception 'DATASET_RECONCILIATION_STALE_READ';end if;
  select array_agg(value::bigint) into obsolete from jsonb_array_elements_text(head->'batchIds');
 end if;
 read_key:=case o->>'provider' when 'google_ads' then 'googleDatasetRead' when 'meta' then 'metaDatasetRead' else 'klaviyoDatasetRead' end;
 perform id from evidence.source_batches where authority=o and id in(select value::bigint from jsonb_array_elements_text(c->'batchIds')) order by id for update;
 for batch_text in select value from jsonb_array_elements_text(c->'batchIds') loop
  select * into strict b from evidence.source_batches where authority=o and id=batch_text::bigint;
  native_read:=b.manifest->read_key;
  if b.storage_state<>'committed' or b.source_state<>'complete' or b.handoff_state<>'pending' or b.retain_until<=clock_timestamp()
  or b.manifest ? 'datasetReconciliationMismatch' or b.manifest->'privacyRedacted'='true'::jsonb or native_read is null
  or native_read->'window' is distinct from jsonb_build_object('from',c->>'businessDate','to',c->>'businessDate')
  or native_read->>'jobId' is distinct from c->'sourceContext'->>'job_id' or native_read->>'fence' is distinct from c->'sourceContext'->>'fence'
  or native_read->>'dataset'=any(sets)
  or coalesce(native_read->>'observedAt','')!~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
  or coalesce(native_read->>'completedAt','')!~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
  or (native_read->>'completedAt')::timestamptz<(native_read->>'observedAt')::timestamptz or (native_read->>'completedAt')::timestamptz>clock_timestamp()
  then raise exception 'DATASET_RECONCILIATION_SOURCE_INVALID';end if;
  sets:=array_append(sets,native_read->>'dataset');pages:=pages+(b.manifest->'counts'->>'pages')::int;
  start_at:=least(start_at,native_read->>'observedAt');finish_at:=greatest(finish_at,native_read->>'completedAt');
  perform analytics.hold_report_source_batch(o,b.id,(p->'policy'->>'until')::timestamptz);
 end loop;
 expected_sets:=case o->>'provider' when 'klaviyo' then array['account_performance','configuration','product_performance'] else array['account_performance','product_performance'] end;
 if (select array_agg(x order by x) from unnest(sets) x) is distinct from expected_sets or pages<>jsonb_array_length(c->'sources')
 or (select count(distinct value->>'page_id') from jsonb_array_elements(c->'sources'))<>pages
 or start_at is distinct from c->>'startedAt' or finish_at is distinct from c->>'completedAt' then raise exception 'DATASET_RECONCILIATION_COVERAGE_INVALID';end if;
 for ref in select value from jsonb_array_elements(c->'sources') loop
  if not (c->'batchIds' ? (ref->>'batch_id')) then raise exception 'DATASET_RECONCILIATION_REFERENCE_INVALID';end if;
  perform analytics.assert_dataset_source(o,ref);
 end loop;
 perform analytics.assert_report_source_context(o,c->'sourceContext',(p->'policy'->>'until')::timestamptz,c->'sources');
 if (scope_date::timestamp at time zone scope_tz)<to_timestamp((c->'sourceContext'->'snapshot'->>'eligibleFromMs')::numeric/1000)
 or scope_date>(clock_timestamp() at time zone scope_tz)::date then raise exception 'DATASET_RECONCILIATION_ELIGIBILITY';end if;
 -- Bounded complete-day replacement. Never erase rows from another owner,
 -- timezone, date, connection or a partial/unavailable projection.
 foreach name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
  for old_fact in execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=$4 and platform_account_id=$5 and business_date=$6 order by id limit 201 for update',name)
   using (o->>'workspaceId')::uuid,(o->>'installationId')::bigint,(o->>'generation')::bigint,o->>'provider',o->>'accountId',scope_date loop
   old_count:=old_count+1;if old_count>200 then raise exception 'DATASET_RECONCILIATION_SCOPE_LIMIT';end if;
   if old_fact->>'source_timezone' is distinct from scope_tz or old_fact->>'provider_connection_id' is distinct from o->>'connectionId'
   or (old_fact->>'retain_until')::timestamptz<=clock_timestamp() then raise exception 'DATASET_RECONCILIATION_SCOPE_CONFLICT';end if;
   for ref in select value from jsonb_array_elements(old_fact->'provenance'->'sources') loop
    perform analytics.assert_dataset_source(o,ref);obsolete:=array_append(obsolete,(ref->>'batch_id')::bigint);
    select manifest->read_key into native_read from evidence.source_batches where id=(ref->>'batch_id')::bigint;
    if native_read->>'completedAt' is null or (native_read->>'completedAt')::timestamptz>(c->>'startedAt')::timestamptz then raise exception 'DATASET_RECONCILIATION_STALE_READ';end if;
   end loop;
   if not exists(select 1 from jsonb_array_elements(p->'rows') x where x->>'table'=name and x->'row'->>'native_key_hash'=old_fact->>'native_key_hash') then
    if analytics.dataset_retention_has_dependents(name,old_fact) then raise exception 'DATASET_RECONCILIATION_DEPENDENT';end if;
    changes:=changes||jsonb_build_array(jsonb_build_object('table',name,'id',old_fact->>'id','before',old_fact->>'payload_digest','after',null,'action','removed'));
    execute format('delete from analytics.%I where id=$1',name) using (old_fact->>'id')::bigint;removed:=removed+1;
   end if;
  end loop;
 end loop;
 if p->'policy'->>'version'='report-source-3y-v1' then
  if exists(select 1 from privacy.deletion_runs where workspace_id=(o->>'workspaceId')::uuid and install_generation=(o->>'generation')::bigint and status in ('pending','running','failed')) then raise exception 'REPORT_RETENTION_PRIVACY_PENDING';end if;
  for item in select value from jsonb_array_elements(p->'rows') loop
   r:=item->'row';
   if r->>'business_date' is distinct from c->>'businessDate' or r->>'source_timezone' is distinct from scope_tz
   or r->'provenance'->'source_context' is distinct from c->'sourceContext' or r->>'source_completeness' is distinct from 'complete'
   or exists(select 1 from jsonb_array_elements(r->'provenance'->'sources') x where not (c->'sources' @> jsonb_build_array(x)))
   then raise exception 'DATASET_RECONCILIATION_ROW_SCOPE';end if;
   if analytics.report_retention_until((r->>'business_date')::date,r->>'source_timezone') is distinct from (p->'policy'->>'until')::timestamptz
    or r->>'business_date' is distinct from r->'provenance'->'source_context'->'window'->>'from'
    or r->>'source_timezone' is distinct from r->'provenance'->'source_context'->'snapshot'->>'timezone'
   then raise exception 'REPORT_RETENTION_POLICY_MISMATCH';end if;
   perform analytics.assert_report_source_context(o,r->'provenance'->'source_context',(p->'policy'->>'until')::timestamptz,r->'provenance'->'sources');
   for k in select distinct x->>'batch_id' from jsonb_array_elements(r->'provenance'->'sources') x loop
    perform analytics.hold_report_source_batch(o,k::bigint,(p->'policy'->>'until')::timestamptz);
   end loop;
   foreach k in array array['product_mapping_id','sold_product_mapping_id','advertised_product_mapping_id'] loop
    if r->>k is not null then perform analytics.hold_report_mapping(o,(r->>k)::bigint,(p->'policy'->>'until')::timestamptz);end if;
   end loop;
  end loop;
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
  -- Serialize all accepted writes against current installation/control authority.
  -- Different content is a conflict; EO05C/D correction is never guessed here.
  execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=$4 and platform_account_id=$5 and grain_version=$6 and native_key_hash=$7 for update',name)
   into found_row using (o->>'workspaceId')::uuid,(o->>'installationId')::bigint,(o->>'generation')::bigint,o->>'provider',o->>'accountId',r->>'grain_version',r->>'native_key_hash';
  if found_row is not null then
   if found_row->>'native_key_canonical' is distinct from r->>'native_key_canonical' or found_row->>'business_date' is distinct from c->>'businessDate'
   or found_row->>'source_timezone' is distinct from scope_tz or found_row->>'provider_connection_id' is distinct from o->>'connectionId'
   or (found_row->>'retain_until')::timestamptz<=clock_timestamp() then raise exception 'DATASET_RECONCILIATION_KEY_CONFLICT';end if;
   rid:=(found_row->>'id')::bigint;
   changes:=changes||jsonb_build_array(jsonb_build_object('table',name,'id',rid::text,'before',found_row->>'payload_digest','after',r->>'payload_digest','action','replaced'));
   select string_agg(format('%I=v.%I',key,key),',' order by key) into cols from jsonb_object_keys(injected) key;
   update evidence.source_batches set manifest=manifest||jsonb_build_object('datasetRevisionPermit',jsonb_build_object(
    'transactionId',pg_catalog.txid_current()::text,'table',name,'id',rid::text,'fromRevision',found_row->>'revision',
    'toRevision',((found_row->>'revision')::bigint+1)::text,'before',found_row->>'payload_digest','after',r->>'payload_digest'))
   where authority=o and id=(r->>'source_batch_id')::bigint;
   execute format('update analytics.%I x set %s,revision=x.revision+1,updated_at=clock_timestamp() from jsonb_populate_record(null::analytics.%I,$1) v where x.id=$2',name,cols,name) using injected,rid;
   update evidence.source_batches set manifest=manifest-'datasetRevisionPermit' where authority=o and id=(r->>'source_batch_id')::bigint;
   modified:=modified+1;
  else
   select string_agg(quote_ident(key),',' order by key) into cols from jsonb_object_keys(injected) key;
   execute format('insert into analytics.%I(%s) select %s from jsonb_populate_record(null::analytics.%I,$1) returning id',name,cols,cols,name) into rid using injected;
   changes:=changes||jsonb_build_array(jsonb_build_object('table',name,'id',rid::text,'before',null,'after',r->>'payload_digest','action','inserted'));
  end if;
  execute format('select to_jsonb(x) from analytics.%I x where id=$1',name) into actual using rid;
  if analytics.reconciliation_fact_digest(name,actual) is distinct from r->>'payload_digest' then raise exception 'DATASET_RECONCILIATION_READBACK_MISMATCH';end if;
  summary:=summary||jsonb_build_array(jsonb_build_object('table',name,'id',rid::text,'nativeKeyHash',r->>'native_key_hash','payloadDigest',r->>'payload_digest'));
  ids:=ids||jsonb_build_array(jsonb_build_object('table',name,'id',rid::text,'nativeKeyHash',r->>'native_key_hash'));
 end loop;
 old_count:=0;
 foreach name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
  execute format('select count(*)::int from (select id from analytics.%I where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=$4 and platform_account_id=$5 and business_date=$6 limit 201) x',name)
   into pages using (o->>'workspaceId')::uuid,(o->>'installationId')::bigint,(o->>'generation')::bigint,o->>'provider',o->>'accountId',scope_date;
  old_count:=old_count+pages;
 end loop;
 if old_count<>jsonb_array_length(p->'rows') then raise exception 'DATASET_RECONCILIATION_READBACK_MISMATCH';end if;
 if d<=clock_timestamp() then raise exception 'DATASET_RECONCILIATION_DEADLINE';end if;
 result:=jsonb_build_object('version','eo05d-reconciliation-v1','status','consumed','operationId',operation,'requestDigest',h,
 'businessDate',c->>'businessDate','timeZone',scope_tz,'revision',(c->>'expectedRevision')::bigint+1,
 'startedAt',c->>'startedAt','completedAt',c->>'completedAt','batchIds',c->'batchIds','sources',c->'sources',
 'rowCount',jsonb_array_length(p->'rows'),'rows',summary,'changes',changes,'removed',removed,'replaced',modified,
 'comparison','matched','consumerReceipt',true,'checkpointAdvanced',true);
 result:=result||jsonb_build_object('digest',analytics.dataset_digest(result));
 if octet_length(result::text)>262144 then raise exception 'DATASET_RECONCILIATION_RECEIPT_LIMIT';end if;
 update evidence.source_batches set manifest=manifest||jsonb_build_object('datasetSupersededBy',operation::text)
 where authority=o and id=any(coalesce(obsolete,'{}')) and not (c->'batchIds' ? id::text);
 update evidence.source_batches set handoff_state='consumed',handoff_receipt=result->>'digest',
 manifest=manifest||jsonb_build_object('datasetConsumerReceipt',jsonb_build_object('operationId',operation,'anchorBatchId',primary_id::text,'digest',result->>'digest'))
 where authority=o and id in(select value::bigint from jsonb_array_elements_text(c->'batchIds'));
 update evidence.source_batches set manifest=manifest||jsonb_build_object('datasetReconciliation',result) where id=primary_id;
 if exists(select 1 from evidence.source_batches where id in(select value::bigint from jsonb_array_elements_text(c->'batchIds')) and octet_length(manifest::text)>1048576)
 then raise exception 'DATASET_RECONCILIATION_MANIFEST_LIMIT';end if;
 return result;
end $fn$;

-- Catch only an actual post-write physical readback mismatch. The subtransaction
-- rolls ALL facts/consumption/checkpoint back before this bounded failure record.
create function analytics.commit_dataset_reconciliation(o jsonb,p jsonb,c jsonb,d timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare r jsonb;bid bigint;
begin
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 begin
  return analytics._commit_dataset_reconciliation(o,p,c,d);
 exception when raise_exception then
  if sqlerrm<>'DATASET_RECONCILIATION_READBACK_MISMATCH' then raise;end if;
 end;
 bid:=(c->'batchIds'->>0)::bigint;
 r:=jsonb_build_object('version','eo05d-reconciliation-v1','status','mismatch','comparison','mismatch','operationId',p->>'operationId',
 'requestDigest',analytics.dataset_digest(jsonb_build_object('write',p,'context',c)),'consumerReceipt',false,'checkpointAdvanced',false,'reportValuesChanged',false);
 update evidence.source_batches set manifest=manifest||jsonb_build_object('datasetReconciliationMismatch',r)
 where id=bid and authority=o and storage_state='committed' and handoff_state='pending';
 if not found then raise exception 'DATASET_RECONCILIATION_MISMATCH_UNRECORDED';end if;
 return r;
end $fn$;

create or replace function analytics.inspect_dataset_storage(o jsonb,p_batch bigint,p_operation uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype; receipt jsonb; item jsonb; fact jsonb; ref jsonb; name text;
begin
 perform evidence.assert_source_owner(o);
 select * into b from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
 and installation_generation=(o->>'generation')::bigint and id=p_batch for share;
 if not found or b.authority is distinct from o or b.storage_state<>'committed' or b.retain_until<=clock_timestamp() then raise exception 'DATASET_SOURCE_NOT_CURRENT';end if;
 receipt:=b.manifest->'datasetStorageReceipts'->p_operation::text;
 if receipt is null then return null;end if;
 if b.manifest ? 'datasetSupersededBy' then return jsonb_build_object('status','invalidated','consumerReceipt',false);end if;
 for item in select value from jsonb_array_elements(receipt->'rows') loop
  name:=item->>'table';
  if name not in ('pd_facts','cpd_product_performance_facts','cpd_product_sales_facts') then raise exception 'DATASET_RECEIPT_INVALID';end if;
  execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and id=$4',name)
   into fact using (o->>'workspaceId')::uuid,(o->>'installationId')::bigint,(o->>'generation')::bigint,(item->>'id')::bigint;
  if fact is null or fact->>'native_key_hash' is distinct from item->>'nativeKeyHash' or (fact->>'retain_until')::timestamptz<=clock_timestamp()
  then return jsonb_build_object('status','invalidated','consumerReceipt',false);end if;
  for ref in select value from jsonb_array_elements(fact->'provenance'->'sources') loop perform analytics.assert_dataset_source(o,ref);end loop;
 end loop;
 return receipt;
end $fn$;

create or replace function analytics.inspect_dataset_empty_retention(o jsonb,bid bigint,op uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype;receipt jsonb;ref jsonb;
begin
 perform evidence.assert_source_owner(o);
 select * into strict b from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint and installation_generation=(o->>'generation')::bigint and id=bid for share;
 if b.authority is distinct from o then raise exception 'REPORT_OWNER_CHANGED';end if;
 receipt:=b.manifest->'datasetEmptyRetentionReceipts'->op::text;
 if receipt is null then return null;end if;
 if b.manifest ? 'datasetSupersededBy' then return jsonb_build_object('status','invalidated','consumerReceipt',false);end if;
 if (receipt->>'until')::timestamptz<=clock_timestamp() then return jsonb_build_object('status','invalidated','consumerReceipt',false);end if;
 for ref in select value from jsonb_array_elements(receipt->'sources') loop perform analytics.assert_dataset_source(o,ref);end loop;
 return receipt;
end $fn$;

-- Per-row transaction-bound revision permission. The remaining validator is preserved.
create or replace function analytics.validate_dataset_fact() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare j jsonb:=to_jsonb(new); b evidence.source_batches%rowtype; o jsonb; ref jsonb; m identity.product_identity_mappings%rowtype;
 f analytics.fx_rates%rowtype; k text; keys text[]; expected jsonb; identity_kind text; native jsonb; all_complete boolean:=true; context jsonb; original_source jsonb; native_read jsonb; permit jsonb;
begin
 if tg_op='UPDATE' then
  select manifest->'datasetRevisionPermit' into permit from evidence.source_batches where workspace_id=new.workspace_id and installation_id=new.installation_id
   and installation_generation=new.installation_generation and id=new.source_batch_id and storage_state='committed' and source_state='complete' and handoff_state='pending';
  if permit is null or permit->>'transactionId' is distinct from pg_catalog.txid_current()::text or permit->>'table' is distinct from tg_table_name
   or permit->>'id' is distinct from new.id::text or permit->>'fromRevision' is distinct from old.revision::text
   or permit->>'toRevision' is distinct from new.revision::text or new.revision<>old.revision+1
   or permit->>'before' is distinct from old.payload_digest or permit->>'after' is distinct from new.payload_digest
   or new.workspace_id is distinct from old.workspace_id or new.installation_id is distinct from old.installation_id
   or new.installation_generation is distinct from old.installation_generation or new.provider_connection_id is distinct from old.provider_connection_id
   or new.platform is distinct from old.platform or new.platform_account_id is distinct from old.platform_account_id
   or new.native_key_canonical is distinct from old.native_key_canonical or new.native_key_hash is distinct from old.native_key_hash
   or new.business_date is distinct from old.business_date or new.source_timezone is distinct from old.source_timezone or new.created_at is distinct from old.created_at
  then raise exception 'DATASET_REVISION_PROTOCOL_REQUIRED';end if;
 end if;
 select * into strict b from evidence.source_batches where workspace_id=new.workspace_id and installation_id=new.installation_id
 and installation_generation=new.installation_generation and id=new.source_batch_id for share;
 o:=b.authority; perform evidence.assert_source_owner(o);
 if o->>'provider'='shopify' or new.platform is distinct from o->>'provider' or new.platform_account_id is distinct from o->>'accountId'
 or new.provider_connection_id::text is distinct from o->>'connectionId'
 or new.retain_until>b.retain_until or new.retain_until<=clock_timestamp() then raise exception 'DATASET_OWNER_OR_POLICY_INVALID';end if;
 if new.platform<>'klaviyo' and new.canonical_reporting_account_id is distinct from o->>'accountId' then raise exception 'DATASET_ACCOUNT_INVALID';end if;
 if octet_length(analytics.dataset_json(j))>65536 or jsonb_typeof(new.provenance->'sources') is distinct from 'array'
 or jsonb_array_length(new.provenance->'sources') not between 1 and 32
 or (select count(*) from jsonb_object_keys(new.provenance))<>2+(case when new.provenance ? 'source_context' then 1 else 0 end)+(case when new.provenance ? 'reporting_currency' then 2 else 0 end)
 or (new.provenance ? 'reporting_currency') is distinct from (new.provenance ? 'fx_policy')
 or not new.provenance ?& array['projection_version','sources'] or coalesce(new.provenance->>'projection_version','')=''
 then raise exception 'DATASET_PROVENANCE_INVALID';end if;
 if new.provenance ? 'source_context' then
  context:=new.provenance->'source_context';
  if jsonb_typeof(context) is distinct from 'object' or (select count(*) from jsonb_object_keys(context))<>6
  or not context ?& array['version','snapshot','digest','job_id','fence','window'] or context->>'version'<>'eo05b-source-context-v1'
  then raise exception 'DATASET_CONTEXT_INVALID';end if;
  select source into original_source from operations.refresh_work_bindings where workspace_id=new.workspace_id and install_generation=new.installation_generation
   and provider=new.platform and account_id=new.platform_account_id and job_id=context->>'job_id' and fence=(context->>'fence')::bigint
   and from_date=(context->'window'->>'from')::date and to_date=(context->'window'->>'to')::date for share;
  if not found or original_source is distinct from context->'snapshot' or evidence.source_hash(original_source) is distinct from context->>'digest'
  or original_source->>'currency' is distinct from new.source_currency or original_source->>'timezone' is distinct from new.source_timezone
  or original_source->>'connectionId' is distinct from new.provider_connection_id::text
  or original_source->>'connectionVersion' is distinct from o->>'connectionVersion'
  or context->'window'->>'from' is distinct from context->'window'->>'to'
  or (new.business_date is not null and new.business_date::text is distinct from context->'window'->>'from')
  then raise exception 'DATASET_CONTEXT_MISMATCH';end if;
  for ref in select value from jsonb_array_elements(new.provenance->'sources') loop
   select manifest->(case new.platform when 'google_ads' then 'googleDatasetRead' when 'meta' then 'metaDatasetRead' else 'klaviyoDatasetRead' end) into native_read
   from evidence.source_batches where workspace_id=new.workspace_id and installation_id=new.installation_id and installation_generation=new.installation_generation and id=(ref->>'batch_id')::bigint;
   if native_read is null or native_read->>'jobId' is distinct from context->>'job_id' or native_read->>'fence' is distinct from context->>'fence'
   or native_read->'window' is distinct from context->'window' then raise exception 'DATASET_CONTEXT_SOURCE_MISMATCH';end if;
  end loop;
 end if;
 if new.provenance ? 'reporting_currency' or new.fx_engine_version='frankfurter-ecb-weekend-v1' then perform analytics.assert_dataset_fx_context(to_jsonb(new));end if;
 for ref in select value from jsonb_array_elements(new.provenance->'sources') loop
  perform analytics.assert_dataset_source(o,ref);
  if exists(select 1 from evidence.source_batches x where x.id=(ref->>'batch_id')::bigint and x.source_state<>'complete') then all_complete:=false;end if;
  if exists(select 1 from evidence.source_batches x where x.id=(ref->>'batch_id')::bigint and x.retain_until<new.retain_until) then raise exception 'DATASET_SOURCE_POLICY_INVALID';end if;
 end loop;
 if new.source_completeness is distinct from (case when all_complete then 'complete' else 'partial' end) then raise exception 'DATASET_COMPLETENESS_INVALID';end if;
 if not exists(select 1 from jsonb_array_elements(new.provenance->'sources') r where r->>'batch_id'=new.source_batch_id::text)
 then raise exception 'DATASET_PRIMARY_SOURCE_REQUIRED';end if;
 -- Registry changes replace this validator; the tables retain their generic
 -- same-grain JSONB shape and do not need a new per-provider column/table.
 if new.extension_schema_version<>'eo05b-extensions-v1' or new.metric_extensions<>'{}'::jsonb
 or (select count(*) from jsonb_object_keys(new.metric_extensions))>32 then raise exception 'DATASET_EXTENSION_UNREGISTERED';end if;
 keys:=case tg_table_name when 'pd_facts' then array['impression','ad_click','spend_value','add_to_cart','add_to_cart_value','checkout','checkout_value','purchase','purchase_value']
 when 'cpd_product_performance_facts' then array['impression','click','spend_value'] else array['sales_quantity','sales_value'] end;
 if (select count(*) from jsonb_object_keys(new.metric_support))<>cardinality(keys)
 or (select count(*) from jsonb_object_keys(new.observation_state))<>cardinality(keys)
 or not new.metric_support ?& keys or not new.observation_state ?& keys then raise exception 'DATASET_METRIC_STATE_INVALID';end if;
 foreach k in array keys loop
  if not coalesce(new.metric_support->>k in ('supported','unsupported','unknown') and new.observation_state->>k in ('present','missing','unknown','unsupported'),false) then raise exception 'DATASET_METRIC_STATE_INVALID';end if;
  if new.metric_support->>k='unsupported' and new.observation_state->>k<>'unsupported' then raise exception 'DATASET_METRIC_STATE_INVALID';end if;
 end loop;
 identity_kind:=new.source_identity->>'kind';native:=new.source_identity->'native';
 if jsonb_typeof(native) is distinct from 'object' or native='{}' or (select count(*) from jsonb_object_keys(native))>16
 or (select count(*) from jsonb_object_keys(new.source_identity))<>3 or not new.source_identity ?& array['kind','namespace','native']
 or coalesce(new.source_identity->>'namespace','')='' or identity_kind not in ('daily','event') or identity_kind is null
 or exists(select 1 from jsonb_each(native) where key !~ '^[a-z][a-z0-9_]{0,63}$' or key ~ 'amount|value|name|mapping|role|channel|currency|version|epoch|connection|credential|job|attempt|receipt|cursor'
 or key not in ('entity_type','entity_id','campaign_id','ad_group_id','asset_group_id','merchant_id','catalog_id','feed_label','language','product_id','sold_product_id','advertised_product_id','event_id')
 or jsonb_typeof(value) not in ('string','null')) then raise exception 'DATASET_IDENTITY_INVALID';end if;
 if (tg_table_name='pd_facts' and (native->>'entity_id' is distinct from j->>'entity_id' or native->>'entity_type' is distinct from j->>'entity_type'))
 or (tg_table_name='cpd_product_performance_facts' and native->>'product_id' is distinct from j->>'native_product_id')
 or (tg_table_name='cpd_product_sales_facts' and identity_kind='daily' and native->>'sold_product_id' is distinct from j->>'native_sold_product_id')
 or (identity_kind='event' and new.platform<>'klaviyo') then raise exception 'DATASET_IDENTITY_INVALID';end if;
 expected:=jsonb_build_array(new.grain_version,new.workspace_id::text,new.installation_id::text,new.installation_generation::text,new.platform,new.platform_account_id,tg_table_name,
 identity_kind,new.source_identity->>'namespace',native);
 if identity_kind='daily' then
  if new.source_identity->>'namespace' is distinct from (case tg_table_name when 'pd_facts' then 'entity_performance' when 'cpd_product_performance_facts' then 'product_performance' else 'product_sales' end) then raise exception 'DATASET_IDENTITY_INVALID';end if;
  if new.business_date is null or coalesce(new.source_timezone,'')='' or new.reporting_scope='{}' then raise exception 'DATASET_DAILY_SCOPE_REQUIRED';end if;
  expected:=expected||jsonb_build_array(new.business_date::text,new.source_timezone,new.reporting_scope,new.source_currency);
 else
  if tg_table_name<>'cpd_product_sales_facts' or new.source_identity->>'namespace'<>'ordered_product' or (select count(*) from jsonb_object_keys(native))<>1
  or coalesce(native->>'event_id','')='' or native->>'event_id' is distinct from j->>'provider_event_id'
  then raise exception 'DATASET_EVENT_IDENTITY_INVALID';end if;
 end if;
 if new.native_key_canonical is distinct from analytics.dataset_json(expected) or new.native_key_hash is distinct from analytics.dataset_digest(expected)
 then raise exception 'DATASET_KEY_INVALID';end if;
 if new.platform='klaviyo' and tg_table_name='cpd_product_sales_facts' and (identity_kind<>'event' or j->>'occurred_at' is null)
 then raise exception 'DATASET_EVENT_TIME_REQUIRED';end if;
 foreach k in array array['product_mapping_id','sold_product_mapping_id','advertised_product_mapping_id'] loop
  if j->>k is not null then
   select * into strict m from identity.product_identity_mappings where workspace_id=new.workspace_id and installation_id=new.installation_id
   and installation_generation=new.installation_generation and id=(j->>k)::bigint for share;
   if m.mapping_state<>'verified' or m.source_rule_version_id is null or m.native_context is distinct from j->'product_context'
   or m.native_product_id is distinct from j->>(case k when 'product_mapping_id' then 'native_product_id' when 'sold_product_mapping_id' then 'native_sold_product_id' else 'native_advertised_product_id' end)
   then raise exception 'DATASET_MAPPING_INVALID';end if;
   perform identity.mapping_review_state(o,m.id,m.source_rule_version_id,false);
  end if;
 end loop;
 if new.fx_state='verified' then
  select * into strict f from analytics.fx_rates where id=new.fx_rate_id for share;
  if f.fx_provider='frankfurter_ecb_v2' and not new.provenance ? 'reporting_currency' then raise exception 'DATASET_FX_PROOF_REQUIRED';end if;
  if f.source_currency is distinct from new.source_currency or f.target_currency is distinct from new.target_currency
  or f.fx_rate_date is distinct from (case when new.provenance ? 'fx_policy' then analytics.dataset_fx_publication_date(new.business_date) else new.business_date end) or coalesce(new.fx_engine_version,'')='' then raise exception 'DATASET_FX_CONTEXT_INVALID';end if;
 end if;
 return new;
end $fn$;

-- EO05C consumes the real EO05D day receipt. Superseded receipts cannot finalize.
create or replace function evidence.commit_maturity_decision(o jsonb,p jsonb,d timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare anchor evidence.source_batches%rowtype; cfg evidence.source_batches%rowtype; newest evidence.source_batches%rowtype;
 b evidence.source_batches%rowtype; ref jsonb; r jsonb; read_key text; read_data jsonb; scope jsonb:=null; datasets text[]:='{}'; expected text[];
 policy jsonb; head jsonb; entries jsonb; result jsonb; m jsonb; bid text; op uuid; proof jsonb; report_ok boolean:=false;
 boundary timestamptz; state text; reason text; revision bigint; page_count int:=0; complete boolean:=true; until_time timestamptz;
begin
 perform evidence.assert_source_owner(o);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('eo05c:'||o::text,0));
 if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>14
 or p->>'version' is distinct from 'eo05c-maturity-v1' or octet_length(p::text)>1048576
 or d is null or not isfinite(d) or d<=clock_timestamp() or d>clock_timestamp()+interval '120 seconds'
 or coalesce(p->>'businessDate','')!~ '^\d{4}-\d\d-\d\d$' or (p->>'businessDate')::date not between date '1900-01-01' and date '9990-12-31'
 or coalesce(p->>'expectedRevision','')!~ '^(0|[1-9][0-9]{0,8})$' or jsonb_typeof(p->'complete') is distinct from 'boolean'
 or jsonb_typeof(p->'reportBatchIds') is distinct from 'array' or jsonb_array_length(p->'reportBatchIds') not between 2 and 3
 or jsonb_typeof(p->'sources') is distinct from 'array' or jsonb_array_length(p->'sources') not between 1 and 300
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p->>'timeZone')
 then raise exception 'MATURITY_DECISION_INVALID';end if;
 op:=(p->>'operationId')::uuid;revision:=(p->>'expectedRevision')::bigint;
 -- Consistent lock order across all referenced batches; no unbounded scan/write.
 perform id from evidence.source_batches where authority=o and (attempt_id=(p->>'anchorAttemptId')::uuid
 or id=(p->>'configurationBatchId')::bigint or id in(select value::text::bigint from jsonb_array_elements_text(p->'reportBatchIds'))) order by id for update;
 select * into strict anchor from evidence.source_batches where authority=o and attempt_id=(p->>'anchorAttemptId')::uuid and batch_ordinal=0;
 select * into strict cfg from evidence.source_batches where authority=o and id=(p->>'configurationBatchId')::bigint;
 select * into newest from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
 and installation_generation=(o->>'generation')::bigint and primary_source=o->>'provider' and authority=o and storage_state='committed' and manifest ? 'maturityConfiguration'
 order by (manifest->'maturityConfiguration'->>'observedAt') COLLATE "C" desc,id desc limit 1;
 if newest.id is null or newest.manifest->'maturityConfiguration'->>'fingerprint' is distinct from p->>'policyFingerprint'
 or cfg.manifest->'maturityConfiguration'->>'fingerprint' is distinct from p->>'policyFingerprint'
 then raise exception 'MATURITY_CONFIGURATION_CHANGED';end if;
 perform analytics.assert_dataset_source(o,jsonb_build_object('batch_id',newest.id::text,'commit_id',newest.commit_id::text,'request_digest',newest.request_digest,
 'page_id',newest.manifest->'maturityConfiguration'->>'pageId','payload_hash',newest.manifest->'maturityConfiguration'->>'payloadHash'));
 if anchor.storage_state<>'committed' or anchor.retain_until<=clock_timestamp() or anchor.manifest->'privacyRedacted'='true'::jsonb
 or cfg.storage_state<>'committed' or cfg.retain_until<=clock_timestamp() or cfg.manifest->'privacyRedacted'='true'::jsonb
 or (cfg.manifest->'maturityConfiguration'->>'observedAt')::timestamptz<clock_timestamp()-interval '60 seconds'
 then raise exception 'MATURITY_SOURCE_UNAVAILABLE';end if;
 head:=anchor.manifest->'maturityHead';
 if coalesce((head->>'revision')::bigint,0)<>revision then raise exception 'MATURITY_REVISION_CONFLICT';end if;
 entries:=coalesce(cfg.manifest->'maturityDecisions','{}');
 if jsonb_typeof(entries)<>'object' or entries ? op::text or (select count(*) from jsonb_object_keys(entries))>=200 then raise exception 'MATURITY_OPERATION_USED_OR_FULL';end if;
 policy:=cfg.manifest->'maturityConfiguration'->'policy';
 if policy->>'timeZone' is distinct from p->>'timeZone' then raise exception 'MATURITY_TIMEZONE_MISMATCH';end if;
 -- A deleted/pruned configuration page cannot authorize a decision.
 perform analytics.assert_dataset_source(o,jsonb_build_object('batch_id',cfg.id::text,'commit_id',cfg.commit_id::text,'request_digest',cfg.request_digest,
 'page_id',cfg.manifest->'maturityConfiguration'->>'pageId','payload_hash',cfg.manifest->'maturityConfiguration'->>'payloadHash'));
 read_key:=case o->>'provider' when 'google_ads' then 'googleDatasetRead' when 'meta' then 'metaDatasetRead' when 'klaviyo' then 'klaviyoDatasetRead' end;
 if read_key is null then raise exception 'MATURITY_PROVIDER_INVALID';end if;
 if anchor.manifest->read_key->'window' is distinct from jsonb_build_object('from',p->>'businessDate','to',p->>'businessDate') then raise exception 'MATURITY_ANCHOR_DATE_MISMATCH';end if;
 for bid in select value from jsonb_array_elements_text(p->'reportBatchIds') loop
  select * into strict b from evidence.source_batches where authority=o and id=bid::bigint;
  read_data:=b.manifest->read_key;
  if b.storage_state<>'committed' or b.retain_until<=clock_timestamp() or b.manifest->'privacyRedacted'='true'::jsonb
  or read_data->'window' is distinct from jsonb_build_object('from',p->>'businessDate','to',p->>'businessDate')
  or read_data->>'dataset'=any(datasets) then raise exception 'MATURITY_REPORT_SOURCE_INVALID';end if;
  datasets:=array_append(datasets,read_data->>'dataset');
  r:=jsonb_build_object('jobId',read_data->>'jobId','fence',read_data->>'fence','operationId',read_data->>'operationId');
  if scope is not null and scope<>r then raise exception 'MATURITY_READ_SCOPE_MISMATCH';end if;scope:=r;
  if not exists(select 1 from operations.refresh_work_bindings x where x.workspace_id=(o->>'workspaceId')::uuid
   and x.install_generation=(o->>'generation')::bigint and x.provider=o->>'provider' and x.account_id=o->>'accountId'
   and x.job_id=read_data->>'jobId' and x.fence=(read_data->>'fence')::bigint
   and x.from_date=(p->>'businessDate')::date and x.to_date=x.from_date
   and x.source->>'timezone'=p->>'timeZone' and x.source->>'connectionId'=o->>'connectionId'
   and x.source->>'connectionVersion'=o->>'connectionVersion') then raise exception 'MATURITY_ADMISSION_MISMATCH';end if;
  if b.source_state<>'complete' then complete:=false;end if;
  page_count:=page_count+(b.manifest->'counts'->>'pages')::int;
  if read_data->>'observedAt'<p->>'startedAt' or read_data->>'completedAt'>p->>'completedAt' then raise exception 'MATURITY_READ_CLOCK_MISMATCH';end if;
  if p->'reportOperationId'<>'null'::jsonb then
   if b.manifest->'datasetStorageReceipts' ? (p->>'reportOperationId') then
    proof:=analytics.inspect_dataset_storage(o,b.id,(p->>'reportOperationId')::uuid);
    report_ok:=report_ok or (proof->>'status'='stored');
   elsif b.manifest->'datasetConsumerReceipt'->>'operationId'=p->>'reportOperationId' then
    proof:=analytics.inspect_dataset_reconciliation(o,(p->>'reportOperationId')::uuid);
    report_ok:=report_ok or (proof->>'status'='consumed' and proof->'checkpointAdvanced'='true'::jsonb);
   elsif b.manifest->'datasetEmptyRetentionReceipts' ? (p->>'reportOperationId') then
    proof:=analytics.inspect_dataset_empty_retention(o,b.id,(p->>'reportOperationId')::uuid);
    report_ok:=report_ok or (proof->>'status'='retained_empty');
   end if;
  end if;
 end loop;
 expected:=case when o->>'provider'='klaviyo' then array['account_performance','configuration','product_performance'] else array['account_performance','product_performance'] end;
 if (select array_agg(x order by x) from unnest(datasets) x) is distinct from expected
 or page_count<>jsonb_array_length(p->'sources') or (select count(distinct value->>'page_id') from jsonb_array_elements(p->'sources'))<>page_count
 then raise exception 'MATURITY_COVERAGE_INVALID';end if;
 for ref in select value from jsonb_array_elements(p->'sources') loop
  if not (p->'reportBatchIds' ? (ref->>'batch_id')) then raise exception 'MATURITY_REFERENCE_SCOPE_INVALID';end if;
  perform analytics.assert_dataset_source(o,ref);
 end loop;
 if coalesce(p->>'startedAt','')!~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
 or coalesce(p->>'completedAt','')!~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
 or (p->>'completedAt')::timestamptz<(p->>'startedAt')::timestamptz or (p->>'completedAt')::timestamptz>clock_timestamp()
 then raise exception 'MATURITY_READ_CLOCK_INVALID';end if;
 if policy->>'state'='unknown' then state:='unknown';reason:=policy->>'reason';
 else
  boundary:=((p->>'businessDate')::date+(policy->>'horizonDays')::int+2)::timestamp at time zone (p->>'timeZone');
  state:='provisional';reason:='attribution_window_open';
  if clock_timestamp()>=boundary then
   reason:='post_window_reconciliation_required';
   if complete and p->'complete'='true'::jsonb and report_ok and (p->>'startedAt')::timestamptz>=boundary then state:='final';reason:=null;end if;
  end if;
 end if;
 result:=jsonb_build_object('version','eo05c-maturity-v1','operationId',op,'revision',revision+1,'state',state,'reason',reason,
 'notBefore',case when boundary is null then null else to_char(boundary at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
 'businessDate',p->>'businessDate','timeZone',p->>'timeZone','policyFingerprint',policy->>'fingerprint',
 'configurationBatchId',cfg.id::text,'sources',p->'sources','reportBatchIds',p->'reportBatchIds','reportOperationId',p->'reportOperationId',
 'startedAt',p->>'startedAt','completedAt',p->>'completedAt','reportVerified',report_ok);
 result:=result||jsonb_build_object('digest',evidence.source_hash(result));
 if anchor.manifest->'reportRetention'->>'version'='report-source-3y-v1' then
  until_time:=(anchor.manifest->'reportRetention'->>'until')::timestamptz;
  perform analytics.hold_report_source_batch(o,cfg.id,until_time);
 end if;
 select manifest into m from evidence.source_batches where id=cfg.id;
 m:=jsonb_set(m,'{maturityDecisions}',entries||jsonb_build_object(op::text,result));
 if octet_length(m::text)>1048576 or octet_length((anchor.manifest||jsonb_build_object('maturityHead',result))::text)>1048576
 or d<=clock_timestamp() then raise exception 'MATURITY_MANIFEST_LIMIT_OR_DEADLINE';end if;
 update evidence.source_batches set manifest=m where id=cfg.id;
 update evidence.source_batches set manifest=manifest||jsonb_build_object('maturityHead',result) where id=anchor.id;
 return result;
end $fn$;

create or replace function evidence.read_maturity_decision(o jsonb,a uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype; cfg evidence.source_batches%rowtype; newest evidence.source_batches%rowtype; head jsonb; ref jsonb;
 report_batch text; report_proof jsonb; report_ok boolean:=false; view_state jsonb;
begin
 perform evidence.assert_source_owner(o);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('eo05c:'||o::text,0));
 select * into strict b from evidence.source_batches where authority=o and attempt_id=a and batch_ordinal=0;
 head:=b.manifest->'maturityHead';if head is null then return null;end if;
 if b.storage_state<>'committed' or b.retain_until<=clock_timestamp() or b.manifest->'privacyRedacted'='true'::jsonb then raise exception 'MATURITY_SOURCE_UNAVAILABLE';end if;
 select * into strict cfg from evidence.source_batches where authority=o and id=(head->>'configurationBatchId')::bigint;
 perform analytics.assert_dataset_source(o,jsonb_build_object('batch_id',cfg.id::text,'commit_id',cfg.commit_id::text,'request_digest',cfg.request_digest,
 'page_id',cfg.manifest->'maturityConfiguration'->>'pageId','payload_hash',cfg.manifest->'maturityConfiguration'->>'payloadHash'));
 for ref in select value from jsonb_array_elements(head->'sources') loop
  perform analytics.assert_dataset_source(o,ref);
  if exists(select 1 from evidence.source_batches x where x.authority=o and x.id=(ref->>'batch_id')::bigint and x.manifest->'privacyRedacted'='true'::jsonb)
  then raise exception 'MATURITY_SOURCE_UNAVAILABLE';end if;
 end loop;
 select * into newest from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
 and installation_generation=(o->>'generation')::bigint and primary_source=o->>'provider' and authority=o and storage_state='committed' and manifest ? 'maturityConfiguration'
 order by (manifest->'maturityConfiguration'->>'observedAt') COLLATE "C" desc,id desc limit 1;
 if newest.id is null or newest.retain_until<=clock_timestamp() or newest.manifest->'privacyRedacted'='true'::jsonb then raise exception 'MATURITY_CONFIGURATION_UNAVAILABLE';end if;
 perform analytics.assert_dataset_source(o,jsonb_build_object('batch_id',newest.id::text,'commit_id',newest.commit_id::text,'request_digest',newest.request_digest,
 'page_id',newest.manifest->'maturityConfiguration'->>'pageId','payload_hash',newest.manifest->'maturityConfiguration'->>'payloadHash'));
 if newest.manifest->'maturityConfiguration'->>'fingerprint' is distinct from head->>'policyFingerprint' then
  view_state:=head||jsonb_build_object('state',case when newest.manifest->'maturityConfiguration'->'policy'->>'state'='unknown' then 'unknown' else 'provisional' end,
   'reason','configuration_changed','inspectionOnly',true,'storedDigest',head->>'digest');
  return view_state||jsonb_build_object('digest',evidence.source_hash(view_state-'digest'));
 end if;
 if head->>'state'='final' then
  for report_batch in select value from jsonb_array_elements_text(head->'reportBatchIds') loop
   report_proof:=analytics.inspect_dataset_storage(o,report_batch::bigint,(head->>'reportOperationId')::uuid);
   if report_proof->>'status'='stored' then report_ok:=true;end if;
   report_proof:=analytics.inspect_dataset_empty_retention(o,report_batch::bigint,(head->>'reportOperationId')::uuid);
   if report_proof->>'status'='retained_empty' then report_ok:=true;end if;
   if exists(select 1 from evidence.source_batches x where x.id=report_batch::bigint and x.authority=o
    and x.manifest->'datasetConsumerReceipt'->>'operationId'=head->>'reportOperationId') then
    report_proof:=analytics.inspect_dataset_reconciliation(o,(head->>'reportOperationId')::uuid);
    if report_proof->>'status'='consumed' and report_proof->'checkpointAdvanced'='true'::jsonb then report_ok:=true;end if;
   end if;
  end loop;
  if not report_ok then
   view_state:=head||jsonb_build_object('state','provisional','reason','report_receipt_unavailable','inspectionOnly',true,'storedDigest',head->>'digest');
   return view_state||jsonb_build_object('digest',evidence.source_hash(view_state-'digest'));
  end if;
 end if;
 return head;
end $fn$;


create index source_batches_dataset_day_receipt on evidence.source_batches(workspace_id,installation_id,installation_generation,primary_source,
 ((authority->>'accountId')),((manifest->'datasetReconciliation'->>'businessDate')),((manifest->'datasetReconciliation'->>'timeZone')),
 (((manifest->'datasetReconciliation'->>'revision')::bigint)) desc,id desc) where manifest ? 'datasetReconciliation';
create index source_batches_dataset_receipt_operation on evidence.source_batches(workspace_id,installation_id,installation_generation,
 ((manifest->'datasetReconciliation'->>'operationId'))) where manifest ? 'datasetReconciliation';
create index source_batches_dataset_mismatch_operation on evidence.source_batches(workspace_id,installation_id,installation_generation,
 ((manifest->'datasetReconciliationMismatch'->>'operationId'))) where manifest ? 'datasetReconciliationMismatch';

revoke all on function analytics.reconciliation_fact_digest(text,jsonb),analytics.inspect_dataset_reconciliation(jsonb,uuid),
 analytics._commit_dataset_reconciliation(jsonb,jsonb,jsonb,timestamptz),analytics.commit_dataset_reconciliation(jsonb,jsonb,jsonb,timestamptz)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
do $roles$
declare r text;
begin
 foreach r in array array['adstable_google_source_runner','adstable_meta_source_runner','adstable_klaviyo_source_runner'] loop
  if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on function analytics.reconciliation_fact_digest(text,jsonb),analytics.inspect_dataset_reconciliation(jsonb,uuid),analytics._commit_dataset_reconciliation(jsonb,jsonb,jsonb,timestamptz),analytics.commit_dataset_reconciliation(jsonb,jsonb,jsonb,timestamptz) from %I',r);end if;
 end loop;
end $roles$;
reset role;
commit;

