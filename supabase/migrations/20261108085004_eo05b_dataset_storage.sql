begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Owner-only dormant storage. No runtime/source runner grant, scheduler, route,
-- native field acceptance, FX provider choice or consumer checkpoint activation.
create table analytics.fx_rates (
 id bigint generated always as identity primary key not null,
 source_currency text not null,
 target_currency text not null,
 fx_rate_date date not null,
 fx_rate numeric not null,
 fx_provider text not null,
 rate_version text not null,
 source_reference jsonb not null,
 fetched_at timestamptz not null,
 fx_schema_version text not null,
 unique(source_currency,target_currency,fx_rate_date,fx_provider,rate_version),
 check(source_currency ~ '^[A-Z]{3}$' and target_currency ~ '^[A-Z]{3}$'),
 check(fx_rate>0 and fx_rate::text not in ('NaN','Infinity','-Infinity') and length(fx_rate::text)<=128),
 check(isfinite(fx_rate_date) and isfinite(fetched_at)),
 check(jsonb_typeof(source_reference)='object' and source_reference<>'{}' and octet_length(source_reference::text)<=16384)

);
alter table analytics.fx_rates enable row level security;
alter table analytics.fx_rates force row level security;
create policy owner_only on analytics.fx_rates to adstable_owner using(true) with check(true);
revoke all on analytics.fx_rates from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
revoke all on sequence analytics.fx_rates_id_seq from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create table analytics.pd_facts (
 id bigint generated always as identity primary key not null,
 workspace_id uuid not null,
 installation_id bigint not null,
 installation_generation bigint not null,
 provider_connection_id uuid not null,
 platform text not null,
 platform_account_id text not null,
 canonical_reporting_account_id text,
 business_date date,
 source_timezone text,
 reporting_scope jsonb not null,
 source_identity jsonb not null,
 grain_version text not null,
 native_key_canonical text not null,
 native_key_hash text not null,
 row_schema_version text not null,
 metric_support jsonb not null,
 observation_state jsonb not null,
 extension_schema_version text not null,
 metric_extensions jsonb not null,
 provenance jsonb not null,
 source_batch_id bigint not null,
 source_completeness text not null,
 source_currency text,
 target_currency text,
 fx_rate_id bigint,
 fx_state text not null,
 fx_engine_version text,
 payload_digest text not null,
 revision bigint not null default 1,
 created_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 retention_policy_version text not null,
 retain_until timestamptz not null,
 entity_type text not null,
 entity_id text not null,
 entity_name text,
 root_entity_type text,
 root_entity_id text,
 root_entity_name text,
 parent_entity_type text,
 parent_entity_id text,
 parent_entity_name text,
 campaign_type text,
 impression numeric,
 ad_click numeric,
 spend_value numeric,
 add_to_cart numeric,
 add_to_cart_value numeric,
 checkout numeric,
 checkout_value numeric,
 purchase numeric,
 purchase_value numeric,
 unique(workspace_id,installation_id,installation_generation,platform,platform_account_id,grain_version,native_key_hash),
 foreign key(workspace_id,installation_id,installation_generation,source_batch_id)
 references evidence.source_batches(workspace_id,installation_id,installation_generation,id) deferrable initially immediate,
 foreign key(fx_rate_id) references analytics.fx_rates(id),
 check(installation_id>0 and installation_generation>0 and revision>0),
 check(platform in ('google_ads','meta','klaviyo')),
 check((platform='klaviyo')=(canonical_reporting_account_id is null)),
 check(platform='klaviyo' or canonical_reporting_account_id=platform_account_id),
 check(grain_version='eo05b-native-grain-v1' and row_schema_version='eo05b-storage-v1'),
 check(native_key_hash ~ '^[a-f0-9]{64}$' and payload_digest ~ '^[a-f0-9]{64}$'),
 check(source_completeness in ('complete','partial')),
 check(isfinite(retain_until) and isfinite(created_at) and isfinite(updated_at) and retain_until>created_at),
 check(business_date is null or isfinite(business_date)),
 check(source_currency is null or source_currency ~ '^[A-Z]{3}$'),
 check(target_currency is null or target_currency ~ '^[A-Z]{3}$'),
 check(fx_state in ('identity','verified','missing','unsupported','conflicting')),
 check((fx_state='verified')=(fx_rate_id is not null)),
 check(fx_state<>'identity' or (source_currency is not null and source_currency=target_currency and fx_rate_id is null)),
 check(length(extension_schema_version) between 1 and 128 and jsonb_typeof(metric_extensions)='object' and octet_length(metric_extensions::text)<=16384),
 check(jsonb_typeof(reporting_scope)='object' and jsonb_typeof(source_identity)='object'),
 check(jsonb_typeof(provenance)='object' and octet_length(provenance::text)<=32768),
 check(jsonb_typeof(metric_support)='object' and jsonb_typeof(observation_state)='object'),
 check(impression is null or (impression>=0 and impression::text not in ('NaN','Infinity','-Infinity') and length(impression::text)<=128)),
 check(metric_support->>'impression' in ('supported','unsupported','unknown') and observation_state->>'impression' in ('present','missing','unknown','unsupported')),
 check((impression is not null)=(metric_support->>'impression'='supported' and observation_state->>'impression'='present')),
 check(ad_click is null or (ad_click>=0 and ad_click::text not in ('NaN','Infinity','-Infinity') and length(ad_click::text)<=128)),
 check(metric_support->>'ad_click' in ('supported','unsupported','unknown') and observation_state->>'ad_click' in ('present','missing','unknown','unsupported')),
 check((ad_click is not null)=(metric_support->>'ad_click'='supported' and observation_state->>'ad_click'='present')),
 check(spend_value is null or (spend_value>=0 and spend_value::text not in ('NaN','Infinity','-Infinity') and length(spend_value::text)<=128)),
 check(metric_support->>'spend_value' in ('supported','unsupported','unknown') and observation_state->>'spend_value' in ('present','missing','unknown','unsupported')),
 check((spend_value is not null)=(metric_support->>'spend_value'='supported' and observation_state->>'spend_value'='present')),
 check(add_to_cart is null or (add_to_cart>=0 and add_to_cart::text not in ('NaN','Infinity','-Infinity') and length(add_to_cart::text)<=128)),
 check(metric_support->>'add_to_cart' in ('supported','unsupported','unknown') and observation_state->>'add_to_cart' in ('present','missing','unknown','unsupported')),
 check((add_to_cart is not null)=(metric_support->>'add_to_cart'='supported' and observation_state->>'add_to_cart'='present')),
 check(add_to_cart_value is null or (add_to_cart_value>=0 and add_to_cart_value::text not in ('NaN','Infinity','-Infinity') and length(add_to_cart_value::text)<=128)),
 check(metric_support->>'add_to_cart_value' in ('supported','unsupported','unknown') and observation_state->>'add_to_cart_value' in ('present','missing','unknown','unsupported')),
 check((add_to_cart_value is not null)=(metric_support->>'add_to_cart_value'='supported' and observation_state->>'add_to_cart_value'='present')),
 check(checkout is null or (checkout>=0 and checkout::text not in ('NaN','Infinity','-Infinity') and length(checkout::text)<=128)),
 check(metric_support->>'checkout' in ('supported','unsupported','unknown') and observation_state->>'checkout' in ('present','missing','unknown','unsupported')),
 check((checkout is not null)=(metric_support->>'checkout'='supported' and observation_state->>'checkout'='present')),
 check(checkout_value is null or (checkout_value>=0 and checkout_value::text not in ('NaN','Infinity','-Infinity') and length(checkout_value::text)<=128)),
 check(metric_support->>'checkout_value' in ('supported','unsupported','unknown') and observation_state->>'checkout_value' in ('present','missing','unknown','unsupported')),
 check((checkout_value is not null)=(metric_support->>'checkout_value'='supported' and observation_state->>'checkout_value'='present')),
 check(purchase is null or (purchase>=0 and purchase::text not in ('NaN','Infinity','-Infinity') and length(purchase::text)<=128)),
 check(metric_support->>'purchase' in ('supported','unsupported','unknown') and observation_state->>'purchase' in ('present','missing','unknown','unsupported')),
 check((purchase is not null)=(metric_support->>'purchase'='supported' and observation_state->>'purchase'='present')),
 check(purchase_value is null or (purchase_value>=0 and purchase_value::text not in ('NaN','Infinity','-Infinity') and length(purchase_value::text)<=128)),
 check(metric_support->>'purchase_value' in ('supported','unsupported','unknown') and observation_state->>'purchase_value' in ('present','missing','unknown','unsupported')),
 check((purchase_value is not null)=(metric_support->>'purchase_value'='supported' and observation_state->>'purchase_value'='present'))
);
alter table analytics.pd_facts enable row level security;
alter table analytics.pd_facts force row level security;
create policy owner_only on analytics.pd_facts to adstable_owner using(true) with check(true);
revoke all on analytics.pd_facts from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
revoke all on sequence analytics.pd_facts_id_seq from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create index pd_facts_source on analytics.pd_facts(workspace_id,installation_id,installation_generation,source_batch_id);
create index pd_facts_day on analytics.pd_facts(workspace_id,installation_id,installation_generation,platform,platform_account_id,business_date);
create index pd_facts_expiry on analytics.pd_facts(workspace_id,installation_id,installation_generation,retain_until,id);
create index pd_facts_fx on analytics.pd_facts(fx_rate_id) where fx_rate_id is not null;

create table analytics.cpd_product_performance_facts (
 id bigint generated always as identity primary key not null,
 workspace_id uuid not null,
 installation_id bigint not null,
 installation_generation bigint not null,
 provider_connection_id uuid not null,
 platform text not null,
 platform_account_id text not null,
 canonical_reporting_account_id text,
 business_date date,
 source_timezone text,
 reporting_scope jsonb not null,
 source_identity jsonb not null,
 grain_version text not null,
 native_key_canonical text not null,
 native_key_hash text not null,
 row_schema_version text not null,
 metric_support jsonb not null,
 observation_state jsonb not null,
 extension_schema_version text not null,
 metric_extensions jsonb not null,
 provenance jsonb not null,
 source_batch_id bigint not null,
 source_completeness text not null,
 source_currency text,
 target_currency text,
 fx_rate_id bigint,
 fx_state text not null,
 fx_engine_version text,
 payload_digest text not null,
 revision bigint not null default 1,
 created_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 retention_policy_version text not null,
 retain_until timestamptz not null,
 channel_type text,
 channel_id text,
 channel_resolution text not null,
 root_entity_type text,
 root_entity_id text,
 root_entity_name text,
 parent_entity_type text,
 parent_entity_id text,
 parent_entity_name text,
 campaign_type text,
 native_product_id text,
 product_context jsonb not null,
 product_mapping_id bigint,
 impression numeric,
 click numeric,
 spend_value numeric,
 unique(workspace_id,installation_id,installation_generation,platform,platform_account_id,grain_version,native_key_hash),
 foreign key(workspace_id,installation_id,installation_generation,source_batch_id)
 references evidence.source_batches(workspace_id,installation_id,installation_generation,id) deferrable initially immediate,
 foreign key(fx_rate_id) references analytics.fx_rates(id),
 check(installation_id>0 and installation_generation>0 and revision>0),
 check(platform in ('google_ads','meta','klaviyo')),
 check((platform='klaviyo')=(canonical_reporting_account_id is null)),
 check(platform='klaviyo' or canonical_reporting_account_id=platform_account_id),
 check(grain_version='eo05b-native-grain-v1' and row_schema_version='eo05b-storage-v1'),
 check(native_key_hash ~ '^[a-f0-9]{64}$' and payload_digest ~ '^[a-f0-9]{64}$'),
 check(source_completeness in ('complete','partial')),
 check(isfinite(retain_until) and isfinite(created_at) and isfinite(updated_at) and retain_until>created_at),
 check(business_date is null or isfinite(business_date)),
 check(source_currency is null or source_currency ~ '^[A-Z]{3}$'),
 check(target_currency is null or target_currency ~ '^[A-Z]{3}$'),
 check(fx_state in ('identity','verified','missing','unsupported','conflicting')),
 check((fx_state='verified')=(fx_rate_id is not null)),
 check(fx_state<>'identity' or (source_currency is not null and source_currency=target_currency and fx_rate_id is null)),
 check(length(extension_schema_version) between 1 and 128 and jsonb_typeof(metric_extensions)='object' and octet_length(metric_extensions::text)<=16384),
 check(jsonb_typeof(reporting_scope)='object' and jsonb_typeof(source_identity)='object'),
 check(jsonb_typeof(provenance)='object' and octet_length(provenance::text)<=32768),
 check(jsonb_typeof(metric_support)='object' and jsonb_typeof(observation_state)='object'),
 check(impression is null or (impression>=0 and impression::text not in ('NaN','Infinity','-Infinity') and length(impression::text)<=128)),
 check(metric_support->>'impression' in ('supported','unsupported','unknown') and observation_state->>'impression' in ('present','missing','unknown','unsupported')),
 check((impression is not null)=(metric_support->>'impression'='supported' and observation_state->>'impression'='present')),
 check(click is null or (click>=0 and click::text not in ('NaN','Infinity','-Infinity') and length(click::text)<=128)),
 check(metric_support->>'click' in ('supported','unsupported','unknown') and observation_state->>'click' in ('present','missing','unknown','unsupported')),
 check((click is not null)=(metric_support->>'click'='supported' and observation_state->>'click'='present')),
 check(spend_value is null or (spend_value>=0 and spend_value::text not in ('NaN','Infinity','-Infinity') and length(spend_value::text)<=128)),
 check(metric_support->>'spend_value' in ('supported','unsupported','unknown') and observation_state->>'spend_value' in ('present','missing','unknown','unsupported')),
 check((spend_value is not null)=(metric_support->>'spend_value'='supported' and observation_state->>'spend_value'='present')),
 foreign key(workspace_id,installation_id,installation_generation,product_mapping_id) references identity.product_identity_mappings(workspace_id,installation_id,installation_generation,id) deferrable initially immediate,
 check(channel_resolution in ('verified','unresolved','conflicting','not_applicable')),
 check((channel_resolution='verified' and channel_type is not null and channel_id is not null) or (channel_resolution<>'verified' and channel_type is null and channel_id is null)),
 check(platform<>'klaviyo' and native_product_id is not null and jsonb_typeof(product_context)='object')
);
alter table analytics.cpd_product_performance_facts enable row level security;
alter table analytics.cpd_product_performance_facts force row level security;
create policy owner_only on analytics.cpd_product_performance_facts to adstable_owner using(true) with check(true);
revoke all on analytics.cpd_product_performance_facts from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
revoke all on sequence analytics.cpd_product_performance_facts_id_seq from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create index cpd_product_performance_facts_source on analytics.cpd_product_performance_facts(workspace_id,installation_id,installation_generation,source_batch_id);
create index cpd_product_performance_facts_day on analytics.cpd_product_performance_facts(workspace_id,installation_id,installation_generation,platform,platform_account_id,business_date);
create index cpd_product_performance_facts_expiry on analytics.cpd_product_performance_facts(workspace_id,installation_id,installation_generation,retain_until,id);
create index cpd_product_performance_facts_fx on analytics.cpd_product_performance_facts(fx_rate_id) where fx_rate_id is not null;
create index cpd_product_performance_facts_product_mapping_id_idx on analytics.cpd_product_performance_facts(workspace_id,installation_id,installation_generation,product_mapping_id) where product_mapping_id is not null;

create table analytics.cpd_product_sales_facts (
 id bigint generated always as identity primary key not null,
 workspace_id uuid not null,
 installation_id bigint not null,
 installation_generation bigint not null,
 provider_connection_id uuid not null,
 platform text not null,
 platform_account_id text not null,
 canonical_reporting_account_id text,
 business_date date,
 source_timezone text,
 reporting_scope jsonb not null,
 source_identity jsonb not null,
 grain_version text not null,
 native_key_canonical text not null,
 native_key_hash text not null,
 row_schema_version text not null,
 metric_support jsonb not null,
 observation_state jsonb not null,
 extension_schema_version text not null,
 metric_extensions jsonb not null,
 provenance jsonb not null,
 source_batch_id bigint not null,
 source_completeness text not null,
 source_currency text,
 target_currency text,
 fx_rate_id bigint,
 fx_state text not null,
 fx_engine_version text,
 payload_digest text not null,
 revision bigint not null default 1,
 created_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 retention_policy_version text not null,
 retain_until timestamptz not null,
 channel_type text,
 channel_id text,
 channel_resolution text not null,
 root_entity_type text,
 root_entity_id text,
 root_entity_name text,
 parent_entity_type text,
 parent_entity_id text,
 parent_entity_name text,
 campaign_type text,
 provider_event_id text,
 occurred_at timestamptz,
 native_sold_product_id text,
 native_advertised_product_id text,
 product_context jsonb not null,
 sold_product_mapping_id bigint,
 advertised_product_mapping_id bigint,
 sales_quantity numeric,
 sales_value numeric,
 sales_role text not null,
 sales_role_evidence jsonb not null,
 native_sales_metrics jsonb not null,
 unique(workspace_id,installation_id,installation_generation,platform,platform_account_id,grain_version,native_key_hash),
 foreign key(workspace_id,installation_id,installation_generation,source_batch_id)
 references evidence.source_batches(workspace_id,installation_id,installation_generation,id) deferrable initially immediate,
 foreign key(fx_rate_id) references analytics.fx_rates(id),
 check(installation_id>0 and installation_generation>0 and revision>0),
 check(platform in ('google_ads','meta','klaviyo')),
 check((platform='klaviyo')=(canonical_reporting_account_id is null)),
 check(platform='klaviyo' or canonical_reporting_account_id=platform_account_id),
 check(grain_version='eo05b-native-grain-v1' and row_schema_version='eo05b-storage-v1'),
 check(native_key_hash ~ '^[a-f0-9]{64}$' and payload_digest ~ '^[a-f0-9]{64}$'),
 check(source_completeness in ('complete','partial')),
 check(isfinite(retain_until) and isfinite(created_at) and isfinite(updated_at) and retain_until>created_at),
 check(business_date is null or isfinite(business_date)),
 check(source_currency is null or source_currency ~ '^[A-Z]{3}$'),
 check(target_currency is null or target_currency ~ '^[A-Z]{3}$'),
 check(fx_state in ('identity','verified','missing','unsupported','conflicting')),
 check((fx_state='verified')=(fx_rate_id is not null)),
 check(fx_state<>'identity' or (source_currency is not null and source_currency=target_currency and fx_rate_id is null)),
 check(length(extension_schema_version) between 1 and 128 and jsonb_typeof(metric_extensions)='object' and octet_length(metric_extensions::text)<=16384),
 check(jsonb_typeof(reporting_scope)='object' and jsonb_typeof(source_identity)='object'),
 check(jsonb_typeof(provenance)='object' and octet_length(provenance::text)<=32768),
 check(jsonb_typeof(metric_support)='object' and jsonb_typeof(observation_state)='object'),
 check(sales_quantity is null or (sales_quantity>=0 and sales_quantity::text not in ('NaN','Infinity','-Infinity') and length(sales_quantity::text)<=128)),
 check(metric_support->>'sales_quantity' in ('supported','unsupported','unknown') and observation_state->>'sales_quantity' in ('present','missing','unknown','unsupported')),
 check((sales_quantity is not null)=(metric_support->>'sales_quantity'='supported' and observation_state->>'sales_quantity'='present')),
 check(sales_value is null or (sales_value>=0 and sales_value::text not in ('NaN','Infinity','-Infinity') and length(sales_value::text)<=128)),
 check(metric_support->>'sales_value' in ('supported','unsupported','unknown') and observation_state->>'sales_value' in ('present','missing','unknown','unsupported')),
 check((sales_value is not null)=(metric_support->>'sales_value'='supported' and observation_state->>'sales_value'='present')),
 foreign key(workspace_id,installation_id,installation_generation,sold_product_mapping_id) references identity.product_identity_mappings(workspace_id,installation_id,installation_generation,id) deferrable initially immediate,
 foreign key(workspace_id,installation_id,installation_generation,advertised_product_mapping_id) references identity.product_identity_mappings(workspace_id,installation_id,installation_generation,id) deferrable initially immediate,
 check(channel_resolution in ('verified','unresolved','conflicting','not_applicable')),
 check((channel_resolution='verified' and channel_type is not null and channel_id is not null) or (channel_resolution<>'verified' and channel_type is null and channel_id is null)),
 check(sales_role in ('Advertised','Cross-sell','Assisted','Triggered','Unclassified')),
 check(jsonb_typeof(sales_role_evidence)='object' and jsonb_typeof(native_sales_metrics)='object' and jsonb_typeof(product_context)='object'),
 check(sales_role='Unclassified' or sales_role_evidence<>'{}'::jsonb),
 check(occurred_at is null or isfinite(occurred_at))
);
alter table analytics.cpd_product_sales_facts enable row level security;
alter table analytics.cpd_product_sales_facts force row level security;
create policy owner_only on analytics.cpd_product_sales_facts to adstable_owner using(true) with check(true);
revoke all on analytics.cpd_product_sales_facts from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
revoke all on sequence analytics.cpd_product_sales_facts_id_seq from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create index cpd_product_sales_facts_source on analytics.cpd_product_sales_facts(workspace_id,installation_id,installation_generation,source_batch_id);
create index cpd_product_sales_facts_day on analytics.cpd_product_sales_facts(workspace_id,installation_id,installation_generation,platform,platform_account_id,business_date);
create index cpd_product_sales_facts_expiry on analytics.cpd_product_sales_facts(workspace_id,installation_id,installation_generation,retain_until,id);
create index cpd_product_sales_facts_fx on analytics.cpd_product_sales_facts(fx_rate_id) where fx_rate_id is not null;
create index cpd_product_sales_facts_sold_product_mapping_id_idx on analytics.cpd_product_sales_facts(workspace_id,installation_id,installation_generation,sold_product_mapping_id) where sold_product_mapping_id is not null;
create index cpd_product_sales_facts_advertised_product_mapping_id_idx on analytics.cpd_product_sales_facts(workspace_id,installation_id,installation_generation,advertised_product_mapping_id) where advertised_product_mapping_id is not null;

-- Deterministic JSON for the private DTO (decimal values travel as strings).
-- Keys are ASCII schema keys; values keep their exact Unicode text.
create function analytics.dataset_json(p jsonb,depth integer default 0) returns text
language plpgsql immutable set search_path='' as $fn$
declare result text; k text; v jsonb; pieces text[]:='{}';
begin
 if depth>32 then raise exception 'DATASET_JSON_BOUNDS';end if;
 if jsonb_typeof(p)='object' then
  for k,v in select key,value from jsonb_each(p) order by key collate "C" loop
   if length(k) not between 1 and 512 or k !~ '^[ -~]+$' or k ~* 'token|secret|password|authorization|cookie|email|phone|address|customer|profile|__proto__|constructor|prototype'
   then raise exception 'DATASET_PRIVATE_FIELD';end if;
   pieces:=pieces||(to_jsonb(k)::text||':'||analytics.dataset_json(v,depth+1));
  end loop;
  result:='{'||array_to_string(pieces,',')||'}';
 elsif jsonb_typeof(p)='array' then
  for v in select value from jsonb_array_elements(p) loop pieces:=pieces||analytics.dataset_json(v,depth+1);end loop;
  result:='['||array_to_string(pieces,',')||']';
 else result:=p::text;end if;
 if octet_length(result)>1048576 then raise exception 'DATASET_JSON_BOUNDS';end if;
 return result;
end $fn$;

create function analytics.dataset_digest(p jsonb) returns text
language sql immutable set search_path='' as $fn$
 select encode(sha256(convert_to(analytics.dataset_json(p),'UTF8')),'hex')
$fn$;

create function analytics.assert_dataset_source(o jsonb,ref jsonb) returns void
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype; p evidence.source_pages%rowtype;
begin
 if jsonb_typeof(ref) is distinct from 'object' or (select count(*) from jsonb_object_keys(ref))<>5
 or not ref ?& array['batch_id','commit_id','request_digest','page_id','payload_hash'] then raise exception 'DATASET_SOURCE_INVALID';end if;
 select * into b from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
 and installation_generation=(o->>'generation')::bigint and id=(ref->>'batch_id')::bigint for share;
 if not found or b.authority is distinct from o or b.primary_source is distinct from o->>'provider'
 or b.storage_state<>'committed' or b.source_state not in ('complete','partial') or b.retain_until<=clock_timestamp()
 or b.commit_id::text is distinct from ref->>'commit_id' or b.request_digest is distinct from ref->>'request_digest'
 then raise exception 'DATASET_SOURCE_NOT_CURRENT';end if;
 select * into p from evidence.source_pages where workspace_id=b.workspace_id and installation_id=b.installation_id
 and installation_generation=b.installation_generation and batch_id=b.id and id=(ref->>'page_id')::bigint for share;
 if not found or p.payload_hash is distinct from ref->>'payload_hash' or p.purged_at is not null or p.retain_until<=clock_timestamp()
 then raise exception 'DATASET_PAGE_NOT_CURRENT';end if;
end $fn$;

create function analytics.validate_dataset_fact() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare j jsonb:=to_jsonb(new); b evidence.source_batches%rowtype; o jsonb; ref jsonb; m identity.product_identity_mappings%rowtype;
 f analytics.fx_rates%rowtype; k text; keys text[]; expected jsonb; identity_kind text; native jsonb; all_complete boolean:=true;
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
 or (select count(*) from jsonb_object_keys(new.provenance))<>2
 or not new.provenance ?& array['projection_version','sources'] or coalesce(new.provenance->>'projection_version','')=''
 then raise exception 'DATASET_PROVENANCE_INVALID';end if;
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

create trigger pd_validate before insert or update on analytics.pd_facts for each row execute function analytics.validate_dataset_fact();
create trigger performance_validate before insert or update on analytics.cpd_product_performance_facts for each row execute function analytics.validate_dataset_fact();
create trigger sales_validate before insert or update on analytics.cpd_product_sales_facts for each row execute function analytics.validate_dataset_fact();

create function analytics.inspect_dataset_storage(o jsonb,p_batch bigint,p_operation uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype; receipt jsonb; item jsonb; fact jsonb; ref jsonb; name text;
begin
 perform evidence.assert_source_owner(o);
 select * into b from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
 and installation_generation=(o->>'generation')::bigint and id=p_batch for share;
 if not found or b.authority is distinct from o or b.storage_state<>'committed' or b.retain_until<=clock_timestamp() then raise exception 'DATASET_SOURCE_NOT_CURRENT';end if;
 receipt:=b.manifest->'datasetStorageReceipts'->p_operation::text;
 if receipt is null then return null;end if;
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

create function analytics.commit_dataset_storage(o jsonb,p jsonb) returns jsonb
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

-- FX evidence is immutable. No FX provider or fallback policy is activated.
create function analytics.reject_fx_mutation() returns trigger
language plpgsql set search_path='' as $fn$
begin raise exception 'DATASET_FX_IMMUTABLE';end $fn$;
create trigger fx_immutable before update on analytics.fx_rates for each row execute function analytics.reject_fx_mutation();

-- Existing privacy worker calls this before evidence is removed. No cascade and
-- no customer identity/content is added to these tables.
create function analytics.erase_dataset_batches(w uuid,i bigint,g bigint,bids bigint[]) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare name text; n bigint; result jsonb:='{}'; remaining boolean;
begin
 foreach name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
  execute format('delete from analytics.%I f where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and ($4 is null or f.source_batch_id=any($4) or exists(select 1 from jsonb_array_elements(f.provenance->''sources'') r where (r->>''batch_id'')::bigint=any($4)))',name) using w,i,g,bids;
  get diagnostics n=row_count;
  execute format('select exists(select 1 from analytics.%I f where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and ($4 is null or f.source_batch_id=any($4) or exists(select 1 from jsonb_array_elements(f.provenance->''sources'') r where (r->>''batch_id'')::bigint=any($4))))',name) into remaining using w,i,g,bids;
  if remaining then raise exception 'DATASET_ERASURE_INCOMPLETE';end if;
  result:=result||jsonb_build_object('analytics.'||name,n);
 end loop;
 return result;
end $fn$;

create function analytics.guard_dataset_evidence() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare name text; referenced boolean; bid bigint;
begin
 if tg_table_name='source_batches' then
  if tg_op='UPDATE' and new.storage_state=old.storage_state then return new;end if;
  bid:=old.id;
 else
  if tg_op='UPDATE' and new.payload_hash=old.payload_hash and new.purged_at is not distinct from old.purged_at then return new;end if;
  bid:=old.batch_id;
 end if;
 foreach name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
  execute format('select exists(select 1 from analytics.%I f where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and (source_batch_id=$4 or exists(select 1 from jsonb_array_elements(f.provenance->''sources'') r where (r->>''batch_id'')::bigint=$4)))',name)
   into referenced using old.workspace_id,old.installation_id,old.installation_generation,bid;
  if referenced then raise exception 'DATASET_EVIDENCE_PINNED';end if;
 end loop;
 if tg_op='DELETE' then return old;else return new;end if;
end $fn$;
create trigger dataset_batch_pin before delete or update of storage_state on evidence.source_batches for each row execute function analytics.guard_dataset_evidence();
create trigger dataset_page_pin before delete or update of payload_hash,purged_at on evidence.source_pages for each row execute function analytics.guard_dataset_evidence();

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
 set constraints all immediate;
 return result;
end $fn$;


create or replace function privacy.complete_customer_source_run(p_run uuid,p_digest text,p_changes jsonb,p_disclosure text default null) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare r privacy.deletion_runs%rowtype; snap jsonb; i bigint; requested jsonb; order_ids bigint[]; claim_ids bigint[]; ref_ids bigint[]; page_ids bigint[]; line_ids bigint[]; journey_ids bigint[]; item jsonb; c jsonb; mid uuid; matched integer; no_data boolean; outcome text; dataset_counts jsonb:='{}';
begin
 perform 1 from operations.refresh_control where singleton for update;
 select * into strict r from privacy.deletion_runs where id=p_run for update;
 perform 1 from shopify.installations where workspace_id=r.workspace_id and install_generation=r.install_generation for update;
 if r.status='completed' then raise exception 'SOURCE_PRIVACY_ALREADY_COMPLETED';end if;
 snap:=privacy.customer_source_snapshot(p_run);
 if snap->>'digest' is distinct from p_digest then raise exception 'SOURCE_PRIVACY_SNAPSHOT_CHANGED';end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or not p_changes ?& array['pages','removedReferences','matchedSourceRecords'] or (select count(*) from jsonb_object_keys(p_changes))<>3
 or jsonb_typeof(p_changes->'matchedSourceRecords') is distinct from 'number' or (p_changes->>'matchedSourceRecords') !~ '^(0|[1-9][0-9]{0,5})$' then raise exception 'SOURCE_PRIVACY_PLAN_INVALID';end if;
 i:=(snap->>'installationId')::bigint;requested:=snap->'scope'->'orders';
 select coalesce(array_agg(id),'{}') into order_ids from source.shopify_order_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and requested ? order_id;
 select coalesce(array_agg(id),'{}') into line_ids from source.shopify_line_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and order_version_id=any(order_ids);
 select coalesce(array_agg(id),'{}') into journey_ids from source.shopify_journey_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and order_version_id=any(order_ids);
 select coalesce(array_agg(id),'{}') into claim_ids from source.provider_claim_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and
 ((order_link_state='verified' and shopify_order_version_id=any(order_ids)) or requested ? native_order_reference);
 select coalesce(array_agg(value::bigint),'{}') into ref_ids from jsonb_array_elements_text(p_changes->'removedReferences');
 select coalesce(array_agg((value->>'id')::bigint),'{}') into page_ids from jsonb_array_elements(p_changes->'pages');
 if cardinality(ref_ids)>5000 or cardinality(page_ids)>1000
 or exists(select 1 from unnest(ref_ids) x where not exists(select 1 from evidence.source_references t where t.id=x and t.installation_id=i and t.page_id=any(page_ids)))
 or exists(select 1 from evidence.source_reference_links l where l.workspace_id=r.workspace_id and l.installation_generation=r.install_generation and l.installation_id=i and l.source_reference_id=any(ref_ids) and
 (l.source_rule_version_id is not null or (l.order_version_id is not null and not l.order_version_id=any(order_ids)) or (l.line_version_id is not null and not l.line_version_id=any(line_ids))
 or (l.journey_version_id is not null and not l.journey_version_id=any(journey_ids)) or (l.claim_version_id is not null and not l.claim_version_id=any(claim_ids))))
 then raise exception 'SOURCE_PRIVACY_CROSS_SUBJECT_DEPENDENCY';end if;
 matched:=(p_changes->>'matchedSourceRecords')::integer;
 no_data:=cardinality(order_ids)=0 and cardinality(line_ids)=0 and cardinality(journey_ids)=0 and cardinality(claim_ids)=0 and cardinality(ref_ids)=0 and cardinality(page_ids)=0 and matched=0;
 if no_data and p_disclosure is not null then raise exception 'SOURCE_PRIVACY_PLAN_INVALID';end if;
 if r.kind='customer_data_request' then
  if not no_data and (p_disclosure is null or p_disclosure !~ '^[a-f0-9]{64}$') then raise exception 'SOURCE_PRIVACY_DISCLOSURE_RECEIPT_REQUIRED';end if;
  c:=jsonb_build_object('orderVersions',cardinality(order_ids),'lineVersions',cardinality(line_ids),'journeyVersions',cardinality(journey_ids),'claimVersions',cardinality(claim_ids),'sourceRecords',cardinality(ref_ids),'rawSourceRecords',matched);
 else
  if p_disclosure is not null then raise exception 'SOURCE_PRIVACY_PLAN_INVALID';end if;
  select analytics.erase_dataset_batches(r.workspace_id,i,r.install_generation,coalesce(array_agg(distinct batch_id),'{}')) into dataset_counts from evidence.source_pages where id=any(page_ids) and installation_id=i;
  -- The trusted bounded decrypt/projector supplies only re-sealed affected pages.
  for item in select value from jsonb_array_elements(p_changes->'pages') loop
   update evidence.source_pages set payload_hash=item->>'payloadHash',ciphertext=decode(item->>'ciphertext','hex'),nonce=decode(item->>'nonce','hex'),auth_tag=decode(item->>'authTag','hex'),key_version=(item->>'keyVersion')::smallint,
    plain_byte_count=(item->>'plainBytes')::integer,field_coverage=item->'fieldCoverage',sanitizer_version=item->>'sanitizerVersion'
   where id=(item->>'id')::bigint and installation_id=i and payload_hash=item->>'previousHash' and purged_at is null;
   if not found then raise exception 'SOURCE_PRIVACY_PAGE_CHANGED';end if;
  end loop;
  update identity.product_identity_mappings set mapping_state='unresolved',verified_at=null,applicability=jsonb_build_object('state','privacy_proof_removed')
   where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id in(select mapping_id from evidence.source_reference_links where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and source_reference_id=any(ref_ids));
  delete from evidence.source_reference_links where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and (source_reference_id=any(ref_ids) or order_version_id=any(order_ids) or line_version_id=any(line_ids) or journey_version_id=any(journey_ids) or claim_version_id=any(claim_ids));
  delete from source.provider_claim_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id=any(claim_ids);
  delete from source.shopify_journey_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id=any(journey_ids);
  delete from source.shopify_line_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id=any(line_ids);
  delete from source.shopify_order_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id=any(order_ids);
  delete from evidence.source_references where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id=any(ref_ids);
  update evidence.source_batches set storage_state='invalidated',commit_id=null,committed_at=null,
   manifest=manifest||jsonb_build_object('privacyRedacted',true) where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id in(select batch_id from evidence.source_pages where id=any(page_ids));
  c:=jsonb_build_object('orderVersions',cardinality(order_ids),'lineVersions',cardinality(line_ids),'journeyVersions',cardinality(journey_ids),'claimVersions',cardinality(claim_ids),'sourceRecords',cardinality(ref_ids),'rawSourceRecords',matched,'pagesRewritten',cardinality(page_ids),'datasetFacts',dataset_counts);
 end if;
 outcome:=case when no_data then 'no_customer_data' when r.kind='customer_redact' then 'deleted' else 'disclosed' end;
 insert into privacy.deletion_manifests(deletion_run_id,workspace_id,install_generation,shop_identity_sha256,kind,deleted_families,retained_families,row_counts,result,completed_at)
 values(r.id,r.workspace_id,r.install_generation,r.shop_identity_sha256,r.kind,
 case when r.kind='customer_redact' then array['customer_scoped_source_records','customer_scoped_dataset_dependencies'] else '{}'::text[] end,
 array['unrelated_source_records'],c,outcome,clock_timestamp()) returning id into mid;
 update privacy.deletion_runs set status='completed',completed_at=clock_timestamp(),last_error_code=null,
  source_customer_receipt=jsonb_build_object('manifestId',mid,'result',outcome,'digest',p_digest,'disclosureReceipt',p_disclosure,'counts',c,
   'redactedOrderHashes',case when r.kind='customer_redact' then
    (select coalesce(jsonb_agg(evidence.source_hash(value) order by value),'[]') from jsonb_array_elements(requested)) else '[]'::jsonb end)
  where id=p_run;
 update privacy.webhook_claims set source_request_scope=null where id=r.claim_id;
 return jsonb_build_object('status','completed','result',outcome,'manifestId',mid,'counts',c);
end $fn$;



create function analytics.record_dataset_fx(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare f analytics.fx_rates%rowtype;
begin
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

do $acl$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='analytics' and (p.proname like '%dataset%' or p.proname='reject_fx_mutation') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator',f.signature);
 end loop;
end $acl$;
commit;
