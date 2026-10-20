begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- One bounded current observation per operation, not an unbounded response/header log.
create table operations.api_quota_feedback (
  operation_key text primary key references operations.api_quota_operations(operation_key) on delete cascade,
  attempt_id uuid not null,
  reserved_at timestamptz not null,
  observed_at timestamptz not null,
  feedback jsonb not null,
  hold_until timestamptz
);
alter table operations.api_quota_feedback enable row level security;
alter table operations.api_quota_feedback force row level security;
create policy api_quota_feedback_owner on operations.api_quota_feedback to adstable_owner using(true) with check(true);
revoke all on operations.api_quota_feedback from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function operations.record_shared_api_quota_feedback(p_operation text,p_attempt uuid,p_feedback jsonb) returns boolean
language plpgsql security definer set search_path='' as $fn$
declare op operations.api_quota_operations%rowtype; prior operations.api_quota_feedback%rowtype;
  t timestamptz; reserved timestamptz; proposed_hold timestamptz; k text; v text; status integer;
begin
  if p_operation is null or p_operation !~ '^[a-f0-9]{64}$' or p_attempt is null or jsonb_typeof(p_feedback) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_feedback))<>6
    or not p_feedback ?& array['kind','httpStatus','limit','remaining','resetSeconds','retryAfterSeconds']
    or coalesce(p_feedback->>'kind','') not in ('steady','retry_after','missing','invalid')
    or coalesce(p_feedback->>'httpStatus','') !~ '^[1-5][0-9]{2}$' then raise exception 'API_QUOTA_FEEDBACK_INVALID'; end if;
  foreach k in array array['limit','remaining','resetSeconds','retryAfterSeconds'] loop
    v:=p_feedback->>k;
    if v is not null and (jsonb_typeof(p_feedback->k)<>'number' or v !~ '^(0|[1-9][0-9]{0,15})$' or v::numeric>9007199254740991) then
      raise exception 'API_QUOTA_FEEDBACK_INVALID'; end if;
  end loop;
  status:=(p_feedback->>'httpStatus')::integer;
  if jsonb_typeof(p_feedback->'httpStatus')<>'number' or jsonb_typeof(p_feedback->'kind')<>'string' then raise exception 'API_QUOTA_FEEDBACK_INVALID'; end if;
  if p_feedback->>'kind'='steady' then
    if status=429 or p_feedback->>'limit' is null or (p_feedback->>'limit')::numeric<1 or p_feedback->>'remaining' is null
      or (p_feedback->>'remaining')::numeric>(p_feedback->>'limit')::numeric or p_feedback->>'resetSeconds' is null
      or (p_feedback->>'resetSeconds')::numeric>60 or p_feedback->>'retryAfterSeconds' is not null then raise exception 'API_QUOTA_FEEDBACK_INVALID'; end if;
  elsif p_feedback->>'kind'='retry_after' then
    if status<>429 or p_feedback->>'retryAfterSeconds' is null or (p_feedback->>'retryAfterSeconds')::numeric>2147483647
      or p_feedback->>'limit' is not null or p_feedback->>'remaining' is not null or p_feedback->>'resetSeconds' is not null then raise exception 'API_QUOTA_FEEDBACK_INVALID'; end if;
  elsif p_feedback->>'limit' is not null or p_feedback->>'remaining' is not null or p_feedback->>'resetSeconds' is not null
    or p_feedback->>'retryAfterSeconds' is not null then raise exception 'API_QUOTA_FEEDBACK_INVALID'; end if;
  select * into op from operations.api_quota_operations where operation_key=p_operation for update;
  if not found or op.provider<>'klaviyo' then return false; end if;
  select min(d.reserved_at) into reserved from operations.api_quota_debits d where d.operation_key=p_operation and d.attempt_id=p_attempt;
  if reserved is null then return false; end if;
  t:=clock_timestamp(); if reserved>t then return false; end if;
  select * into prior from operations.api_quota_feedback where operation_key=p_operation;
  if prior.observed_at>t then return false; end if;
  -- A successful response with zero remaining is normal waiting, NOT a provider error/retry.
  if status between 200 and 299 and p_feedback->>'kind'='steady' and (p_feedback->>'remaining')::bigint=0 then
    proposed_hold:=t+(p_feedback->>'resetSeconds')::integer*interval '1 second';
  end if;
  insert into operations.api_quota_feedback(operation_key,attempt_id,reserved_at,observed_at,feedback,hold_until)
    values(p_operation,p_attempt,reserved,t,p_feedback,proposed_hold)
  on conflict(operation_key) do update set
    attempt_id=case when excluded.reserved_at>=operations.api_quota_feedback.reserved_at then excluded.attempt_id else operations.api_quota_feedback.attempt_id end,
    reserved_at=greatest(excluded.reserved_at,operations.api_quota_feedback.reserved_at),observed_at=excluded.observed_at,
    feedback=case when excluded.reserved_at>=operations.api_quota_feedback.reserved_at then excluded.feedback else operations.api_quota_feedback.feedback end,
    hold_until=greatest(operations.api_quota_feedback.hold_until,excluded.hold_until);
  return true;
end
$fn$;

alter function operations.reserve_shared_api_quota(text,uuid,text) rename to reserve_shared_api_quota_before_feedback;
revoke all on function operations.reserve_shared_api_quota_before_feedback(text,uuid,text) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.reserve_shared_api_quota(p_operation text,p_attempt uuid,p_lane text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare op operations.api_quota_operations%rowtype; observation operations.api_quota_feedback%rowtype; t timestamptz;
begin
  if p_operation is null or p_operation !~ '^[a-f0-9]{64}$' or p_attempt is null or p_lane is null or p_lane not in ('interactive','background') then raise exception 'API_QUOTA_INPUT_INVALID'; end if;
  select * into op from operations.api_quota_operations where operation_key=p_operation for update;
  if found and op.enabled and not op.stopped and op.provider='klaviyo' then
    if op.route_required and not operations.shared_api_quota_profile_valid(p_operation) then return jsonb_build_object('status','not_configured'); end if;
    if (select count(*) from operations.api_quota_bindings where operation_key=p_operation) not between 1 and 16
      or exists(select 1 from operations.api_quota_bindings b join operations.api_quota_policies q on q.id=b.policy_id where b.operation_key=p_operation and q.provider<>op.provider)
      then return jsonb_build_object('status','not_configured'); end if;
    -- Same operation -> connection domain -> UUID-ordered policy lock order as the existing reserve/stop paths.
    perform d.id from operations.api_quota_failure_bindings b join operations.api_quota_failure_domains d on d.id=b.domain_id
      where b.operation_key=p_operation for share of d;
    perform q.id from operations.api_quota_bindings b join operations.api_quota_policies q on q.id=b.policy_id
      where b.operation_key=p_operation order by q.id for update of q;
    -- Existing connection/provider stops take precedence over a normal header wait.
    if not exists(select 1 from operations.api_quota_failure_bindings b join operations.api_quota_failure_domains d on d.id=b.domain_id where b.operation_key=p_operation and d.stopped)
      and not exists(select 1 from operations.api_quota_bindings b join operations.api_quota_policies q on q.id=b.policy_id where b.operation_key=p_operation and q.stopped) then
      select * into observation from operations.api_quota_feedback where operation_key=p_operation;
      t:=clock_timestamp();
      if observation.observed_at>t then return jsonb_build_object('status','clock_invalid'); end if;
      if observation.hold_until>t then return jsonb_build_object('status','waiting'); end if;
    end if;
  end if;
  return operations.reserve_shared_api_quota_before_feedback(p_operation,p_attempt,p_lane);
end
$fn$;
revoke all on function operations.record_shared_api_quota_feedback(text,uuid,jsonb),operations.reserve_shared_api_quota(text,uuid,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.record_shared_api_quota_feedback(text,uuid,jsonb),operations.reserve_shared_api_quota(text,uuid,text) to adstable_refresh_coordinator;
reset role;
commit;
