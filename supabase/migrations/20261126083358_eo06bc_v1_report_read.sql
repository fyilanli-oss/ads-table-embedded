begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

-- Read published facts in one snapshot. The existing raw-row Compare reader
-- remains available to clients using its original query and response shape.
create function analytics.read_v1_report_sales(
 p_workspace uuid, p_installation bigint, p_generation bigint, p_view text,
 p_start date, p_end date, p_compare_start date, p_compare_end date,
 p_platforms text[], p_account text, p_campaign text, p_channel text, p_products text[]
) returns table (
 period text, day_offset integer, business_date date, source_timezone text,
 platform text, platform_account_id text, root_entity_type text, campaign_id text,
 campaign_name text, campaign_format text, channel_type text, channel_id text,
 channel_name text, channel_resolution text, advertised_product_id text,
 sold_product_id text, sales_role text, sales_quantity text, sales_value text,
 currency text, reporting_currency text, reporting_value text, time_basis text,
 conversion_scope text, units text, source_completeness text,
 quantity_support text, quantity_observation text, value_support text, value_observation text,
 destination_count integer, destination_campaign_type text, destination_campaign_id text,
 destination_channel_type text, destination_channel_id text
)
language plpgsql stable security definer set search_path = '' as $reader$
declare
 max_days integer := case p_view when 'daily' then 31 when 'table' then 90 end;
begin
 if max_days is null or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_end < p_start or p_end - p_start >= max_days or (p_compare_start is null) <> (p_compare_end is null) then
  raise exception 'REPORT_COMPARE_RANGE_INVALID' using errcode = '22023';
 end if;
 if p_compare_start is not null and (not isfinite(p_compare_start) or not isfinite(p_compare_end)
    or p_compare_end < p_compare_start or p_compare_end - p_compare_start <> p_end - p_start
    or (p_compare_start <= p_end and p_compare_end >= p_start)) then
  raise exception 'REPORT_COMPARE_RANGE_INVALID' using errcode = '22023';
 end if;
 if exists (select 1 from unnest(p_platforms) v(item) where item is null or item not in ('google_ads','meta','klaviyo'))
    or exists (select 1 from unnest(p_products) v(item) where item is null or length(item) > 128 or item !~ '^gid://shopify/Product/[1-9][0-9]*$')
    or (p_account is not null and coalesce(cardinality(p_platforms), 0) <> 1)
    or (p_campaign is not null and p_account is null) or (p_channel is not null and p_campaign is null)
    or exists (select 1 from unnest(array[p_account,p_campaign,p_channel]) v(item)
      where item is not null and (btrim(item) = '' or length(item) > 1024)) then
  raise exception 'REPORT_COMPARE_FILTER_INVALID' using errcode = '22023';
 end if;
 if not exists (
   select 1 from shopify.installations i join app.workspaces w on w.id = i.workspace_id
   where i.workspace_id = p_workspace and i.id = p_installation
     and i.install_generation = p_generation and i.status = 'active' and w.status = 'active'
 ) or exists (
   select 1 from privacy.deletion_runs d
   where d.workspace_id = p_workspace and d.install_generation = p_generation
     and d.status in ('pending','running','failed')
 ) then
  raise exception 'REPORT_COMPARE_SCOPE_UNAVAILABLE' using errcode = '42501';
 end if;

 return query
 with periods(name, starts_on, ends_on) as (
  values ('primary'::text,p_start,p_end), ('comparison'::text,p_compare_start,p_compare_end)
 )
 select p.name, f.business_date - p.starts_on, f.business_date, f.source_timezone,
  f.platform, f.platform_account_id, f.root_entity_type, f.root_entity_id,
  coalesce(f.root_entity_name, labels.campaign_name), f.campaign_type,
  f.channel_type, f.channel_id, labels.channel_name, f.channel_resolution,
  advertised.shopify_product_id, sold.shopify_product_id, f.sales_role,
  f.sales_quantity::text, f.sales_value::text, f.source_currency, settings.reporting_currency,
  case when f.source_currency = settings.reporting_currency then f.sales_value::text
       when f.fx_state = 'verified' and f.target_currency = settings.reporting_currency
          and fx.source_currency = f.source_currency and fx.target_currency = f.target_currency
         then (f.sales_value * fx.fx_rate)::text end,
  f.reporting_scope->>'time_basis', f.reporting_scope->>'conversion_scope', f.reporting_scope->>'units',
  f.source_completeness, f.metric_support->>'sales_quantity', f.observation_state->>'sales_quantity',
  f.metric_support->>'sales_value', f.observation_state->>'sales_value',
  placement.count, placement.campaign_type, placement.campaign_id, placement.channel_type, placement.channel_id
 from periods p
 join analytics.cpd_product_sales_facts f on f.business_date between p.starts_on and p.ends_on
 join evidence.source_batches b on (b.workspace_id,b.installation_id,b.installation_generation,b.id) =
  (f.workspace_id,f.installation_id,f.installation_generation,f.source_batch_id)
 left join identity.product_identity_mappings sold
  on (sold.workspace_id,sold.installation_id,sold.installation_generation,sold.id) =
     (f.workspace_id,f.installation_id,f.installation_generation,f.sold_product_mapping_id)
  and sold.mapping_state = 'verified' and sold.retain_until > statement_timestamp()
 left join identity.product_identity_mappings advertised
  on (advertised.workspace_id,advertised.installation_id,advertised.installation_generation,advertised.id) =
     (f.workspace_id,f.installation_id,f.installation_generation,f.advertised_product_mapping_id)
  and advertised.mapping_state = 'verified' and advertised.retain_until > statement_timestamp()
 left join app.workspace_settings settings on (settings.workspace_id,settings.installation_id,settings.installation_generation) =
  (f.workspace_id,f.installation_id,f.installation_generation)
 left join analytics.fx_rates fx on fx.id = f.fx_rate_id
 left join lateral (
  select case when count(distinct pd.root_entity_name) = 1 then min(pd.root_entity_name) end campaign_name,
         case when count(distinct pd.entity_name) filter (where n.same_channel) = 1
           then min(pd.entity_name) filter (where n.same_channel) end channel_name
  from analytics.pd_facts pd
  join evidence.source_batches pb on (pb.workspace_id,pb.installation_id,pb.installation_generation,pb.id) =
   (pd.workspace_id,pd.installation_id,pd.installation_generation,pd.source_batch_id)
  cross join lateral (select f.channel_resolution = 'verified' and (pd.entity_type,pd.entity_id) =
   (f.channel_type,f.channel_id) as same_channel) n
  where (pd.workspace_id,pd.installation_id,pd.installation_generation,pd.provider_connection_id,
         pd.platform,pd.platform_account_id,pd.business_date,pd.source_timezone,pd.root_entity_type,pd.root_entity_id) =
        (f.workspace_id,f.installation_id,f.installation_generation,f.provider_connection_id,
         f.platform,f.platform_account_id,f.business_date,f.source_timezone,f.root_entity_type,f.root_entity_id)
    and (f.root_entity_name is null or n.same_channel) and pd.retain_until > statement_timestamp()
    and pb.storage_state = 'committed' and pb.handoff_state = 'consumed' and pb.retain_until > statement_timestamp()
    and pb.manifest->'privacyRedacted' is distinct from 'true'::jsonb and not (pb.manifest ? 'datasetReconciliationMismatch')
 ) labels on true
 left join lateral (
  select count(*)::integer count, min(x.root_entity_type) campaign_type, min(x.root_entity_id) campaign_id,
         min(x.channel_type) channel_type, min(x.channel_id) channel_id
  from (
   select distinct pf.root_entity_type,pf.root_entity_id,pf.channel_type,pf.channel_id
   from analytics.cpd_product_performance_facts pf
   join identity.product_identity_mappings pm on (pm.workspace_id,pm.installation_id,pm.installation_generation,pm.id) =
    (pf.workspace_id,pf.installation_id,pf.installation_generation,pf.product_mapping_id)
   join evidence.source_batches pb on (pb.workspace_id,pb.installation_id,pb.installation_generation,pb.id) =
    (pf.workspace_id,pf.installation_id,pf.installation_generation,pf.source_batch_id)
   where advertised.shopify_product_id is not null and sold.shopify_product_id is not null
     and f.channel_resolution = 'verified' and f.root_entity_type is not null and f.root_entity_id is not null
     and (pf.workspace_id,pf.installation_id,pf.installation_generation,pf.provider_connection_id,
          pf.platform,pf.platform_account_id,pf.business_date,pf.source_timezone) =
         (f.workspace_id,f.installation_id,f.installation_generation,f.provider_connection_id,
          f.platform,f.platform_account_id,f.business_date,f.source_timezone)
     and pf.reporting_scope->>'time_basis' = f.reporting_scope->>'time_basis'
     and pf.channel_resolution = 'verified' and pf.root_entity_type is not null and pf.root_entity_id is not null
     and pm.shopify_product_id = sold.shopify_product_id and pm.mapping_state = 'verified'
     and least(pf.retain_until,pm.retain_until,pb.retain_until) > statement_timestamp()
     and pb.storage_state = 'committed' and pb.handoff_state = 'consumed'
     and pb.manifest->'privacyRedacted' is distinct from 'true'::jsonb and not (pb.manifest ? 'datasetReconciliationMismatch')
   limit 2
  ) x
 ) placement on true
 where (f.workspace_id,f.installation_id,f.installation_generation) = (p_workspace,p_installation,p_generation)
  and f.retain_until > statement_timestamp() and b.storage_state = 'committed' and b.handoff_state = 'consumed'
  and b.retain_until > statement_timestamp() and b.manifest->'privacyRedacted' is distinct from 'true'::jsonb
  and not (b.manifest ? 'datasetReconciliationMismatch')
  and (coalesce(cardinality(p_platforms),0) = 0 or f.platform = any(p_platforms))
  and (p_account is null or f.platform_account_id = p_account)
  and (p_campaign is null or f.root_entity_id = p_campaign)
  and (p_channel is null or (f.channel_resolution = 'verified' and f.channel_id = p_channel))
  and (coalesce(cardinality(p_products),0) = 0 or advertised.shopify_product_id = any(p_products)
    or sold.shopify_product_id = any(p_products))
 order by p.starts_on,p.name,f.business_date,f.id;
end;
$reader$;

revoke all on function analytics.read_v1_report_sales(uuid,bigint,bigint,text,date,date,date,date,text[],text,text,text,text[])
 from public,anon,authenticated,service_role,adstable_refresh_coordinator;
do $permissions$
begin
 if to_regrole('adstable_refresh_dataset_runner') is not null then
  revoke all on function analytics.read_v1_report_sales(uuid,bigint,bigint,text,date,date,date,date,text[],text,text,text,text[])
   from adstable_refresh_dataset_runner;
 end if;
end;
$permissions$;
grant execute on function analytics.read_v1_report_sales(uuid,bigint,bigint,text,date,date,date,date,text[],text,text,text,text[])
 to adstable_runtime;
commit;
