begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Prepared owner-only source landing store; no application activation or keys.
create schema evidence authorization adstable_owner;
create schema identity authorization adstable_owner;
create schema source authorization adstable_owner;
revoke all on schema evidence,identity,source from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
set local role adstable_owner;
create table evidence.source_batches(
 id bigint generated always as identity primary key, workspace_id uuid not null references app.workspaces(id) on delete restrict, installation_id bigint not null references shopify.installations(id) on delete restrict, installation_generation bigint not null check(installation_generation>0), shop_id text not null check(shop_id ~ '^gid://shopify/Shop/[1-9][0-9]*$'), recorded_at timestamptz not null default statement_timestamp(), retention_class text not null check(retention_class in ('metadata','raw','identity','order','claim')), retain_until timestamptz not null check(isfinite(retain_until)), unique(workspace_id,installation_id,installation_generation,id),
 attempt_id uuid not null,batch_ordinal integer not null check(batch_ordinal>=0),primary_source text not null check(primary_source in ('shopify','google_ads','meta','klaviyo')),authority jsonb not null check(jsonb_typeof(authority)='object'),source_state text not null check(source_state in ('complete','partial','failed')),storage_state text not null check(storage_state in ('staged','committed','invalidated')),request_digest text not null check(request_digest ~ '^[0-9a-f]{64}$'),manifest jsonb not null check(jsonb_typeof(manifest)='object'),commit_id uuid,committed_at timestamptz,handoff_state text not null default 'pending' check(handoff_state in ('pending','consumed')),handoff_receipt text check(handoff_receipt is null or handoff_receipt ~ '^[0-9a-f]{64}$'),check((handoff_state='consumed')=(handoff_receipt is not null)),check((storage_state='committed')=(commit_id is not null and committed_at is not null)),unique(workspace_id,installation_id,installation_generation,attempt_id,batch_ordinal)
);
create index source_batches_lookup_0 on evidence.source_batches(workspace_id,installation_id,installation_generation,recorded_at);
create index source_batches_lookup_1 on evidence.source_batches(retain_until);
create table evidence.source_pages(
 id bigint generated always as identity primary key, workspace_id uuid not null references app.workspaces(id) on delete restrict, installation_id bigint not null references shopify.installations(id) on delete restrict, installation_generation bigint not null check(installation_generation>0), shop_id text not null check(shop_id ~ '^gid://shopify/Shop/[1-9][0-9]*$'), recorded_at timestamptz not null default statement_timestamp(), retention_class text not null check(retention_class in ('metadata','raw','identity','order','claim')), retain_until timestamptz not null check(isfinite(retain_until)), unique(workspace_id,installation_id,installation_generation,id),
 batch_id bigint not null,family text not null check(family ~ '^[a-z][a-z0-9_:.-]{0,127}$'),page_ordinal integer not null check(page_ordinal>=0),origin text not null check(origin in ('shopify','google_ads','meta','klaviyo')),capture_layer text not null check(capture_layer in ('native_response_projection','collector_projection')),numeric_fidelity text not null check(numeric_fidelity in ('exact_source_string','lossless_token','decoded_only')),field_coverage jsonb not null check(jsonb_typeof(field_coverage)='array'),payload_schema_version text not null,sanitizer_version text not null,payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),ciphertext bytea,nonce bytea,auth_tag bytea,key_version integer not null check(key_version between 1 and 32767),plain_byte_count integer not null check(plain_byte_count between 1 and 8388608),purged_at timestamptz,purge_reason text,check((purged_at is null and ciphertext is not null and nonce is not null and auth_tag is not null and octet_length(ciphertext)>0 and octet_length(nonce)=12 and octet_length(auth_tag)=16) or (purged_at is not null and ciphertext is null and nonce is null and auth_tag is null and purge_reason='expired_unreferenced')),foreign key(workspace_id,installation_id,installation_generation,batch_id) references evidence.source_batches(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,unique(workspace_id,installation_id,installation_generation,batch_id,family,page_ordinal)
);
create index source_pages_lookup_0 on evidence.source_pages(workspace_id,installation_id,installation_generation,batch_id);
create index source_pages_lookup_1 on evidence.source_pages(retain_until);
create table evidence.source_references(
 id bigint generated always as identity primary key, workspace_id uuid not null references app.workspaces(id) on delete restrict, installation_id bigint not null references shopify.installations(id) on delete restrict, installation_generation bigint not null check(installation_generation>0), shop_id text not null check(shop_id ~ '^gid://shopify/Shop/[1-9][0-9]*$'), recorded_at timestamptz not null default statement_timestamp(), retention_class text not null check(retention_class in ('metadata','raw','identity','order','claim')), retain_until timestamptz not null check(isfinite(retain_until)), unique(workspace_id,installation_id,installation_generation,id),
 page_id bigint not null,locator_kind text not null check(locator_kind in ('row','object','collection')),record_locator text not null check(length(record_locator) between 1 and 512),native_record_type text not null check(length(native_record_type) between 1 and 128),native_record_id text check(native_record_id is null or length(native_record_id) between 1 and 1024),record_hash text not null check(record_hash ~ '^[0-9a-f]{64}$'),observation_state text not null check(observation_state in ('present','absent','unknown','conflicting','partial')),foreign key(workspace_id,installation_id,installation_generation,page_id) references evidence.source_pages(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,unique(workspace_id,installation_id,installation_generation,page_id,locator_kind,record_locator)
);
create index source_references_lookup_0 on evidence.source_references(workspace_id,installation_id,installation_generation,page_id);
create table identity.source_rule_versions(
 id bigint generated always as identity primary key, workspace_id uuid not null references app.workspaces(id) on delete restrict, installation_id bigint not null references shopify.installations(id) on delete restrict, installation_generation bigint not null check(installation_generation>0), shop_id text not null check(shop_id ~ '^gid://shopify/Shop/[1-9][0-9]*$'), recorded_at timestamptz not null default statement_timestamp(), retention_class text not null check(retention_class in ('metadata','raw','identity','order','claim')), retain_until timestamptz not null check(isfinite(retain_until)), unique(workspace_id,installation_id,installation_generation,id),
 accepted_batch_id bigint not null,rule_key text not null check(length(rule_key) between 1 and 512),version bigint not null check(version>0),supersedes_id bigint,rule_kind text not null,native_context jsonb not null,parser_version text not null,review_status text not null check(review_status in ('reviewed','withdrawn','conflicting')),documented_basis jsonb not null,applicability jsonb not null,foreign key(workspace_id,installation_id,installation_generation,accepted_batch_id) references evidence.source_batches(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,supersedes_id) references identity.source_rule_versions(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,unique(workspace_id,installation_id,installation_generation,rule_key,version)
);
create index source_rule_versions_lookup_0 on identity.source_rule_versions(workspace_id,installation_id,installation_generation,accepted_batch_id);
create index source_rule_versions_lookup_1 on identity.source_rule_versions(workspace_id,installation_id,installation_generation,supersedes_id);
create table identity.product_identity_mappings(
 id bigint generated always as identity primary key, workspace_id uuid not null references app.workspaces(id) on delete restrict, installation_id bigint not null references shopify.installations(id) on delete restrict, installation_generation bigint not null check(installation_generation>0), shop_id text not null check(shop_id ~ '^gid://shopify/Shop/[1-9][0-9]*$'), recorded_at timestamptz not null default statement_timestamp(), retention_class text not null check(retention_class in ('metadata','raw','identity','order','claim')), retain_until timestamptz not null check(isfinite(retain_until)), unique(workspace_id,installation_id,installation_generation,id),
 accepted_batch_id bigint not null,source_rule_version_id bigint,supersedes_id bigint,identity_key_version text not null,identity_key_canonical text not null,identity_hash text not null check(identity_hash ~ '^[0-9a-f]{64}$'),revision bigint not null check(revision>0),native_product_id text not null check(length(native_product_id) between 1 and 1024),native_context jsonb not null,shopify_product_id text,shopify_variant_id text,mapping_state text not null check(mapping_state in ('verified','unresolved','conflicting','withdrawn')),verified_at timestamptz,applicability jsonb not null,check(shopify_product_id is null or shopify_product_id ~ '^gid://shopify/Product/[1-9][0-9]*$'),check(shopify_variant_id is null or shopify_variant_id ~ '^gid://shopify/ProductVariant/[1-9][0-9]*$'),check(mapping_state<>'verified' or (shopify_product_id is not null and verified_at is not null and source_rule_version_id is not null)),foreign key(workspace_id,installation_id,installation_generation,accepted_batch_id) references evidence.source_batches(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,source_rule_version_id) references identity.source_rule_versions(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,supersedes_id) references identity.product_identity_mappings(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,unique(workspace_id,installation_id,installation_generation,identity_hash,revision)
);
create index product_identity_mappings_lookup_0 on identity.product_identity_mappings(workspace_id,installation_id,installation_generation,accepted_batch_id);
create index product_identity_mappings_lookup_1 on identity.product_identity_mappings(workspace_id,installation_id,installation_generation,source_rule_version_id);
create index product_identity_mappings_lookup_2 on identity.product_identity_mappings(workspace_id,installation_id,installation_generation,supersedes_id);
create index product_identity_mappings_lookup_3 on identity.product_identity_mappings(workspace_id,shopify_product_id);
create table source.shopify_order_versions(
 id bigint generated always as identity primary key, workspace_id uuid not null references app.workspaces(id) on delete restrict, installation_id bigint not null references shopify.installations(id) on delete restrict, installation_generation bigint not null check(installation_generation>0), shop_id text not null check(shop_id ~ '^gid://shopify/Shop/[1-9][0-9]*$'), recorded_at timestamptz not null default statement_timestamp(), retention_class text not null check(retention_class in ('metadata','raw','identity','order','claim')), retain_until timestamptz not null check(isfinite(retain_until)), unique(workspace_id,installation_id,installation_generation,id),
 source_batch_id bigint not null,source_reference_id bigint not null,order_id text not null check(order_id ~ '^gid://shopify/Order/[1-9][0-9]*$'),order_updated_at timestamptz not null check(isfinite(order_updated_at)),observation_hash text not null check(observation_hash ~ '^[0-9a-f]{64}$'),native_data jsonb not null check(jsonb_typeof(native_data)='object'),foreign key(workspace_id,installation_id,installation_generation,source_batch_id) references evidence.source_batches(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,source_reference_id) references evidence.source_references(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,unique(workspace_id,installation_id,installation_generation,order_id,order_updated_at)
);
create index shopify_order_versions_lookup_0 on source.shopify_order_versions(workspace_id,installation_id,installation_generation,source_batch_id);
create index shopify_order_versions_lookup_1 on source.shopify_order_versions(workspace_id,installation_id,installation_generation,source_reference_id);
create table source.shopify_line_versions(
 id bigint generated always as identity primary key, workspace_id uuid not null references app.workspaces(id) on delete restrict, installation_id bigint not null references shopify.installations(id) on delete restrict, installation_generation bigint not null check(installation_generation>0), shop_id text not null check(shop_id ~ '^gid://shopify/Shop/[1-9][0-9]*$'), recorded_at timestamptz not null default statement_timestamp(), retention_class text not null check(retention_class in ('metadata','raw','identity','order','claim')), retain_until timestamptz not null check(isfinite(retain_until)), unique(workspace_id,installation_id,installation_generation,id),
 order_version_id bigint not null,source_reference_id bigint not null,line_item_id text not null check(line_item_id ~ '^gid://shopify/LineItem/[1-9][0-9]*$'),observation_hash text not null,native_data jsonb not null check(jsonb_typeof(native_data)='object'),foreign key(workspace_id,installation_id,installation_generation,order_version_id) references source.shopify_order_versions(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,source_reference_id) references evidence.source_references(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,unique(workspace_id,installation_id,installation_generation,order_version_id,line_item_id)
);
create index shopify_line_versions_lookup_0 on source.shopify_line_versions(workspace_id,installation_id,installation_generation,order_version_id);
create index shopify_line_versions_lookup_1 on source.shopify_line_versions(workspace_id,installation_id,installation_generation,source_reference_id);
create table source.shopify_journey_versions(
 id bigint generated always as identity primary key, workspace_id uuid not null references app.workspaces(id) on delete restrict, installation_id bigint not null references shopify.installations(id) on delete restrict, installation_generation bigint not null check(installation_generation>0), shop_id text not null check(shop_id ~ '^gid://shopify/Shop/[1-9][0-9]*$'), recorded_at timestamptz not null default statement_timestamp(), retention_class text not null check(retention_class in ('metadata','raw','identity','order','claim')), retain_until timestamptz not null check(isfinite(retain_until)), unique(workspace_id,installation_id,installation_generation,id),
 order_version_id bigint not null,source_batch_id bigint not null,part_kind text not null check(part_kind in ('summary','moments')),part_ordinal integer not null check(part_ordinal>=0),journey_state text not null check(journey_state in ('ready','pending','unavailable','partial','unknown')),ready boolean,moments_complete boolean not null,payload_projection jsonb not null,observation_hash text not null,foreign key(workspace_id,installation_id,installation_generation,order_version_id) references source.shopify_order_versions(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,source_batch_id) references evidence.source_batches(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,unique(workspace_id,installation_id,installation_generation,order_version_id,source_batch_id,part_kind,part_ordinal)
);
create index shopify_journey_versions_lookup_0 on source.shopify_journey_versions(workspace_id,installation_id,installation_generation,order_version_id);
create index shopify_journey_versions_lookup_1 on source.shopify_journey_versions(workspace_id,installation_id,installation_generation,source_batch_id);
create table source.provider_claim_versions(
 id bigint generated always as identity primary key, workspace_id uuid not null references app.workspaces(id) on delete restrict, installation_id bigint not null references shopify.installations(id) on delete restrict, installation_generation bigint not null check(installation_generation>0), shop_id text not null check(shop_id ~ '^gid://shopify/Shop/[1-9][0-9]*$'), recorded_at timestamptz not null default statement_timestamp(), retention_class text not null check(retention_class in ('metadata','raw','identity','order','claim')), retain_until timestamptz not null check(isfinite(retain_until)), unique(workspace_id,installation_id,installation_generation,id),
 source_reference_id bigint not null,provider text not null check(provider in ('google_ads','meta','klaviyo')),account_id text not null,claim_identity_key text not null check(length(claim_identity_key) between 1 and 512),native_event_or_claim_id text not null,native_order_reference text,shopify_order_version_id bigint,order_link_state text not null check(order_link_state in ('unlinked','verified','conflicting')),native_data jsonb not null,observation_hash text not null,supersedes_id bigint,check(order_link_state<>'verified' or shopify_order_version_id is not null),foreign key(workspace_id,installation_id,installation_generation,source_reference_id) references evidence.source_references(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,shopify_order_version_id) references source.shopify_order_versions(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,supersedes_id) references source.provider_claim_versions(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,unique(workspace_id,installation_id,installation_generation,provider,account_id,claim_identity_key,observation_hash)
);
create index provider_claim_versions_lookup_0 on source.provider_claim_versions(workspace_id,installation_id,installation_generation,source_reference_id);
create index provider_claim_versions_lookup_1 on source.provider_claim_versions(workspace_id,installation_id,installation_generation,shopify_order_version_id);
create index provider_claim_versions_lookup_2 on source.provider_claim_versions(workspace_id,installation_id,installation_generation,supersedes_id);
create table evidence.source_reference_links(
 id bigint generated always as identity primary key, workspace_id uuid not null references app.workspaces(id) on delete restrict, installation_id bigint not null references shopify.installations(id) on delete restrict, installation_generation bigint not null check(installation_generation>0), shop_id text not null check(shop_id ~ '^gid://shopify/Shop/[1-9][0-9]*$'), recorded_at timestamptz not null default statement_timestamp(), retention_class text not null check(retention_class in ('metadata','raw','identity','order','claim')), retain_until timestamptz not null check(isfinite(retain_until)), unique(workspace_id,installation_id,installation_generation,id),
 source_reference_id bigint not null,role text not null check(length(role) between 1 and 128),source_rule_version_id bigint,mapping_id bigint,order_version_id bigint,line_version_id bigint,journey_version_id bigint,claim_version_id bigint,check(num_nonnulls(source_rule_version_id,mapping_id,order_version_id,line_version_id,journey_version_id,claim_version_id)=1),foreign key(workspace_id,installation_id,installation_generation,source_reference_id) references evidence.source_references(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,source_rule_version_id) references identity.source_rule_versions(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,mapping_id) references identity.product_identity_mappings(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,order_version_id) references source.shopify_order_versions(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,line_version_id) references source.shopify_line_versions(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,journey_version_id) references source.shopify_journey_versions(workspace_id,installation_id,installation_generation,id) deferrable initially deferred,foreign key(workspace_id,installation_id,installation_generation,claim_version_id) references source.provider_claim_versions(workspace_id,installation_id,installation_generation,id) deferrable initially deferred
);
create index source_reference_links_lookup_0 on evidence.source_reference_links(workspace_id,installation_id,installation_generation,source_reference_id);
create index source_reference_links_lookup_1 on evidence.source_reference_links(workspace_id,installation_id,installation_generation,source_rule_version_id);
create index source_reference_links_lookup_2 on evidence.source_reference_links(workspace_id,installation_id,installation_generation,mapping_id);
create index source_reference_links_lookup_3 on evidence.source_reference_links(workspace_id,installation_id,installation_generation,order_version_id);
create index source_reference_links_lookup_4 on evidence.source_reference_links(workspace_id,installation_id,installation_generation,line_version_id);
create index source_reference_links_lookup_5 on evidence.source_reference_links(workspace_id,installation_id,installation_generation,journey_version_id);
create index source_reference_links_lookup_6 on evidence.source_reference_links(workspace_id,installation_id,installation_generation,claim_version_id);
create unique index source_link_source_rule_version_id_unique on evidence.source_reference_links(workspace_id,installation_id,installation_generation,source_reference_id,source_rule_version_id,role) where source_rule_version_id is not null;
create unique index source_link_mapping_id_unique on evidence.source_reference_links(workspace_id,installation_id,installation_generation,source_reference_id,mapping_id,role) where mapping_id is not null;
create unique index source_link_order_version_id_unique on evidence.source_reference_links(workspace_id,installation_id,installation_generation,source_reference_id,order_version_id,role) where order_version_id is not null;
create unique index source_link_line_version_id_unique on evidence.source_reference_links(workspace_id,installation_id,installation_generation,source_reference_id,line_version_id,role) where line_version_id is not null;
create unique index source_link_journey_version_id_unique on evidence.source_reference_links(workspace_id,installation_id,installation_generation,source_reference_id,journey_version_id,role) where journey_version_id is not null;
create unique index source_link_claim_version_id_unique on evidence.source_reference_links(workspace_id,installation_id,installation_generation,source_reference_id,claim_version_id,role) where claim_version_id is not null;
alter table evidence.source_batches enable row level security;
alter table evidence.source_batches force row level security;
create policy source_owner on evidence.source_batches to adstable_owner using(true) with check(true);
revoke all on evidence.source_batches from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
alter table evidence.source_pages enable row level security;
alter table evidence.source_pages force row level security;
create policy source_owner on evidence.source_pages to adstable_owner using(true) with check(true);
revoke all on evidence.source_pages from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
alter table evidence.source_references enable row level security;
alter table evidence.source_references force row level security;
create policy source_owner on evidence.source_references to adstable_owner using(true) with check(true);
revoke all on evidence.source_references from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
alter table identity.source_rule_versions enable row level security;
alter table identity.source_rule_versions force row level security;
create policy source_owner on identity.source_rule_versions to adstable_owner using(true) with check(true);
revoke all on identity.source_rule_versions from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
alter table identity.product_identity_mappings enable row level security;
alter table identity.product_identity_mappings force row level security;
create policy source_owner on identity.product_identity_mappings to adstable_owner using(true) with check(true);
revoke all on identity.product_identity_mappings from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
alter table source.shopify_order_versions enable row level security;
alter table source.shopify_order_versions force row level security;
create policy source_owner on source.shopify_order_versions to adstable_owner using(true) with check(true);
revoke all on source.shopify_order_versions from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
alter table source.shopify_line_versions enable row level security;
alter table source.shopify_line_versions force row level security;
create policy source_owner on source.shopify_line_versions to adstable_owner using(true) with check(true);
revoke all on source.shopify_line_versions from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
alter table source.shopify_journey_versions enable row level security;
alter table source.shopify_journey_versions force row level security;
create policy source_owner on source.shopify_journey_versions to adstable_owner using(true) with check(true);
revoke all on source.shopify_journey_versions from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
alter table source.provider_claim_versions enable row level security;
alter table source.provider_claim_versions force row level security;
create policy source_owner on source.provider_claim_versions to adstable_owner using(true) with check(true);
revoke all on source.provider_claim_versions from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
alter table evidence.source_reference_links enable row level security;
alter table evidence.source_reference_links force row level security;
create policy source_owner on evidence.source_reference_links to adstable_owner using(true) with check(true);
revoke all on evidence.source_reference_links from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function evidence.source_hash(value jsonb) returns text
language sql immutable strict set search_path='' as $fn$ select encode(sha256(convert_to(value::text,'UTF8')),'hex') $fn$;
create function evidence.assert_source_owner(o jsonb) returns void
language plpgsql security definer set search_path='' as $fn$
declare i shopify.installations%rowtype; a record;
begin
 if jsonb_typeof(o) is distinct from 'object' or coalesce(o->>'provider','') not in ('shopify','google_ads','meta','klaviyo') then raise exception 'SOURCE_OWNER_INVALID'; end if;
 select * into i from shopify.installations where id=(o->>'installationId')::bigint for share;
 if not found or i.workspace_id is distinct from (o->>'workspaceId')::uuid or i.install_generation is distinct from (o->>'generation')::bigint
 or i.shop_id is distinct from o->>'shopId' or i.shop_domain is distinct from o->>'shopDomain' or i.status<>'active'
 or not exists(select 1 from app.workspaces w where w.id=i.workspace_id and w.status='active')
 or exists(select 1 from privacy.deletion_runs d where d.workspace_id=i.workspace_id and d.install_generation=i.install_generation and d.status in ('pending','running','failed') and d.kind in ('shop_redact','merchant_delete_my_data','customer_redact')) then raise exception 'SOURCE_OWNER_CHANGED'; end if;
 if o->>'provider'<>'shopify' then
  perform 1 from integrations.provider_connections c where c.id=(o->>'connectionId')::uuid for share;
  select * into a from integrations.load_provider_identity_authority(i.workspace_id,i.install_generation,o->>'provider',i.shop_id,i.shop_domain);
  if not found or a.connection_id is distinct from (o->>'connectionId')::uuid or a.connection_version is distinct from (o->>'connectionVersion')::bigint
   or a.credential_id is distinct from (o->>'credentialId')::uuid or a.reporting_selection_epoch is distinct from o->>'selectionEpoch'
   or (o->>'provider'<>'klaviyo' and a.reporting_account_id is distinct from o->>'accountId')
   or not exists(select 1 from jsonb_array_elements(a.accounts) x where x->>'id'=o->>'accountId') then raise exception 'SOURCE_PROVIDER_CHANGED'; end if;
 end if;
end $fn$;
create function evidence.read_source_receipt(o jsonb,p_attempt uuid,p_ordinal integer) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype;
begin
 select * into b from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
 and installation_generation=(o->>'generation')::bigint and shop_id=o->>'shopId' and authority=o and attempt_id=p_attempt and batch_ordinal=p_ordinal;
 if not found then return jsonb_build_object('status','not_observed','rollbackProven',false); end if;
 return jsonb_build_object('status',b.storage_state,'batchId',b.id::text,'commitId',b.commit_id::text,'digest',b.request_digest,'manifest',b.manifest,'sourceState',b.source_state);
end $fn$;
-- Owner-only ingestion: application roles receive no EXECUTE capability here.
create function evidence.commit_source_batch(o jsonb,p_attempt uuid,p_ordinal integer,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype; bid bigint; w uuid; iid bigint; g bigint; s text;
 item jsonb; old record; rid bigint; parent bigint; refs jsonb:='{}'; ids jsonb:='{}'; k text; tgt text; h text;
 digest text; counts jsonb:='{}'; deadline timestamptz; policy jsonb; meta_until timestamptz;
begin
 if p_attempt is null or p_ordinal is null or p_ordinal<0 or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>16777216
 or (select count(*) from jsonb_object_keys(p))<>11 then raise exception 'SOURCE_BUNDLE_INVALID'; end if;
 foreach k in array array['pages','references','rules','mappings','orders','lines','journeys','claims','links'] loop
  if jsonb_typeof(p->k) is distinct from 'array' or jsonb_array_length(p->k)>1000 then raise exception 'SOURCE_BOUNDS_INVALID'; end if;
 end loop;
 if (select sum(jsonb_array_length(p->entries.group_name)) from unnest(array['pages','references','rules','mappings','orders','lines','journeys','claims','links']) as entries(group_name))>1000 then raise exception 'SOURCE_BOUNDS_INVALID';end if;
 if coalesce(p->>'sourceState','') not in ('complete','partial','failed') or jsonb_typeof(p->'policy') is distinct from 'object' then raise exception 'SOURCE_POLICY_REQUIRED'; end if;
 policy:=p->'policy';meta_until:=(policy->'metadata'->>'until')::timestamptz;
 foreach k in array array['metadata','raw','identity','order','claim'] loop
  deadline:=(policy->k->>'until')::timestamptz;
  if deadline is null or not isfinite(deadline) or deadline<=statement_timestamp() or deadline>meta_until or length(coalesce(policy->k->>'version','')) not between 1 and 128 then raise exception 'SOURCE_POLICY_INVALID'; end if;
 end loop;
 perform evidence.assert_source_owner(o);
 w:=(o->>'workspaceId')::uuid;iid:=(o->>'installationId')::bigint;g:=(o->>'generation')::bigint;s:=o->>'shopId';
 perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||p_attempt::text||p_ordinal::text,0));digest:=evidence.source_hash(p);
 select * into b from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and attempt_id=p_attempt and batch_ordinal=p_ordinal;
 if found then
  if b.authority is distinct from o or b.request_digest<>digest then raise exception 'SOURCE_OPERATION_CONFLICT'; end if;
  return evidence.read_source_receipt(o,p_attempt,p_ordinal);
 end if;
 insert into evidence.source_batches(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,attempt_id,batch_ordinal,primary_source,authority,source_state,storage_state,request_digest,manifest)
 values(w,iid,g,s,'metadata',meta_until,p_attempt,p_ordinal,o->>'provider',o,p->>'sourceState','staged',digest,jsonb_build_object('policy',policy)) returning id into bid;
 for item in select value from jsonb_array_elements(p->'pages') loop
  insert into evidence.source_pages(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,batch_id,family,page_ordinal,origin,capture_layer,numeric_fidelity,field_coverage,payload_schema_version,sanitizer_version,payload_hash,ciphertext,nonce,auth_tag,key_version,plain_byte_count)
  values(w,iid,g,s,'raw',(policy->'raw'->>'until')::timestamptz,bid,item->>'family',(item->>'ordinal')::int,item->>'origin',item->>'captureLayer',item->>'numericFidelity',item->'fieldCoverage',item->>'schemaVersion',item->>'sanitizerVersion',item->>'payloadHash',decode(item->>'ciphertext','hex'),decode(item->>'nonce','hex'),decode(item->>'authTag','hex'),(item->>'keyVersion')::int,(item->>'plainBytes')::int) returning id into rid;
  if refs ? ('p:'||(item->>'key')) then raise exception 'SOURCE_KEY_DUPLICATE'; end if;refs:=refs||jsonb_build_object('p:'||(item->>'key'),rid::text);
 end loop;
 for item in select value from jsonb_array_elements(p->'references') loop
  insert into evidence.source_references(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,page_id,locator_kind,record_locator,native_record_type,native_record_id,record_hash,observation_state)
  values(w,iid,g,s,'metadata',meta_until,(refs->>('p:'||(item->>'page')))::bigint,item->>'locatorKind',item->>'locator',item->>'nativeType',item->>'nativeId',item->>'hash',item->>'state') returning id into rid;
  if refs ? ('r:'||(item->>'key')) then raise exception 'SOURCE_KEY_DUPLICATE'; end if;refs:=refs||jsonb_build_object('r:'||(item->>'key'),rid::text);
 end loop;
 for item in select value from jsonb_array_elements(p->'rules') loop
  insert into identity.source_rule_versions as existing(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,accepted_batch_id,rule_key,version,rule_kind,native_context,parser_version,review_status,documented_basis,applicability)
  values(w,iid,g,s,'identity',(policy->'identity'->>'until')::timestamptz,bid,item->>'ruleKey',(item->>'version')::bigint,item->>'kind',item->'context',item->>'parserVersion',item->>'state',item->'basis',item->'applicability') on conflict(workspace_id,installation_id,installation_generation,rule_key,version) do update set retain_until=greatest(existing.retain_until,excluded.retain_until) where existing.rule_kind is not distinct from excluded.rule_kind and existing.native_context is not distinct from excluded.native_context and existing.parser_version is not distinct from excluded.parser_version and existing.review_status is not distinct from excluded.review_status and existing.documented_basis is not distinct from excluded.documented_basis and existing.applicability is not distinct from excluded.applicability and (select authority from evidence.source_batches where id=existing.accepted_batch_id)=o returning id into rid;
  if not found then raise exception 'SOURCE_RULE_VERSION_CONFLICT';end if;
  ids:=ids||jsonb_build_object('rule:'||(item->>'key'),rid::text);
 end loop;
 for item in select value from jsonb_array_elements(p->'mappings') loop
  if item->'identity' is distinct from jsonb_build_object('provider',o->>'provider','accountId',o->>'accountId','nativeId',item->>'nativeId','context',item->'context') then raise exception 'SOURCE_MAPPING_IDENTITY_INVALID';end if;
  h:=evidence.source_hash(item->'identity');perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||h,0));
  if exists(select 1 from identity.product_identity_mappings m where m.workspace_id=w and m.installation_id=iid and m.installation_generation=g and m.identity_hash=h and m.identity_key_canonical<>(item->'identity')::text) then raise exception 'SOURCE_IDENTITY_HASH_CONFLICT'; end if;
  insert into identity.product_identity_mappings as existing(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,accepted_batch_id,source_rule_version_id,identity_key_version,identity_key_canonical,identity_hash,revision,native_product_id,native_context,shopify_product_id,shopify_variant_id,mapping_state,verified_at,applicability)
  values(w,iid,g,s,'identity',(policy->'identity'->>'until')::timestamptz,bid,(ids->>('rule:'||(item->>'rule')))::bigint,'1',(item->'identity')::text,h,(item->>'revision')::bigint,item->>'nativeId',item->'context',item->>'productId',item->>'variantId',item->>'state',(item->>'verifiedAt')::timestamptz,item->'applicability') on conflict(workspace_id,installation_id,installation_generation,identity_hash,revision) do update set retain_until=greatest(existing.retain_until,excluded.retain_until) where existing.identity_key_canonical is not distinct from excluded.identity_key_canonical and existing.identity_key_version is not distinct from excluded.identity_key_version and existing.native_product_id is not distinct from excluded.native_product_id and existing.native_context is not distinct from excluded.native_context and existing.shopify_product_id is not distinct from excluded.shopify_product_id and existing.shopify_variant_id is not distinct from excluded.shopify_variant_id and existing.mapping_state is not distinct from excluded.mapping_state and existing.verified_at is not distinct from excluded.verified_at and existing.applicability is not distinct from excluded.applicability and existing.source_rule_version_id is not distinct from excluded.source_rule_version_id and (select authority from evidence.source_batches where id=existing.accepted_batch_id)=o returning id into rid;
  if not found then raise exception 'SOURCE_MAPPING_VERSION_CONFLICT';end if;
  ids:=ids||jsonb_build_object('mapping:'||(item->>'key'),rid::text);
 end loop;

 for item in select value from jsonb_array_elements(p->'orders') loop
  h:=evidence.source_hash(item->'data');perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||(item->>'orderId'),0));
  select * into old from source.shopify_order_versions v where v.workspace_id=w and v.installation_id=iid and v.installation_generation=g and v.order_id=item->>'orderId' and v.order_updated_at=(item->>'updatedAt')::timestamptz;
  if found then
   if old.native_data is distinct from item->'data' then raise exception 'SOURCE_ORDER_VERSION_CONFLICT'; end if;counts:=counts||jsonb_build_object('ordersReused',coalesce((counts->>'ordersReused')::int,0)+1);rid:=old.id;update source.shopify_order_versions set retain_until=greatest(retain_until,(policy->'order'->>'until')::timestamptz) where id=rid;
  else
   counts:=counts||jsonb_build_object('ordersInserted',coalesce((counts->>'ordersInserted')::int,0)+1);
   insert into source.shopify_order_versions(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,source_batch_id,source_reference_id,order_id,order_updated_at,observation_hash,native_data)
   values(w,iid,g,s,'order',(policy->'order'->>'until')::timestamptz,bid,(refs->>('r:'||(item->>'reference')))::bigint,item->>'orderId',(item->>'updatedAt')::timestamptz,h,item->'data') returning id into rid;
  end if;insert into evidence.source_reference_links(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,source_reference_id,role,order_version_id) values(w,iid,g,s,'metadata',meta_until,(refs->>('r:'||(item->>'reference')))::bigint,'primary',rid);
  ids:=ids||jsonb_build_object('order:'||(item->>'key'),rid::text);
 end loop;
 for item in select value from jsonb_array_elements(p->'lines') loop
  parent:=(ids->>('order:'||(item->>'order')))::bigint;h:=evidence.source_hash(item->'data');
  select * into old from source.shopify_line_versions v where v.workspace_id=w and v.installation_id=iid and v.installation_generation=g and v.order_version_id=parent and v.line_item_id=item->>'lineId';
  if found then
   if old.native_data is distinct from item->'data' then raise exception 'SOURCE_LINE_VERSION_CONFLICT'; end if;counts:=counts||jsonb_build_object('linesReused',coalesce((counts->>'linesReused')::int,0)+1);rid:=old.id;update source.shopify_line_versions set retain_until=greatest(retain_until,(policy->'order'->>'until')::timestamptz) where id=rid;
  else
   counts:=counts||jsonb_build_object('linesInserted',coalesce((counts->>'linesInserted')::int,0)+1);
   insert into source.shopify_line_versions(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,order_version_id,source_reference_id,line_item_id,observation_hash,native_data)
   values(w,iid,g,s,'order',(policy->'order'->>'until')::timestamptz,parent,(refs->>('r:'||(item->>'reference')))::bigint,item->>'lineId',h,item->'data') returning id into rid;
  end if;insert into evidence.source_reference_links(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,source_reference_id,role,line_version_id) values(w,iid,g,s,'metadata',meta_until,(refs->>('r:'||(item->>'reference')))::bigint,'primary',rid);
  ids:=ids||jsonb_build_object('line:'||(item->>'key'),rid::text);
 end loop;
 for item in select value from jsonb_array_elements(p->'journeys') loop
  insert into source.shopify_journey_versions(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,order_version_id,source_batch_id,part_kind,part_ordinal,journey_state,ready,moments_complete,payload_projection,observation_hash)
  values(w,iid,g,s,'order',(policy->'order'->>'until')::timestamptz,(ids->>('order:'||(item->>'order')))::bigint,bid,item->>'kind',(item->>'ordinal')::int,item->>'state',(item->>'ready')::boolean,(item->>'complete')::boolean,item->'data',evidence.source_hash(item->'data')) returning id into rid;
  ids:=ids||jsonb_build_object('journey:'||(item->>'key'),rid::text);
 end loop;
 for item in select value from jsonb_array_elements(p->'claims') loop
  if item->>'provider' is distinct from o->>'provider' or item->>'accountId' is distinct from o->>'accountId' then raise exception 'SOURCE_CLAIM_OWNER_CONFLICT'; end if;
  insert into source.provider_claim_versions as existing(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,source_reference_id,provider,account_id,claim_identity_key,native_event_or_claim_id,native_order_reference,shopify_order_version_id,order_link_state,native_data,observation_hash)
  values(w,iid,g,s,'claim',(policy->'claim'->>'until')::timestamptz,(refs->>('r:'||(item->>'reference')))::bigint,item->>'provider',item->>'accountId',item->>'claimKey',item->>'nativeId',item->>'nativeOrderId',(ids->>('order:'||(item->>'order')))::bigint,item->>'linkState',item->'data',evidence.source_hash(item->'data')) on conflict(workspace_id,installation_id,installation_generation,provider,account_id,claim_identity_key,observation_hash) do update set retain_until=greatest(existing.retain_until,excluded.retain_until) where existing.native_event_or_claim_id is not distinct from excluded.native_event_or_claim_id and existing.native_order_reference is not distinct from excluded.native_order_reference and existing.shopify_order_version_id is not distinct from excluded.shopify_order_version_id and existing.order_link_state is not distinct from excluded.order_link_state and existing.native_data is not distinct from excluded.native_data returning id into rid;
  if not found then raise exception 'SOURCE_CLAIM_VERSION_CONFLICT';end if;
  insert into evidence.source_reference_links(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,source_reference_id,role,claim_version_id) values(w,iid,g,s,'metadata',meta_until,(refs->>('r:'||(item->>'reference')))::bigint,'primary',rid);
  ids:=ids||jsonb_build_object('claim:'||(item->>'key'),rid::text);
 end loop;
 for item in select value from jsonb_array_elements(p->'links') loop
  tgt:=item->>'targetType';rid:=(ids->>(tgt||':'||(item->>'target')))::bigint;
  if rid is null or tgt not in ('rule','mapping','order','line','journey','claim') then raise exception 'SOURCE_LINK_INVALID'; end if;
  insert into evidence.source_reference_links(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,source_reference_id,role,source_rule_version_id,mapping_id,order_version_id,line_version_id,journey_version_id,claim_version_id)
  values(w,iid,g,s,'metadata',meta_until,(refs->>('r:'||(item->>'reference')))::bigint,item->>'role',case when tgt='rule' then rid end,case when tgt='mapping' then rid end,case when tgt='order' then rid end,case when tgt='line' then rid end,case when tgt='journey' then rid end,case when tgt='claim' then rid end);
 end loop;
 if exists(select 1 from identity.source_rule_versions r where r.accepted_batch_id=bid and not exists(select 1 from evidence.source_reference_links l where l.source_rule_version_id=r.id))
 or exists(select 1 from identity.product_identity_mappings m where m.accepted_batch_id=bid and not exists(select 1 from evidence.source_reference_links l where l.mapping_id=m.id))
 or exists(select 1 from source.shopify_journey_versions j where j.source_batch_id=bid and not exists(select 1 from evidence.source_reference_links l where l.journey_version_id=j.id)) then raise exception 'SOURCE_EVIDENCE_LINK_REQUIRED'; end if;
 foreach k in array array['pages','references','rules','mappings','orders','lines','journeys','claims','links'] loop counts:=counts||jsonb_build_object(k,jsonb_array_length(p->k)); end loop;
 update evidence.source_batches set storage_state='committed',commit_id=gen_random_uuid(),committed_at=statement_timestamp(),manifest=manifest||jsonb_build_object('counts',counts,'ids',ids,'sourceComplete',p->>'sourceState'='complete') where id=bid;
 set constraints all immediate;
 return evidence.read_source_receipt(o,p_attempt,p_ordinal);
end $fn$;

create function evidence.source_page_deadline(p evidence.source_pages) returns timestamptz
language sql stable security definer set search_path='' as $fn$
 with recursive roots as (select 'rule'::text as kind,x.id,x.retain_until from evidence.source_reference_links l join identity.source_rule_versions x on x.id=l.source_rule_version_id where l.workspace_id=p.workspace_id and l.installation_id=p.installation_id and l.installation_generation=p.installation_generation and l.source_reference_id in(select r.id from evidence.source_references r where r.workspace_id=p.workspace_id and r.installation_id=p.installation_id and r.installation_generation=p.installation_generation and r.page_id=p.id)
 union
select 'mapping'::text as kind,x.id,x.retain_until from evidence.source_reference_links l join identity.product_identity_mappings x on x.id=l.mapping_id where l.workspace_id=p.workspace_id and l.installation_id=p.installation_id and l.installation_generation=p.installation_generation and l.source_reference_id in(select r.id from evidence.source_references r where r.workspace_id=p.workspace_id and r.installation_id=p.installation_id and r.installation_generation=p.installation_generation and r.page_id=p.id)
 union
select 'order'::text as kind,x.id,x.retain_until from evidence.source_reference_links l join source.shopify_order_versions x on x.id=l.order_version_id where l.workspace_id=p.workspace_id and l.installation_id=p.installation_id and l.installation_generation=p.installation_generation and l.source_reference_id in(select r.id from evidence.source_references r where r.workspace_id=p.workspace_id and r.installation_id=p.installation_id and r.installation_generation=p.installation_generation and r.page_id=p.id)
 union
select 'line'::text as kind,x.id,x.retain_until from evidence.source_reference_links l join source.shopify_line_versions x on x.id=l.line_version_id where l.workspace_id=p.workspace_id and l.installation_id=p.installation_id and l.installation_generation=p.installation_generation and l.source_reference_id in(select r.id from evidence.source_references r where r.workspace_id=p.workspace_id and r.installation_id=p.installation_id and r.installation_generation=p.installation_generation and r.page_id=p.id)
 union
select 'journey'::text as kind,x.id,x.retain_until from evidence.source_reference_links l join source.shopify_journey_versions x on x.id=l.journey_version_id where l.workspace_id=p.workspace_id and l.installation_id=p.installation_id and l.installation_generation=p.installation_generation and l.source_reference_id in(select r.id from evidence.source_references r where r.workspace_id=p.workspace_id and r.installation_id=p.installation_id and r.installation_generation=p.installation_generation and r.page_id=p.id)
 union
select 'claim'::text as kind,x.id,x.retain_until from evidence.source_reference_links l join source.provider_claim_versions x on x.id=l.claim_version_id where l.workspace_id=p.workspace_id and l.installation_id=p.installation_id and l.installation_generation=p.installation_generation and l.source_reference_id in(select r.id from evidence.source_references r where r.workspace_id=p.workspace_id and r.installation_id=p.installation_id and r.installation_generation=p.installation_generation and r.page_id=p.id)
 union
select 'order',x.id,x.retain_until from source.shopify_order_versions x join evidence.source_references r on r.id=x.source_reference_id where r.workspace_id=p.workspace_id and r.installation_id=p.installation_id and r.installation_generation=p.installation_generation and r.page_id=p.id
 union
select 'line',x.id,x.retain_until from source.shopify_line_versions x join evidence.source_references r on r.id=x.source_reference_id where r.workspace_id=p.workspace_id and r.installation_id=p.installation_id and r.installation_generation=p.installation_generation and r.page_id=p.id
 union
select 'claim',x.id,x.retain_until from source.provider_claim_versions x join evidence.source_references r on r.id=x.source_reference_id where r.workspace_id=p.workspace_id and r.installation_id=p.installation_id and r.installation_generation=p.installation_generation and r.page_id=p.id),
 edges as (
 select 'rule'::text parent_kind,source_rule_version_id parent_id,'mapping'::text child_kind,id,retain_until from identity.product_identity_mappings where workspace_id=p.workspace_id and installation_id=p.installation_id and installation_generation=p.installation_generation
 union all select 'order',order_version_id,'line',id,retain_until from source.shopify_line_versions where workspace_id=p.workspace_id and installation_id=p.installation_id and installation_generation=p.installation_generation
 union all select 'order',order_version_id,'journey',id,retain_until from source.shopify_journey_versions where workspace_id=p.workspace_id and installation_id=p.installation_id and installation_generation=p.installation_generation
 union all select 'order',shopify_order_version_id,'claim',id,retain_until from source.provider_claim_versions where workspace_id=p.workspace_id and installation_id=p.installation_id and installation_generation=p.installation_generation),
 dependencies(kind,id,retain_until) as (select * from roots union select e.child_kind,e.id,e.retain_until from dependencies d join edges e on e.parent_kind=d.kind and e.parent_id=d.id)
 select greatest(p.retain_until,coalesce((select max(retain_until) from dependencies),p.retain_until))
$fn$;
create function evidence.purge_expired_source_pages(p_workspace uuid,p_after bigint,p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare p evidence.source_pages%rowtype;n integer:=0;h integer:=0;last_id bigint:=p_after; b evidence.source_batches%rowtype;
begin
 if p_workspace is null or p_after is null or p_after<0 or p_limit is null or p_limit not between 1 and 1000 then raise exception 'SOURCE_PURGE_BOUNDS'; end if;
 -- Installation lock serializes cleanup with all guarded source commits and privacy deletion.
 perform 1 from shopify.installations where workspace_id=p_workspace order by id for update;
 for p in select x.* from evidence.source_pages x where x.workspace_id=p_workspace and x.id>p_after and x.purged_at is null and x.retain_until<=statement_timestamp() order by x.id limit p_limit for update skip locked loop
  last_id:=p.id;select * into strict b from evidence.source_batches where id=p.batch_id for share;
  if b.storage_state<>'committed' or b.source_state<>'complete' or b.handoff_state<>'consumed' or evidence.source_page_deadline(p)>statement_timestamp() then h:=h+1;continue;end if;
  update evidence.source_pages set ciphertext=null,nonce=null,auth_tag=null,purged_at=statement_timestamp(),purge_reason='expired_unreferenced' where id=p.id;n:=n+1;
 end loop;
 return jsonb_build_object('purged',n,'held',h,'lastScannedId',last_id::text,'reason','expired_unreferenced');
end $fn$;
create function evidence.read_source_pages(o jsonb,p_attempt uuid,p_ordinal integer,p_after bigint,p_limit integer) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
begin
 if p_limit is null or p_limit not between 1 and 100 or p_after is null or p_after<0 then raise exception 'SOURCE_READ_BOUNDS'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id::text,'family',p.family,'ordinal',p.page_ordinal,'origin',p.origin,'payloadHash',p.payload_hash,
 'captureLayer',p.capture_layer,'numericFidelity',p.numeric_fidelity,'fieldCoverage',p.field_coverage,'schemaVersion',p.payload_schema_version,'sanitizerVersion',p.sanitizer_version,
 'keyVersion',p.key_version,'plainBytes',p.plain_byte_count,'ciphertext',encode(p.ciphertext,'hex'),'nonce',encode(p.nonce,'hex'),'authTag',encode(p.auth_tag,'hex'),'available',p.purged_at is null))
 from (select x.* from evidence.source_pages x join evidence.source_batches b on b.id=x.batch_id and b.workspace_id=x.workspace_id and b.installation_id=x.installation_id and b.installation_generation=x.installation_generation where b.workspace_id=(o->>'workspaceId')::uuid and b.installation_id=(o->>'installationId')::bigint and b.installation_generation=(o->>'generation')::bigint and b.authority=o and b.attempt_id=p_attempt and b.batch_ordinal=p_ordinal and b.storage_state='committed' and x.id>p_after order by x.id limit p_limit) p),'[]'::jsonb);
end $fn$;
create function evidence.delete_installation_sources(p_installation bigint) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare result jsonb:='{}'; n bigint;
begin
 set constraints all deferred;
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
create or replace function privacy.execute_deletion_run(p_run_id uuid)
returns table (
  deletion_run_id uuid,
  deletion_status text,
  manifest_id uuid,
  manifest_result text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_run privacy.deletion_runs%rowtype;
  current_installation shopify.installations%rowtype;
  existing_manifest privacy.deletion_manifests%rowtype;
  created_manifest_id uuid;
  deleted_trial bigint := 0;
  deleted_entitlement bigint := 0;
  deleted_subscription bigint := 0;
  deleted_session bigint := 0;
  deleted_domain_history bigint := 0;
  deleted_installation bigint := 0;
  deleted_sources jsonb := '{}'::jsonb;
begin
  select run.* into current_run
    from privacy.deletion_runs as run where run.id = p_run_id for update;
  if not found then raise exception 'DELETION_RUN_NOT_FOUND'; end if;

  select manifest.* into existing_manifest
    from privacy.deletion_manifests as manifest
   where manifest.deletion_run_id = p_run_id;
  if found then
    return query
      select current_run.id, 'completed'::text,
             existing_manifest.id, existing_manifest.result;
    return;
  end if;

  if current_run.status not in ('pending', 'failed') then
    raise exception 'DELETION_RUN_NOT_EXECUTABLE';
  end if;

  update privacy.deletion_runs
     set status = 'running',
         started_at = coalesce(started_at, statement_timestamp()),
         attempt_count = attempt_count + 1,
         last_error_code = null,
         updated_at = statement_timestamp()
   where id = current_run.id;

  -- Order IDs can be personal references even without names/profiles. Never issue a false no-data receipt.
  if current_run.kind in ('customer_data_request','customer_redact') and exists(select 1 from evidence.source_batches b where b.workspace_id=current_run.workspace_id and b.installation_generation=current_run.install_generation) then raise exception 'SOURCE_CUSTOMER_PRIVACY_REVIEW_REQUIRED';end if;
  if current_run.kind in ('customer_data_request', 'customer_redact') then
    insert into privacy.deletion_manifests (
      deletion_run_id, workspace_id, install_generation, shop_identity_sha256,
      kind, deleted_families, retained_families, row_counts, result, completed_at
    ) values (
      current_run.id, current_run.workspace_id, current_run.install_generation,
      current_run.shop_identity_sha256, current_run.kind, '{}'::text[],
      array['aggregated_non_customer_scoped_foundation'],
      '{"customer_scoped_rows":0}'::jsonb, 'no_customer_data', statement_timestamp()
    ) returning id into created_manifest_id;

    update privacy.deletion_runs
       set status = 'completed', completed_at = statement_timestamp(),
           updated_at = statement_timestamp()
     where id = current_run.id;

    return query
      select current_run.id, 'completed'::text,
             created_manifest_id, 'no_customer_data'::text;
    return;
  end if;

  select installation.* into current_installation
    from shopify.installations as installation
   where installation.workspace_id = current_run.workspace_id
     and installation.install_generation = current_run.install_generation
     and installation.status = 'deletion_pending'
     and installation.shop_identity_sha256 = current_run.shop_identity_sha256
   for update;

  if not found then
    update privacy.deletion_runs
       set status = 'superseded',
           last_error_code = 'GENERATION_NO_LONGER_DELETION_PENDING',
           updated_at = statement_timestamp()
     where id = current_run.id;
    return query
      select current_run.id, 'superseded'::text, null::uuid, null::text;
    return;
  end if;

  deleted_sources := evidence.delete_installation_sources(current_installation.id);

  delete from billing.trial_ledger
   where workspace_id = current_run.workspace_id
     and install_generation = current_run.install_generation;
  get diagnostics deleted_trial = row_count;
  delete from billing.workspace_entitlements
   where workspace_id = current_run.workspace_id
     and install_generation = current_run.install_generation;
  get diagnostics deleted_entitlement = row_count;
  delete from billing.workspace_subscriptions
   where workspace_id = current_run.workspace_id
     and install_generation = current_run.install_generation;
  get diagnostics deleted_subscription = row_count;
  delete from shopify.runtime_sessions
   where shop_domain = current_installation.shop_domain;
  get diagnostics deleted_session = row_count;
  delete from shopify.installation_domain_history
   where installation_id = current_installation.id;
  get diagnostics deleted_domain_history = row_count;
  delete from shopify.installations where id = current_installation.id;
  get diagnostics deleted_installation = row_count;

  update app.workspaces
     set status = 'archived', version = version + 1,
         updated_at = statement_timestamp()
   where id = current_run.workspace_id;

  insert into privacy.deletion_manifests (
    deletion_run_id, workspace_id, install_generation, shop_identity_sha256,
    kind, deleted_families, retained_families, row_counts, result, completed_at
  ) values (
    current_run.id, current_run.workspace_id, current_run.install_generation,
    current_run.shop_identity_sha256, current_run.kind,
    array[
      'billing_projection', 'shopify_runtime_sessions',
      'shopify_installation', 'shopify_domain_history', 'source_evidence_identity_orders'
    ],
    array['pseudonymous_generation_tombstone', 'non_personal_deletion_evidence'],
    pg_catalog.jsonb_build_object(
      'billing_trial_ledger', deleted_trial,
      'billing_workspace_entitlements', deleted_entitlement,
      'billing_workspace_subscriptions', deleted_subscription,
      'shopify_runtime_sessions', deleted_session,
      'shopify_installation_domain_history', deleted_domain_history,
      'shopify_installations', deleted_installation
    ) || deleted_sources,
    'deleted', statement_timestamp()
  ) returning id into created_manifest_id;

  update privacy.deletion_runs
     set status = 'completed', completed_at = statement_timestamp(),
         updated_at = statement_timestamp()
   where id = current_run.id;

  return query
    select current_run.id, 'completed'::text,
           created_manifest_id, 'deleted'::text;
end
$function$;

revoke all on all tables in schema evidence,identity,source from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
revoke all on all sequences in schema evidence,identity,source from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
revoke all on all functions in schema evidence from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
comment on schema evidence is 'Step15 private landing/proof store, owner-only repository preparation; no operational reporting activation.';
reset role;
commit;
