begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Reuse the bounded private observation inventory. No payloads, limits, rules or routes seeded.
create function operations.record_shopify_admin_quota_feedback(p_operation text,p_attempt uuid,p_feedback jsonb) returns boolean
language plpgsql security definer set search_path='' as $fn$
declare op operations.api_quota_operations%rowtype; prior operations.api_quota_feedback%rowtype;
  t timestamptz; reserved timestamptz; k text; v numeric; kind text;
begin
  if p_operation is null or p_operation !~ '^[a-f0-9]{64}$' or p_attempt is null or jsonb_typeof(p_feedback) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_feedback))<>7
    or not p_feedback ?& array['kind','httpStatus','requestedQueryCost','actualQueryCost','maximumAvailable','currentlyAvailable','restoreRate']
    or jsonb_typeof(p_feedback->'kind') is distinct from 'string'
    or coalesce(p_feedback->>'kind','') not in ('shopify_admin_cost_observed','shopify_admin_cost_partial','shopify_admin_cost_missing','shopify_admin_cost_invalid')
    or jsonb_typeof(p_feedback->'httpStatus') is distinct from 'number'
    or coalesce(p_feedback->>'httpStatus','') !~ '^[1-5][0-9]{2}$' then raise exception 'API_QUOTA_FEEDBACK_INVALID'; end if;
  kind:=p_feedback->>'kind';
  foreach k in array array['requestedQueryCost','actualQueryCost','maximumAvailable','currentlyAvailable','restoreRate'] loop
    if kind in ('shopify_admin_cost_missing','shopify_admin_cost_invalid') or (kind='shopify_admin_cost_partial' and k='actualQueryCost') then
      if p_feedback->k is distinct from 'null'::jsonb then raise exception 'API_QUOTA_FEEDBACK_INVALID'; end if;
    else
      if jsonb_typeof(p_feedback->k) is distinct from 'number' then raise exception 'API_QUOTA_FEEDBACK_INVALID'; end if;
      v:=(p_feedback->>k)::numeric;
      if v<0 or v>9007199254740991 or (k in ('requestedQueryCost','actualQueryCost') and v<>trunc(v)) then raise exception 'API_QUOTA_FEEDBACK_INVALID'; end if;
    end if;
  end loop;
  if kind in ('shopify_admin_cost_observed','shopify_admin_cost_partial') and
    ((p_feedback->>'actualQueryCost')::numeric>(p_feedback->>'requestedQueryCost')::numeric
      or (p_feedback->>'currentlyAvailable')::numeric>(p_feedback->>'maximumAvailable')::numeric) then raise exception 'API_QUOTA_FEEDBACK_INVALID'; end if;
  select * into op from operations.api_quota_operations where operation_key=p_operation for update;
  if not found or op.provider<>'shopify_admin' then return false; end if;
  select min(d.reserved_at) into reserved from operations.api_quota_debits d where d.operation_key=p_operation and d.attempt_id=p_attempt;
  if reserved is null then return false; end if;
  t:=clock_timestamp();if reserved>t then return false;end if;
  select * into prior from operations.api_quota_feedback where operation_key=p_operation;
  if prior.observed_at>t then return false;end if;
  if prior.attempt_id=p_attempt then return prior.feedback=p_feedback;end if;
  insert into operations.api_quota_feedback(operation_key,attempt_id,reserved_at,observed_at,feedback,hold_until)
    values(p_operation,p_attempt,reserved,t,p_feedback,null)
  on conflict(operation_key) do update set
    attempt_id=case when excluded.reserved_at>=operations.api_quota_feedback.reserved_at then excluded.attempt_id else operations.api_quota_feedback.attempt_id end,
    reserved_at=greatest(operations.api_quota_feedback.reserved_at,excluded.reserved_at),observed_at=excluded.observed_at,
    feedback=case when excluded.reserved_at>=operations.api_quota_feedback.reserved_at then excluded.feedback else operations.api_quota_feedback.feedback end;
  -- Observation does not change policy units, credit usage, infer a plan or reopen a stop.
  return true;
end
$fn$;

alter table operations.api_quota_operations drop constraint api_quota_operations_stop_signal_check,
  add constraint api_quota_operations_stop_signal_check check(stop_signal in ('shopify_partner_throttled','shopify_admin_throttled'));
alter table operations.api_quota_stop_rules drop constraint api_quota_stop_rules_signal_check,
  add constraint api_quota_stop_rules_signal_check check(signal in ('shopify_partner_throttled','shopify_admin_throttled'));

alter function operations.stop_shared_api_quota_scoped(text,uuid,boolean,boolean,text) rename to stop_shared_api_quota_scoped_before_admin;
revoke all on function operations.stop_shared_api_quota_scoped_before_admin(text,uuid,boolean,boolean,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.stop_shared_api_quota_scoped(p_operation text,p_attempt uuid,p_known_response boolean,p_connection_failure boolean,p_signal text) returns boolean
language plpgsql security definer set search_path='' as $fn$
declare op operations.api_quota_operations%rowtype; stopped boolean;
begin
  if p_signal is distinct from 'shopify_admin_throttled' then
    return operations.stop_shared_api_quota_scoped_before_admin(p_operation,p_attempt,p_known_response,p_connection_failure,p_signal);
  end if;
  if p_operation is null or p_operation !~ '^[a-f0-9]{64}$' or p_attempt is null
    or p_known_response is distinct from true or p_connection_failure is distinct from false then raise exception 'API_QUOTA_INPUT_INVALID'; end if;
  select * into op from operations.api_quota_operations where operation_key=p_operation for update;
  if not found or op.provider<>'shopify_admin' then return false;end if;
  -- Existing operation -> connection domain -> UUID-ordered charged-policy locks and settlement.
  stopped:=operations.stop_shared_api_quota_scoped_before_admin(p_operation,p_attempt,true,false,null);
  if not stopped then return false;end if;
  if op.stopped_at is null then update operations.api_quota_operations set stop_signal=p_signal where operation_key=p_operation;end if;
  update operations.api_quota_policies q set stopped=true where q.provider='shopify_admin' and q.cost_unit='shopify_admin_query_points'
    and exists(select 1 from operations.api_quota_stop_rules r join operations.api_quota_debits d
      on d.operation_key=r.operation_key and d.policy_id=r.policy_id
      where r.operation_key=p_operation and r.signal=p_signal and r.policy_id=q.id and d.attempt_id=p_attempt);
  return true;
end
$fn$;
revoke all on function operations.record_shopify_admin_quota_feedback(text,uuid,jsonb),operations.stop_shared_api_quota_scoped(text,uuid,boolean,boolean,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.record_shopify_admin_quota_feedback(text,uuid,jsonb),operations.stop_shared_api_quota_scoped(text,uuid,boolean,boolean,text) to adstable_refresh_coordinator;
reset role;
commit;
