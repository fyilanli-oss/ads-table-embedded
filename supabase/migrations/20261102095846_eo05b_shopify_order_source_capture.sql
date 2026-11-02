begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Private composition only. No runtime/coordinator grants or worker activation.
-- Existing read/reservation/accounting phase stays order_observed/reserved.
create function evidence.commit_shopify_order_source(o jsonb,p_attempt uuid,p_ordinal integer,p jsonb,p_read jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare r operations.shopify_order_work_reservations%rowtype;
 q operations.shopify_order_pending_ranges%rowtype; receipt jsonb; prior jsonb;
 iid bigint:=(o->>'installationId')::bigint; w uuid:=(o->>'workspaceId')::uuid;
 g bigint:=(o->>'generation')::bigint; f bigint:=(p_read->>'fence')::bigint;
begin
 if o->>'provider' is distinct from 'shopify' or p_ordinal is distinct from 0
 or jsonb_typeof(p_read) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_read))<>6
 or not p_read ?& array['rangeKey','fence','observedAt','sourceHash','stats','range']
 or p_read->>'sourceHash' !~ '^[a-f0-9]{64}$'
 or jsonb_array_length(p->'rules') is distinct from 0 or jsonb_array_length(p->'mappings') is distinct from 0
 or jsonb_array_length(p->'claims') is distinct from 0
 or exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'origin'<>'shopify'
   or x->>'family' not in ('order_headers','order_lines','order_journey') or x->>'captureLayer'<>'collector_projection')
 then raise exception 'SHOPIFY_SOURCE_BINDING_INVALID';end if;
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 perform 1 from operations.shopify_order_queue_control where singleton for share;
 select * into r from operations.shopify_order_work_reservations where attempt_id=p_attempt for update;
 if not found then raise exception 'SHOPIFY_SOURCE_READ_NOT_CURRENT';end if;
 select * into q from operations.shopify_order_pending_ranges where installation_id=iid and range_key=p_read->>'rangeKey' for share;
 perform 1 from billing.workspace_subscriptions where workspace_id=w and installation_id=iid and install_generation=g for share;
 perform 1 from billing.workspace_entitlements where workspace_id=w and install_generation=g for share;
 if r.phase<>'order_observed' or r.order_stats is distinct from p_read->'stats'
 or q.from_inclusive is distinct from (p_read->'range'->>'fromInclusive')::timestamptz
 or q.to_exclusive is distinct from (p_read->'range'->>'toExclusive')::timestamptz
 or not operations.shopify_order_entitlement_is_current(iid,w,g,o->>'shopId',o->>'shopDomain',p_read->>'rangeKey',p_attempt,f,
   (p_read->>'observedAt')::timestamptz,p_read->>'sourceHash')
 or r.order_deadline_at<=clock_timestamp() then raise exception 'SHOPIFY_SOURCE_READ_NOT_CURRENT';end if;
 select manifest->'shopifyRead' into prior from evidence.source_batches
 where workspace_id=w and installation_id=iid and installation_generation=g and attempt_id=p_attempt and batch_ordinal=0;
 if found and prior is distinct from p_read then raise exception 'SHOPIFY_SOURCE_READ_CONFLICT';end if;
 receipt:=evidence.commit_source_batch(o,p_attempt,0,p);
 update evidence.source_batches set manifest=manifest||jsonb_build_object('shopifyRead',p_read)
 where id=(receipt->>'batchId')::bigint and workspace_id=w and installation_id=iid and installation_generation=g;
 if r.order_deadline_at<=clock_timestamp() then raise exception 'SHOPIFY_SOURCE_READ_EXPIRED';end if;
 return evidence.read_source_receipt(o,p_attempt,0);
end $fn$;
revoke all on function evidence.commit_shopify_order_source(jsonb,uuid,integer,jsonb,jsonb)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
