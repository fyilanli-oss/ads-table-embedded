begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

create function operations.load_refresh_entitlement_installation(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('workspaceId',i.workspace_id::text,'installGeneration',i.install_generation::text,
    'shopId',i.shop_id,'shopDomain',i.shop_domain,'status',i.status,'observedAt',date_trunc('milliseconds',statement_timestamp()))
  from shopify.installations i join app.workspaces w on w.id=i.workspace_id
  where i.workspace_id=p_workspace and i.install_generation=p_generation and i.status='active' and w.status='active'
    and operations.refresh_claim_is_current(p_workspace,p_generation,p_provider,p_account,p_job,p_fence)
$fn$;

create function operations.refresh_entitlement_is_current(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint,p_observed timestamptz)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_observed is not null and p_observed<=statement_timestamp() and exists(
    select 1 from operations.refresh_runs r
    join shopify.installations i on i.workspace_id=r.workspace_id and i.install_generation=r.install_generation and i.status='active'
    join app.workspaces w on w.id=i.workspace_id and w.status='active'
    join billing.workspace_subscriptions s on s.workspace_id=i.workspace_id and s.install_generation=i.install_generation
      and s.installation_id=i.id and s.shop_id=i.shop_id and s.shop_domain=i.shop_domain
    join billing.workspace_entitlements e on e.workspace_id=s.workspace_id and e.install_generation=s.install_generation
      and e.source_hash=s.source_hash and e.source_observed_at=s.source_observed_at
    where r.workspace_id=p_workspace and r.install_generation=p_generation and r.provider=p_provider and r.account_id=p_account
      and r.job_id=p_job and r.fence=p_fence and r.status='running'
      and p_observed>=date_trunc('milliseconds',r.started_at) and s.source_observed_at>=p_observed and s.source_observed_at<=statement_timestamp()
      and s.provider_status='active'
      and ((e.entitlement_status='trial' and s.trial_ends_at>statement_timestamp())
        or (e.entitlement_status='active' and s.current_cycle_start<=statement_timestamp() and s.current_cycle_end>statement_timestamp()))
  ) and operations.refresh_claim_is_current(p_workspace,p_generation,p_provider,p_account,p_job,p_fence)
$fn$;

create function operations.apply_refresh_entitlement_snapshot(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare i shopify.installations%rowtype; r operations.refresh_runs%rowtype; observed timestamptz; applied record;
begin
  perform 1 from operations.refresh_control where singleton for update;
  if not operations.refresh_claim_is_current(p_workspace,p_generation,p_provider,p_account,p_job,p_fence) then
    raise exception 'REFRESH_ENTITLEMENT_CLAIM_NOT_CURRENT';
  end if;
  select * into strict r from operations.refresh_runs where workspace_id=p_workspace and install_generation=p_generation
    and provider=p_provider and account_id=p_account and job_id=p_job and fence=p_fence;
  select installation.* into strict i from shopify.installations installation join app.workspaces w on w.id=installation.workspace_id
    where installation.workspace_id=p_workspace and installation.install_generation=p_generation and installation.status='active' and w.status='active';
  observed := (p_snapshot->>'observedAt')::timestamptz;
  if jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot->>'shopId' is distinct from i.shop_id
    or p_snapshot->>'shopDomain' is distinct from i.shop_domain or p_snapshot->>'installGeneration' is distinct from p_generation::text
    or observed is null or observed>clock_timestamp() or observed<date_trunc('milliseconds',r.started_at) then
    raise exception 'REFRESH_ENTITLEMENT_SNAPSHOT_INVALID';
  end if;
  -- A response describing an already ended trial/cycle cannot authorize background work.
  if (p_snapshot->>'active')::boolean and not coalesce(
    (p_snapshot->>'entitlementStatus'='trial' and (p_snapshot->>'trialEndsAt')::timestamptz>clock_timestamp())
    or (p_snapshot->>'entitlementStatus'='active' and (p_snapshot->>'currentCycleStart')::timestamptz<=clock_timestamp()
      and (p_snapshot->>'currentCycleEnd')::timestamptz>clock_timestamp()),false) then
    raise exception 'REFRESH_ENTITLEMENT_PERIOD_INVALID';
  end if;
  select * into strict applied from billing.apply_shopify_app_pricing_snapshot(i.shop_id,i.shop_domain,p_generation,
    (p_snapshot->>'active')::boolean,p_snapshot->>'entitlementStatus',p_snapshot->>'billingPeriod',
    (p_snapshot->>'cancelAtEndOfCycle')::boolean,(p_snapshot->>'trialEndsAt')::timestamptz,
    (p_snapshot->>'currentCycleStart')::timestamptz,(p_snapshot->>'currentCycleEnd')::timestamptz,
    array(select jsonb_array_elements_text(p_snapshot->'itemHandles')),
    array(select jsonb_array_elements_text(p_snapshot->'pendingItemHandles')),observed,p_snapshot->>'sourceHash');
  return jsonb_build_object('workspaceId',applied.workspace_id::text,'shopId',applied.shop_id,'shopDomain',applied.shop_domain,
    'installGeneration',applied.install_generation,'entitlementStatus',applied.entitlement_status,'sourceObservedAt',applied.source_observed_at);
end
$fn$;
revoke all on function operations.load_refresh_entitlement_installation(uuid,bigint,text,text,text,bigint),
  operations.refresh_entitlement_is_current(uuid,bigint,text,text,text,bigint,timestamptz),
  operations.apply_refresh_entitlement_snapshot(uuid,bigint,text,text,text,bigint,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime;
grant execute on function operations.load_refresh_entitlement_installation(uuid,bigint,text,text,text,bigint),
  operations.refresh_entitlement_is_current(uuid,bigint,text,text,text,bigint,timestamptz),
  operations.apply_refresh_entitlement_snapshot(uuid,bigint,text,text,text,bigint,jsonb) to adstable_refresh_coordinator;
-- No coordinator grant to the unfenced generic billing apply function or raw billing tables.
reset role;
commit;
