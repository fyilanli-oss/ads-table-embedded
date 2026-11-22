begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Keep the historical full plan and require exact coverage for the daily plan.

create or replace function evidence.commit_google_dataset_source(o jsonb,p_attempt uuid,p_ordinal integer,p jsonb,r jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare w uuid:=(o->>'workspaceId')::uuid; iid bigint:=(o->>'installationId')::bigint; g bigint:=(o->>'generation')::bigint;
 ctx jsonb; prior evidence.source_batches%rowtype; receipt jsonb; input_hash text; k text; allowed text[]; multipart boolean; daily_plan boolean; package_count integer;
begin
 multipart:=coalesce(r ? 'packageCount',false);
 daily_plan:=coalesce(r ? 'reportPlan',false);
 package_count:=case when multipart and jsonb_typeof(r->'packageCount')='number' and coalesce(r->>'packageCount','') ~ '^([2-9]|1[0-9]|20)$' then (r->>'packageCount')::int else 1 end;
 if multipart and (package_count=1 or r->>'dataset' not in ('account_performance','product_performance')
  or p->>'sourceState' is distinct from 'partial'
  or coalesce(r->>'pageCount','') !~ '^[1-9][0-9]{0,2}$' or (r->>'pageCount')::int>300
  or coalesce(r->>'recordCount','') !~ '^[0-9]{1,5}$' or (r->>'recordCount')::int>20000
  or jsonb_typeof(r->'families') is distinct from 'array') then raise exception 'GOOGLE_DATASET_PACKAGE_INVALID';end if;
 if o->>'provider' is distinct from 'google_ads' or (p_ordinal is null or p_ordinal<0 or p_ordinal>=package_count)
 or jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>(case when multipart then 13 else 9 end)+(case when daily_plan then 1 else 0 end)
 or (daily_plan and (r->>'dataset' is distinct from 'product_performance'
  or r->>'reportPlan' is distinct from 'google-daily-product-v1'))
 or not r ?& array['jobId','fence','window','observedAt','operationId','quotaContext','completedAt','deadlineAt','dataset']
 or coalesce(r->>'dataset','') not in ('account_performance','product_performance','merchant_identity')
 or coalesce(p->>'sourceState','') not in ('complete','partial') or p_attempt is null
 or (r->>'operationId')::uuid is null then raise exception 'GOOGLE_DATASET_BINDING_INVALID';end if;
 foreach k in array array['orders','lines','journeys','claims','rules','mappings','links'] loop
  if jsonb_array_length(p->k) is distinct from 0 then raise exception 'GOOGLE_DATASET_FAMILY_INVALID';end if;
 end loop;
 allowed:=case r->>'dataset'
 when 'account_performance' then array['account_identity','campaign_context','ad_group_channel_daily','search_ad_channel_daily','pmax_asset_group_channel_daily',
  'search_ad_conversion_action_daily','shopping_ad_group_conversion_action_daily','pmax_asset_group_conversion_action_daily','conversion_action_daily']
 when 'product_performance' then array['shopping_product_daily','pmax_product_daily','cart_data_product_sales_daily','shopping_cart_data_product_sales_daily',
  'search_cart_data_product_sales_daily','pmax_cart_data_product_sales_daily','pmax_listing_tree_current','pmax_product_group_aggregate_daily']
 else array['google_merchant_link','merchant_products','google_merchant_status'] end;
 if daily_plan then allowed:=array_remove(allowed,'cart_data_product_sales_daily');end if;
 if jsonb_typeof(p->'pages') is distinct from 'array' or jsonb_array_length(p->'pages') not between 1 and 100
 or exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'origin' is distinct from 'google_ads'
  or not (x->>'family'=any(allowed)) or x->>'captureLayer' is distinct from 'native_response_projection'
  or x->>'schemaVersion' is distinct from 'google-raw-datasets-v2'
  or x->>'sanitizerVersion' is distinct from 'google-query-fields-v1'
  or x->>'numericFidelity' is distinct from 'lossless_token') then raise exception 'GOOGLE_DATASET_FAMILY_INVALID';end if;
 if multipart then
  if exists(select 1 from unnest(allowed) f where not (r->'families' ? f)) or jsonb_array_length(r->'families')<>cardinality(allowed) then raise exception 'GOOGLE_DATASET_INCOMPLETE';end if;
 elsif r->>'dataset'<>'merchant_identity' then
  if p->>'sourceState'<>'complete' or exists(select 1 from unnest(allowed) f where not exists
   (select 1 from jsonb_array_elements(p->'pages') x where x->>'family'=f)) then raise exception 'GOOGLE_DATASET_INCOMPLETE';end if;
 else
  if not exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'family'='google_merchant_link')
   or (p->>'sourceState'='complete' and not exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'family'='merchant_products'))
   or (p->>'sourceState'='partial' and not exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'family'='google_merchant_status'))
   then raise exception 'GOOGLE_DATASET_INCOMPLETE';end if;
 end if;
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 perform 1 from operations.refresh_quota_contexts where workspace_id=w and install_generation=g and provider='google_ads' for share;
 perform 1 from billing.workspace_subscriptions where workspace_id=w and installation_id=iid and install_generation=g for share;
 perform 1 from billing.workspace_entitlements where workspace_id=w and install_generation=g for share;
 ctx:=operations.load_refresh_quota_context(w,g,'google_ads',o->>'accountId',r->>'jobId',(r->>'fence')::bigint,
  (r->'window'->>'from')::date,(r->'window'->>'to')::date,'google_ads',(r->>'observedAt')::timestamptz);
 if ctx is null or ctx is distinct from r->'quotaContext'
 or (r->>'completedAt')::timestamptz<(r->>'observedAt')::timestamptz
 or (r->>'completedAt')::timestamptz>clock_timestamp()
 or (r->>'deadlineAt')::timestamptz<=clock_timestamp()
 or (r->>'deadlineAt')::timestamptz>clock_timestamp()+interval '10 minutes'
 or (r->>'dataset'='merchant_identity' and p->>'sourceState'='complete' and ctx->'merchant' is null)
 then raise exception 'GOOGLE_DATASET_READ_NOT_CURRENT';end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||p_attempt::text||p_ordinal::text,0));
 input_hash:=evidence.source_hash(p);
 select * into prior from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and attempt_id=p_attempt and batch_ordinal=p_ordinal;
 if found then
  if prior.authority is distinct from o or prior.manifest->>'googleDatasetInputDigest' is distinct from input_hash
   or prior.manifest->'googleDatasetRead' is distinct from r then raise exception 'GOOGLE_DATASET_OPERATION_CONFLICT';end if;
  return evidence.read_source_receipt(o,p_attempt,p_ordinal);
 end if;
 receipt:=evidence.commit_source_batch(o,p_attempt,p_ordinal,p);
 update evidence.source_batches set manifest=manifest||jsonb_build_object('googleDatasetRead',r,'googleDatasetInputDigest',input_hash)
 where id=(receipt->>'batchId')::bigint and workspace_id=w and installation_id=iid and installation_generation=g;
 if (r->>'deadlineAt')::timestamptz<=clock_timestamp() then raise exception 'GOOGLE_DATASET_READ_EXPIRED';end if;
 return evidence.read_source_receipt(o,p_attempt,p_ordinal);
end $fn$;
revoke all on function evidence.commit_google_dataset_source(jsonb,uuid,integer,jsonb,jsonb)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

commit;
