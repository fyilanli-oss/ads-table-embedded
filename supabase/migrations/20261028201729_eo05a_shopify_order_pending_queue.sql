begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Pending operational metadata only, never Order/LineItem facts or durable page evidence.
create table operations.shopify_order_queue_control(
 singleton boolean primary key default true check(singleton),
 revision bigint not null default 0 check(revision between 0 and 9007199254740990),
 configuration_epoch bigint not null default 1 check(configuration_epoch between 1 and 9007199254740991),
 enabled boolean not null default false,
 max_pending_total integer check(max_pending_total between 1 and 1000000),
 max_pending_per_installation integer check(max_pending_per_installation between 1 and 1000000),
 check(not enabled or (max_pending_total is not null and max_pending_per_installation is not null
   and max_pending_per_installation<=max_pending_total))
);
create table operations.shopify_order_pending_ranges(
 installation_id bigint not null references shopify.installations(id) on delete cascade,
 workspace_id uuid not null references app.workspaces(id) on delete cascade,
 install_generation bigint not null check(install_generation between 1 and 9007199254740991),
 range_key text not null check(range_key~'^[a-f0-9]{64}$'),
 from_inclusive timestamptz not null,to_exclusive timestamptz not null,
 include_order_history boolean not null,page_size integer not null check(page_size between 1 and 100),
 api_version text not null check(api_version='2026-10'),configuration_epoch bigint not null,
 quota_contexts jsonb not null check(jsonb_typeof(quota_contexts)='object'),
 quota_routes jsonb not null check(jsonb_typeof(quota_routes)='array' and jsonb_array_length(quota_routes)=5),
 status text not null default 'queued' check(status in ('queued','cancelled')),
 version bigint not null default 1 check(version between 1 and 9007199254740991),
 queued_at timestamptz not null default statement_timestamp(),changed_at timestamptz not null default statement_timestamp(),
 primary key(installation_id,range_key),check(from_inclusive<to_exclusive),
 unique(installation_id,from_inclusive,to_exclusive,include_order_history,api_version)
);
create index shopify_order_pending_workspace_idx on operations.shopify_order_pending_ranges(workspace_id);
create index shopify_order_pending_installation_idx on operations.shopify_order_pending_ranges(installation_id,queued_at) where status='queued';
create index shopify_order_pending_global_idx on operations.shopify_order_pending_ranges(queued_at) where status='queued';
alter table operations.shopify_order_queue_control enable row level security;
alter table operations.shopify_order_queue_control force row level security;
alter table operations.shopify_order_pending_ranges enable row level security;
alter table operations.shopify_order_pending_ranges force row level security;
create policy shopify_order_queue_control_owner on operations.shopify_order_queue_control to adstable_owner using(true) with check(true);
create policy shopify_order_pending_ranges_owner on operations.shopify_order_pending_ranges to adstable_owner using(true) with check(true);
revoke all on operations.shopify_order_queue_control,operations.shopify_order_pending_ranges
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
insert into operations.shopify_order_queue_control(singleton) values(true);
create function operations.guard_shopify_order_queue_configuration() returns trigger
language plpgsql set search_path='' as $fn$
begin
 if new.revision<old.revision or new.configuration_epoch<old.configuration_epoch
   or ((new.enabled,new.max_pending_total,new.max_pending_per_installation) is distinct from
       (old.enabled,old.max_pending_total,old.max_pending_per_installation) and new.configuration_epoch<=old.configuration_epoch)
 then raise exception 'SHOPIFY_ORDER_QUEUE_CONFIGURATION_EPOCH_REQUIRED'; end if;
 return new;
end
$fn$;
create trigger shopify_order_queue_configuration_guard before update on operations.shopify_order_queue_control
 for each row execute function operations.guard_shopify_order_queue_configuration();

-- Read current nonsecret routing inventory only; NOT a dispatch/entitlement/work-fence receipt.
create function operations.shopify_order_queue_contexts(p_installation bigint,p_workspace uuid,p_generation bigint) returns jsonb
language sql stable security definer set search_path='' as $fn$
 select case when count(*)=2 then jsonb_object_agg(q.provider,jsonb_build_object(
 'provider',q.provider,'clientScopeKey',q.client_scope_key,'connectionScopeKey',q.connection_scope_key,
 'connectionEpoch',q.connection_epoch,'accountId',q.account_id,'organizationId',q.organization_id,'apiVersion',q.api_version)) else null end
 from operations.refresh_quota_contexts q join shopify.installations i on i.id=q.installation_id
 join app.workspaces w on w.id=i.workspace_id
 where i.id=p_installation and i.workspace_id=p_workspace and i.install_generation=p_generation
 and i.status='active' and w.status='active' and q.workspace_id=p_workspace and q.install_generation=p_generation and q.enabled
 and q.connection_id is null and q.connection_version is null
 and ((q.provider='shopify_admin' and q.account_id=i.shop_domain and q.organization_id is null and q.api_version='2026-10')
 or (q.provider='shopify_partner' and q.account_id is null and q.organization_id is not null))
$fn$;
create function operations.read_shopify_order_queue_admission(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare c operations.shopify_order_queue_control%rowtype; contexts jsonb;
begin
 if not exists(select 1 from shopify.installations i join app.workspaces w on w.id=i.workspace_id
   where i.id=p_installation and i.workspace_id=p_workspace and i.install_generation=p_generation
   and i.shop_id=p_shop and i.shop_domain=p_domain and i.status='active' and w.status='active') then return jsonb_build_object('status','not_current'); end if;
 select * into c from operations.shopify_order_queue_control where singleton;
 if not found or not c.enabled then return jsonb_build_object('status','not_configured'); end if;
 contexts:=operations.shopify_order_queue_contexts(p_installation,p_workspace,p_generation);
 if contexts is null then return jsonb_build_object('status','quota_configuration_required'); end if;
 return jsonb_build_object('status','ready','revision',c.revision,'configurationEpoch',c.configuration_epoch,'contexts',contexts);
end
$fn$;

create function operations.enqueue_shopify_order_range(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,
 p_key text,p_from timestamptz,p_to timestamptz,p_history boolean,p_page integer,p_revision bigint,p_epoch bigint,p_contexts jsonb,p_routes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare c operations.shopify_order_queue_control%rowtype; i shopify.installations%rowtype;
 existing operations.shopify_order_pending_ranges%rowtype; contexts jsonb; route jsonb; ctx jsonb; calculated text; expected_key text;
begin
 if p_key is null or p_key!~'^[a-f0-9]{64}$' or p_from is null or p_to is null or p_from>=p_to
 or not isfinite(p_from) or not isfinite(p_to)
 or p_from<>date_trunc('milliseconds',p_from) or p_to<>date_trunc('milliseconds',p_to)
 or p_to>statement_timestamp() or p_history is null or p_page is null or p_page not between 1 and 100
 or p_revision is null or p_epoch is null or p_contexts is null or p_routes is null
 then raise exception 'SHOPIFY_ORDER_QUEUE_INPUT_INVALID'; end if;
 select * into strict c from operations.shopify_order_queue_control where singleton for update;
 if not c.enabled then return jsonb_build_object('status','not_configured'); end if;
 select x.* into i from shopify.installations x join app.workspaces w on w.id=x.workspace_id
 where x.id=p_installation and x.workspace_id=p_workspace and x.install_generation=p_generation
 and x.shop_id=p_shop and x.shop_domain=p_domain and x.status='active' and w.status='active' for share of x,w;
 if not found then return jsonb_build_object('status','not_current'); end if;
 expected_key:=encode(sha256(convert_to(replace(json_build_array('shopify_orders',json_build_object(
  'provider','shopify','workspaceId',p_workspace::text,'installGeneration',p_generation,'shopId',i.shop_id,
  'shopDomain',i.shop_domain,'installationId',i.id::text),'2026-10',p_history,json_build_object(
  'fromInclusive',to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'toExclusive',to_char(p_to at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))::text,' ',''),'UTF8')),'hex');
 if expected_key<>p_key then raise exception 'SHOPIFY_ORDER_QUEUE_KEY_MISMATCH'; end if;
 if c.configuration_epoch<>p_epoch then return jsonb_build_object('status','conflict'); end if;
 select * into existing from operations.shopify_order_pending_ranges where installation_id=i.id and range_key=p_key;
 if found then
  if existing.from_inclusive<>p_from or existing.to_exclusive<>p_to or existing.include_order_history<>p_history
    or existing.page_size<>p_page or existing.configuration_epoch<>p_epoch or existing.quota_contexts<>p_contexts or existing.quota_routes<>p_routes
  then return jsonb_build_object('status','record_conflict'); end if;
  return jsonb_build_object('status','already_recorded','recordStatus',existing.status,'version',existing.version,'rangeKey',existing.range_key);
 end if;
 if c.revision<>p_revision then return jsonb_build_object('status','conflict'); end if;
 contexts:=operations.shopify_order_queue_contexts(i.id,p_workspace,p_generation);
 if contexts is null or contexts<>p_contexts then return jsonb_build_object('status','quota_configuration_required'); end if;
 if jsonb_typeof(p_routes)<>'array' or jsonb_array_length(p_routes)<>5 then raise exception 'SHOPIFY_ORDER_QUEUE_ROUTES_INVALID'; end if;
 if (select count(distinct x->>'family') from jsonb_array_elements(p_routes) x)<>5 then raise exception 'SHOPIFY_ORDER_QUEUE_ROUTES_INVALID'; end if;
 for route in select value from jsonb_array_elements(p_routes) loop
  if jsonb_typeof(route)<>'object' or (select count(*) from jsonb_object_keys(route))<>4
    or not route ?& array['family','provider','routeKey','connectionScopeKey']
    or (route->>'provider'='shopify_partner' and route->>'family'<>'partner_graphql')
    or (route->>'provider'='shopify_admin' and route->>'family' not in ('permission_scopes','order_headers','order_lines','order_journey'))
    or coalesce(route->>'provider','') not in ('shopify_partner','shopify_admin')
  then raise exception 'SHOPIFY_ORDER_QUEUE_ROUTES_INVALID'; end if;
  ctx:=contexts->(route->>'provider');
  calculated:=encode(sha256(convert_to(replace(json_build_array('quota_route_v1',ctx->>'provider',ctx->>'clientScopeKey',
    ctx->>'connectionScopeKey',(ctx->>'connectionEpoch')::bigint,ctx->>'accountId',ctx->>'organizationId',ctx->>'apiVersion',route->>'family','[]'::json)::text,' ',''),'UTF8')),'hex');
  if route->>'routeKey' is distinct from calculated or route->>'connectionScopeKey' is distinct from ctx->>'connectionScopeKey'
   or operations.resolve_shared_api_quota_route(calculated,ctx->>'connectionScopeKey',ctx->>'provider') is distinct from calculated
  then return jsonb_build_object('status','quota_configuration_required'); end if;
 end loop;
 if exists(select 1 from operations.shopify_order_pending_ranges q where q.installation_id=i.id and q.status='queued'
   and q.from_inclusive<p_to and q.to_exclusive>p_from) then return jsonb_build_object('status','record_conflict'); end if;
 if (select count(*) from (select 1 from operations.shopify_order_pending_ranges where status='queued' limit c.max_pending_total) q)>=c.max_pending_total
  or (select count(*) from (select 1 from operations.shopify_order_pending_ranges where status='queued' and installation_id=i.id limit c.max_pending_per_installation) q)>=c.max_pending_per_installation
 then return jsonb_build_object('status','queue_full'); end if;
 insert into operations.shopify_order_pending_ranges(installation_id,workspace_id,install_generation,range_key,from_inclusive,to_exclusive,
  include_order_history,page_size,api_version,configuration_epoch,quota_contexts,quota_routes)
 values(i.id,p_workspace,p_generation,p_key,p_from,p_to,p_history,p_page,'2026-10',p_epoch,contexts,p_routes);
 update operations.shopify_order_queue_control set revision=revision+1 where singleton;
 return jsonb_build_object('status','queued','recordStatus','queued','version',1,'rangeKey',p_key);
end
$fn$;
create function operations.read_shopify_order_pending_range(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text)
returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('rangeKey',q.range_key,'recordStatus',q.status,'version',q.version,
 'fromInclusive',to_char(q.from_inclusive at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'toExclusive',to_char(q.to_exclusive at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
 from operations.shopify_order_pending_ranges q join shopify.installations i on i.id=q.installation_id
 join app.workspaces w on w.id=i.workspace_id
 where i.id=p_installation and i.workspace_id=p_workspace and i.install_generation=p_generation and i.shop_id=p_shop and i.shop_domain=p_domain
 and i.status='active' and w.status='active' and q.workspace_id=p_workspace and q.install_generation=p_generation and q.range_key=p_key
$fn$;
revoke all on function operations.guard_shopify_order_queue_configuration(),operations.shopify_order_queue_contexts(bigint,uuid,bigint),
 operations.read_shopify_order_queue_admission(bigint,uuid,bigint,text,text),
 operations.enqueue_shopify_order_range(bigint,uuid,bigint,text,text,text,timestamptz,timestamptz,boolean,integer,bigint,bigint,jsonb,jsonb),
 operations.read_shopify_order_pending_range(bigint,uuid,bigint,text,text,text)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.read_shopify_order_queue_admission(bigint,uuid,bigint,text,text),
 operations.enqueue_shopify_order_range(bigint,uuid,bigint,text,text,text,timestamptz,timestamptz,boolean,integer,bigint,bigint,jsonb,jsonb),
 operations.read_shopify_order_pending_range(bigint,uuid,bigint,text,text,text) to adstable_refresh_coordinator;
commit;
