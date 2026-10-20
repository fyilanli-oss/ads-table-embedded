begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Explicit trusted work-plan deadline, not a guessed production timeout or a renewable lease.
alter table operations.refresh_work_bindings add column deadline_at_ms bigint
  check (deadline_at_ms between 1 and 9007199254740991);

create function operations.commit_refresh_preflight_with_deadline(p_revision bigint,p_queue_revision bigint,p_state jsonb,
  p_source jsonb,p_window jsonb,p_partition text,p_deadline bigint) returns boolean
language plpgsql security definer set search_path='' as $fn$
declare changed integer;
begin
  perform 1 from operations.refresh_control where singleton for update;
  if p_deadline is null or p_deadline>9007199254740991
    or p_deadline<=floor(extract(epoch from clock_timestamp())*1000)::bigint then return false; end if;
  if not operations.commit_refresh_preflight(p_revision,p_queue_revision,p_state,p_source,p_window,p_partition) then return false; end if;
  update operations.refresh_work_bindings b set deadline_at_ms=p_deadline from operations.refresh_runs r
    where b.workspace_id=r.workspace_id and b.install_generation=r.install_generation and b.provider=r.provider
      and b.account_id=r.account_id and b.job_id=r.job_id and b.fence=r.fence and r.status='running'
      and b.workspace_id=(p_source->>'workspaceId')::uuid and b.install_generation=(p_source->>'installGeneration')::bigint
      and b.provider=p_source->>'provider' and b.account_id=p_source->>'accountId';
  get diagnostics changed=row_count;
  if changed<>1 or p_deadline<=floor(extract(epoch from clock_timestamp())*1000)::bigint then raise exception 'REFRESH_DEADLINE_BINDING_FAILED'; end if;
  return true;
end
$fn$;
revoke all on function operations.commit_refresh_preflight(bigint,bigint,jsonb,jsonb,jsonb,text) from adstable_refresh_coordinator;

-- A late worker cannot advance while waiting for the next detector invocation.
-- Historical owner-only unbound fixtures remain outside the native worker path.
alter function operations.refresh_claim_is_current(uuid,bigint,text,text,text,bigint) rename to refresh_claim_is_current_before_deadline;
revoke all on function operations.refresh_claim_is_current_before_deadline(uuid,bigint,text,text,text,bigint)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.refresh_claim_is_current(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint)
returns boolean language sql volatile security definer set search_path='' as $fn$
  select operations.refresh_claim_is_current_before_deadline(p_workspace,p_generation,p_provider,p_account,p_job,p_fence)
    and (not exists(select 1 from operations.refresh_work_bindings where workspace_id=p_workspace and install_generation=p_generation
      and provider=p_provider and account_id=p_account and job_id=p_job)
    or exists(select 1 from operations.refresh_work_bindings where workspace_id=p_workspace and install_generation=p_generation
      and provider=p_provider and account_id=p_account and job_id=p_job and fence=p_fence
      and deadline_at_ms>floor(extract(epoch from clock_timestamp())*1000)::bigint))
$fn$;

-- Deadline is NOT proof that local/external execution terminated. Preserve the observed
-- call phase while retaining the whole reservation in every interruption case.
alter function operations.refresh_stop_classification(text) rename to refresh_stop_classification_before_deadline;
revoke all on function operations.refresh_stop_classification_before_deadline(text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.refresh_stop_classification(p_reason text) returns jsonb
language sql immutable set search_path='' as $fn$
  select case when p_reason in ('worker_deadline_before_call','worker_deadline_during_request','worker_deadline_after_response') then
    jsonb_build_object('state','uncertain','call_state',case p_reason when 'worker_deadline_before_call' then 'not_sent'
      when 'worker_deadline_after_response' then 'settled' else 'unknown' end,'source','system','action','verify_execution_stopped')
    else operations.refresh_stop_classification_before_deadline(p_reason) end
$fn$;
revoke all on function operations.refresh_stop_classification(text) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function operations.review_refresh_interrupted_work() returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare c operations.refresh_control%rowtype; item record; now_ms bigint; cap integer; count_expired integer;
  uncertain integer:=0; classification text; result jsonb;
begin
  -- Same first lock as admission/stage/stop. Stage observation and fencing are atomic.
  select * into strict c from operations.refresh_control where singleton for update;
  if c.bounds is null then return jsonb_build_object('status','not_configured'); end if;
  cap:=(c.bounds->>'maxClaims')::integer;
  if cap is null or cap<1 then raise exception 'REFRESH_REVIEW_BOUNDS_INVALID'; end if;
  now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  -- Bound the running set, not all historical bindings. Overflow never silently truncates.
  select count(*) into count_expired from (select 1 from operations.refresh_runs where status='running' limit cap+1) r;
  if count_expired>cap then raise exception 'REFRESH_REVIEW_OVER_BOUND'; end if;
  if exists(select 1 from operations.refresh_runs r join operations.refresh_work_bindings b
    using(workspace_id,install_generation,provider,account_id,job_id,fence)
    where r.status='running' and b.deadline_at_ms is null) then raise exception 'REFRESH_DEADLINE_MISSING'; end if;
  for item in select r.*,p.stage from operations.refresh_runs r join operations.refresh_work_bindings b
    using(workspace_id,install_generation,provider,account_id,job_id,fence)
    left join operations.refresh_work_progress p using(workspace_id,install_generation,provider,account_id,job_id,fence)
    where r.status='running' and b.deadline_at_ms<=now_ms
      and not operations.refresh_account_is_held(r.workspace_id,r.install_generation,r.provider,r.account_id)
    order by r.fence
  loop
    classification:=case when item.stage is null or item.stage='checking_authority' then 'worker_deadline_before_call'
      when item.stage='request_intent' then 'worker_deadline_during_request' else 'worker_deadline_after_response' end;
    result:=operations.record_refresh_work_stop(item.workspace_id,item.install_generation,item.provider,item.account_id,
      item.job_id,item.fence,classification,(select revision from operations.refresh_control where singleton));
    if result->>'recorded' is distinct from 'true' then raise exception 'REFRESH_REVIEW_CONFLICT'; end if;
    uncertain:=uncertain+1;
  end loop;
  return jsonb_build_object('status','reviewed','stopped',0,'uncertain',uncertain);
end
$fn$;
revoke all on function operations.commit_refresh_preflight_with_deadline(bigint,bigint,jsonb,jsonb,jsonb,text,bigint),
  operations.refresh_claim_is_current(uuid,bigint,text,text,text,bigint),operations.review_refresh_interrupted_work()
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.commit_refresh_preflight_with_deadline(bigint,bigint,jsonb,jsonb,jsonb,text,bigint),
  operations.refresh_claim_is_current(uuid,bigint,text,text,text,bigint),operations.review_refresh_interrupted_work() to adstable_refresh_coordinator;
reset role;
commit;
