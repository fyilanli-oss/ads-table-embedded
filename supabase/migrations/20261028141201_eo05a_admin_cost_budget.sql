begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Existing private inventory only. No native profiles, limits or routes are seeded.
alter table operations.api_quota_operations drop constraint api_quota_operations_provider_check,
  add constraint api_quota_operations_provider_check check(provider in ('shopify_partner','shopify_admin','meta','google_ads','klaviyo')),
  add column reserved_requested_cost bigint,
  add constraint api_quota_operations_admin_cost_check check(
    (provider='shopify_admin' and route_required and reserved_requested_cost between 1 and 9007199254740991 and reserved_requested_cost is not null)
    or (provider<>'shopify_admin' and reserved_requested_cost is null));
alter table operations.api_quota_policies drop constraint api_quota_policies_provider_check,
  add constraint api_quota_policies_provider_check check(provider in ('shopify_partner','shopify_admin','meta','google_ads','klaviyo')),
  add column cost_unit text not null default 'quota_units',
  add constraint api_quota_policies_cost_unit_check check(
    (provider='shopify_admin' and cost_unit='shopify_admin_query_points')
    or (provider<>'shopify_admin' and cost_unit='quota_units'));
alter table operations.api_quota_failure_domains drop constraint api_quota_failure_domains_provider_check,
  add constraint api_quota_failure_domains_provider_check check(provider in ('shopify_partner','shopify_admin','meta','google_ads','klaviyo'));

-- Preserve existing providers' exact fingerprint; Admin binds point units and ceiling too.
create or replace function operations.shared_api_quota_fingerprint(p_operation text) returns text
language sql stable security definer set search_path='' as $fn$
  select encode(sha256(convert_to(string_agg(
    q.id::text||':'||q.provider||':'||q.window_ms::text||':'||q.max_units::text||':'||q.interactive_reserve::text||':'||
    q.dispatch_delay_ms::text||':'||q.max_outstanding::text||':'||b.units::text||
    case when op.provider='shopify_admin' then ':'||q.cost_unit||':'||op.reserved_requested_cost::text else '' end,
    ',' order by q.id),'UTF8')),'hex')
  from operations.api_quota_bindings b join operations.api_quota_policies q on q.id=b.policy_id
    join operations.api_quota_operations op on op.operation_key=b.operation_key where b.operation_key=p_operation
$fn$;

alter function operations.reserve_shared_api_quota(text,uuid,text) rename to reserve_shared_api_quota_before_admin_cost;
revoke all on function operations.reserve_shared_api_quota_before_admin_cost(text,uuid,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.reserve_shared_api_quota(p_operation text,p_attempt uuid,p_lane text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare op operations.api_quota_operations%rowtype; result jsonb;
begin
  if p_operation is null or p_operation !~ '^[a-f0-9]{64}$' or p_attempt is null or p_lane is null or p_lane not in ('interactive','background') then
    raise exception 'API_QUOTA_INPUT_INVALID'; end if;
  select * into op from operations.api_quota_operations where operation_key=p_operation for update;
  if not found or not op.enabled then return jsonb_build_object('status','not_configured'); end if;
  if op.provider='shopify_admin' then
    -- No permit from request counts or a partially charged point scope set.
    perform 1 from operations.api_quota_bindings where operation_key=p_operation order by policy_id for share;
    if not exists(select 1 from operations.api_quota_bindings where operation_key=p_operation)
      or exists(select 1 from operations.api_quota_bindings b join operations.api_quota_policies q on q.id=b.policy_id
        where b.operation_key=p_operation and (q.provider<>'shopify_admin' or q.cost_unit<>'shopify_admin_query_points' or b.units<>op.reserved_requested_cost)) then
      return jsonb_build_object('status','not_configured'); end if;
  end if;
  -- Original route/failure-domain/policy locks, interactive headroom, stop and feedback chain.
  result:=operations.reserve_shared_api_quota_before_admin_cost(p_operation,p_attempt,p_lane);
  if op.provider='shopify_admin' and result->>'status'='reserved' then
    -- Existing chain holds all policy locks here; reject the whole transaction on a changed debit.
    if (select count(*) from operations.api_quota_debits where operation_key=p_operation and attempt_id=p_attempt)
       <>(select count(*) from operations.api_quota_bindings where operation_key=p_operation)
      or exists(select 1 from operations.api_quota_debits d join operations.api_quota_policies q on q.id=d.policy_id
        where d.operation_key=p_operation and d.attempt_id=p_attempt
          and (d.units<>op.reserved_requested_cost or q.provider<>'shopify_admin' or q.cost_unit<>'shopify_admin_query_points')) then
      raise exception 'API_QUOTA_ADMIN_COST_CHANGED'; end if;
    return result||jsonb_build_object('costBudget',jsonb_build_object('unit','shopify_admin_query_points','reservedRequestedCost',op.reserved_requested_cost));
  end if;
  return result;
end
$fn$;
revoke all on function operations.reserve_shared_api_quota(text,uuid,text),operations.shared_api_quota_fingerprint(text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.reserve_shared_api_quota(text,uuid,text) to adstable_refresh_coordinator;
reset role;
commit;
