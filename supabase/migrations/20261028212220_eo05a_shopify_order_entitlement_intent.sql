begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;
alter table operations.shopify_order_work_reservations
 add column phase text not null default 'pre_request' check(phase in ('pre_request','entitlement_intent','entitlement_dispatched','entitlement_observed','entitlement_denied','stopped')),
 add column entitlement_intent_at timestamptz,
 add column entitlement_observed_at timestamptz,
 add column entitlement_source_hash text check(entitlement_source_hash is null or entitlement_source_hash~'^[a-f0-9]{64}$'),
 add column stop_reason text check(stop_reason is null or stop_reason in ('entitlement_not_dispatched','entitlement_denied','entitlement_unknown','entitlement_write_unconfirmed','authority_changed'));

create function operations.shopify_order_work_is_current(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint)
returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from operations.shopify_order_work_reservations r
 join operations.shopify_order_pending_ranges q on q.installation_id=r.installation_id and q.range_key=r.range_key
 join shopify.installations i on i.id=r.installation_id join app.workspaces w on w.id=i.workspace_id
 cross join operations.shopify_order_queue_control c
 where r.installation_id=p_installation and r.workspace_id=p_workspace and r.install_generation=p_generation and r.range_key=p_key
 and r.attempt_id=p_attempt and r.fence=p_fence and r.status='reserved' and r.phase in ('pre_request','entitlement_intent','entitlement_dispatched','entitlement_observed')
 and i.workspace_id=p_workspace and i.install_generation=p_generation and i.shop_id=p_shop and i.shop_domain=p_domain and i.status='active' and w.status='active'
 and q.workspace_id=p_workspace and q.install_generation=p_generation and q.status='queued' and q.version=r.range_version
 and c.singleton and c.enabled and c.worker_enabled and c.configuration_epoch=r.queue_epoch and c.worker_epoch=r.worker_epoch
 and q.configuration_epoch=r.queue_epoch and r.cost=c.worker_cost
 and operations.shopify_order_queue_contexts(p_installation,p_workspace,p_generation)=q.quota_contexts
 and not exists(select 1 from jsonb_array_elements(q.quota_routes) x
 where operations.resolve_shared_api_quota_route(x->>'routeKey',x->>'connectionScopeKey',x->>'provider') is distinct from x->>'routeKey'))
$fn$;

alter function operations.release_shopify_order_work(bigint,uuid,bigint,text,text,text,uuid,bigint) rename to release_shopify_order_work_before_entitlement;
revoke all on function operations.release_shopify_order_work_before_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.release_shopify_order_work(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint)
returns boolean language plpgsql security definer set search_path='' as $fn$
begin
 perform 1 from operations.refresh_control where singleton for update;
 if not exists(select 1 from operations.shopify_order_work_reservations where installation_id=p_installation and workspace_id=p_workspace
 and install_generation=p_generation and range_key=p_key and attempt_id=p_attempt and fence=p_fence and phase='pre_request') then return false; end if;
 return operations.release_shopify_order_work_before_entitlement(p_installation,p_workspace,p_generation,p_shop,p_domain,p_key,p_attempt,p_fence);
end
$fn$;

create function operations.begin_shopify_order_entitlement(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare ctx jsonb; observed timestamptz;
begin
 perform 1 from operations.refresh_control where singleton for update;
 if not operations.shopify_order_work_is_current(p_installation,p_workspace,p_generation,p_shop,p_domain,p_key,p_attempt,p_fence) then return null; end if;
 ctx:=operations.shopify_order_queue_contexts(p_installation,p_workspace,p_generation)->'shopify_partner';
 if ctx->>'apiVersion' is distinct from '2026-07' then return null; end if;
 observed:=date_trunc('milliseconds',clock_timestamp());
 update operations.shopify_order_work_reservations set phase='entitlement_intent',entitlement_intent_at=observed
 where installation_id=p_installation and range_key=p_key and attempt_id=p_attempt and fence=p_fence and phase='pre_request';
 if not found then return null; end if;
 update operations.refresh_control set revision=revision+1 where singleton;
 return jsonb_build_object('observedAt',observed,'quotaContext',ctx);
end
$fn$;
create function operations.load_shopify_order_entitlement_context(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint)
returns jsonb language sql stable security definer set search_path='' as $fn$
 select operations.shopify_order_queue_contexts(p_installation,p_workspace,p_generation)->'shopify_partner'
 where operations.shopify_order_work_is_current(p_installation,p_workspace,p_generation,p_shop,p_domain,p_key,p_attempt,p_fence)
 and exists(select 1 from operations.shopify_order_work_reservations where attempt_id=p_attempt and phase='entitlement_intent')
$fn$;

create function operations.dispatch_shopify_order_entitlement(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint)
returns boolean language plpgsql security definer set search_path='' as $fn$
begin
 perform 1 from operations.refresh_control where singleton for update;
 if not operations.shopify_order_work_is_current(p_installation,p_workspace,p_generation,p_shop,p_domain,p_key,p_attempt,p_fence) then return false; end if;
 update operations.shopify_order_work_reservations set phase='entitlement_dispatched' where attempt_id=p_attempt and phase='entitlement_intent';
 if not found then return false; end if;
 update operations.refresh_control set revision=revision+1 where singleton;
 return true;
end
$fn$;

create function operations.apply_shopify_order_entitlement(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare r operations.shopify_order_work_reservations%rowtype; observed timestamptz; applied record; next_phase text;
begin
 perform 1 from operations.refresh_control where singleton for update;
 if not operations.shopify_order_work_is_current(p_installation,p_workspace,p_generation,p_shop,p_domain,p_key,p_attempt,p_fence)
 then raise exception 'SHOPIFY_ORDER_ENTITLEMENT_NOT_CURRENT'; end if;
 select * into strict r from operations.shopify_order_work_reservations where attempt_id=p_attempt and phase='entitlement_dispatched' for update;
 observed:=(p_snapshot->>'observedAt')::timestamptz;
 if p_snapshot->>'shopId' is distinct from p_shop or p_snapshot->>'shopDomain' is distinct from p_domain
 or p_snapshot->>'installGeneration' is distinct from p_generation::text or observed is distinct from r.entitlement_intent_at
 or observed>clock_timestamp() or coalesce(p_snapshot->>'sourceHash','')!~'^[a-f0-9]{64}$'
 then raise exception 'SHOPIFY_ORDER_ENTITLEMENT_SNAPSHOT_INVALID'; end if;
 if (p_snapshot->>'active')::boolean and not coalesce(
  (p_snapshot->>'entitlementStatus'='trial' and (p_snapshot->>'trialEndsAt')::timestamptz>clock_timestamp())
  or (p_snapshot->>'entitlementStatus'='active' and (p_snapshot->>'currentCycleStart')::timestamptz<=clock_timestamp()
   and (p_snapshot->>'currentCycleEnd')::timestamptz>clock_timestamp()),false)
 then raise exception 'SHOPIFY_ORDER_ENTITLEMENT_PERIOD_INVALID'; end if;
 select * into strict applied from billing.apply_shopify_app_pricing_snapshot(p_shop,p_domain,p_generation,
  (p_snapshot->>'active')::boolean,p_snapshot->>'entitlementStatus',p_snapshot->>'billingPeriod',(p_snapshot->>'cancelAtEndOfCycle')::boolean,
  (p_snapshot->>'trialEndsAt')::timestamptz,(p_snapshot->>'currentCycleStart')::timestamptz,(p_snapshot->>'currentCycleEnd')::timestamptz,
  array(select jsonb_array_elements_text(p_snapshot->'itemHandles')),array(select jsonb_array_elements_text(p_snapshot->'pendingItemHandles')),observed,p_snapshot->>'sourceHash');
 if not exists(select 1 from billing.workspace_subscriptions s where s.workspace_id=p_workspace and s.install_generation=p_generation
  and s.installation_id=p_installation and s.source_hash=p_snapshot->>'sourceHash' and s.source_observed_at=observed)
 then raise exception 'SHOPIFY_ORDER_ENTITLEMENT_PROJECTION_CHANGED'; end if;
 next_phase:='entitlement_observed';
 if applied.entitlement_status='subscription_required' then next_phase:='entitlement_denied'; end if;
 update operations.shopify_order_work_reservations set phase=next_phase,entitlement_observed_at=observed,entitlement_source_hash=p_snapshot->>'sourceHash'
 where attempt_id=p_attempt;
 update operations.refresh_control set revision=revision+1 where singleton;
 return jsonb_build_object('shopId',applied.shop_id,'shopDomain',applied.shop_domain,'installGeneration',applied.install_generation,
 'entitlementStatus',applied.entitlement_status,'sourceObservedAt',observed,'sourceHash',p_snapshot->>'sourceHash');
end
$fn$;
create function operations.shopify_order_entitlement_is_current(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint,p_observed timestamptz,p_hash text)
returns boolean language sql stable security definer set search_path='' as $fn$
 select operations.shopify_order_work_is_current(p_installation,p_workspace,p_generation,p_shop,p_domain,p_key,p_attempt,p_fence)
 and exists(select 1 from operations.shopify_order_work_reservations r
 join billing.workspace_subscriptions s on s.workspace_id=r.workspace_id and s.installation_id=r.installation_id and s.install_generation=r.install_generation
 join billing.workspace_entitlements e on e.workspace_id=s.workspace_id and e.install_generation=s.install_generation and e.source_hash=s.source_hash and e.source_observed_at=s.source_observed_at
 where r.attempt_id=p_attempt and r.phase='entitlement_observed' and r.entitlement_observed_at=p_observed and r.entitlement_source_hash=p_hash
 and s.source_hash=p_hash and s.source_observed_at=p_observed and p_observed<=statement_timestamp() and s.provider_status='active'
 and ((e.entitlement_status='trial' and s.trial_ends_at>statement_timestamp())
 or (e.entitlement_status='active' and s.current_cycle_start<=statement_timestamp() and s.current_cycle_end>statement_timestamp())))
$fn$;
create function operations.stop_shopify_order_entitlement(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare r operations.shopify_order_work_reservations%rowtype; release_slot boolean:=false;
begin
 if p_reason is null or p_reason not in ('entitlement_not_dispatched','entitlement_denied','entitlement_unknown','entitlement_write_unconfirmed','authority_changed')
 then raise exception 'SHOPIFY_ORDER_ENTITLEMENT_STOP_INVALID'; end if;
 perform 1 from operations.refresh_control where singleton for update;
 if not exists(select 1 from shopify.installations i where i.id=p_installation and i.workspace_id=p_workspace and i.shop_id=p_shop and i.shop_domain=p_domain) then return null; end if;
 select * into r from operations.shopify_order_work_reservations where installation_id=p_installation and workspace_id=p_workspace and install_generation=p_generation
 and range_key=p_key and attempt_id=p_attempt and fence=p_fence and status='reserved' and phase in ('entitlement_intent','entitlement_dispatched','entitlement_observed','entitlement_denied') for update;
 if not found then return null; end if;
 if p_reason='entitlement_not_dispatched' and r.phase='entitlement_intent' then release_slot:=true; end if;
 if p_reason='entitlement_denied' and r.phase='entitlement_denied' then release_slot:=true; end if;
 if release_slot then
  update operations.shopify_order_work_reservations set phase='stopped',stop_reason=p_reason,status='released',released_at=statement_timestamp() where attempt_id=p_attempt;
 else
  update operations.shopify_order_work_reservations set phase='stopped',stop_reason=p_reason where attempt_id=p_attempt;
 end if;
 update operations.refresh_control set revision=revision+1 where singleton;
 return jsonb_build_object('recorded',true,'reservationRetained',not release_slot);
end
$fn$;
revoke all on function operations.shopify_order_work_is_current(bigint,uuid,bigint,text,text,text,uuid,bigint),
 operations.release_shopify_order_work(bigint,uuid,bigint,text,text,text,uuid,bigint),
 operations.begin_shopify_order_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint),
 operations.load_shopify_order_entitlement_context(bigint,uuid,bigint,text,text,text,uuid,bigint),
 operations.dispatch_shopify_order_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint),
 operations.apply_shopify_order_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint,jsonb),
 operations.shopify_order_entitlement_is_current(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text),
 operations.stop_shopify_order_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint,text)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.release_shopify_order_work(bigint,uuid,bigint,text,text,text,uuid,bigint),
 operations.begin_shopify_order_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint),
 operations.load_shopify_order_entitlement_context(bigint,uuid,bigint,text,text,text,uuid,bigint),
 operations.dispatch_shopify_order_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint),
 operations.apply_shopify_order_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint,jsonb),
 operations.shopify_order_entitlement_is_current(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text),
 operations.stop_shopify_order_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint,text) to adstable_refresh_coordinator;
commit;
