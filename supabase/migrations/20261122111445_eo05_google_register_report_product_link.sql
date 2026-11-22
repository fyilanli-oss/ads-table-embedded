begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

alter table identity.google_report_product_links
  add column source_page_id bigint,
  add column decision_id uuid,
  add column review_hash text,
  add constraint google_report_product_link_review_check check (
    (source_page_id is null and decision_id is null and review_hash is null)
    or (source_page_id is not null and decision_id is not null and review_hash is not null and review_hash ~ '^[0-9a-f]{64}$')
  ),
  add foreign key (workspace_id,installation_id,installation_generation,source_page_id)
    references evidence.source_pages(workspace_id,installation_id,installation_generation,id) on delete cascade,
  add unique (workspace_id,installation_id,installation_generation,decision_id);
create index google_report_product_links_source_page_idx on identity.google_report_product_links
  (workspace_id,installation_id,installation_generation,source_page_id) where source_page_id is not null;

-- The app decrypts and validates the report and mapping before a trusted
-- reviewer approves the exact tuple. SQL checks current scoped evidence again.
create function identity.register_google_report_product_link(o jsonb,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare w uuid:=(o->>'workspaceId')::uuid; i bigint:=(o->>'installationId')::bigint; g bigint:=(o->>'generation')::bigint;
  d date:=(p->>'businessDate')::date; k text:=p->>'role'; mid bigint:=(p->>'mappingId')::bigint;
  old_id bigint:=(p->>'replacesMappingId')::bigint; vid uuid:=(p->>'decisionId')::uuid;
  valid_to timestamptz:=(p->>'validUntil')::timestamptz; deadline timestamptz:=(p->>'deadlineAt')::timestamptz;
  digest text; current_ids bigint[]; m identity.product_identity_mappings%rowtype;
  prior identity.google_report_product_links%rowtype; src evidence.source_pages%rowtype; receipt jsonb;
begin
  if o->>'provider' is distinct from 'google_ads' or jsonb_typeof(p) is distinct from 'object'
    or octet_length(p::text)>4096 or not p ?& array['businessDate','role','mappingId','ruleId','revision','productId','replacesMappingId',
      'sourcePageId','sourceBatchId','sourceDigest','decisionId','proposalHash','validUntil','deadlineAt']
    or (select count(*) from jsonb_object_keys(p))<>14
    or not coalesce(isfinite(d) and k in ('performance','sold','advertised') and mid>0 and vid is not null
      and (old_id is null or (old_id>0 and old_id<>mid)) and isfinite(valid_to) and valid_to>clock_timestamp()
      and isfinite(deadline) and deadline>clock_timestamp() and deadline<=clock_timestamp()+interval '10 minutes'
      and p->>'proposalHash' ~ '^[0-9a-f]{64}$', false) then raise exception 'GOOGLE_REPORT_LINK_INPUT_INVALID';end if;
  perform 1 from operations.refresh_control where singleton for update;
  perform evidence.assert_source_owner(o);
  digest:=evidence.source_hash(p-'deadlineAt');
  receipt:=jsonb_build_object('status','registered','mappingId',mid::text,'businessDate',d,'role',k,'decisionId',vid);
  select * into prior from identity.google_report_product_links where workspace_id=w and installation_id=i
    and installation_generation=g and decision_id=vid;
  if found then
    if prior.review_hash is distinct from digest or prior.valid_until<=clock_timestamp()
      then raise exception 'GOOGLE_REPORT_LINK_REVIEW_CONFLICT';end if;
    return receipt;
  end if;

  select pg.* into src from evidence.source_pages pg join evidence.source_batches b on b.id=pg.batch_id
    and b.workspace_id=pg.workspace_id and b.installation_id=pg.installation_id and b.installation_generation=pg.installation_generation
  where pg.workspace_id=w and pg.installation_id=i and pg.installation_generation=g
    and pg.id=(p->>'sourcePageId')::bigint and b.id=(p->>'sourceBatchId')::bigint and b.authority=o and pg.origin='google_ads'
    and b.storage_state='committed' and b.manifest->>'privacyRedacted' is distinct from 'true'
    and b.manifest->'googleDatasetRead'->>'dataset'='product_performance'
    and b.manifest->'googleDatasetRead'->'window'=jsonb_build_object('from',d,'to',d)
    and pg.purged_at is null and pg.payload_hash=p->>'sourceDigest' and least(pg.retain_until,b.retain_until)>=valid_to
    and pg.field_coverage ?& array['segments.product_merchant_id','segments.product_feed_label','segments.product_language']
    and pg.field_coverage ? (case k when 'sold' then 'segments.product_sold_item_id' else 'segments.product_item_id' end)
    and (case when k='performance' then pg.family in ('shopping_product_daily','pmax_product_daily')
      else pg.family in ('shopping_cart_data_product_sales_daily','search_cart_data_product_sales_daily','pmax_cart_data_product_sales_daily') end)
  for share of pg,b;
  if not found then raise exception 'GOOGLE_REPORT_LINK_SOURCE_NOT_CURRENT';end if;

  select candidate.* into m from identity.product_identity_mappings candidate
    join evidence.source_batches b on b.id=candidate.accepted_batch_id and b.authority=o
  where candidate.workspace_id=w and candidate.installation_id=i and candidate.installation_generation=g and candidate.id=mid
    and candidate.mapping_state='verified' and candidate.retain_until>=valid_to
    and candidate.source_rule_version_id=(p->>'ruleId')::bigint and candidate.revision=(p->>'revision')::bigint
    and candidate.shopify_product_id=p->>'productId' for share of candidate;
  if not found then raise exception 'GOOGLE_REPORT_LINK_MAPPING_NOT_CURRENT';end if;
  perform identity.mapping_review_state(o,m.id,m.source_rule_version_id,false);

  select array_agg(l.mapping_id order by l.mapping_id) into current_ids
  from identity.google_report_product_links l join identity.product_identity_mappings prior_mapping on prior_mapping.id=l.mapping_id
    join evidence.source_batches b on b.id=prior_mapping.accepted_batch_id and b.authority=o
  where l.workspace_id=w and l.installation_id=i and l.installation_generation=g and l.business_date=d and l.product_role=k
    and l.valid_until>clock_timestamp() and prior_mapping.native_product_id=m.native_product_id
    and prior_mapping.native_context->>'merchant_id'=m.native_context->>'merchant_id'
    and prior_mapping.native_context->>'feed_label'=m.native_context->>'feed_label'
    and prior_mapping.native_context->>'content_language'=m.native_context->>'content_language';
  if (old_id is null and current_ids is not null) or (old_id is not null and current_ids is distinct from array[old_id])
    then raise exception 'GOOGLE_REPORT_LINK_REPLACEMENT_CONFLICT';end if;
  if old_id is not null then
    update identity.google_report_product_links set valid_until=clock_timestamp() where workspace_id=w and installation_id=i
      and installation_generation=g and business_date=d and product_role=k and mapping_id=old_id;
  end if;
  insert into identity.google_report_product_links(workspace_id,installation_id,installation_generation,mapping_id,business_date,
    product_role,valid_until,source_page_id,decision_id,review_hash)
  values(w,i,g,mid,d,k,valid_to,src.id,vid,digest);
  return receipt;
end $fn$;

revoke all on function identity.register_google_report_product_link(jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;
do $grant$
begin
  if exists(select 1 from pg_catalog.pg_roles where rolname='adstable_google_source_runner') then
    revoke all on function identity.register_google_report_product_link(jsonb,jsonb) from adstable_google_source_runner;
  end if;
end $grant$;

-- Use the same lock ordering as registration so review and publication cannot race.
create or replace function analytics.read_google_daily_product_links(o jsonb,c jsonb,d timestamptz,keys jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare result jsonb;
begin
  perform 1 from operations.refresh_control where singleton for update;
  perform analytics.assert_google_daily_report_claim(o,c,d);
  perform evidence.assert_source_owner(o);
  if jsonb_typeof(keys) is distinct from 'array' or jsonb_array_length(keys) not between 1 and 250
    or octet_length(keys::text)>400000 then raise exception 'GOOGLE_REPORT_LINK_INPUT_INVALID';end if;
  with matches as materialized (
    select k.ordinality, m.id, m.native_context
    from jsonb_array_elements(keys) with ordinality k(key,ordinality)
    join identity.google_report_product_links l on l.workspace_id=(o->>'workspaceId')::uuid
      and l.installation_id=(o->>'installationId')::bigint and l.installation_generation=(o->>'generation')::bigint
      and l.business_date=(c->>'businessDate')::date and l.product_role=k.key->>'role' and l.valid_until>=d
    join identity.product_identity_mappings m on m.id=l.mapping_id and m.workspace_id=l.workspace_id
      and m.installation_id=l.installation_id and m.installation_generation=l.installation_generation
      and m.native_product_id=k.key->>'nativeId' and m.native_context->>'merchant_id'=k.key->>'merchantId'
      and m.native_context->>'feed_label'=k.key->>'feedLabel' and m.native_context->>'content_language'=k.key->>'language'
    join evidence.source_batches b on b.id=m.accepted_batch_id and b.authority=o
    join evidence.source_pages proof on proof.id=l.source_page_id and proof.purged_at is null and proof.retain_until>=d
    join evidence.source_batches report on report.id=proof.batch_id and report.authority=o
      and report.storage_state='committed' and report.retain_until>=d and report.manifest->>'privacyRedacted' is distinct from 'true'
    for share of l
  ), ranked as (
    select m.*, count(*) over (partition by m.ordinality) as matching_links from matches m
  )
  select coalesce(jsonb_agg(jsonb_build_object('index',m.ordinality-1,'mappingId',m.id::text,'context',m.native_context)), '[]'::jsonb)
  into result from ranked m where m.matching_links=1;
  return result;
end $fn$;

create or replace function analytics.read_google_daily_product_mapping(o jsonb,c jsonb,d timestamptz,p_mapping bigint) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare m identity.product_identity_mappings%rowtype;
begin
  perform 1 from operations.refresh_control where singleton for update;
  perform analytics.assert_google_daily_report_claim(o,c,d);
  perform evidence.assert_source_owner(o);
  select found_mapping.* into m from identity.product_identity_mappings found_mapping
  join evidence.source_batches b on b.id=found_mapping.accepted_batch_id and b.authority=o
  where found_mapping.workspace_id=(o->>'workspaceId')::uuid and found_mapping.installation_id=(o->>'installationId')::bigint
    and found_mapping.installation_generation=(o->>'generation')::bigint and found_mapping.id=p_mapping
    and found_mapping.mapping_state='verified' and exists (
      select 1 from identity.google_report_product_links l
      join evidence.source_pages proof on proof.id=l.source_page_id and proof.purged_at is null and proof.retain_until>=d
      join evidence.source_batches report on report.id=proof.batch_id and report.authority=o
        and report.storage_state='committed' and report.retain_until>=d and report.manifest->>'privacyRedacted' is distinct from 'true'
      where l.workspace_id=found_mapping.workspace_id
        and l.installation_id=found_mapping.installation_id and l.installation_generation=found_mapping.installation_generation
        and l.mapping_id=found_mapping.id and l.business_date=(c->>'businessDate')::date and l.valid_until>=d
    );
  if not found then return null;end if;
  begin
    return identity.mapping_review_state(o,m.id,m.source_rule_version_id,false);
  exception when raise_exception then
    if sqlerrm in ('MAPPING_NOT_CURRENT','MAPPING_RULE_NOT_CURRENT','MAPPING_BATCH_NOT_CURRENT',
      'MAPPING_ORIGIN_NOT_CURRENT','MAPPING_OBSERVATION_STALE') then return null;end if;
    raise;
  end;
end $fn$;

commit;
