begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Failure domains are NOT rate budgets. Owner-only opaque connection/credential groups;
-- there are no production rows, automatic account inference or web runtime grants.
alter table operations.api_quota_operations add column stopped boolean not null default false;
alter table operations.api_quota_operations add column stop_kind text check(stop_kind in ('connection','rejected','unknown'));
alter table operations.api_quota_operations add column stop_signal text check(stop_signal='shopify_partner_throttled');
alter table operations.api_quota_operations add column stopped_at timestamptz;
create table operations.api_quota_failure_domains (
  id text primary key check(id ~ '^[a-f0-9]{64}$'),
  provider text not null check(provider in ('shopify_partner','meta','google_ads','klaviyo')),
  stopped boolean not null default false
);
create table operations.api_quota_failure_bindings (
  operation_key text primary key references operations.api_quota_operations(operation_key) on delete cascade,
  domain_id text not null references operations.api_quota_failure_domains(id)
);
create index api_quota_failure_bindings_domain_idx on operations.api_quota_failure_bindings(domain_id);
create table operations.api_quota_stop_rules (
  operation_key text not null references operations.api_quota_operations(operation_key) on delete cascade,
  signal text not null check(signal='shopify_partner_throttled'),
  policy_id uuid not null references operations.api_quota_policies(id),
  primary key(operation_key,signal,policy_id)
);
create index api_quota_stop_rules_policy_idx on operations.api_quota_stop_rules(policy_id);
alter table operations.api_quota_failure_domains enable row level security;
alter table operations.api_quota_failure_domains force row level security;
alter table operations.api_quota_failure_bindings enable row level security;
alter table operations.api_quota_failure_bindings force row level security;
alter table operations.api_quota_stop_rules enable row level security;
alter table operations.api_quota_stop_rules force row level security;
create policy api_quota_failure_domains_owner on operations.api_quota_failure_domains to adstable_owner using(true) with check(true);
create policy api_quota_failure_bindings_owner on operations.api_quota_failure_bindings to adstable_owner using(true) with check(true);
create policy api_quota_stop_rules_owner on operations.api_quota_stop_rules to adstable_owner using(true) with check(true);
revoke all on operations.api_quota_failure_domains,operations.api_quota_failure_bindings,operations.api_quota_stop_rules
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

alter function operations.reserve_shared_api_quota(text,uuid,text) rename to reserve_shared_api_quota_before_stop_scope;
revoke all on function operations.reserve_shared_api_quota_before_stop_scope(text,uuid,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.reserve_shared_api_quota(p_operation text,p_attempt uuid,p_lane text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare op operations.api_quota_operations%rowtype; domain operations.api_quota_failure_domains%rowtype;
begin
  if p_operation is null or p_operation !~ '^[a-f0-9]{64}$' or p_attempt is null or p_lane is null or p_lane not in ('interactive','background') then
    raise exception 'API_QUOTA_INPUT_INVALID'; end if;
  -- All reserve/stop callers: single operation -> failure domain -> policies in UUID order.
  select * into op from operations.api_quota_operations where operation_key=p_operation for update;
  if not found or not op.enabled then return jsonb_build_object('status','not_configured'); end if;
  if op.stopped then return jsonb_build_object('status','stopped'); end if;
  select d.* into domain from operations.api_quota_failure_domains d join operations.api_quota_failure_bindings b on b.domain_id=d.id
    where b.operation_key=p_operation for share of d;
  if found then
    if domain.provider<>op.provider then return jsonb_build_object('status','not_configured'); end if;
    if domain.stopped then return jsonb_build_object('status','stopped'); end if;
  end if;
  return operations.reserve_shared_api_quota_before_stop_scope(p_operation,p_attempt,p_lane);
end
$fn$;

create function operations.stop_shared_api_quota_scoped(p_operation text,p_attempt uuid,p_known_response boolean,p_connection_failure boolean,p_signal text) returns boolean
language plpgsql security definer set search_path='' as $fn$
declare op operations.api_quota_operations%rowtype; domain operations.api_quota_failure_domains%rowtype;
begin
  if p_operation is null or p_operation !~ '^[a-f0-9]{64}$' or p_attempt is null or p_known_response is null or p_connection_failure is null
    or (p_connection_failure and not p_known_response)
    or (p_signal is not null and (p_signal<>'shopify_partner_throttled' or not p_known_response or p_connection_failure)) then raise exception 'API_QUOTA_INPUT_INVALID'; end if;
  select * into op from operations.api_quota_operations where operation_key=p_operation for update;
  if not found then return false; end if;
  select d.* into domain from operations.api_quota_failure_domains d join operations.api_quota_failure_bindings b on b.domain_id=d.id
    where b.operation_key=p_operation for update of d;
  if found and domain.provider<>op.provider then return false; end if;
  -- The attempt's charged policies, not arbitrary caller-selected scope IDs or current URL fields.
  perform q.id from operations.api_quota_policies q where exists(select 1 from operations.api_quota_debits d
    where d.policy_id=q.id and d.operation_key=p_operation and d.attempt_id=p_attempt) order by q.id for update of q;
  if not exists(select 1 from operations.api_quota_debits where operation_key=p_operation and attempt_id=p_attempt) then return false; end if;
  update operations.api_quota_operations set stopped=true,
    stop_kind=coalesce(stop_kind,case when p_connection_failure then 'connection' when p_known_response then 'rejected' else 'unknown' end),
    stop_signal=case when stopped_at is null then p_signal else stop_signal end,
    stopped_at=coalesce(stopped_at,clock_timestamp()) where operation_key=p_operation;
  if p_connection_failure and domain.id is not null then update operations.api_quota_failure_domains set stopped=true where id=domain.id; end if;
  -- A verified native signal AND an owner-defined matching rule are BOTH required to stop a rate budget.
  -- A known permission rejection or unknown network result never flips every shared budget to stopped.
  if p_signal='shopify_partner_throttled' and op.provider='shopify_partner' then
    update operations.api_quota_policies q set stopped=true where q.provider=op.provider
      and exists(select 1 from operations.api_quota_stop_rules r join operations.api_quota_debits d
        on d.operation_key=r.operation_key and d.policy_id=r.policy_id
        where r.operation_key=p_operation and r.signal=p_signal and r.policy_id=q.id and d.attempt_id=p_attempt);
  end if;
  -- Known error response settles outstanding capacity but NEVER refunds rolling rate usage.
  -- Unknown attempts remain unsettled, including after rate expiry. No automatic clear API.
  if p_known_response then update operations.api_quota_debits set settled=true where operation_key=p_operation and attempt_id=p_attempt; end if;
  return true;
end
$fn$;

-- Close the legacy coordinator entry point as well: conservative local stop, never old broad-stop behavior.
create or replace function operations.stop_shared_api_quota(p_operation text,p_attempt uuid) returns boolean
language sql security definer set search_path='' as $fn$
  select operations.stop_shared_api_quota_scoped(p_operation,p_attempt,false,false,null)
$fn$;
revoke all on function operations.reserve_shared_api_quota(text,uuid,text),operations.stop_shared_api_quota_scoped(text,uuid,boolean,boolean,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.reserve_shared_api_quota(text,uuid,text),operations.stop_shared_api_quota_scoped(text,uuid,boolean,boolean,text) to adstable_refresh_coordinator;
reset role;
commit;
