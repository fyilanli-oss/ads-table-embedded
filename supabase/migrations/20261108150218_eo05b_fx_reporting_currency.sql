begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Workspace configuration, separate from the existing five Dataset families.
-- First explicit merchant choice only; no UI/default/account-currency inference.
create table app.workspace_settings(
 workspace_id uuid not null references app.workspaces(id) on delete restrict,
 installation_id bigint not null references shopify.installations(id) on delete restrict,
 installation_generation bigint not null check(installation_generation>0),
 reporting_currency text not null check(reporting_currency in ('USD','EUR','TRY','GBP','JPY','CNY','AUD','CAD','CHF','SEK','NOK','DKK','PLN')),
 reporting_currency_source text not null check(reporting_currency_source='merchant_selected'),
 reporting_currency_version bigint not null check(reporting_currency_version=1),
 selection_operation_id uuid not null unique,
 selected_at timestamptz not null default clock_timestamp() check(isfinite(selected_at)),
 primary key(workspace_id,installation_id,installation_generation)
);
create index workspace_settings_installation_idx on app.workspace_settings(installation_id);
alter table app.workspace_settings enable row level security;
alter table app.workspace_settings force row level security;
create policy owner_only on app.workspace_settings to adstable_owner using(true) with check(true);
revoke all on app.workspace_settings from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function app.assert_reporting_currency_owner(o jsonb) returns void
language plpgsql security definer set search_path='' as $fn$
begin
 if jsonb_typeof(o) is distinct from 'object' or (select count(*) from jsonb_object_keys(o))<>5
 or not o ?& array['workspaceId','installationId','generation','shopId','shopDomain'] then raise exception 'REPORTING_CURRENCY_OWNER_INVALID';end if;
 perform 1 from shopify.installations i join app.workspaces w on w.id=i.workspace_id
 where i.workspace_id=(o->>'workspaceId')::uuid and i.id=(o->>'installationId')::bigint and i.install_generation=(o->>'generation')::bigint
 and i.shop_id=o->>'shopId' and i.shop_domain=o->>'shopDomain' and i.status='active' and w.status='active' for share of i,w;
 if not found then raise exception 'REPORTING_CURRENCY_OWNER_CHANGED';end if;
 if exists(select 1 from privacy.deletion_runs where workspace_id=(o->>'workspaceId')::uuid and install_generation=(o->>'generation')::bigint and status in ('pending','running','failed'))
 then raise exception 'REPORTING_CURRENCY_PRIVACY_PENDING';end if;
end $fn$;

create function app.guard_reporting_currency() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare i shopify.installations%rowtype;
begin
 if tg_op='UPDATE' then raise exception 'REPORTING_CURRENCY_CHANGE_REQUIRES_REPROCESSING_DECISION';end if;
 select * into strict i from shopify.installations where id=new.installation_id;
 perform app.assert_reporting_currency_owner(jsonb_build_object('workspaceId',new.workspace_id::text,'installationId',new.installation_id::text,'generation',new.installation_generation::text,'shopId',i.shop_id,'shopDomain',i.shop_domain));
 return new;
end $fn$;
create trigger reporting_currency_guard before insert or update on app.workspace_settings for each row execute function app.guard_reporting_currency();

create function app.read_reporting_currency(o jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare s app.workspace_settings%rowtype;
begin
 perform app.assert_reporting_currency_owner(o);
 select * into s from app.workspace_settings where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint and installation_generation=(o->>'generation')::bigint for share;
 if not found then return null;end if;
 return jsonb_build_object('version','reporting-currency-v1','workspaceId',s.workspace_id::text,'installationId',s.installation_id::text,'generation',s.installation_generation::text,
 'currency',s.reporting_currency,'currencyVersion',s.reporting_currency_version::text,'selectionOperationId',s.selection_operation_id,'source',s.reporting_currency_source);
end $fn$;

create function app.select_reporting_currency(o jsonb,c text,op uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare s app.workspace_settings%rowtype;
begin
 perform 1 from operations.refresh_control where singleton for update;
 perform app.assert_reporting_currency_owner(o);
 if c is null or c not in ('USD','EUR','TRY','GBP','JPY','CNY','AUD','CAD','CHF','SEK','NOK','DKK','PLN') or op is null then raise exception 'REPORTING_CURRENCY_INPUT_INVALID';end if;
 select * into s from app.workspace_settings where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint and installation_generation=(o->>'generation')::bigint for update;
 if found then
  if s.selection_operation_id<>op or s.reporting_currency<>c then raise exception 'REPORTING_CURRENCY_ALREADY_CONFIGURED';end if;
 else
  insert into app.workspace_settings(workspace_id,installation_id,installation_generation,reporting_currency,reporting_currency_source,reporting_currency_version,selection_operation_id)
  values((o->>'workspaceId')::uuid,(o->>'installationId')::bigint,(o->>'generation')::bigint,c,'merchant_selected',1,op);
 end if;
 return app.read_reporting_currency(o);
end $fn$;

-- Only the explicitly accepted weekend rule. A missing weekday/holiday quote
-- is held; no arbitrary nearest/latest search or forward-looking quote.
create function analytics.dataset_fx_publication_date(d date) returns date
language plpgsql immutable set search_path='' as $fn$
begin
 if d is null or not isfinite(d) or extract(year from d) not between 1900 and 9995 then raise exception 'DATASET_FX_DATE_INVALID';end if;
 return d-case extract(isodow from d)::integer when 6 then 1 when 7 then 2 else 0 end;
end $fn$;

create function analytics.assert_frankfurter_rate(p jsonb) returns void
language plpgsql stable security definer set search_path='' as $fn$
declare proof jsonb:=p->'source_reference';b jsonb:=proof->'body';d date:=(p->>'fx_rate_date')::date;
begin
 if p->>'fx_provider' is distinct from 'frankfurter_ecb_v2' or p->>'fx_schema_version' is distinct from 'frankfurter-ecb-proof-v1'
 or jsonb_typeof(proof) is distinct from 'object' or (select count(*) from jsonb_object_keys(proof))<>5 or not proof ?& array['version','url','requestDate','body','digest']
 or proof->>'version' is distinct from 'frankfurter-ecb-proof-v1' or proof->>'requestDate' is distinct from d::text
 or d is distinct from analytics.dataset_fx_publication_date(d)
 or proof->>'url' is distinct from 'https://api.frankfurter.dev/v2/providers/ECB/rate/'||(p->>'source_currency')||'/'||(p->>'target_currency')||'?date='||d::text
 or jsonb_typeof(b) is distinct from 'object' or (select count(*) from jsonb_object_keys(b))<>4 or not b ?& array['date','base','quote','rate']
 or b->>'date' is distinct from d::text or b->>'base' is distinct from p->>'source_currency' or b->>'quote' is distinct from p->>'target_currency'
 or jsonb_typeof(b->'rate') is distinct from 'string' or b->>'rate' is distinct from p->>'fx_rate'
 or p->>'fx_rate' !~ '^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$' or (p->>'fx_rate')::numeric<=0
 or proof->>'digest' is distinct from analytics.dataset_digest(b) or p->>'rate_version' is distinct from proof->>'digest'
 then raise exception 'DATASET_FX_PROOF_INVALID';end if;
end $fn$;

create function analytics.lookup_dataset_fx(s text,t text,d date) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare f analytics.fx_rates%rowtype;n integer;
begin
 if s is null or t is null or s=t or s !~ '^[A-Z]{3}$' or t !~ '^[A-Z]{3}$' or d is distinct from analytics.dataset_fx_publication_date(d) then raise exception 'DATASET_FX_LOOKUP_INVALID';end if;
 select count(*) into n from (select 1 from analytics.fx_rates where source_currency=s and target_currency=t and fx_rate_date=d and fx_provider='frankfurter_ecb_v2' limit 2) q;
 if n>1 then raise exception 'DATASET_FX_REVISION_REQUIRES_REVIEW';end if;
 select * into f from analytics.fx_rates where source_currency=s and target_currency=t and fx_rate_date=d and fx_provider='frankfurter_ecb_v2' for share;
 if not found then return null;end if;
 perform analytics.assert_frankfurter_rate(to_jsonb(f)||jsonb_build_object('fx_rate',f.fx_rate::text));
 return to_jsonb(f)||jsonb_build_object('id',f.id::text,'fx_rate',f.fx_rate::text);
end $fn$;

create function analytics.assert_dataset_fx_context(j jsonb) returns void
language plpgsql security definer set search_path='' as $fn$
declare i shopify.installations%rowtype;configuration jsonb;p jsonb:=j->'provenance'->'fx_policy';f analytics.fx_rates%rowtype;d date:=(j->>'business_date')::date;
begin
 select * into strict i from shopify.installations where id=(j->>'installation_id')::bigint and workspace_id=(j->>'workspace_id')::uuid and install_generation=(j->>'installation_generation')::bigint for share;
 configuration:=app.read_reporting_currency(jsonb_build_object('workspaceId',i.workspace_id::text,'installationId',i.id::text,'generation',i.install_generation::text,'shopId',i.shop_id,'shopDomain',i.shop_domain));
 if configuration is null or j->'provenance'->'reporting_currency' is distinct from configuration or configuration->>'currency' is distinct from j->>'target_currency'
 or jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>3 or not p ?& array['version','businessDate','rateDate']
 or p->>'version' is distinct from 'frankfurter-ecb-weekend-v1' or j->>'fx_engine_version' is distinct from p->>'version'
 or p->>'businessDate' is distinct from d::text then raise exception 'DATASET_FX_CONFIGURATION_MISMATCH';end if;
 if j->>'fx_state'='identity' then
  if j->>'source_currency' is distinct from j->>'target_currency' or p->>'rateDate' is distinct from d::text or j->>'fx_rate_id' is not null then raise exception 'DATASET_FX_IDENTITY_INVALID';end if;
 elsif j->>'fx_state'='verified' then
  select * into strict f from analytics.fx_rates where id=(j->>'fx_rate_id')::bigint for share;
  perform analytics.assert_frankfurter_rate(to_jsonb(f)||jsonb_build_object('fx_rate',f.fx_rate::text));
  if analytics.lookup_dataset_fx(f.source_currency,f.target_currency,f.fx_rate_date)->>'id' is distinct from f.id::text then raise exception 'DATASET_FX_REVISION_REQUIRES_REVIEW';end if;
  if f.source_currency is distinct from j->>'source_currency' or f.target_currency is distinct from j->>'target_currency'
  or f.fx_rate_date is distinct from analytics.dataset_fx_publication_date(d) or p->>'rateDate' is distinct from f.fx_rate_date::text then raise exception 'DATASET_FX_CONTEXT_INVALID';end if;
 else raise exception 'DATASET_FX_STATE_INVALID';end if;
end $fn$;


create or replace function analytics.record_dataset_fx(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare f analytics.fx_rates%rowtype;
begin
 if p->>'fx_provider'='frankfurter_ecb_v2' then perform analytics.assert_frankfurter_rate(p);end if;
 if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>9
 or not p ?& array['source_currency','target_currency','fx_rate_date','fx_rate','fx_provider','rate_version','source_reference','fetched_at','fx_schema_version']
 or jsonb_typeof(p->'fx_rate') is distinct from 'string' or p->>'fx_rate' !~ '^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$'
 or (p->>'fx_rate')::numeric<=0 or length(p->>'fx_rate')>128 or p->>'source_currency'=p->>'target_currency'
 or coalesce(p->>'fx_provider','')='' or coalesce(p->>'rate_version','')='' or coalesce(p->>'fx_schema_version','')=''
 or octet_length(analytics.dataset_json(p))>32768 then raise exception 'DATASET_FX_INVALID';end if;
 perform pg_catalog.pg_advisory_xact_lock(hashtextextended(analytics.dataset_json(jsonb_build_array(p->>'source_currency',p->>'target_currency',p->>'fx_rate_date',p->>'fx_provider',p->>'rate_version')),0));
 select * into f from analytics.fx_rates where source_currency=p->>'source_currency' and target_currency=p->>'target_currency'
 and fx_rate_date=(p->>'fx_rate_date')::date and fx_provider=p->>'fx_provider' and rate_version=p->>'rate_version' for share;
 if found then
  if f.fx_rate is distinct from (p->>'fx_rate')::numeric or f.source_reference is distinct from p->'source_reference'
  or f.fx_schema_version is distinct from p->>'fx_schema_version' then raise exception 'DATASET_FX_CONFLICT';end if;
 else
  insert into analytics.fx_rates(source_currency,target_currency,fx_rate_date,fx_rate,fx_provider,rate_version,source_reference,fetched_at,fx_schema_version)
  values(p->>'source_currency',p->>'target_currency',(p->>'fx_rate_date')::date,(p->>'fx_rate')::numeric,p->>'fx_provider',p->>'rate_version',p->'source_reference',(p->>'fetched_at')::timestamptz,p->>'fx_schema_version') returning * into f;
 end if;
 return to_jsonb(f)||jsonb_build_object('id',f.id::text,'fx_rate',f.fx_rate::text);
end $fn$;

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

create or replace function evidence.delete_installation_sources(p_installation bigint) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare result jsonb:='{}'; n bigint;
begin
 set constraints all deferred;
 delete from analytics.pd_facts where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('analytics.pd_facts',n);
 delete from analytics.cpd_product_performance_facts where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('analytics.cpd_product_performance_facts',n);
 delete from analytics.cpd_product_sales_facts where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('analytics.cpd_product_sales_facts',n);
 if exists(select 1 from analytics.pd_facts where installation_id=p_installation) or exists(select 1 from analytics.cpd_product_performance_facts where installation_id=p_installation) or exists(select 1 from analytics.cpd_product_sales_facts where installation_id=p_installation) then raise exception 'DATASET_ERASURE_INCOMPLETE';end if;
 delete from evidence.source_reference_links where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('evidence.source_reference_links',n);
 delete from source.provider_claim_versions where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('source.provider_claim_versions',n);
 delete from source.shopify_journey_versions where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('source.shopify_journey_versions',n);
 delete from source.shopify_line_versions where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('source.shopify_line_versions',n);
 delete from source.shopify_order_versions where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('source.shopify_order_versions',n);
 delete from identity.product_identity_mappings where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('identity.product_identity_mappings',n);
 delete from identity.source_rule_versions where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('identity.source_rule_versions',n);
 delete from evidence.source_references where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('evidence.source_references',n);
 delete from evidence.source_pages where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('evidence.source_pages',n);
 delete from evidence.source_batches where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('evidence.source_batches',n);
 delete from app.workspace_settings where installation_id=p_installation;get diagnostics n=row_count;result:=result||jsonb_build_object('app.workspace_settings',n);
 set constraints all immediate;
 return result;
end $fn$;

revoke all on function app.assert_reporting_currency_owner(jsonb),app.guard_reporting_currency(),app.read_reporting_currency(jsonb),app.select_reporting_currency(jsonb,text,uuid),analytics.dataset_fx_publication_date(date),analytics.assert_frankfurter_rate(jsonb),analytics.lookup_dataset_fx(text,text,date),analytics.assert_dataset_fx_context(jsonb),analytics.record_dataset_fx(jsonb),analytics.validate_dataset_fact(),evidence.delete_installation_sources(bigint) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
