-- Prepared private Dataset reader. Hourly message performance is not part of
-- this read: the input rows are native product sale events from both writers.
create index klaviyo_daily_sales_owner_time_idx on analytics.cpd_product_sales_facts
  (workspace_id,installation_id,installation_generation,platform_account_id,provider_connection_id,occurred_at)
  where platform='klaviyo' and provider_event_id is not null;
create index klaviyo_hourly_sales_batch_hour_idx on analytics.klaviyo_hourly_product_sales(source_batch_id,hour_start);
create function analytics.read_klaviyo_product_sales_window(o jsonb, from_at timestamptz, to_at timestamptz, row_limit int)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare data jsonb; w uuid := (o->>'workspaceId')::uuid; i bigint := (o->>'installationId')::bigint;
  g bigint := (o->>'generation')::bigint; connection uuid := (o->>'connectionId')::uuid;
  a text := o->>'accountId';
begin
  if o->>'provider' is distinct from 'klaviyo' or from_at is null or to_at is null
    or not isfinite(from_at) or not isfinite(to_at) or to_at<=from_at or to_at-from_at>interval '48 hours'
    or row_limit is null or row_limit not between 1 and 2000 then raise exception 'KLAVIYO_PRODUCT_WINDOW_INVALID'; end if;
  perform evidence.assert_source_owner(o);
  with candidates as (
    select d.provider_event_id event_id, d.occurred_at at_time, 0 priority, b.id batch_id,
      (b.manifest->'klaviyoDatasetRead'->>'observedAt')::timestamptz observed,
      jsonb_build_object('eventId',d.provider_event_id,'occurredAt',d.occurred_at,
        'metricId',d.product_context->>'metric_id','productId',d.native_sold_product_id,'variantId',d.product_context->>'variant_id',
        'quantity',d.sales_quantity::text,'value',d.sales_value::text,'currency',d.source_currency,
        'attribution',jsonb_build_object('source',d.root_entity_type,'source_entity_id',d.root_entity_id,
          'channel_id',d.channel_id,'channel_type',d.channel_type,'sales_role',d.sales_role,
          'reason',d.sales_role_evidence->>'reason'),'cadence','daily') sale
    from analytics.cpd_product_sales_facts d
    join evidence.source_batches b on b.id=d.source_batch_id and b.workspace_id=d.workspace_id
      and b.installation_id=d.installation_id and b.installation_generation=d.installation_generation
    where d.workspace_id=w and d.installation_id=i and d.installation_generation=g
      and d.platform='klaviyo' and d.platform_account_id=a and d.provider_connection_id=connection
      and d.occurred_at>=from_at and d.occurred_at<to_at and d.provider_event_id is not null
      and d.source_completeness='complete' and d.retain_until>statement_timestamp()
      and b.handoff_state='consumed' and b.manifest->'klaviyoDatasetRead'->>'observedAt' is not null
      and b.authority=o and b.storage_state='committed' and b.source_state='complete'
      and b.manifest->'privacyRedacted' is distinct from 'true'::jsonb
    union all
    select h.event_id,(h.sale->>'occurredAt')::timestamptz,1,b.id,f.observed_at,
      h.sale||jsonb_build_object('currency',b.manifest->>'klaviyoHourlySourceCurrency','cadence','hourly')
    from analytics.klaviyo_hourly_event_facts f
    join analytics.klaviyo_hourly_product_sales h on h.source_batch_id=f.source_batch_id and h.hour_start=f.hour_start
    join analytics.klaviyo_hourly_event_receipts receipt on receipt.source_batch_id=f.source_batch_id
    join evidence.source_batches b on b.id=f.source_batch_id
    where f.workspace_id=w and f.installation_id=i and f.generation=g and f.account_id=a
      and f.connection_id=connection and f.connection_version=(o->>'connectionVersion')::bigint
      and f.hour_start>=from_at-interval '1 hour' and f.hour_start<to_at
      and (h.sale->>'occurredAt')::timestamptz>=from_at and (h.sale->>'occurredAt')::timestamptz<to_at
      and b.authority=o and b.storage_state='committed' and b.source_state='complete'
      and b.manifest->'klaviyoHourlyManifest'->>'digest' is not null
      and receipt.receipt->>'digest'=b.manifest->'klaviyoHourlyManifest'->>'digest'
      and b.retain_until>statement_timestamp() and b.manifest->'privacyRedacted' is distinct from 'true'::jsonb
  ), unique_sales as (
    select distinct on (event_id) event_id,at_time,sale
    from candidates order by event_id,observed desc,priority,batch_id desc
  ), bounded as (
    select * from unique_sales order by at_time,event_id limit row_limit+1
  )
  select coalesce(jsonb_agg(sale order by at_time,event_id),'[]'::jsonb) into data from bounded;
  if jsonb_array_length(data)>row_limit then
    return jsonb_build_object('status','limit_reached','sales',null);
  end if;
  return jsonb_build_object('status','read','sales',data);
end $fn$;
revoke all on function analytics.read_klaviyo_product_sales_window(jsonb,timestamptz,timestamptz,int)
from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
