begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Independent source policy, closed by default; never add Shopify to reporting providers.
alter table operations.shopify_order_queue_control
 add column worker_enabled boolean not null default false,
 add column worker_epoch bigint not null default 1 check(worker_epoch between 1 and 9007199254740991),
 add column worker_cost jsonb,
 add constraint shopify_order_worker_cost_required check(not worker_enabled or
   (worker_cost is not null and operations.refresh_vector_valid(worker_cost) is true
    and (worker_cost->>'requests')::numeric>0 and (worker_cost->>'dbWrites')::numeric>0
    and (worker_cost->>'connections')::numeric>0 and (worker_cost->>'rows')::numeric>0 and (worker_cost->>'bytes')::numeric>0));
create function operations.guard_shopify_order_worker_policy() returns trigger
language plpgsql set search_path='' as $fn$
begin
 if new.worker_epoch<old.worker_epoch or
 ((new.worker_enabled,new.worker_cost) is distinct from (old.worker_enabled,old.worker_cost) and new.worker_epoch<=old.worker_epoch)
 then raise exception 'SHOPIFY_ORDER_WORKER_EPOCH_REQUIRED'; end if;
 return new;
end
$fn$;
create trigger shopify_order_worker_policy_guard before update on operations.shopify_order_queue_control
 for each row execute function operations.guard_shopify_order_worker_policy();
create table operations.shopify_order_work_reservations(
 attempt_id uuid primary key,
 installation_id bigint not null,range_key text not null,
 workspace_id uuid not null references app.workspaces(id) on delete restrict,
 install_generation bigint not null,
 fence bigint not null unique check(fence between 1 and 9007199254740991),
 cost jsonb not null check(operations.refresh_vector_valid(cost) is true),
 queue_epoch bigint not null,worker_epoch bigint not null,range_version bigint not null,
 status text not null check(status in ('reserved','released')),
 reserved_at timestamptz not null default statement_timestamp(),released_at timestamptz,
 check((status='reserved')=(released_at is null)),
 foreign key(installation_id,range_key) references operations.shopify_order_pending_ranges(installation_id,range_key) on delete restrict
);
create unique index shopify_order_work_single_flight_idx on operations.shopify_order_work_reservations(installation_id) where status='reserved';
create index shopify_order_work_range_idx on operations.shopify_order_work_reservations(installation_id,range_key);
create index shopify_order_work_workspace_idx on operations.shopify_order_work_reservations(workspace_id) where status='reserved';
-- Full FK index also covers released records for parent deletion checks.
create index shopify_order_work_workspace_fk_idx on operations.shopify_order_work_reservations(workspace_id);
alter table operations.shopify_order_work_reservations enable row level security;
alter table operations.shopify_order_work_reservations force row level security;
create policy shopify_order_work_owner on operations.shopify_order_work_reservations to adstable_owner using(true) with check(true);
revoke all on operations.shopify_order_work_reservations from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- SQL source of truth: shared global/workspace resources; no provider/account fabricated.
create function operations.shopify_order_combined_capacity(p_claims jsonb,p_workspace uuid,p_extra jsonb) returns text
language plpgsql stable security definer set search_path='' as $fn$
declare c operations.refresh_control%rowtype; scope jsonb; resource text; maximum numeric; consumed numeric; additional integer:=0;
begin
 select * into c from operations.refresh_control where singleton;
 if c.budget is null or c.bounds is null or jsonb_typeof(p_claims) is distinct from 'array'
 or operations.refresh_vector_valid(c.budget->'global') is not true
 or operations.refresh_vector_valid(c.budget->'interactiveReserve') is not true
 or operations.refresh_vector_valid(p_extra) is not true
 or jsonb_typeof(c.bounds->'maxClaims') is distinct from 'number'
 or coalesce(c.bounds->>'maxClaims','')!~'^[1-9][0-9]*$'
 or (c.bounds->>'maxClaims')::numeric>2147483646 then return 'budget_unknown'; end if;
 if p_workspace is not null then additional:=1; end if;
 if jsonb_array_length(p_claims)+(select count(*) from operations.shopify_order_work_reservations where status='reserved')
   +additional > (c.bounds->>'maxClaims')::numeric then return 'budget_full'; end if;
 if exists(select 1 from jsonb_array_elements(p_claims) x where operations.refresh_vector_valid(x->'cost') is not true) then return 'budget_unknown'; end if;
 if p_workspace is not null and (select count(*) from jsonb_array_elements(c.budget->'workspaces') x where x->>'workspaceId'=p_workspace::text)<>1 then return 'budget_unknown'; end if;
 for scope in select jsonb_build_object('workspaceId',null,'limit',c.budget->'global')
   union all select value from jsonb_array_elements(c.budget->'workspaces') loop
  if operations.refresh_vector_valid(scope->'limit') is not true then return 'budget_unknown'; end if;
  foreach resource in array array['requests','dbWrites','connections','rows','bytes'] loop
   maximum:=(scope->'limit'->>resource)::numeric;
   if scope->>'workspaceId' is null then maximum:=maximum-(c.budget->'interactiveReserve'->>resource)::numeric; end if;
   select coalesce(sum((x->'cost'->>resource)::numeric),0) into consumed from jsonb_array_elements(p_claims) x
    where scope->>'workspaceId' is null or x->>'workspaceId'=scope->>'workspaceId';
   consumed:=consumed+coalesce((select sum((r.cost->>resource)::numeric) from operations.shopify_order_work_reservations r
     where r.status='reserved' and (scope->>'workspaceId' is null or r.workspace_id::text=scope->>'workspaceId')),0);
   if p_workspace is not null and (scope->>'workspaceId' is null or p_workspace::text=scope->>'workspaceId') then consumed:=consumed+(p_extra->>resource)::numeric; end if;
   if consumed>maximum then return 'budget_full'; end if;
  end loop;
 end loop;
 return 'ready';
end
$fn$;

alter function operations.read_refresh_admission_snapshot() rename to read_refresh_admission_snapshot_before_shopify_orders;
revoke all on function operations.read_refresh_admission_snapshot_before_shopify_orders() from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.read_refresh_admission_snapshot() returns jsonb
language sql stable security definer set search_path='' as $fn$
 select case when exists(select 1 from operations.shopify_order_work_reservations where status='reserved') then
 jsonb_set(s.value,'{state,externalClaims}',coalesce((select jsonb_agg(jsonb_build_object('source','shopify_orders','id',r.attempt_id::text,
 'installationId',r.installation_id::text,'workspaceId',r.workspace_id::text,'fence',r.fence,'cost',r.cost) order by r.fence)
 from (select * from operations.shopify_order_work_reservations where status='reserved' order by fence
 limit case when coalesce(s.value->'bounds'->>'maxClaims','')~'^[1-9][0-9]{0,8}$' then (s.value->'bounds'->>'maxClaims')::integer+1 else 1 end) r),'[]'::jsonb))
 else s.value end from (select operations.read_refresh_admission_snapshot_before_shopify_orders() value) s
$fn$;
alter function operations.commit_refresh_admissions(bigint,jsonb) rename to commit_refresh_admissions_before_shopify_orders;
revoke all on function operations.commit_refresh_admissions_before_shopify_orders(bigint,jsonb) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.commit_refresh_admissions(expected_revision bigint,proposed jsonb) returns boolean
language plpgsql security definer set search_path='' as $fn$
begin
 perform 1 from operations.refresh_control where singleton for update;
 if expected_revision is distinct from (select revision from operations.refresh_control where singleton) then return false; end if;
 if exists(select 1 from operations.shopify_order_work_reservations where status='reserved')
 and operations.shopify_order_combined_capacity(proposed->'claims',null,'{"requests":0,"dbWrites":0,"connections":0,"rows":0,"bytes":0}'::jsonb) is distinct from 'ready'
 then return false; end if;
 return operations.commit_refresh_admissions_before_shopify_orders(expected_revision,proposed);
end
$fn$;

create function operations.reserve_shopify_order_work(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare c operations.refresh_control%rowtype; policy operations.shopify_order_queue_control%rowtype;
 q operations.shopify_order_pending_ranges%rowtype; route jsonb; contexts jsonb; claims jsonb; capacity text;
begin
 if p_attempt is null then raise exception 'SHOPIFY_ORDER_WORK_INPUT_INVALID'; end if;
 -- Same lock order for both work classes. No database transaction spans native HTTP.
 select * into strict c from operations.refresh_control where singleton for update;
 select * into strict policy from operations.shopify_order_queue_control where singleton for update;
 if not policy.enabled or not policy.worker_enabled then return jsonb_build_object('status','not_configured'); end if;
 perform 1 from shopify.installations i join app.workspaces w on w.id=i.workspace_id
 where i.id=p_installation and i.workspace_id=p_workspace and i.install_generation=p_generation
 and i.shop_id=p_shop and i.shop_domain=p_domain and i.status='active' and w.status='active' for share of i,w;
 if not found then return jsonb_build_object('status','not_current'); end if;
 select * into q from operations.shopify_order_pending_ranges where installation_id=p_installation and range_key=p_key for update;
 if not found or q.workspace_id<>p_workspace or q.install_generation<>p_generation or q.status<>'queued'
 or q.configuration_epoch<>policy.configuration_epoch then return jsonb_build_object('status','not_current'); end if;
 if exists(select 1 from operations.shopify_order_work_reservations where attempt_id=p_attempt)
 then return jsonb_build_object('status','attempt_exists'); end if;
 if exists(select 1 from operations.shopify_order_work_reservations where installation_id=p_installation and status='reserved')
 then return jsonb_build_object('status','installation_busy'); end if;
 contexts:=operations.shopify_order_queue_contexts(p_installation,p_workspace,p_generation);
 if contexts is null or contexts<>q.quota_contexts then return jsonb_build_object('status','quota_configuration_required'); end if;
 for route in select value from jsonb_array_elements(q.quota_routes) loop
  if operations.resolve_shared_api_quota_route(route->>'routeKey',route->>'connectionScopeKey',route->>'provider') is distinct from route->>'routeKey'
  then return jsonb_build_object('status','quota_configuration_required'); end if;
 end loop;
 claims:=operations.read_refresh_admission_snapshot()->'state'->'claims';
 capacity:=operations.shopify_order_combined_capacity(claims,p_workspace,policy.worker_cost);
 if capacity is distinct from 'ready' then return jsonb_build_object('status',coalesce(capacity,'budget_unknown')); end if;
 if c.next_fence>=9007199254740991 or c.revision>=9007199254740991 then raise exception 'SHOPIFY_ORDER_WORK_COUNTER_EXHAUSTED'; end if;
 insert into operations.shopify_order_work_reservations(attempt_id,installation_id,range_key,workspace_id,install_generation,fence,cost,queue_epoch,worker_epoch,range_version,status)
 values(p_attempt,p_installation,p_key,p_workspace,p_generation,c.next_fence,policy.worker_cost,policy.configuration_epoch,policy.worker_epoch,q.version,'reserved');
 update operations.refresh_control set revision=revision+1,next_fence=next_fence+1 where singleton;
 return jsonb_build_object('status','reserved','attemptId',p_attempt::text,'rangeKey',p_key,'fence',c.next_fence,'cost',policy.worker_cost);
end
$fn$;

create function operations.read_shopify_order_work_reservation(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid)
returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('attemptId',r.attempt_id::text,'rangeKey',r.range_key,'fence',r.fence,'cost',r.cost,'reservationStatus',r.status)
 from operations.shopify_order_work_reservations r join shopify.installations i on i.id=r.installation_id join app.workspaces w on w.id=i.workspace_id
 where r.installation_id=p_installation and r.workspace_id=p_workspace and r.install_generation=p_generation and r.range_key=p_key and r.attempt_id=p_attempt
 and i.workspace_id=p_workspace and i.install_generation=p_generation and i.shop_id=p_shop and i.shop_domain=p_domain and i.status='active' and w.status='active'
$fn$;
-- Only pre-HTTP reservations exist in this migration. Future request-intent work must
-- close this release path after an intent; elapsed time or unknown outcome never releases.
create function operations.release_shopify_order_work(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint)
returns boolean language plpgsql security definer set search_path='' as $fn$
begin
 perform 1 from operations.refresh_control where singleton for update;
 if not exists(select 1 from shopify.installations i join app.workspaces w on w.id=i.workspace_id where i.id=p_installation
 and i.workspace_id=p_workspace and i.install_generation=p_generation and i.shop_id=p_shop and i.shop_domain=p_domain and i.status='active' and w.status='active') then return false; end if;
 update operations.shopify_order_work_reservations set status='released',released_at=statement_timestamp()
 where installation_id=p_installation and workspace_id=p_workspace and install_generation=p_generation and range_key=p_key and attempt_id=p_attempt and fence=p_fence and status='reserved';
 if not found then return false; end if;
 update operations.refresh_control set revision=revision+1 where singleton;
 return true;
end
$fn$;
revoke all on function operations.guard_shopify_order_worker_policy(),operations.shopify_order_combined_capacity(jsonb,uuid,jsonb),
 operations.read_refresh_admission_snapshot(),operations.commit_refresh_admissions(bigint,jsonb),
 operations.reserve_shopify_order_work(bigint,uuid,bigint,text,text,text,uuid),operations.read_shopify_order_work_reservation(bigint,uuid,bigint,text,text,text,uuid),
 operations.release_shopify_order_work(bigint,uuid,bigint,text,text,text,uuid,bigint)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
-- Preserve the native source-bound preflight gate: generic ad admission remains owner-only.
grant execute on function operations.read_refresh_admission_snapshot(),
 operations.reserve_shopify_order_work(bigint,uuid,bigint,text,text,text,uuid),operations.read_shopify_order_work_reservation(bigint,uuid,bigint,text,text,text,uuid),
 operations.release_shopify_order_work(bigint,uuid,bigint,text,text,text,uuid,bigint) to adstable_refresh_coordinator;
commit;
