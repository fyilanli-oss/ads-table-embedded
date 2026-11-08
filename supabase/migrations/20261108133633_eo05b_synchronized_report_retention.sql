begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

create function analytics.report_retention_until(d date,tz text) returns timestamptz
language plpgsql stable set search_path='' as $fn$
begin
 if d is null or not isfinite(d) or extract(year from d) not between 1900 and 9995
 or tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz)
 then raise exception 'REPORT_RETENTION_DATE_INVALID';end if;
 return (((d+interval '3 years')::date+1)::timestamp at time zone tz);
end $fn$;

-- Only fresh/current evidence can become report-linked. Expired or redacted
-- evidence is never revived. The exact existing ciphertext is retained in place.
create function analytics.hold_report_source_batch(o jsonb,bid bigint,u timestamptz) returns void
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype; n integer; floor_time timestamptz;
 w uuid:=(o->>'workspaceId')::uuid;i bigint:=(o->>'installationId')::bigint;g bigint:=(o->>'generation')::bigint;
begin
 if u is null or not isfinite(u) or u<=clock_timestamp() then raise exception 'REPORT_RETENTION_EXPIRED';end if;
 select * into strict b from evidence.source_batches where workspace_id=w and installation_id=i and installation_generation=g and id=bid for update;
 if b.authority is distinct from o or b.storage_state<>'committed' or b.source_state not in ('complete','partial')
 or b.retain_until<=clock_timestamp() or b.manifest->'privacyRedacted'='true'::jsonb
 then raise exception 'REPORT_SOURCE_NOT_CURRENT';end if;
 select count(*) into n from evidence.source_pages where workspace_id=w and installation_id=i and installation_generation=g and batch_id=bid;
 if n>1000 or exists(select 1 from evidence.source_pages where workspace_id=w and installation_id=i and installation_generation=g and batch_id=bid and (purged_at is not null or retain_until<=clock_timestamp()))
 or (select count(*) from evidence.source_references r join evidence.source_pages p on p.id=r.page_id where p.workspace_id=w and p.installation_id=i and p.installation_generation=g and p.batch_id=bid)>1000
 or exists(select 1 from evidence.source_references r join evidence.source_pages p on p.id=r.page_id where p.workspace_id=w and p.installation_id=i and p.installation_generation=g and p.batch_id=bid and r.retain_until<=clock_timestamp())
 or exists(select 1 from evidence.source_reference_links l join evidence.source_references r on r.id=l.source_reference_id join evidence.source_pages p on p.id=r.page_id where l.workspace_id=w and l.installation_id=i and l.installation_generation=g and p.batch_id=bid and l.retain_until<=clock_timestamp())
 then raise exception 'REPORT_SOURCE_EVIDENCE_INVALID';end if;
 floor_time:=greatest(u,coalesce((b.manifest->'reportRetention'->>'until')::timestamptz,u));
 update evidence.source_batches set retain_until=greatest(retain_until,floor_time),
 manifest=manifest||jsonb_build_object('reportRetention',jsonb_build_object('version','report-source-3y-v1','until',floor_time)) where id=bid;
 update evidence.source_pages set retain_until=greatest(retain_until,floor_time) where workspace_id=w and installation_id=i and installation_generation=g and batch_id=bid;
 update evidence.source_references r set retain_until=greatest(r.retain_until,floor_time) from evidence.source_pages p
 where r.workspace_id=w and r.installation_id=i and r.installation_generation=g and r.page_id=p.id and p.batch_id=bid;
 update evidence.source_reference_links l set retain_until=greatest(l.retain_until,floor_time) from evidence.source_references r,evidence.source_pages p
 where l.workspace_id=w and l.installation_id=i and l.installation_generation=g and l.source_reference_id=r.id and r.page_id=p.id and p.batch_id=bid;
end $fn$;

create function analytics.hold_report_mapping(o jsonb,mid bigint,u timestamptz) returns void
language plpgsql security definer set search_path='' as $fn$
declare m identity.product_identity_mappings%rowtype;s jsonb;bid bigint;
 w uuid:=(o->>'workspaceId')::uuid;i bigint:=(o->>'installationId')::bigint;g bigint:=(o->>'generation')::bigint;
begin
 select * into strict m from identity.product_identity_mappings where workspace_id=w and installation_id=i and installation_generation=g and id=mid for update;
 -- Existing current native mapping/rule authority is checked BEFORE promotion.
 s:=identity.mapping_review_state(o,mid,m.source_rule_version_id,false);
 if m.mapping_state<>'verified' then raise exception 'REPORT_MAPPING_UNVERIFIED';end if;
 for bid in select distinct id from (
  select m.accepted_batch_id id union all select r.accepted_batch_id from identity.source_rule_versions r where r.id=m.source_rule_version_id
  union all select (s->>'sourceBatchId')::bigint
  union all select (value->>'batchId')::bigint from jsonb_array_elements(s->'pages')) q where id is not null order by id loop
  perform analytics.hold_report_source_batch(o,bid,u);
 end loop;
 update identity.product_identity_mappings set retain_until=greatest(retain_until,u) where id=mid and workspace_id=w and installation_id=i and installation_generation=g;
 update identity.source_rule_versions set retain_until=greatest(retain_until,u) where id=m.source_rule_version_id and workspace_id=w and installation_id=i and installation_generation=g;
 update evidence.source_reference_links set retain_until=greatest(retain_until,u) where workspace_id=w and installation_id=i and installation_generation=g and (mapping_id=mid or source_rule_version_id=m.source_rule_version_id);
end $fn$;

create function analytics.assert_report_source_context(o jsonb,c jsonb,u timestamptz,refs jsonb) returns void
language plpgsql security definer set search_path='' as $fn$
declare original jsonb;ref jsonb;r jsonb;
begin
 perform evidence.assert_source_owner(o);
 if jsonb_typeof(c) is distinct from 'object' or (select count(*) from jsonb_object_keys(c))<>6
 or not c ?& array['version','snapshot','digest','job_id','fence','window'] or c->>'version'<>'eo05b-source-context-v1'
 or jsonb_typeof(refs) is distinct from 'array' or jsonb_array_length(refs) not between 1 and 300 then raise exception 'REPORT_CONTEXT_INVALID';end if;
 select source into original from operations.refresh_work_bindings where workspace_id=(o->>'workspaceId')::uuid and install_generation=(o->>'generation')::bigint
 and provider=o->>'provider' and account_id=o->>'accountId' and job_id=c->>'job_id' and fence=(c->>'fence')::bigint
 and from_date=(c->'window'->>'from')::date and to_date=(c->'window'->>'to')::date for share;
 if not found or original is distinct from c->'snapshot' or evidence.source_hash(original) is distinct from c->>'digest'
 or c->'window'->>'from' is distinct from c->'window'->>'to'
 or original->>'connectionId' is distinct from o->>'connectionId' or original->>'connectionVersion' is distinct from o->>'connectionVersion'
 or analytics.report_retention_until((c->'window'->>'from')::date,original->>'timezone') is distinct from u
 then raise exception 'REPORT_CONTEXT_MISMATCH';end if;
 for ref in select value from jsonb_array_elements(refs) loop
  perform analytics.assert_dataset_source(o,ref);
  select manifest->(case o->>'provider' when 'google_ads' then 'googleDatasetRead' when 'meta' then 'metaDatasetRead' else 'klaviyoDatasetRead' end) into r
  from evidence.source_batches where id=(ref->>'batch_id')::bigint;
  if r is null or r->>'jobId' is distinct from c->>'job_id' or r->>'fence' is distinct from c->>'fence' or r->'window' is distinct from c->'window'
  then raise exception 'REPORT_CONTEXT_SOURCE_MISMATCH';end if;
 end loop;
end $fn$;

-- The floor is discoverable through existing batch/reference/link relations.
-- TTL maintenance cannot shorten a linked proof; privacy DELETE is unaffected.
create function analytics.guard_report_retention_floor() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare kind text;bids bigint[];u timestamptz;
begin
 if new.retain_until>=old.retain_until then return new;end if;
 if tg_table_name='source_reference_links' then
  select array_agg(distinct p.batch_id) into bids from evidence.source_references r join evidence.source_pages p on p.id=r.page_id
   where r.id=old.source_reference_id and r.workspace_id=old.workspace_id and r.installation_id=old.installation_id and r.installation_generation=old.installation_generation;
 else
  kind:=case tg_table_name when 'source_batches' then 'batch' when 'source_pages' then 'page' when 'source_references' then 'reference'
   when 'product_identity_mappings' then 'mapping' when 'source_rule_versions' then 'rule' when 'shopify_order_versions' then 'order'
   when 'shopify_line_versions' then 'line' when 'shopify_journey_versions' then 'journey' else 'claim' end;
  bids:=evidence.retention_batches(old.workspace_id,old.installation_id,old.installation_generation,kind,to_jsonb(old));
 end if;
 select max((manifest->'reportRetention'->>'until')::timestamptz) into u from evidence.source_batches
 where workspace_id=old.workspace_id and installation_id=old.installation_id and installation_generation=old.installation_generation and id=any(bids);
 if new.retain_until<u then raise exception 'REPORT_RETENTION_PINNED';end if;
 return new;
end $fn$;

create function analytics.inspect_dataset_empty_retention(o jsonb,bid bigint,op uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype;receipt jsonb;ref jsonb;
begin
 perform evidence.assert_source_owner(o);
 select * into strict b from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint and installation_generation=(o->>'generation')::bigint and id=bid for share;
 if b.authority is distinct from o then raise exception 'REPORT_OWNER_CHANGED';end if;
 receipt:=b.manifest->'datasetEmptyRetentionReceipts'->op::text;
 if receipt is null then return null;end if;
 if (receipt->>'until')::timestamptz<=clock_timestamp() then return jsonb_build_object('status','invalidated','consumerReceipt',false);end if;
 for ref in select value from jsonb_array_elements(receipt->'sources') loop perform analytics.assert_dataset_source(o,ref);end loop;
 return receipt;
end $fn$;

-- A verified empty read has a finite retained source proof, never a fabricated
-- zero fact, consumer receipt or checkpoint. Only the private fixed projector
-- reaches this entry after physical-source verification.
create function analytics.commit_dataset_empty_retention(o jsonb,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype;ref jsonb;bid bigint;u timestamptz;op uuid;h text;prior jsonb;receipt jsonb;needed text[];
begin
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>5
 or not p ?& array['version','operationId','policy','sourceContext','sources'] or p->>'version'<>'eo05b-empty-retention-v1'
 or octet_length(p::text)>1048576 or p->'policy'->>'version' is distinct from 'report-source-3y-v1'
 or (select count(*) from jsonb_object_keys(p->'policy'))<>2 or not p->'policy' ?& array['version','until']
 then raise exception 'REPORT_EMPTY_INPUT_INVALID';end if;
 op:=(p->>'operationId')::uuid;u:=(p->'policy'->>'until')::timestamptz;
 if op is null or u is null or not isfinite(u) or u<=clock_timestamp() then raise exception 'REPORT_EMPTY_INPUT_INVALID';end if;
 if exists(select 1 from privacy.deletion_runs where workspace_id=(o->>'workspaceId')::uuid and install_generation=(o->>'generation')::bigint and status in ('pending','running','failed')) then raise exception 'REPORT_RETENTION_PRIVACY_PENDING';end if;
 perform analytics.assert_report_source_context(o,p->'sourceContext',u,p->'sources');
 if jsonb_array_length(p->'sources')<>(select count(distinct (value->>'batch_id',value->>'page_id')) from jsonb_array_elements(p->'sources'))
 then raise exception 'REPORT_EMPTY_DUPLICATE_PROOF';end if;
 needed:=case o->>'provider' when 'klaviyo' then array['configuration','account_performance','product_performance'] else array['account_performance','product_performance'] end;
 if exists(select 1 from unnest(needed) k where not exists(select 1 from evidence.source_batches x
  where x.id in(select (value->>'batch_id')::bigint from jsonb_array_elements(p->'sources'))
  and x.manifest->(case o->>'provider' when 'google_ads' then 'googleDatasetRead' when 'meta' then 'metaDatasetRead' else 'klaviyoDatasetRead' end)->>'dataset'=k))
 then raise exception 'REPORT_EMPTY_DATASET_MISSING';end if;
 select * into strict b from evidence.source_batches where id=(p->'sources'->0->>'batch_id')::bigint for update;
 h:=analytics.dataset_digest(p);prior:=b.manifest->'datasetEmptyRetentionReceipts'->op::text;
 if prior is not null then
  if prior->>'digest' is distinct from h then raise exception 'REPORT_EMPTY_OPERATION_CONFLICT';end if;
  return analytics.inspect_dataset_empty_retention(o,b.id,op);
 end if;
 if (select count(*) from jsonb_object_keys(coalesce(b.manifest->'datasetEmptyRetentionReceipts','{}')))>=32 then raise exception 'REPORT_EMPTY_RECEIPT_CAPACITY';end if;
 for bid in select distinct (value->>'batch_id')::bigint from jsonb_array_elements(p->'sources') loop
  if exists(select 1 from evidence.source_batches where id=bid and source_state<>'complete')
   or (select count(*) from evidence.source_pages where batch_id=bid)<>(select count(*) from jsonb_array_elements(p->'sources') where value->>'batch_id'=bid::text)
  then raise exception 'REPORT_EMPTY_PROOF_INCOMPLETE';end if;
  perform analytics.hold_report_source_batch(o,bid,u);
 end loop;
 receipt:=jsonb_build_object('status','retained_empty','operationId',op,'digest',h,'until',p->'policy'->>'until','sources',p->'sources','consumerReceipt',false);
 if octet_length(b.manifest::text)+octet_length(receipt::text)>1048576 then raise exception 'REPORT_EMPTY_RECEIPT_CAPACITY';end if;
 update evidence.source_batches set manifest=jsonb_set(manifest,'{datasetEmptyRetentionReceipts}',coalesce(manifest->'datasetEmptyRetentionReceipts','{}')||jsonb_build_object(op::text,receipt)) where id=b.id;
 return receipt;
end $fn$;

do $do$
declare t text;
begin
 foreach t in array array['evidence.source_batches','evidence.source_pages','evidence.source_references','evidence.source_reference_links',
 'identity.product_identity_mappings','identity.source_rule_versions','source.shopify_order_versions','source.shopify_line_versions','source.shopify_journey_versions','source.provider_claim_versions'] loop
 execute format('create trigger report_retention_floor before update of retain_until on %s for each row execute function analytics.guard_report_retention_floor()',t);
 end loop;
end $do$;

create or replace function analytics.commit_dataset_storage(o jsonb,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare item jsonb; r jsonb; row_input jsonb; injected jsonb; b evidence.source_batches%rowtype; primary_id bigint;
 operation uuid; h text; prior jsonb; result jsonb; ids jsonb:='[]'; found_row jsonb; rid bigint; name text; cols text; allowed text[]; k text;
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
 if p->'policy'->>'version'='report-source-3y-v1' then
  if exists(select 1 from privacy.deletion_runs where workspace_id=(o->>'workspaceId')::uuid and install_generation=(o->>'generation')::bigint and status in ('pending','running','failed')) then raise exception 'REPORT_RETENTION_PRIVACY_PENDING';end if;
  for item in select value from jsonb_array_elements(p->'rows') loop
   r:=item->'row';
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
 result:=jsonb_build_object('status','stored','operationId',operation,'digest',h,'rows',ids,'consumerReceipt',false);
 update evidence.source_batches set manifest=jsonb_set(manifest,'{datasetStorageReceipts}',coalesce(manifest->'datasetStorageReceipts','{}')||jsonb_build_object(operation::text,result)) where id=primary_id;
 return result;
end $fn$;


create function analytics.dataset_retention_has_dependents(t text,row_data jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $fn$
declare fk record;predicate text;found_row boolean;target oid;
begin
 if t not in ('pd_facts','cpd_product_performance_facts','cpd_product_sales_facts') then raise exception 'DATASET_RETENTION_TABLE_INVALID';end if;
 target:=to_regclass('analytics.'||t);
 for fk in select c.* from pg_catalog.pg_constraint c where c.contype='f' and c.confrelid=target order by c.oid loop
  select string_agg(format('child.%I = ($1->>%L)::%s',a.attname,b.attname,pg_catalog.format_type(a.atttypid,a.atttypmod)),' and ' order by k.ord) into predicate
  from unnest(fk.conkey,fk.confkey) with ordinality k(child_att,parent_att,ord)
  join pg_catalog.pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.child_att
  join pg_catalog.pg_attribute b on b.attrelid=fk.confrelid and b.attnum=k.parent_att;
  execute format('select exists(select 1 from %s child where %s)',fk.conrelid::regclass,predicate) into found_row using row_data;
  if found_row then return true;end if;
 end loop;
 return false;
end $fn$;

create function analytics.cleanup_dataset_retention(w uuid,i bigint,g bigint,op uuid,t text,a bigint,n integer,d timestamptz,audit jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare installation shopify.installations%rowtype;r jsonb;receipt jsonb;prior jsonb;receipts jsonb;h text;blocked boolean;removed integer;
 scanned integer:=0;held integer:=0;deleted integer:=0;last_id bigint:=a;
begin
 if w is null or i is null or g is null or op is null or a is null or a<0 or n is null or n not between 1 and 200
 or t is null or t not in ('pd_facts','cpd_product_performance_facts','cpd_product_sales_facts')
 or d is null or not isfinite(d) or d<=clock_timestamp() or d>clock_timestamp()+interval '10 minutes'
 or jsonb_typeof(audit) is distinct from 'object' or (select count(*) from jsonb_object_keys(audit))<>3
 or not audit ?& array['version','until','maxReceipts'] or coalesce(length(audit->>'version'),0) not between 1 and 128
 or jsonb_typeof(audit->'version') is distinct from 'string' or jsonb_typeof(audit->'until') is distinct from 'string'
 or jsonb_typeof(audit->'maxReceipts') is distinct from 'number' or not coalesce((audit->>'maxReceipts')::integer between 1 and 1000,false)
 or not coalesce(isfinite((audit->>'until')::timestamptz) and (audit->>'until')::timestamptz>=d,false)
 then raise exception 'DATASET_RETENTION_INPUT_INVALID';end if;
 perform 1 from operations.refresh_control where singleton for update;
 select * into strict installation from shopify.installations where workspace_id=w and id=i and install_generation=g for update;
 if exists(select 1 from privacy.deletion_runs where workspace_id=w and install_generation=g and status in ('pending','running','failed')) then raise exception 'DATASET_RETENTION_PRIVACY_PENDING';end if;
 h:=evidence.source_hash(jsonb_build_object('workspaceId',w,'installationId',i::text,'generation',g::text,'operationId',op,'kind','dataset:'||t,'after',a::text,'limit',n,'deadlineAt',d,'audit',audit));
 select value into prior from jsonb_array_elements(installation.source_retention_receipts) where value->>'operationId'=op::text;
 if prior is not null then
  if prior->>'digest' is distinct from h then raise exception 'DATASET_RETENTION_OPERATION_CONFLICT';end if;
  return prior;
 end if;
 select coalesce(jsonb_agg(value order by ord),'[]') into receipts from jsonb_array_elements(installation.source_retention_receipts) with ordinality q(value,ord) where (value->>'expiresAt')::timestamptz>statement_timestamp();
 if jsonb_array_length(receipts)>=(audit->>'maxReceipts')::integer then raise exception 'DATASET_RETENTION_AUDIT_CAPACITY';end if;
 for r in execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and id>$4 and retain_until<=statement_timestamp() order by id limit $5 for update skip locked',t) using w,i,g,a,n loop
  if clock_timestamp()>=d then raise exception 'DATASET_RETENTION_DEADLINE';end if;
  scanned:=scanned+1;last_id:=(r->>'id')::bigint;
  blocked:=jsonb_array_length(r->'provenance'->'sources') not between 1 and 32;
  if exists(select 1 from jsonb_array_elements(r->'provenance'->'sources') ref where not exists(select 1 from evidence.source_batches b
   where b.workspace_id=w and b.installation_id=i and b.installation_generation=g and b.id=(ref->>'batch_id')::bigint
   and b.storage_state='committed' and b.source_state='complete' and b.handoff_state='consumed' and b.handoff_receipt is not null
   and coalesce(b.manifest->'privacyRedacted','false'::jsonb)='false'::jsonb)) then blocked:=true;end if;
  if blocked or analytics.dataset_retention_has_dependents(t,r) then held:=held+1;continue;end if;
  execute format('delete from analytics.%I where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and id=$4 and retain_until<=statement_timestamp()',t) using w,i,g,last_id;
  get diagnostics removed=row_count;
  if removed<>1 then raise exception 'DATASET_RETENTION_DELETE_UNCONFIRMED';end if;
  deleted:=deleted+1;
 end loop;
 if clock_timestamp()>=d then raise exception 'DATASET_RETENTION_DEADLINE';end if;
 receipt:=jsonb_build_object('status','completed','scope','bounded_scan_only','operationId',op,'digest',h,'kind','dataset:'||t,'after',a::text,'lastScannedId',last_id::text,
  'scanned',scanned,'held',held,'deleted',deleted,'completedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',audit->>'until','policyVersion',audit->>'version','consumerReceipt',false,'sourceDeleted',false);
 receipts:=receipts||jsonb_build_array(receipt);
 if octet_length(receipts::text)>1048576 then raise exception 'DATASET_RETENTION_AUDIT_CAPACITY';end if;
 update shopify.installations set source_retention_receipts=receipts where id=i and workspace_id=w and install_generation=g;
 return receipt;
end $fn$;

revoke all on function analytics.report_retention_until(date,text),analytics.hold_report_source_batch(jsonb,bigint,timestamptz),
analytics.hold_report_mapping(jsonb,bigint,timestamptz),analytics.assert_report_source_context(jsonb,jsonb,timestamptz,jsonb),analytics.guard_report_retention_floor(),
analytics.inspect_dataset_empty_retention(jsonb,bigint,uuid),analytics.commit_dataset_empty_retention(jsonb,jsonb),analytics.commit_dataset_storage(jsonb,jsonb),
analytics.dataset_retention_has_dependents(text,jsonb),analytics.cleanup_dataset_retention(uuid,bigint,bigint,uuid,text,bigint,integer,timestamptz,jsonb)
from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
