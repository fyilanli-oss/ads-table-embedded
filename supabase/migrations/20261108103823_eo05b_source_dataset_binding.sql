begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;
-- Optional persisted source-admission proof for the new private binding.
-- Legacy storage DTOs remain readable; no grants or activation.
create or replace function analytics.validate_dataset_fact() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare j jsonb:=to_jsonb(new); b evidence.source_batches%rowtype; o jsonb; ref jsonb; m identity.product_identity_mappings%rowtype;
 f analytics.fx_rates%rowtype; k text; keys text[]; expected jsonb; identity_kind text; native jsonb; all_complete boolean:=true; context jsonb; original_source jsonb; native_read jsonb;
begin
 if tg_op='UPDATE' then raise exception 'DATASET_REVISION_PROTOCOL_REQUIRED';end if;
 select * into strict b from evidence.source_batches where workspace_id=new.workspace_id and installation_id=new.installation_id
 and installation_generation=new.installation_generation and id=new.source_batch_id for share;
 o:=b.authority; perform evidence.assert_source_owner(o);
 if o->>'provider'='shopify' or new.platform is distinct from o->>'provider' or new.platform_account_id is distinct from o->>'accountId'
 or new.provider_connection_id::text is distinct from o->>'connectionId'
 or new.retain_until>b.retain_until or new.retain_until<=clock_timestamp() then raise exception 'DATASET_OWNER_OR_POLICY_INVALID';end if;
 if new.platform<>'klaviyo' and new.canonical_reporting_account_id is distinct from o->>'accountId' then raise exception 'DATASET_ACCOUNT_INVALID';end if;
 if octet_length(analytics.dataset_json(j))>65536 or jsonb_typeof(new.provenance->'sources') is distinct from 'array'
 or jsonb_array_length(new.provenance->'sources') not between 1 and 32
 or (select count(*) from jsonb_object_keys(new.provenance)) not in (2,3)
 or ((select count(*) from jsonb_object_keys(new.provenance))=3 and not new.provenance ? 'source_context')
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
  if f.source_currency is distinct from new.source_currency or f.target_currency is distinct from new.target_currency
  or f.fx_rate_date is distinct from new.business_date or coalesce(new.fx_engine_version,'')='' then raise exception 'DATASET_FX_CONTEXT_INVALID';end if;
 end if;
 return new;
end $fn$;
commit;
