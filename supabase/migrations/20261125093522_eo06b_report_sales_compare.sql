begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

-- The private server must supply an installed-shop scope from trusted authority.
-- Return native report dates and metric states without inferring missing rows.
create function analytics.read_report_sales_compare(
 p_workspace uuid, p_installation bigint, p_generation bigint,
 p_view text, p_start date, p_end date,
 p_compare_start date default null, p_compare_end date default null,
 p_platform text default null, p_account text default null,
 p_campaign text default null, p_channel text default null, p_product text default null
) returns table (
 period text, day_offset integer, business_date date, source_timezone text,
 platform text, platform_account_id text, root_entity_type text, campaign_id text, campaign_name text,
 channel_type text, channel_id text, channel_resolution text,
 advertised_product_id text, sold_product_id text, sales_role text,
 sales_quantity text, sales_value text, currency text, source_completeness text,
 quantity_support text, quantity_observation text, value_support text, value_observation text
)
language plpgsql stable security definer set search_path = '' as $reader$
declare
 max_days integer;
begin
 max_days := case p_view when 'daily' then 31 when 'summary' then 90 when 'table' then 90 end;
 if max_days is null or p_start is null or p_end is null
    or not isfinite(p_start) or not isfinite(p_end) or p_end < p_start then
  raise exception 'REPORT_COMPARE_RANGE_INVALID' using errcode = '22023';
 end if;
 if p_end - p_start >= max_days
    or (p_compare_start is null) <> (p_compare_end is null) then
  raise exception 'REPORT_COMPARE_RANGE_INVALID' using errcode = '22023';
 end if;
 if p_compare_start is not null then
  if not isfinite(p_compare_start) or not isfinite(p_compare_end)
     or p_compare_end < p_compare_start or p_compare_end - p_compare_start <> p_end - p_start then
   raise exception 'REPORT_COMPARE_RANGE_INVALID' using errcode = '22023';
  end if;
 end if;
 if (p_platform is not null and p_platform not in ('google_ads','meta','klaviyo'))
    or (p_account is not null and p_platform is null)
    or ((p_campaign is not null or p_channel is not null) and p_account is null)
    or (p_account is not null and length(p_account) not between 1 and 1024)
    or (p_campaign is not null and length(p_campaign) not between 1 and 1024)
    or (p_channel is not null and length(p_channel) not between 1 and 1024)
    or (p_product is not null and (length(p_product) > 128 or p_product !~ '^gid://shopify/Product/[1-9][0-9]*$')) then
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
 with periods (name, starts_on, ends_on) as (
  values ('primary'::text, p_start, p_end), ('comparison'::text, p_compare_start, p_compare_end)
 )
 select p.name, f.business_date - p.starts_on, f.business_date, f.source_timezone,
        f.platform, f.platform_account_id, f.root_entity_type, f.root_entity_id, f.root_entity_name,
        f.channel_type, f.channel_id, f.channel_resolution,
        advertised.shopify_product_id, sold.shopify_product_id, f.sales_role,
        f.sales_quantity::text, f.sales_value::text, f.source_currency, f.source_completeness,
        f.metric_support->>'sales_quantity', f.observation_state->>'sales_quantity',
        f.metric_support->>'sales_value', f.observation_state->>'sales_value'
 from periods p
 join analytics.cpd_product_sales_facts f on f.business_date between p.starts_on and p.ends_on
 join evidence.source_batches b on (b.workspace_id, b.installation_id, b.installation_generation, b.id) =
    (f.workspace_id, f.installation_id, f.installation_generation, f.source_batch_id)
 left join identity.product_identity_mappings sold
   on (sold.workspace_id, sold.installation_id, sold.installation_generation, sold.id) =
      (f.workspace_id, f.installation_id, f.installation_generation, f.sold_product_mapping_id)
   and sold.mapping_state = 'verified' and sold.retain_until > statement_timestamp()
 left join identity.product_identity_mappings advertised
   on (advertised.workspace_id, advertised.installation_id, advertised.installation_generation, advertised.id) =
      (f.workspace_id, f.installation_id, f.installation_generation, f.advertised_product_mapping_id)
   and advertised.mapping_state = 'verified' and advertised.retain_until > statement_timestamp()
 where f.workspace_id = p_workspace and f.installation_id = p_installation
   and f.installation_generation = p_generation and f.retain_until > statement_timestamp()
   and b.storage_state = 'committed' and b.handoff_state = 'consumed'
   and b.retain_until > statement_timestamp()
   and b.manifest->'privacyRedacted' is distinct from 'true'::jsonb
   and not (b.manifest ? 'datasetReconciliationMismatch')
   and (p_platform is null or f.platform = p_platform)
   and (p_account is null or f.platform_account_id = p_account)
   and (p_campaign is null or f.root_entity_id = p_campaign)
   and (p_channel is null or f.channel_id = p_channel)
   and (p_product is null or p_product in (advertised.shopify_product_id, sold.shopify_product_id))
 order by p.starts_on, p.name, f.business_date, f.id;
end;
$reader$;

revoke all on function analytics.read_report_sales_compare(uuid,bigint,bigint,text,date,date,date,date,text,text,text,text,text)
 from public,anon,authenticated,service_role,adstable_refresh_coordinator;
-- The refresh dataset runner is provisioned separately and may not exist yet.
do $permissions$
begin
 if to_regrole('adstable_refresh_dataset_runner') is not null then
  revoke all on function analytics.read_report_sales_compare(uuid,bigint,bigint,text,date,date,date,date,text,text,text,text,text)
   from adstable_refresh_dataset_runner;
 end if;
end;
$permissions$;
grant execute on function analytics.read_report_sales_compare(uuid,bigint,bigint,text,date,date,date,date,text,text,text,text,text)
 to adstable_runtime;

commit;
