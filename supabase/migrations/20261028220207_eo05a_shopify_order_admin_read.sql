begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;
alter table operations.shopify_order_work_reservations drop constraint shopify_order_work_reservations_phase_check;
alter table operations.shopify_order_work_reservations
 add constraint shopify_order_work_reservations_phase_check check(phase in ('pre_request','entitlement_intent','entitlement_dispatched','entitlement_observed','entitlement_denied','order_intent','order_reading','order_observed','stopped')),
 add column order_limits jsonb,
 add column order_deadline_at timestamptz,
 add column order_request_count integer not null default 0 check(order_request_count between 0 and 10000),
 add column order_observed_at timestamptz,
 add column order_stats jsonb,
 add column order_stop_reason text check(order_stop_reason is null or order_stop_reason in ('quota_not_dispatched','read_failed','authority_changed','handoff_unconfirmed'));

create or replace function operations.shopify_order_work_is_current(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint)
returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from operations.shopify_order_work_reservations r
 join operations.shopify_order_pending_ranges q on q.installation_id=r.installation_id and q.range_key=r.range_key
 join shopify.installations i on i.id=r.installation_id join app.workspaces w on w.id=i.workspace_id
 cross join operations.shopify_order_queue_control c
 where r.installation_id=p_installation and r.workspace_id=p_workspace and r.install_generation=p_generation and r.range_key=p_key
 and r.attempt_id=p_attempt and r.fence=p_fence and r.status='reserved' and r.phase in ('pre_request','entitlement_intent','entitlement_dispatched','entitlement_observed','order_intent','order_reading','order_observed')
 and i.workspace_id=p_workspace and i.install_generation=p_generation and i.shop_id=p_shop and i.shop_domain=p_domain and i.status='active' and w.status='active'
 and q.workspace_id=p_workspace and q.install_generation=p_generation and q.status='queued' and q.version=r.range_version
 and c.singleton and c.enabled and c.worker_enabled and c.configuration_epoch=r.queue_epoch and c.worker_epoch=r.worker_epoch
 and q.configuration_epoch=r.queue_epoch and r.cost=c.worker_cost
 and operations.shopify_order_queue_contexts(p_installation,p_workspace,p_generation)=q.quota_contexts
 and not exists(select 1 from jsonb_array_elements(q.quota_routes) x
 where operations.resolve_shared_api_quota_route(x->>'routeKey',x->>'connectionScopeKey',x->>'provider') is distinct from x->>'routeKey'))
$fn$;

create or replace function operations.shopify_order_entitlement_is_current(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint,p_observed timestamptz,p_hash text)
returns boolean language sql stable security definer set search_path='' as $fn$
 select operations.shopify_order_work_is_current(p_installation,p_workspace,p_generation,p_shop,p_domain,p_key,p_attempt,p_fence)
 and exists(select 1 from operations.shopify_order_work_reservations r
 join billing.workspace_subscriptions s on s.workspace_id=r.workspace_id and s.installation_id=r.installation_id and s.install_generation=r.install_generation
 join billing.workspace_entitlements e on e.workspace_id=s.workspace_id and e.install_generation=s.install_generation and e.source_hash=s.source_hash and e.source_observed_at=s.source_observed_at
 where r.attempt_id=p_attempt and r.phase in ('entitlement_observed','order_intent','order_reading','order_observed')
 and (r.phase='entitlement_observed' or r.order_deadline_at>statement_timestamp())
 and r.entitlement_observed_at=p_observed and r.entitlement_source_hash=p_hash
 and s.source_hash=p_hash and s.source_observed_at=p_observed and p_observed<=statement_timestamp() and s.provider_status='active'
 and ((e.entitlement_status='trial' and s.trial_ends_at>statement_timestamp())
 or (e.entitlement_status='active' and s.current_cycle_start<=statement_timestamp() and s.current_cycle_end>statement_timestamp())))
$fn$;

create function operations.begin_shopify_order_read(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint,p_observed timestamptz,p_hash text,p_limits jsonb,p_deadline timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare r operations.shopify_order_work_reservations%rowtype; q operations.shopify_order_pending_ranges%rowtype; k text;
begin
 perform 1 from operations.refresh_control where singleton for update;
 if not operations.shopify_order_entitlement_is_current(p_installation,p_workspace,p_generation,p_shop,p_domain,p_key,p_attempt,p_fence,p_observed,p_hash) then return null; end if;
 select * into strict r from operations.shopify_order_work_reservations where attempt_id=p_attempt;
 select * into strict q from operations.shopify_order_pending_ranges where installation_id=p_installation and range_key=p_key;
 if r.phase<>'entitlement_observed' then return null; end if;
 if p_limits is null or jsonb_typeof(p_limits)<>'object' or (select count(*) from jsonb_object_keys(p_limits))<>5
 or not p_limits ?& array['maxElapsedMs','maxRequests','maxRows','maxBytes','pageSize'] or p_deadline is null or p_deadline<=clock_timestamp()
 then raise exception 'SHOPIFY_ORDER_READ_LIMITS_INVALID'; end if;
 foreach k in array array['maxElapsedMs','maxRequests','maxRows','maxBytes','pageSize'] loop
  if jsonb_typeof(p_limits->k) is distinct from 'number' or coalesce(p_limits->>k,'')!~'^[1-9][0-9]*$'
   or (p_limits->>k)::numeric>9007199254740991 then raise exception 'SHOPIFY_ORDER_READ_LIMITS_INVALID'; end if;
 end loop;
 if (p_limits->>'maxElapsedMs')::numeric>600000 or (p_limits->>'maxRequests')::numeric>10000
 or (p_limits->>'maxRows')::numeric>least(1000000,(r.cost->>'rows')::numeric)
 or (p_limits->>'maxBytes')::numeric>least(134217728,(r.cost->>'bytes')::numeric)
 or (p_limits->>'pageSize')::numeric<>q.page_size then raise exception 'SHOPIFY_ORDER_READ_LIMITS_INVALID'; end if;
 update operations.shopify_order_work_reservations set phase='order_intent',order_limits=p_limits,
 order_deadline_at=least(p_deadline,clock_timestamp()+(p_limits->>'maxElapsedMs')::double precision*interval '1 millisecond') where attempt_id=p_attempt;
 update operations.refresh_control set revision=revision+1 where singleton;
 return q.quota_contexts->'shopify_admin';
end
$fn$;
create function operations.load_shopify_order_read_context(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint,p_observed timestamptz,p_hash text)
returns jsonb language sql stable security definer set search_path='' as $fn$
 select q.quota_contexts->'shopify_admin' from operations.shopify_order_work_reservations r join operations.shopify_order_pending_ranges q
 on q.installation_id=r.installation_id and q.range_key=r.range_key
 where r.attempt_id=p_attempt and r.phase in ('order_intent','order_reading') and r.order_deadline_at>statement_timestamp()
 and operations.shopify_order_entitlement_is_current(p_installation,p_workspace,p_generation,p_shop,p_domain,p_key,p_attempt,p_fence,p_observed,p_hash)
$fn$;
create function operations.load_shopify_order_read_owner(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint,p_observed timestamptz,p_hash text)
returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('installationId',i.id::text,'workspaceId',i.workspace_id::text,'installGeneration',i.install_generation,'shopId',i.shop_id,'shopDomain',i.shop_domain)
 from shopify.installations i where i.id=p_installation
 and operations.load_shopify_order_read_context(p_installation,p_workspace,p_generation,p_shop,p_domain,p_key,p_attempt,p_fence,p_observed,p_hash) is not null
$fn$;
create function operations.dispatch_shopify_order_read(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint,p_observed timestamptz,p_hash text)
returns boolean language plpgsql security definer set search_path='' as $fn$
begin
 perform 1 from operations.refresh_control where singleton for update;
 if operations.load_shopify_order_read_context(p_installation,p_workspace,p_generation,p_shop,p_domain,p_key,p_attempt,p_fence,p_observed,p_hash) is null then return false; end if;
 update operations.shopify_order_work_reservations set phase='order_reading',order_request_count=order_request_count+1
 where attempt_id=p_attempt and order_request_count<(order_limits->>'maxRequests')::integer;
 if not found then return false; end if;
 update operations.refresh_control set revision=revision+1 where singleton;
 return true;
end
$fn$;
create function operations.observe_shopify_order_read(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint,p_observed timestamptz,p_hash text,p_stats jsonb)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare r operations.shopify_order_work_reservations%rowtype; k text;
begin
 perform 1 from operations.refresh_control where singleton for update;
 if operations.load_shopify_order_read_context(p_installation,p_workspace,p_generation,p_shop,p_domain,p_key,p_attempt,p_fence,p_observed,p_hash) is null then return false; end if;
 select * into strict r from operations.shopify_order_work_reservations where attempt_id=p_attempt and phase='order_reading';
 if p_stats is null or jsonb_typeof(p_stats)<>'object' or (select count(*) from jsonb_object_keys(p_stats))<>3
 or not p_stats ?& array['requests','rows','SDKResponseBytes'] then raise exception 'SHOPIFY_ORDER_READ_STATS_INVALID'; end if;
 foreach k in array array['requests','rows','SDKResponseBytes'] loop
  if jsonb_typeof(p_stats->k) is distinct from 'number' or coalesce(p_stats->>k,'')!~'^[0-9]+$'
  or (p_stats->>k)::numeric>9007199254740991 then raise exception 'SHOPIFY_ORDER_READ_STATS_INVALID'; end if;
 end loop;
 if (p_stats->>'requests')::numeric<>r.order_request_count or (p_stats->>'rows')::numeric>(r.order_limits->>'maxRows')::numeric
 or (p_stats->>'SDKResponseBytes')::numeric>(r.order_limits->>'maxBytes')::numeric then raise exception 'SHOPIFY_ORDER_READ_STATS_INVALID'; end if;
 update operations.shopify_order_work_reservations set phase='order_observed',order_observed_at=statement_timestamp(),order_stats=p_stats where attempt_id=p_attempt;
 update operations.refresh_control set revision=revision+1 where singleton;
 return true;
end
$fn$;
create function operations.stop_shopify_order_read(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare r operations.shopify_order_work_reservations%rowtype; release_slot boolean:=false;
begin
 if p_reason is null or p_reason not in ('quota_not_dispatched','read_failed','authority_changed','handoff_unconfirmed') then raise exception 'SHOPIFY_ORDER_READ_STOP_INVALID'; end if;
 perform 1 from operations.refresh_control where singleton for update;
 if not exists(select 1 from shopify.installations i where i.id=p_installation and i.workspace_id=p_workspace and i.shop_id=p_shop and i.shop_domain=p_domain) then return null; end if;
 select * into r from operations.shopify_order_work_reservations where installation_id=p_installation and workspace_id=p_workspace and install_generation=p_generation
 and range_key=p_key and attempt_id=p_attempt and fence=p_fence and status='reserved' and phase in ('order_intent','order_reading','order_observed') for update;
 if not found then return null; end if;
 release_slot:=p_reason='quota_not_dispatched' and r.order_request_count=0 and r.phase='order_intent';
 if release_slot then
  update operations.shopify_order_work_reservations set phase='stopped',order_stop_reason=p_reason,status='released',released_at=statement_timestamp() where attempt_id=p_attempt;
 else
  update operations.shopify_order_work_reservations set phase='stopped',order_stop_reason=p_reason where attempt_id=p_attempt;
 end if;
 update operations.refresh_control set revision=revision+1 where singleton;
 return jsonb_build_object('recorded',true,'reservationRetained',not release_slot,'adminRequests',r.order_request_count);
end
$fn$;
revoke all on function operations.begin_shopify_order_read(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text,jsonb,timestamptz),
 operations.load_shopify_order_read_context(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text),
 operations.load_shopify_order_read_owner(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text),
 operations.dispatch_shopify_order_read(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text),
 operations.observe_shopify_order_read(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text,jsonb),
 operations.stop_shopify_order_read(bigint,uuid,bigint,text,text,text,uuid,bigint,text)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.begin_shopify_order_read(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text,jsonb,timestamptz),
 operations.load_shopify_order_read_context(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text),
 operations.load_shopify_order_read_owner(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text),
 operations.dispatch_shopify_order_read(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text),
 operations.observe_shopify_order_read(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text,jsonb),
 operations.stop_shopify_order_read(bigint,uuid,bigint,text,text,text,uuid,bigint,text) to adstable_refresh_coordinator;
commit;
