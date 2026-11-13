begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

create or replace function analytics.dataset_json(p jsonb,depth integer default 0) returns text
language plpgsql immutable set search_path='' as $fn$
declare result text;
begin
 if depth>32 then raise exception 'DATASET_JSON_BOUNDS';end if;
 if jsonb_typeof(p)='object' then
  if exists(select 1 from jsonb_object_keys(p) k where length(k) not between 1 and 512
   or k !~ '^[ -~]+$' or k ~* 'token|secret|password|authorization|cookie|email|phone|address|customer|profile|__proto__|constructor|prototype')
  then raise exception 'DATASET_PRIVATE_FIELD';end if;
  select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||analytics.dataset_json(value,depth+1),',' order by key collate "C"),'')||'}'
   into result from jsonb_each(p);
 elsif jsonb_typeof(p)='array' then
  select '['||coalesce(string_agg(analytics.dataset_json(value,depth+1),',' order by ord),'')||']'
   into result from jsonb_array_elements(p) with ordinality as entries(value,ord);
 else result:=p::text;end if;
 if octet_length(result)>1048576 then raise exception 'DATASET_JSON_BOUNDS';end if;
 return result;
end $fn$;

create function analytics.daily_reconciliation_json(p jsonb,depth integer default 0) returns text
language plpgsql immutable set search_path='' as $fn$
declare result text;
begin
 if depth>32 then raise exception 'DATASET_JSON_BOUNDS';end if;
 if jsonb_typeof(p)='object' then
  if exists(select 1 from jsonb_object_keys(p) k where length(k) not between 1 and 512
   or k !~ '^[ -~]+$' or k ~* 'token|secret|password|authorization|cookie|email|phone|address|customer|profile|__proto__|constructor|prototype')
  then raise exception 'DATASET_PRIVATE_FIELD';end if;
  select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||analytics.daily_reconciliation_json(value,depth+1),',' order by key collate "C"),'')||'}'
   into result from jsonb_each(p);
 elsif jsonb_typeof(p)='array' then
  select '['||coalesce(string_agg(analytics.daily_reconciliation_json(value,depth+1),',' order by ord),'')||']'
   into result from jsonb_array_elements(p) with ordinality as entries(value,ord);
 else result:=p::text;end if;
 if octet_length(result)>4194304 then raise exception 'DATASET_JSON_BOUNDS';end if;
 return result;
end $fn$;

revoke all on function analytics.daily_reconciliation_json(jsonb,integer) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create or replace function analytics.inspect_dataset_reconciliation(o jsonb,op uuid) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $fn$
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
  execute format('select count(*)::int from (select id from analytics.%I where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=$4 and platform_account_id=$5 and business_date=$6 limit 1025) x',t)
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

create or replace function analytics._commit_dataset_reconciliation(o jsonb,p jsonb,c jsonb,d timestamptz) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $fn$
declare item jsonb; r jsonb; row_input jsonb; injected jsonb; b evidence.source_batches%rowtype; primary_id bigint;
 operation uuid; h text; prior jsonb; result jsonb; ids jsonb:='[]'; found_row jsonb; rid bigint; name text; cols text; allowed text[]; k text;
 head jsonb; old_fact jsonb; ref jsonb; native_read jsonb; read_key text; sets text[]:='{}'; expected_sets text[];
 batch_text text; obsolete bigint[]:='{}'; old_count int:=0; incoming_keys text[]; pages int:=0; old_id bigint; changes jsonb:='[]'; actual jsonb; summary jsonb:='[]';
 start_at text; finish_at text; prev_time timestamptz; removed int:=0; modified int:=0; scope_date date; scope_tz text;
begin
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 if o->>'provider'='shopify' or jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>4
 or not p ?& array['version','operationId','policy','rows'] or p->>'version'<>'eo05b-storage-v1'
 or jsonb_typeof(p->'rows') is distinct from 'array' or jsonb_array_length(p->'rows') not between 0 and 1024
 or octet_length(analytics.daily_reconciliation_json(p))>4194304 then raise exception 'DATASET_INPUT_INVALID';end if;
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
 h:=encode(sha256(convert_to(analytics.daily_reconciliation_json(jsonb_build_object('write',p,'context',c)), 'UTF8')), 'hex');
 if jsonb_typeof(c) is distinct from 'object' or (select count(*) from jsonb_object_keys(c))<>9
 or c->>'version' is distinct from 'eo05d-reconciliation-v1' or coalesce(c->>'expectedRevision','')!~ '^(0|[1-9][0-9]{0,8})$'
 or jsonb_typeof(c->'sources') is distinct from 'array' or jsonb_array_length(c->'sources') not between 1 and 300
 or jsonb_typeof(c->'batchIds') is distinct from 'array' or jsonb_array_length(c->'batchIds') not between 2 and 3
 or (select count(distinct value) from jsonb_array_elements_text(c->'batchIds'))<>jsonb_array_length(c->'batchIds')
 or d is null or not isfinite(d) or d<=clock_timestamp() or d>clock_timestamp()+interval '120 seconds'
 or octet_length(analytics.daily_reconciliation_json(jsonb_build_object('write',p,'context',c)))>4194304
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
 select coalesce(array_agg(value->>'table'||':'||(value->'row'->>'native_key_hash')),array[]::text[])
 into incoming_keys from jsonb_array_elements(p->'rows');
 foreach name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
  for old_fact in execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=$4 and platform_account_id=$5 and business_date=$6 order by id limit 1025 for update',name)
   using (o->>'workspaceId')::uuid,(o->>'installationId')::bigint,(o->>'generation')::bigint,o->>'provider',o->>'accountId',scope_date loop
   old_count:=old_count+1;if old_count>1024 then raise exception 'DATASET_RECONCILIATION_SCOPE_LIMIT';end if;
   if old_fact->>'source_timezone' is distinct from scope_tz or old_fact->>'provider_connection_id' is distinct from o->>'connectionId'
   or (old_fact->>'retain_until')::timestamptz<=clock_timestamp() then raise exception 'DATASET_RECONCILIATION_SCOPE_CONFLICT';end if;
   for ref in select value from jsonb_array_elements(old_fact->'provenance'->'sources') loop
    perform analytics.assert_dataset_source(o,ref);obsolete:=array_append(obsolete,(ref->>'batch_id')::bigint);
    select manifest->read_key into native_read from evidence.source_batches where id=(ref->>'batch_id')::bigint;
    if native_read->>'completedAt' is null or (native_read->>'completedAt')::timestamptz>(c->>'startedAt')::timestamptz then raise exception 'DATASET_RECONCILIATION_STALE_READ';end if;
   end loop;
   if not coalesce((name||':'||(old_fact->>'native_key_hash'))=any(incoming_keys),false) then
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
  execute format('select count(*)::int from (select id from analytics.%I where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=$4 and platform_account_id=$5 and business_date=$6 limit 1025) x',name)
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
 if octet_length(result::text)>524288 then raise exception 'DATASET_RECONCILIATION_RECEIPT_LIMIT';end if;
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

reset role;
commit;
