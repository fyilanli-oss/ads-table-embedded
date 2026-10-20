begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

-- No production policies/routes are inserted. IDs below are internal opaque scope keys,
-- not tokens, shop domains, customer payloads or Dataset facts.
create table operations.api_quota_policies (
  id uuid primary key,
  provider text not null check(provider in ('shopify_partner','meta','google_ads','klaviyo')),
  window_ms bigint not null check(window_ms between 1 and 9007199254740991),
  max_units bigint not null check(max_units between 1 and 9007199254740991),
  interactive_reserve bigint not null check(interactive_reserve>=0 and interactive_reserve<=max_units),
  dispatch_delay_ms integer not null check(dispatch_delay_ms>0),
  max_outstanding integer not null check(max_outstanding>0),
  last_observed_at timestamptz,
  stopped boolean not null default false
);
create table operations.api_quota_operations (
  operation_key text primary key check(operation_key ~ '^[a-f0-9]{64}$'),
  provider text not null check(provider in ('shopify_partner','meta','google_ads','klaviyo')),
  enabled boolean not null default false
);
create table operations.api_quota_bindings (
  operation_key text not null references operations.api_quota_operations(operation_key) on delete cascade,
  policy_id uuid not null references operations.api_quota_policies(id),
  units bigint not null check(units between 1 and 9007199254740991),
  primary key(operation_key,policy_id)
);
create index api_quota_bindings_policy_idx on operations.api_quota_bindings(policy_id);
create table operations.api_quota_debits (
  policy_id uuid not null references operations.api_quota_policies(id),
  attempt_id uuid not null,
  operation_key text not null references operations.api_quota_operations(operation_key) on delete cascade,
  lane text not null check(lane in ('interactive','background')),
  units bigint not null check(units>0),
  reserved_at timestamptz not null,
  expires_at timestamptz not null check(expires_at>reserved_at),
  settled boolean not null default false,
  primary key(policy_id,attempt_id)
);
create index api_quota_debits_expiry_idx on operations.api_quota_debits(policy_id,expires_at);
create index api_quota_debits_operation_idx on operations.api_quota_debits(operation_key);
create index api_quota_debits_cleanup_idx on operations.api_quota_debits(expires_at);
alter table operations.api_quota_policies enable row level security;
alter table operations.api_quota_policies force row level security;
alter table operations.api_quota_operations enable row level security;
alter table operations.api_quota_operations force row level security;
alter table operations.api_quota_bindings enable row level security;
alter table operations.api_quota_bindings force row level security;
alter table operations.api_quota_debits enable row level security;
alter table operations.api_quota_debits force row level security;
create policy api_quota_policies_owner on operations.api_quota_policies to adstable_owner using(true) with check(true);
create policy api_quota_operations_owner on operations.api_quota_operations to adstable_owner using(true) with check(true);
create policy api_quota_bindings_owner on operations.api_quota_bindings to adstable_owner using(true) with check(true);
create policy api_quota_debits_owner on operations.api_quota_debits to adstable_owner using(true) with check(true);
revoke all on operations.api_quota_policies,operations.api_quota_operations,operations.api_quota_bindings,operations.api_quota_debits
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- Owner-configured complete scope set; the caller cannot select a subset, lower its
-- cost, choose limits, fabricate provider headers or advance a caller-supplied clock.
create function operations.reserve_shared_api_quota(p_operation text,p_attempt uuid,p_lane text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare op operations.api_quota_operations%rowtype; p record; n integer; t timestamptz; used numeric; delay integer;
begin
  if p_operation is null or p_operation !~ '^[a-f0-9]{64}$' or p_attempt is null or p_lane is null or p_lane not in ('interactive','background') then
    raise exception 'API_QUOTA_INPUT_INVALID'; end if;
  select * into op from operations.api_quota_operations where operation_key=p_operation for share;
  if not found or not op.enabled then return jsonb_build_object('status','not_configured'); end if;
  select count(*) into n from operations.api_quota_bindings where operation_key=p_operation;
  -- Structural safety bound, not an invented provider throughput limit.
  if n not between 1 and 16 then return jsonb_build_object('status','not_configured'); end if;
  -- Deterministic lock order across BOTH lanes and overlapping operation scope sets.
  perform q.id from operations.api_quota_policies q join operations.api_quota_bindings b on b.policy_id=q.id
    where b.operation_key=p_operation order by q.id for update of q;
  t:=clock_timestamp();
  if exists(select 1 from operations.api_quota_debits d where d.attempt_id=p_attempt and d.operation_key=p_operation) then
    return jsonb_build_object('status','already_reserved'); end if;
  for p in select q.*,b.units from operations.api_quota_bindings b join operations.api_quota_policies q on q.id=b.policy_id
    where b.operation_key=p_operation order by q.id loop
    if p.provider<>op.provider then return jsonb_build_object('status','not_configured'); end if;
    if p.last_observed_at>t then return jsonb_build_object('status','clock_invalid'); end if;
    if p.stopped then return jsonb_build_object('status','stopped'); end if;
    if (select count(*) from operations.api_quota_debits d where d.policy_id=p.id and not d.settled)>=p.max_outstanding then
      return jsonb_build_object('status','waiting'); end if;
    select coalesce(sum(d.units),0) into used from operations.api_quota_debits d where d.policy_id=p.id and d.expires_at>t;
    -- Both lanes consume the SAME total. Background cannot consume interactive headroom.
    if used+p.units>p.max_units-(case when p_lane='background' then p.interactive_reserve else 0 end) then
      return jsonb_build_object('status','waiting'); end if;
    delay:=least(delay,p.dispatch_delay_ms);
  end loop;
  -- Commit ALL debits together, or NONE. Slots are charged even if the caller crashes.
  -- Extend accounting by dispatch slack: a late permitted send must not compress the
  -- real send rate after earlier reservations expire. No provider arrival guarantee.
  for p in select q.*,b.units from operations.api_quota_bindings b join operations.api_quota_policies q on q.id=b.policy_id
    where b.operation_key=p_operation order by q.id loop
    delete from operations.api_quota_debits where policy_id=p.id and expires_at<=t and settled;
    insert into operations.api_quota_debits(policy_id,attempt_id,operation_key,lane,units,reserved_at,expires_at)
      values(p.id,p_attempt,p_operation,p_lane,p.units,t,t+(p.window_ms+p.dispatch_delay_ms)::double precision*interval '1 millisecond');
    update operations.api_quota_policies set last_observed_at=t where id=p.id;
  end loop;
  return jsonb_build_object('status','reserved','attemptId',p_attempt,'operationKey',p_operation,
    'dispatchBudgetMs',delay,'dispatchBeforeMs',floor(extract(epoch from t+delay*interval '1 millisecond')*1000)::bigint);
end
$fn$;

-- Known response or a local, proven-not-sent decision only. Never a timeout-based refund.
-- Rate usage remains charged through expiry even after settlement.
create function operations.settle_shared_api_quota(p_operation text,p_attempt uuid) returns boolean
language plpgsql security definer set search_path = '' as $fn$
begin
  perform q.id from operations.api_quota_policies q join operations.api_quota_bindings b on b.policy_id=q.id
    where b.operation_key=p_operation order by q.id for update of q;
  update operations.api_quota_debits set settled=true where operation_key=p_operation and attempt_id=p_attempt and not settled;
  return found;
end
$fn$;

-- Provider rejection/unknown outcome is NOT normal quota waiting. Stop the affected
-- configured operation scope set; expiry/Retry-After alone never clears this stop.
-- Activation must explicitly review the blast radius of each configured shared scope.
create function operations.stop_shared_api_quota(p_operation text,p_attempt uuid) returns boolean
language plpgsql security definer set search_path = '' as $fn$
begin
  perform q.id from operations.api_quota_policies q join operations.api_quota_bindings b on b.policy_id=q.id
    where b.operation_key=p_operation order by q.id for update of q;
  if not exists(select 1 from operations.api_quota_debits where operation_key=p_operation and attempt_id=p_attempt) then return false; end if;
  update operations.api_quota_policies q set stopped=true where exists(select 1 from operations.api_quota_debits d
    where d.policy_id=q.id and d.operation_key=p_operation and d.attempt_id=p_attempt);
  return true;
end
$fn$;

-- Bounded internal maintenance, no cron activated here. Only expired quota metadata.
create function operations.cleanup_shared_api_quota(p_limit integer) returns integer
language plpgsql security definer set search_path = '' as $fn$
declare n integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'API_QUOTA_CLEANUP_INVALID'; end if;
  with expired as(select policy_id,attempt_id from operations.api_quota_debits where expires_at<=clock_timestamp() and settled
    order by expires_at,policy_id,attempt_id for update skip locked limit p_limit),
  removed as(delete from operations.api_quota_debits d using expired e where d.policy_id=e.policy_id and d.attempt_id=e.attempt_id returning 1)
  select count(*) into n from removed;
  return n;
end
$fn$;
revoke all on function operations.reserve_shared_api_quota(text,uuid,text),operations.settle_shared_api_quota(text,uuid),operations.stop_shared_api_quota(text,uuid),operations.cleanup_shared_api_quota(integer)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.reserve_shared_api_quota(text,uuid,text),operations.settle_shared_api_quota(text,uuid),operations.stop_shared_api_quota(text,uuid),operations.cleanup_shared_api_quota(integer)
  to adstable_refresh_coordinator;
reset role;
commit;
