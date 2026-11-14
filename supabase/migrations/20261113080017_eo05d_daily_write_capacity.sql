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
 batch_text text; obsolete bigint[]:='{}'; old_count int:=0; incoming_keys text[]; checked_old_refs jsonb:='[]'; checked_provenance jsonb:='[]'; held_batches bigint[]:='{}'; pages int:=0; old_id bigint; changes jsonb:='[]'; actual jsonb; summary jsonb:='[]';
 start_at text; finish_at text; prev_time timestamptz; removed int:=0; modified int:=0; scope_date date; scope_tz text;
 scope_day text; scope_context jsonb; scope_sources jsonb; retain_to timestamptz; provenance jsonb; row_sources jsonb;
begin
 -- The public-to-server wrapper holds the shared control and workspace locks.
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
 scope_day:=c->>'businessDate';scope_context:=c->'sourceContext';scope_sources:=c->'sources';retain_to:=(p->'policy'->>'until')::timestamptz;
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
    if exists(select 1 from jsonb_array_elements(checked_old_refs) seen where seen=ref) then continue;end if;
    perform analytics.assert_dataset_source(o,ref);obsolete:=array_append(obsolete,(ref->>'batch_id')::bigint);
    select manifest->read_key into native_read from evidence.source_batches where id=(ref->>'batch_id')::bigint;
    if native_read->>'completedAt' is null or (native_read->>'completedAt')::timestamptz>(c->>'startedAt')::timestamptz then raise exception 'DATASET_RECONCILIATION_STALE_READ';end if;
    checked_old_refs:=checked_old_refs||jsonb_build_array(ref);
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
   provenance:=r->'provenance';
   if r->>'business_date' is distinct from scope_day or r->>'source_timezone' is distinct from scope_tz
   or provenance->'source_context' is distinct from scope_context or r->>'source_completeness' is distinct from 'complete'
   then raise exception 'DATASET_RECONCILIATION_ROW_SCOPE';end if;
   -- Membership and retention are identical only for exactly equal provenance.
   -- The day, timezone, scope and completeness above are checked on every row.
   if not exists(select 1 from jsonb_array_elements(checked_provenance) x where x=provenance) then
    row_sources:=provenance->'sources';
    if exists(select 1 from jsonb_array_elements(row_sources) x where not (scope_sources @> jsonb_build_array(x)))
    then raise exception 'DATASET_RECONCILIATION_ROW_SCOPE';end if;
    if scope_day is distinct from scope_context->'window'->>'from'
     or scope_tz is distinct from scope_context->'snapshot'->>'timezone'
    then raise exception 'REPORT_RETENTION_POLICY_MISMATCH';end if;
    perform analytics.assert_report_source_context(o,scope_context,retain_to,row_sources);
    for k in select distinct x->>'batch_id' from jsonb_array_elements(row_sources) x loop
     if not k::bigint=any(held_batches) then
      perform analytics.hold_report_source_batch(o,k::bigint,retain_to);
      held_batches:=array_append(held_batches,k::bigint);
     end if;
    end loop;
    checked_provenance:=checked_provenance||jsonb_build_array(provenance);
   end if;
   foreach k in array array['product_mapping_id','sold_product_mapping_id','advertised_product_mapping_id'] loop
    if r->>k is not null then perform analytics.hold_report_mapping(o,(r->>k)::bigint,retain_to);end if;
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

create or replace function analytics.commit_dataset_reconciliation(o jsonb,p jsonb,c jsonb,d timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare r jsonb;bid bigint;
begin
 perform 1 from operations.refresh_control where singleton for share;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adstable-dataset:'||(o->>'workspaceId')::uuid::text,0));
 perform evidence.assert_source_owner(o);
 begin
  return analytics._commit_dataset_reconciliation(o,p,c,d);
 exception when raise_exception then
  if sqlerrm<>'DATASET_RECONCILIATION_READBACK_MISMATCH' then raise;end if;
 end;
 bid:=(c->'batchIds'->>0)::bigint;
 r:=jsonb_build_object('version','eo05d-reconciliation-v1','status','mismatch','comparison','mismatch','operationId',p->>'operationId',
 'requestDigest',encode(sha256(convert_to(analytics.daily_reconciliation_json(jsonb_build_object('write',p,'context',c)), 'UTF8')), 'hex'),'consumerReceipt',false,'checkpointAdvanced',false,'reportValuesChanged',false);
 update evidence.source_batches set manifest=manifest||jsonb_build_object('datasetReconciliationMismatch',r)
 where id=bid and authority=o and storage_state='committed' and handoff_state='pending';
 if not found then raise exception 'DATASET_RECONCILIATION_MISMATCH_UNRECORDED';end if;
 return r;
end $fn$;

create or replace function analytics.commit_scheduled_dataset_reconciliation(o jsonb,p jsonb,c jsonb,d timestamptz) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $fn$
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
  perform 1 from operations.refresh_control where singleton for share;
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

-- Resolve authority in bulk after the same bounded queue selection.
create or replace function operations.read_refresh_preflight_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $fn$
  with cfg as materialized(select * from operations.refresh_queue_control where singleton),
  admission as materialized(select operations.read_refresh_admission_snapshot() as value),
  pending as materialized(
    select q.*
    from operations.refresh_queue_accounts q left join operations.refresh_service_order so on so.workspace_id=q.workspace_id
    where q.state='pending' and q.connection_open
      and not operations.refresh_account_is_held(q.workspace_id,q.install_generation,q.provider,q.account_id)
      and not exists(select 1 from operations.refresh_runs r where r.workspace_id=q.workspace_id and r.install_generation=q.install_generation
        and r.provider=q.provider and r.account_id=q.account_id and r.status='running')
    order by coalesce(so.turn,-1),q.first_queued_at_ms,q.workspace_id,q.provider,q.account_id
    limit coalesce((select (value->'bounds'->>'maxCandidates')::integer from admission),0)
  ), valid_timezones as materialized(select name from pg_catalog.pg_timezone_names),
  verified as (
    select jsonb_build_object('workspaceId',w.id::text,'installGeneration',i.install_generation::text,'provider',c.provider,
      'accountId',a.provider_account_id,'connectionId',c.id::text,'connectionVersion',c.connection_version,
      'accountRowId',a.id::text,'selectionId',b.id::text,'eligibleFromMs',floor(extract(epoch from greatest(c.connected_at,b.effective_from))*1000)::bigint,
      'timezone',a.timezone_name,'currency',a.currency_code) as source,
      q.first_due_hour_ms,q.first_queued_at_ms,q.workspace_id,q.provider,q.account_id,
      q.connection_id,q.connection_version,q.eligible_from_ms
    from pending q join app.workspaces w on w.id=q.workspace_id
      join shopify.installations i on i.workspace_id=w.id and i.install_generation=q.install_generation
      join integrations.provider_connections c on c.installation_id=i.id and c.workspace_id=w.id and c.install_generation=i.install_generation
      join integrations.provider_accounts a on a.connection_id=c.id and a.workspace_id=w.id and a.install_generation=i.install_generation and a.provider=c.provider
      left join integrations.reporting_account_bindings b on b.connection_id=c.id and b.workspace_id=w.id and b.install_generation=i.install_generation
        and b.provider=c.provider and b.account_id=a.id and b.effective_to is null
    where c.provider=q.provider and a.provider_account_id=q.account_id
      and w.status='active' and i.status='active' and c.lifecycle_status='connected' and a.active
      and c.connected_at<=statement_timestamp() and (b.effective_from is null or b.effective_from<=statement_timestamp())
      and exists(select 1 from integrations.provider_credential_envelopes ce where ce.id=c.credential_id and ce.installation_id=i.id
        and ce.workspace_id=w.id and ce.install_generation=i.install_generation and ce.provider=c.provider)
      and a.currency_code is not null and exists(select 1 from valid_timezones tz where tz.name=a.timezone_name)
      and ((c.provider='meta' and b.id is not null and a.account_kind='advertiser' and a.reporting_eligible and a.provider_account_id ~ '^act_[0-9]+$' and c.granted_scopes @> array['ads_read'])
        or (c.provider='google_ads' and b.id is not null and a.account_kind='advertiser' and a.reporting_eligible and a.provider_account_id ~ '^[0-9]+$' and c.granted_scopes @> array['https://www.googleapis.com/auth/adwords'])
        or (c.provider='klaviyo' and a.account_kind='account' and a.provider_status='active'
          and c.granted_scopes @> array['campaigns:read','events:read','flows:read','metrics:read']
          and (select count(*) from (select 1 from integrations.provider_accounts ka where ka.connection_id=c.id and ka.active limit 2) k)=1))
  )
  select admission.value || jsonb_build_object('queueRevision',cfg.revision,'configured',
    coalesce(admission.value->'budget'<>'null'::jsonb and admission.value->'bounds'<>'null'::jsonb and cfg.max_snapshot_age_ms is not null
      and cfg.last_success_at_ms<=floor(extract(epoch from statement_timestamp())*1000)::bigint
      and floor(extract(epoch from statement_timestamp())*1000)::bigint-cfg.last_success_at_ms<=cfg.max_snapshot_age_ms,false),
    'candidates',coalesce((select jsonb_agg(source||jsonb_build_object('scheduledHour',first_due_hour_ms,'queuedAt',first_queued_at_ms)
      order by first_queued_at_ms,workspace_id,provider,account_id) from verified where source is not null
      and source->>'connectionId'=connection_id and (source->>'connectionVersion')::bigint=connection_version
      and (source->>'eligibleFromMs')::bigint=eligible_from_ms),'[]'::jsonb)) from admission,cfg
$fn$;

-- Keep hourly progress in the verified work records. A held or unconfirmed
-- job still owns its account slot and cannot appear as a completed day.
create function operations.read_hourly_refresh_snapshot(p_hour bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare snapshot jsonb; completed jsonb;
 current_hour bigint:=floor(extract(epoch from statement_timestamp())/3600)::bigint*3600000;
begin
 if p_hour is null or p_hour<0 or p_hour%3600000<>0
  or p_hour>current_hour
 then raise exception 'REFRESH_HOUR_INVALID';end if;
 if p_hour<current_hour then return jsonb_build_object('hourEnded',true);end if;
 snapshot:=operations.read_refresh_preflight_snapshot();
 select coalesce(jsonb_agg(jsonb_build_array(b.workspace_id::text,b.install_generation::text,b.provider,b.account_id,b.from_date::text)), '[]'::jsonb)
 into completed
 from jsonb_array_elements(snapshot->'candidates') s
 join operations.refresh_work_bindings b on b.workspace_id=(s->>'workspaceId')::uuid
  and b.install_generation=(s->>'installGeneration')::bigint and b.provider=s->>'provider'
  and b.account_id=s->>'accountId' and b.source=(s-array['scheduledHour','queuedAt'])
  and b.partition_id='hourly:'||p_hour::text and b.from_date=b.to_date
 join operations.refresh_runs r using (workspace_id,install_generation,provider,account_id,job_id,fence)
 join operations.refresh_work_progress w using (workspace_id,install_generation,provider,account_id,job_id,fence)
 where r.status='completed' and w.stage='ready_for_dataset' and w.from_date=b.from_date and w.to_date=b.to_date;
 return snapshot||jsonb_build_object('completedHourlyDays',completed);
end $fn$;
revoke all on function operations.read_hourly_refresh_snapshot(bigint)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_queue_runner;
grant execute on function operations.read_hourly_refresh_snapshot(bigint) to adstable_refresh_coordinator;

-- Finishing an unrelated job releases capacity. Under the existing lock,
-- keep the selected order and recheck it against the current reservations.
create function operations.commit_hourly_refresh_preflight(p_revision bigint,p_queue_revision bigint,p_state jsonb,
 p_source jsonb,p_window jsonb,p_partition text,p_deadline bigint) returns boolean
language plpgsql security definer set search_path='' as $fn$
declare c operations.refresh_control%rowtype; current_state jsonb; selected jsonb;
 hour_start bigint; write_state jsonb;
begin
 select * into strict c from operations.refresh_control where singleton for update;
 hour_start:=floor(extract(epoch from clock_timestamp())/3600)::bigint*3600000;
 if p_partition is distinct from 'hourly:'||hour_start::text or p_deadline>hour_start+3600000
  or p_window->>'from' is distinct from p_window->>'to'
  or p_revision is null or p_revision>c.revision
  or p_state->>'revision' is distinct from (p_revision+1)::text then return false;end if;
 if p_revision=c.revision then
  return operations.commit_refresh_preflight_with_deadline(p_revision,p_queue_revision,p_state,p_source,p_window,p_partition,p_deadline);
 end if;
 -- Another admission changes the fence or the service order and needs a fresh plan.
 if p_state->>'nextFence' is distinct from (c.next_fence+1)::text
  or p_state->>'nextTurn' is distinct from (c.next_turn+1)::text then return false;end if;
 current_state:=operations.read_refresh_admission_snapshot()->'state';
 selected:=p_state->'claims'->-1;
 if selected->>'fence' is distinct from c.next_fence::text
  or not ((p_state->'claims') @> (current_state->'claims'))
  or (p_state->'externalClaims' is distinct from current_state->'externalClaims')
  or (p_state->'holds' is distinct from current_state->'holds')
  or c.revision-p_revision <> jsonb_array_length(p_state->'claims')-jsonb_array_length(current_state->'claims')-1
  or exists(select 1 from jsonb_array_elements(p_state->'claims') a
    where a is distinct from selected and not ((current_state->'claims') @> jsonb_build_array(a))
      and not exists(select 1 from operations.refresh_runs r
        where r.fence=(a->>'fence')::bigint and r.status='completed'))
  or exists(select 1 from jsonb_array_elements(current_state->'claims') a
    where a->>'workspaceId'=selected->>'workspaceId' and a->>'installGeneration'=selected->>'installGeneration'
      and a->>'provider'=selected->>'provider' and a->>'accountId'=selected->>'accountId')
  then return false;end if;
 write_state:=p_state||jsonb_build_object('revision',c.revision+1,'claims',(current_state->'claims')||jsonb_build_array(selected));
 return operations.commit_refresh_preflight_with_deadline(c.revision,p_queue_revision,write_state,p_source,p_window,p_partition,p_deadline);
end $fn$;
revoke all on function operations.commit_hourly_refresh_preflight(bigint,bigint,jsonb,jsonb,jsonb,text,bigint)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_queue_runner;
grant execute on function operations.commit_hourly_refresh_preflight(bigint,bigint,jsonb,jsonb,jsonb,text,bigint)
 to adstable_refresh_coordinator;

-- Reconcile expired hourly claims before the interruption detector fences them.
-- Recovery reads the existing receipt and facts and only writes a completion.
create function operations.recover_hourly_refresh_receipts() returns integer
language plpgsql security definer set search_path='' as $fn$
declare item record; candidate record; receipt jsonb; recovered integer:=0; cap integer; seen integer:=0;
 cutoff bigint:=floor(extract(epoch from statement_timestamp())/3600)::bigint*3600000;
begin
 select (bounds->>'maxClaims')::integer into cap from operations.refresh_control where singleton for update;
 if cap is null then return 0;end if;
 if cap<1 then raise exception 'REFRESH_REVIEW_BOUNDS_INVALID';end if;
 for item in
  select r.*, b.source, b.from_date, b.to_date
  from operations.refresh_runs r join operations.refresh_work_bindings b
    using(workspace_id,install_generation,provider,account_id,job_id,fence)
  join operations.refresh_work_progress p using(workspace_id,install_generation,provider,account_id,job_id,fence)
  where r.status='running' and b.deadline_at_ms<=cutoff and b.partition_id~'^hourly:[0-9]{1,16}$'
    and case when b.partition_id~'^hourly:[0-9]{1,16}$' then substring(b.partition_id from 8)::bigint<cutoff else false end
    and p.stage='ready_for_dataset' and p.from_date=b.from_date and p.to_date=b.to_date
    and not operations.refresh_account_is_held(r.workspace_id,r.install_generation,r.provider,r.account_id)
  order by r.fence
 loop
  seen:=seen+1;
  if seen>cap then raise exception 'REFRESH_REVIEW_OVER_BOUND';end if;
  begin
   select x.authority, x.manifest->'datasetReconciliation'->>'operationId' as operation,
     x.manifest->'scheduledDatasetClaim'->>'digest' as digest
   into candidate
   from evidence.source_batches x
   where x.workspace_id=item.workspace_id and x.installation_generation=item.install_generation
     and x.primary_source=item.provider and x.authority->>'accountId'=item.account_id
     and x.authority->>'connectionId'=item.source->>'connectionId'
     and x.authority->>'connectionVersion'=item.source->>'connectionVersion'
     and x.authority->>'selectionEpoch' is not distinct from item.source->>'selectionId'
     and x.handoff_state='consumed' and x.manifest->'scheduledDatasetClaim'->>'job'=item.job_id
     and x.manifest->'scheduledDatasetClaim'->>'fence'=item.fence::text
     and x.manifest->'datasetConsumerReceipt'->>'anchorBatchId'=x.id::text
   limit 1;
   if not found then continue;end if;
   receipt:=analytics.inspect_dataset_reconciliation(candidate.authority,candidate.operation::uuid);
   if receipt->>'status' is distinct from 'consumed' or receipt->>'digest' is distinct from candidate.digest
    or receipt->>'businessDate' is distinct from item.from_date::text or item.from_date<>item.to_date
    or receipt->'consumerReceipt' is distinct from 'true'::jsonb
    or receipt->'checkpointAdvanced' is distinct from 'true'::jsonb
    or receipt->>'comparison' is distinct from 'matched' then continue;end if;
   if operations.finish_refresh_work_before_stops(item.workspace_id,item.install_generation,item.provider,item.account_id,
    item.job_id,item.fence,'completed') then recovered:=recovered+1;end if;
  exception when raise_exception then
   if sqlerrm not in ('SOURCE_OWNER_CHANGED','SOURCE_PROVIDER_CHANGED','DATASET_RECONCILIATION_UNAVAILABLE',
      'DATASET_RECONCILIATION_RECEIPT_INVALID','DATASET_RECONCILIATION_CONSUMPTION_INVALID') then raise;end if;
  end;
 end loop;
 return recovered;
end $fn$;
revoke all on function operations.recover_hourly_refresh_receipts()
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_queue_runner;
grant execute on function operations.recover_hourly_refresh_receipts() to adstable_refresh_coordinator;

reset role;
commit;
