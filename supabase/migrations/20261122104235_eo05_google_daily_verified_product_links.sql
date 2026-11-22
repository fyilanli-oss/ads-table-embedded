begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- A reviewed report identity refers to one existing mapping revision. No writer
-- is exposed to the refresh role. A native review/registration path is separate.
create table identity.google_report_product_links (
  workspace_id uuid not null,
  installation_id bigint not null,
  installation_generation bigint not null,
  mapping_id bigint not null,
  business_date date not null check (isfinite(business_date)),
  product_role text not null check (product_role in ('performance','sold','advertised')),
  valid_until timestamptz not null check (isfinite(valid_until)),
  primary key (workspace_id,installation_id,installation_generation,business_date,product_role,mapping_id),
  foreign key (workspace_id,installation_id,installation_generation,mapping_id)
    references identity.product_identity_mappings(workspace_id,installation_id,installation_generation,id) on delete cascade
);
create index google_report_product_links_mapping_idx on identity.google_report_product_links
  (workspace_id,installation_id,installation_generation,mapping_id);
alter table identity.google_report_product_links enable row level security;
alter table identity.google_report_product_links force row level security;
create policy source_owner on identity.google_report_product_links to adstable_owner using (true) with check (true);
revoke all on identity.google_report_product_links from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;

create function analytics.read_google_daily_product_links(o jsonb,c jsonb,d timestamptz,keys jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare result jsonb;
begin
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
    for share of l
  ), ranked as (
    select m.*, count(*) over (partition by m.ordinality) as matching_links from matches m
  )
  select coalesce(jsonb_agg(jsonb_build_object('index',m.ordinality-1,'mappingId',m.id::text,'context',m.native_context)), '[]'::jsonb)
  into result from ranked m where m.matching_links=1;
  return result;
end $fn$;

create function analytics.read_google_daily_product_mapping(o jsonb,c jsonb,d timestamptz,p_mapping bigint) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare m identity.product_identity_mappings%rowtype;
begin
  perform analytics.assert_google_daily_report_claim(o,c,d);
  perform evidence.assert_source_owner(o);
  select found_mapping.* into m from identity.product_identity_mappings found_mapping
  join evidence.source_batches b on b.id=found_mapping.accepted_batch_id and b.authority=o
  where found_mapping.workspace_id=(o->>'workspaceId')::uuid and found_mapping.installation_id=(o->>'installationId')::bigint
    and found_mapping.installation_generation=(o->>'generation')::bigint and found_mapping.id=p_mapping
    and found_mapping.mapping_state='verified' and exists (
      select 1 from identity.google_report_product_links l where l.workspace_id=found_mapping.workspace_id
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

revoke all on function analytics.read_google_daily_product_links(jsonb,jsonb,timestamptz,jsonb),
  analytics.read_google_daily_product_mapping(jsonb,jsonb,timestamptz,bigint)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function analytics.read_google_daily_product_links(jsonb,jsonb,timestamptz,jsonb),
  analytics.read_google_daily_product_mapping(jsonb,jsonb,timestamptz,bigint) to adstable_refresh_dataset_runner;

commit;
