begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

alter table operations.api_quota_operations add column route_required boolean not null default false;
-- No production bindings/limits/client identities are inserted. Disabled by default.
create table operations.api_quota_route_profiles (
  operation_key text primary key references operations.api_quota_operations(operation_key) on delete cascade,
  domain_id text not null references operations.api_quota_failure_domains(id),
  quota_fingerprint text not null check(quota_fingerprint ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default false
);
create index api_quota_route_profiles_domain_idx on operations.api_quota_route_profiles(domain_id);
create table operations.api_quota_routes (
  route_key text primary key check(route_key ~ '^[a-f0-9]{64}$'),
  operation_key text not null unique references operations.api_quota_route_profiles(operation_key) on delete cascade,
  enabled boolean not null default false,
  check(route_key=operation_key)
);
create index api_quota_routes_operation_idx on operations.api_quota_routes(operation_key);
alter table operations.api_quota_route_profiles enable row level security;
alter table operations.api_quota_route_profiles force row level security;
alter table operations.api_quota_routes enable row level security;
alter table operations.api_quota_routes force row level security;
create policy api_quota_route_profiles_owner on operations.api_quota_route_profiles to adstable_owner using(true) with check(true);
create policy api_quota_routes_owner on operations.api_quota_routes to adstable_owner using(true) with check(true);
revoke all on operations.api_quota_route_profiles,operations.api_quota_routes from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- Canonical ALL-policy fingerprint, not a caller-supplied subset. Fixed typed components only.
create function operations.shared_api_quota_fingerprint(p_operation text) returns text
language sql stable security definer set search_path='' as $fn$
  select encode(sha256(convert_to(string_agg(
    q.id::text||':'||q.provider||':'||q.window_ms::text||':'||q.max_units::text||':'||q.interactive_reserve::text||':'||
    q.dispatch_delay_ms::text||':'||q.max_outstanding::text||':'||b.units::text,',' order by q.id),'UTF8')),'hex')
  from operations.api_quota_bindings b join operations.api_quota_policies q on q.id=b.policy_id where b.operation_key=p_operation
$fn$;

create function operations.shared_api_quota_profile_valid(p_operation text) returns boolean
language sql stable security definer set search_path='' as $fn$
  select exists(select 1 from operations.api_quota_route_profiles p
    join operations.api_quota_operations op on op.operation_key=p.operation_key
    join operations.api_quota_failure_bindings b on b.operation_key=p.operation_key and b.domain_id=p.domain_id
    join operations.api_quota_failure_domains d on d.id=p.domain_id and d.provider=op.provider
    where p.operation_key=p_operation and p.enabled and op.enabled and op.route_required
      and exists(select 1 from operations.api_quota_routes r where r.operation_key=p_operation and r.route_key=p_operation and r.enabled)
      and p.quota_fingerprint=operations.shared_api_quota_fingerprint(p_operation)
      and (select count(*) from operations.api_quota_bindings qb where qb.operation_key=p_operation) between 1 and 16
      and not exists(select 1 from operations.api_quota_bindings qb join operations.api_quota_policies q on q.id=qb.policy_id
        where qb.operation_key=p_operation and q.provider<>op.provider))
$fn$;

-- Only opaque hashes/provider enter this read path: no token, URL, dates, cursor, products or native account ID.
create function operations.resolve_shared_api_quota_route(p_route text,p_domain text,p_provider text) returns text
language sql stable security definer set search_path='' as $fn$
  select r.operation_key from operations.api_quota_routes r join operations.api_quota_route_profiles p on p.operation_key=r.operation_key
    join operations.api_quota_operations op on op.operation_key=r.operation_key
  where r.route_key=p_route and r.enabled and p.domain_id=p_domain and op.provider=p_provider
    and operations.shared_api_quota_profile_valid(r.operation_key)
$fn$;

alter function operations.reserve_shared_api_quota(text,uuid,text) rename to reserve_shared_api_quota_before_scope_resolver;
revoke all on function operations.reserve_shared_api_quota_before_scope_resolver(text,uuid,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.reserve_shared_api_quota(p_operation text,p_attempt uuid,p_lane text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare op operations.api_quota_operations%rowtype; result jsonb;
begin
  if p_operation is null or p_operation !~ '^[a-f0-9]{64}$' or p_attempt is null or p_lane is null or p_lane not in ('interactive','background') then
    raise exception 'API_QUOTA_INPUT_INVALID'; end if;
  select * into op from operations.api_quota_operations where operation_key=p_operation for update;
  if not found or not op.enabled then return jsonb_build_object('status','not_configured'); end if;
  if op.route_required then
    -- Protect the profile and existing links. FK insertion to this operation conflicts with FOR UPDATE.
    -- Native configuration writes remain owner-only and require the separate freeze/activation gate.
    perform 1 from operations.api_quota_route_profiles where operation_key=p_operation for share;
    perform 1 from operations.api_quota_failure_bindings where operation_key=p_operation for share;
    perform 1 from operations.api_quota_bindings where operation_key=p_operation order by policy_id for share;
    if not operations.shared_api_quota_profile_valid(p_operation) then return jsonb_build_object('status','not_configured'); end if;
  end if;
  result:=operations.reserve_shared_api_quota_before_scope_resolver(p_operation,p_attempt,p_lane);
  -- After the existing domain/policy locks are held, recheck exact scopes/limits. A change
  -- must roll back the WHOLE reservation, never return a rejection while retaining partial debits.
  if op.route_required and not operations.shared_api_quota_profile_valid(p_operation) then raise exception 'API_QUOTA_ROUTE_CHANGED'; end if;
  return result;
end
$fn$;

revoke all on function operations.shared_api_quota_fingerprint(text),operations.shared_api_quota_profile_valid(text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
revoke all on function operations.resolve_shared_api_quota_route(text,text,text),operations.reserve_shared_api_quota(text,uuid,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.resolve_shared_api_quota_route(text,text,text),operations.reserve_shared_api_quota(text,uuid,text) to adstable_refresh_coordinator;
reset role;
commit;
