begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Persisted service age uses the already-shared monotonic fence, including released
-- attempts. One candidate per workspace, then oldest eligible range. No new queue,
-- fact table, native policy, timer or activation is installed.
create index shopify_order_work_service_age_idx
 on operations.shopify_order_work_reservations(workspace_id,fence desc);
alter table operations.shopify_order_pending_ranges add column dispatch_considered_fence bigint not null default 0
 check(dispatch_considered_fence between 0 and 9007199254740991);
create index shopify_order_pending_service_age_idx
 on operations.shopify_order_pending_ranges(workspace_id,dispatch_considered_fence desc);
create function operations.reserve_next_shopify_order_work(p_attempt uuid,p_max_candidates integer,p_excluded uuid[])
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare policy operations.shopify_order_queue_control%rowtype; candidate record;
 result jsonb; checked integer:=0; blocked jsonb:='[]'::jsonb; considered bigint;
begin
 if p_attempt is null or p_max_candidates is null or p_max_candidates not between 1 and 100
 or p_excluded is null or coalesce(array_ndims(p_excluded),1)<>1 or cardinality(p_excluded)>100 or array_position(p_excluded,null) is not null
 or cardinality(p_excluded)<>(select count(distinct x) from unnest(p_excluded) x)
 then raise exception 'SHOPIFY_ORDER_DISPATCH_INPUT_INVALID'; end if;
 perform 1 from operations.refresh_control where singleton for update;
 select * into strict policy from operations.shopify_order_queue_control where singleton for update;
 if not policy.enabled or not policy.worker_enabled then return jsonb_build_object('status','not_configured'); end if;
 if exists(select 1 from operations.shopify_order_work_reservations where attempt_id=p_attempt)
 then raise exception 'SHOPIFY_ORDER_DISPATCH_ATTEMPT_EXISTS'; end if;
 for candidate in
  select chosen.*,greatest(coalesce((select r.fence from operations.shopify_order_work_reservations r
    where r.workspace_id=chosen.workspace_id order by r.fence desc limit 1),0),
    coalesce((select max(q.dispatch_considered_fence) from operations.shopify_order_pending_ranges q
     where q.workspace_id=chosen.workspace_id),0)) served_fence
  from (
   select distinct on(q.workspace_id) q.*,i.shop_id,i.shop_domain
   from operations.shopify_order_pending_ranges q
   join shopify.installations i on i.id=q.installation_id and i.workspace_id=q.workspace_id and i.install_generation=q.install_generation
   join app.workspaces w on w.id=q.workspace_id
   where q.status='queued' and q.configuration_epoch=policy.configuration_epoch
    and i.status='active' and w.status='active' and not(q.workspace_id=any(p_excluded))
    and not exists(select 1 from operations.shopify_order_work_reservations r where r.installation_id=q.installation_id and r.status='reserved')
   order by q.workspace_id,q.queued_at,q.from_inclusive,q.installation_id,q.range_key
  ) chosen
  order by served_fence,chosen.queued_at,chosen.workspace_id,chosen.range_key limit p_max_candidates
 loop
  checked:=checked+1;
  -- Refused candidates also rotate: a stale profile at the front must not starve
  -- healthy workspaces when the explicit candidate bound is only one.
  select next_fence into considered from operations.refresh_control where singleton;
  if considered>=9007199254740991 or (select revision from operations.refresh_control where singleton)>=9007199254740991
  then raise exception 'SHOPIFY_ORDER_DISPATCH_COUNTER_EXHAUSTED'; end if;
  update operations.shopify_order_pending_ranges set dispatch_considered_fence=considered
   where installation_id=candidate.installation_id and range_key=candidate.range_key;
  update operations.refresh_control set revision=revision+1,next_fence=next_fence+1 where singleton;
  result:=operations.reserve_shopify_order_work(candidate.installation_id,candidate.workspace_id,candidate.install_generation,
    candidate.shop_id,candidate.shop_domain,candidate.range_key,p_attempt);
  if result->>'status'='reserved' then
   return result||jsonb_build_object('proposal',jsonb_build_object(
    'owner',jsonb_build_object('installationId',candidate.installation_id::text,'workspaceId',candidate.workspace_id::text,
     'installGeneration',candidate.install_generation,'shopId',candidate.shop_id,'shopDomain',candidate.shop_domain),
    'key',candidate.range_key,'range',jsonb_build_object(
     'fromInclusive',to_char(candidate.from_inclusive at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
     'toExclusive',to_char(candidate.to_exclusive at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'includeOrderHistory',candidate.include_order_history,'pageSize',candidate.page_size));
  end if;
  blocked:=blocked||jsonb_build_array(jsonb_build_object('status',result->>'status'));
 end loop;
 return jsonb_build_object('status',case when checked=0 then 'empty' else 'no_admission' end,'checkedCandidates',checked,'blocked',blocked);
end
$fn$;
revoke all on function operations.reserve_next_shopify_order_work(uuid,integer,uuid[])
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.reserve_next_shopify_order_work(uuid,integer,uuid[]) to adstable_refresh_coordinator;
commit;
