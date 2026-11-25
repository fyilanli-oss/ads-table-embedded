begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;


-- Maintain the original per-row permit checks and recognize batch permits only on complete Meta evidence.

create or replace function analytics.validate_dataset_fact() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare j jsonb:=to_jsonb(new); b evidence.source_batches%rowtype; o jsonb; ref jsonb; m identity.product_identity_mappings%rowtype;
 f analytics.fx_rates%rowtype; k text; keys text[]; expected jsonb; identity_kind text; native jsonb; all_complete boolean:=true; context jsonb; original_source jsonb; native_read jsonb; permit jsonb;
begin
 if tg_op='UPDATE' then
  select coalesce(manifest->'datasetRevisionPermit',
    case new.platform when 'google_ads' then manifest->'googleDailyRevisionPermits'->(tg_table_name||':'||old.id::text)
     when 'meta' then manifest->'metaDailyRevisionPermits'->(tg_table_name||':'||old.id::text) end)
   into permit from evidence.source_batches where workspace_id=new.workspace_id and installation_id=new.installation_id
   and installation_generation=new.installation_generation and id=new.source_batch_id and storage_state='committed'
   and handoff_state='pending'
   and (source_state='complete' or (
    source_state='partial' and new.platform='google_ads' and primary_source='google_ads'
    and manifest->'googleDatasetRead' ? 'packageCount'
    and manifest->'googleDailyRevisionPermits'->(tg_table_name||':'||old.id::text)->'googleVerifiedPackage'=
      jsonb_build_object('jobId',new.provenance->'source_context'->>'job_id',
        'fence',new.provenance->'source_context'->>'fence',
        'window',new.provenance->'source_context'->'window')
    and manifest->'googleDatasetRead'->>'jobId'=new.provenance->'source_context'->>'job_id'
    and manifest->'googleDatasetRead'->>'fence'=new.provenance->'source_context'->>'fence'
    and manifest->'googleDatasetRead'->'window'=new.provenance->'source_context'->'window'));
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

create or replace function analytics.inspect_dataset_reconciliation(o jsonb,op uuid) returns jsonb
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
  execute format('select count(*)::int from (select id from analytics.%I where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=$4 and platform_account_id=$5 and business_date=$6 limit %s) x',t,case when o->>'provider'='meta' and r ? 'packages' then 1001 else 201 end)
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

create function analytics._commit_meta_packaged_report(o jsonb,p jsonb,c jsonb,d timestamptz,expected jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare item jsonb; r jsonb; row_input jsonb; injected jsonb; b evidence.source_batches%rowtype; primary_id bigint;
 operation uuid; h text; prior jsonb; result jsonb; found_row jsonb; rid bigint; name text; cols text; allowed text[]; k text;
 head jsonb; old_fact jsonb; ref jsonb; native_read jsonb; sets text[]:='{}';
 batch_text text; obsolete bigint[]:='{}'; old_count int:=0; pages int:=0; actual jsonb; summary jsonb:='[]';
 start_at text; finish_at text; removed int:=0; modified int:=0; scope_date date; scope_tz text;
 part jsonb; part_number integer; parts jsonb; pack_summary jsonb:='[]'; combined_rows jsonb:='[]';
 incoming_keys jsonb; permits jsonb; updates jsonb; source_id bigint; group_rows record; changed integer;
begin
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 if o->>'provider' is distinct from 'meta' then raise exception 'META_REPORT_SCOPE_INVALID';end if;
 if jsonb_typeof(p) is distinct from 'array' or jsonb_typeof(expected) is distinct from 'array'
 or jsonb_array_length(p) not between 1 and 5 or jsonb_array_length(p)<>jsonb_array_length(expected)
 then raise exception 'META_REPORT_PACKAGE_COUNT';end if;
 parts:=p;
 for part,part_number in select value,(n-1)::integer from jsonb_array_elements(parts) with ordinality t(value,n) order by n loop
  if jsonb_typeof(part) is distinct from 'object' or (select count(*) from jsonb_object_keys(part))<>4
   or not part ?& array['version','operationId','policy','rows'] or part->>'version' is distinct from 'eo05b-storage-v1'
   or part-'rows' is distinct from (parts->0)-'rows' or jsonb_typeof(part->'rows') is distinct from 'array'
   or jsonb_array_length(part->'rows')>200 or (jsonb_array_length(parts)>1 and jsonb_array_length(part->'rows')=0)
  then raise exception 'META_REPORT_PACKAGE_INVALID';end if;
  item:=jsonb_build_object('ordinal',part_number,'rowCount',jsonb_array_length(part->'rows'),
   'digest',analytics.dataset_digest(jsonb_build_object('write',part,'context',c)));
  if item is distinct from expected->part_number then raise exception 'META_REPORT_PACKAGE_INVALID';end if;
  pack_summary:=pack_summary||jsonb_build_array(item);
  combined_rows:=combined_rows||(part->'rows');
 end loop;
 p:=jsonb_set(parts->0,'{rows}',combined_rows);
 select jsonb_object_agg((entry->>'table')||':'||(entry->'row'->>'native_key_hash'),true)
   into incoming_keys from jsonb_array_elements(combined_rows) entry;
 if coalesce((select count(*) from jsonb_object_keys(incoming_keys)),0)<>jsonb_array_length(combined_rows) then
  raise exception 'DATASET_DUPLICATE_NATIVE_KEY';
 end if;
 if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>4
 or not p ?& array['version','operationId','policy','rows'] or p->>'version'<>'eo05b-storage-v1'
 then raise exception 'DATASET_INPUT_INVALID';end if;
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
 h:=analytics.dataset_digest(jsonb_build_object('packages',pack_summary));
 if jsonb_typeof(c) is distinct from 'object' or (select count(*) from jsonb_object_keys(c))<>9
 or c->>'version' is distinct from 'eo05d-reconciliation-v1' or coalesce(c->>'expectedRevision','')!~ '^(0|[1-9][0-9]{0,8})$'
 or jsonb_typeof(c->'sources') is distinct from 'array' or jsonb_array_length(c->'sources') not between 1 and 300
 or jsonb_typeof(c->'batchIds') is distinct from 'array' or jsonb_array_length(c->'batchIds')<>2
 or (select count(distinct value) from jsonb_array_elements_text(c->'batchIds'))<>jsonb_array_length(c->'batchIds')
 or d is null or not isfinite(d) or d<=clock_timestamp() or d>clock_timestamp()+interval '120 seconds'
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
  if prior->>'status' is distinct from 'consumed' or prior->>'comparison' is distinct from 'matched' then raise exception 'DATASET_RECONCILIATION_PREVIOUS_UNVERIFIED';end if;
  if (c->>'startedAt')::timestamptz<(head->>'completedAt')::timestamptz then raise exception 'DATASET_RECONCILIATION_STALE_READ';end if;
  select array_agg(value::bigint) into obsolete from jsonb_array_elements_text(head->'batchIds');
 end if;
 perform id from evidence.source_batches where authority=o and id in(select value::bigint from jsonb_array_elements_text(c->'batchIds')) order by id for update;
 for batch_text in select value from jsonb_array_elements_text(c->'batchIds') loop
  select * into strict b from evidence.source_batches where authority=o and id=batch_text::bigint;
  native_read:=b.manifest->'metaDatasetRead';
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
 if (select array_agg(x order by x) from unnest(sets) x) is distinct from array['account_performance','product_performance']
 or pages<>jsonb_array_length(c->'sources')
 or (select count(distinct value->>'page_id') from jsonb_array_elements(c->'sources'))<>pages
 or start_at is distinct from c->>'startedAt' or finish_at is distinct from c->>'completedAt' then raise exception 'DATASET_RECONCILIATION_COVERAGE_INVALID';end if;
 for ref in select value from jsonb_array_elements(c->'sources') loop
  if not (c->'batchIds' ? (ref->>'batch_id')) then raise exception 'DATASET_RECONCILIATION_REFERENCE_INVALID';end if;
  perform analytics.assert_dataset_source(o,ref);
 end loop;
 perform analytics.assert_report_source_context(o,c->'sourceContext',(p->'policy'->>'until')::timestamptz,c->'sources');
 if (scope_date::timestamp at time zone scope_tz)<to_timestamp((c->'sourceContext'->'snapshot'->>'eligibleFromMs')::numeric/1000)
 or scope_date>=(clock_timestamp() at time zone scope_tz)::date then raise exception 'DATASET_RECONCILIATION_ELIGIBILITY';end if;
 -- Bounded complete-day replacement. Never erase rows from another owner,
 -- timezone, date, connection or a partial/unavailable projection.
 foreach name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
  for old_fact in execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=$4 and platform_account_id=$5 and business_date=$6 order by id limit 1001 for update',name)
   using (o->>'workspaceId')::uuid,(o->>'installationId')::bigint,(o->>'generation')::bigint,o->>'provider',o->>'accountId',scope_date loop
   old_count:=old_count+1;if old_count>1000 then raise exception 'DATASET_RECONCILIATION_SCOPE_LIMIT';end if;
   if old_fact->>'source_timezone' is distinct from scope_tz or old_fact->>'provider_connection_id' is distinct from o->>'connectionId'
   or (old_fact->>'retain_until')::timestamptz<=clock_timestamp() then raise exception 'DATASET_RECONCILIATION_SCOPE_CONFLICT';end if;
   if not coalesce(prior->'sources' @> (old_fact->'provenance'->'sources'),false) then
    raise exception 'DATASET_RECONCILIATION_PREVIOUS_UNVERIFIED';
   end if;
   if not (coalesce(incoming_keys,'{}'::jsonb) ? (name||':'||(old_fact->>'native_key_hash'))) then
    if analytics.dataset_retention_has_dependents(name,old_fact) then raise exception 'DATASET_RECONCILIATION_DEPENDENT';end if;
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
   if r->>'business_date' is distinct from r->'provenance'->'source_context'->'window'->>'from'
    or r->>'source_timezone' is distinct from r->'provenance'->'source_context'->'snapshot'->>'timezone'
   then raise exception 'REPORT_RETENTION_POLICY_MISMATCH';end if;
   foreach k in array array['product_mapping_id','sold_product_mapping_id','advertised_product_mapping_id'] loop
    if r->>k is not null then perform analytics.hold_report_mapping(o,(r->>k)::bigint,(p->'policy'->>'until')::timestamptz);end if;
   end loop;
  end loop;
 end if;
 for part in select value from jsonb_array_elements(parts) loop
  permits:='{}'::jsonb;
  updates:='[]'::jsonb;
  for item in select value from jsonb_array_elements(part->'rows') loop
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
   'canonical_reporting_account_id',o->>'accountId',
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
   source_id:=(r->>'source_batch_id')::bigint;
   permits:=jsonb_set(permits,array[source_id::text],coalesce(permits->source_id::text,'{}'::jsonb)||
    jsonb_build_object(name||':'||rid::text,jsonb_build_object(
     'transactionId',pg_catalog.txid_current()::text,'table',name,'id',rid::text,'fromRevision',found_row->>'revision',
     'toRevision',((found_row->>'revision')::bigint+1)::text,'before',found_row->>'payload_digest','after',r->>'payload_digest')));
   updates:=updates||jsonb_build_array(jsonb_build_object('id',rid,'table',name,'row',injected));
   modified:=modified+1;
  else
   select string_agg(quote_ident(key),',' order by key) into cols from jsonb_object_keys(injected) key;
   execute format('insert into analytics.%I(%s) select %s from jsonb_populate_record(null::analytics.%I,$1) returning id',name,cols,cols,name) into rid using injected;
  end if;
  summary:=summary||jsonb_build_array(jsonb_build_object('table',name,'id',rid::text,
   'nativeKeyHash',r->>'native_key_hash','payloadDigest',r->>'payload_digest'));
  end loop;

  -- One scoped permit write per raw batch and one fact update per table
  -- inside each bounded package. The ordinary trigger validates every row.
  update evidence.source_batches batch set manifest=batch.manifest||jsonb_build_object('metaDailyRevisionPermits',x.value)
    from jsonb_each(permits) x where batch.id=x.key::bigint and batch.authority=o and batch.handoff_state='pending'
      and batch.source_state='complete' and not (batch.manifest ?| array['datasetRevisionPermit','metaDailyRevisionPermits']);
  get diagnostics changed=row_count;
  if changed<>(select count(*) from jsonb_object_keys(permits)) then raise exception 'DATASET_REVISION_PROTOCOL_REQUIRED';end if;
  for group_rows in select entry->>'table' as table_name,jsonb_agg(entry) as items
    from jsonb_array_elements(updates) entry group by entry->>'table'
  loop
   select string_agg(format('%I=v.%I',key,key),',' order by key) into cols from jsonb_object_keys(group_rows.items->0->'row') key;
   execute format('update analytics.%I x set %s,revision=x.revision+1,updated_at=clock_timestamp() from (
     select (item->>''id'')::bigint as fact_id,data.* from jsonb_array_elements($1) item
     cross join lateral jsonb_populate_record(null::analytics.%I,item->''row'') data
    ) v where x.id=v.fact_id',group_rows.table_name,cols,group_rows.table_name) using group_rows.items;
   get diagnostics changed=row_count;
   if changed<>jsonb_array_length(group_rows.items) then raise exception 'DATASET_RECONCILIATION_READBACK_MISMATCH';end if;
  end loop;
  update evidence.source_batches batch set manifest=batch.manifest-'metaDailyRevisionPermits'
    from jsonb_object_keys(permits) as x(id) where batch.id=x.id::bigint and batch.authority=o;
 end loop;
 for item in select value from jsonb_array_elements(summary) loop
  name:=item->>'table';
  execute format('select to_jsonb(x) from analytics.%I x where id=$1',name) into actual using (item->>'id')::bigint;
  if analytics.reconciliation_fact_digest(name,actual) is distinct from item->>'payloadDigest' then
   raise exception 'DATASET_RECONCILIATION_READBACK_MISMATCH';
  end if;
 end loop;
 old_count:=0;
 foreach name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
  execute format('select count(*)::int from (select id from analytics.%I where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=$4 and platform_account_id=$5 and business_date=$6 limit 1001) x',name)
   into pages using (o->>'workspaceId')::uuid,(o->>'installationId')::bigint,(o->>'generation')::bigint,o->>'provider',o->>'accountId',scope_date;
  old_count:=old_count+pages;
 end loop;
 if old_count<>jsonb_array_length(p->'rows') then raise exception 'DATASET_RECONCILIATION_READBACK_MISMATCH';end if;
 if d<=clock_timestamp() then raise exception 'DATASET_RECONCILIATION_DEADLINE';end if;
 result:=jsonb_build_object('version','eo05d-reconciliation-v1','status','consumed','operationId',operation,'requestDigest',h,
 'businessDate',c->>'businessDate','timeZone',scope_tz,'revision',(c->>'expectedRevision')::bigint+1,
 'startedAt',c->>'startedAt','completedAt',c->>'completedAt','batchIds',c->'batchIds','sources',c->'sources',
 'rowCount',jsonb_array_length(p->'rows'),'rows',summary,'changes','[]'::jsonb,'removed',removed,'replaced',modified,'packages',pack_summary,
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

create function analytics.commit_scheduled_meta_packaged_report(o jsonb,p jsonb,c jsonb,d timestamptz,expected jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
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
  perform 1 from operations.refresh_control where singleton for update;
  if not found then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'; end if;
  perform evidence.assert_source_owner(o);

  if provider_name is distinct from 'meta' or d is null or d<=clock_timestamp()
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

  begin
    receipt:=analytics._commit_meta_packaged_report(o,p,c,d,expected);
  exception when raise_exception then
    if sqlerrm<>'DATASET_RECONCILIATION_READBACK_MISMATCH' then raise;end if;
    receipt:=jsonb_build_object('version','eo05d-reconciliation-v1','status','mismatch','comparison','mismatch',
      'operationId',p->0->>'operationId','requestDigest',analytics.dataset_digest(jsonb_build_object('packages',expected)),
      'consumerReceipt',false,'checkpointAdvanced',false,'reportValuesChanged',false);
    update evidence.source_batches set manifest=manifest||jsonb_build_object('datasetReconciliationMismatch',receipt)
      where id=(c->'batchIds'->>0)::bigint and authority=o and storage_state='committed' and handoff_state='pending';
    if not found then raise exception 'DATASET_RECONCILIATION_MISMATCH_UNRECORDED';end if;
  end;
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

revoke all on function analytics._commit_meta_packaged_report(jsonb,jsonb,jsonb,timestamptz,jsonb),
 analytics.commit_scheduled_meta_packaged_report(jsonb,jsonb,jsonb,timestamptz,jsonb)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;
grant execute on function analytics.commit_scheduled_meta_packaged_report(jsonb,jsonb,jsonb,timestamptz,jsonb)
 to adstable_refresh_dataset_runner;
reset role;
commit;
