begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

alter table operations.shopify_order_work_reservations
 drop constraint shopify_order_work_reservations_phase_check,
 add constraint shopify_order_work_reservations_phase_check check(phase in
 ('pre_request','entitlement_intent','entitlement_dispatched','entitlement_observed','entitlement_denied','order_intent','order_reading','order_observed','stopped','reconciled')),
 add column entitlement_request_count integer default 0 check(entitlement_request_count between 0 and 1),
 add column reconciliation_version bigint not null default 0 check(reconciliation_version between 0 and 9007199254740991),
 add column reconciliation_state text not null default 'unreviewed' check(reconciliation_state in ('unreviewed','released_before_provider','released_before_admin','held_unknown','held_admin_prefix','held_uncommitted','held_metadata_conflict')),
 add column reconciliation_action_id uuid unique,
 add column reconciled_at timestamptz,
 add column reconciliation_prior_phase text check(reconciliation_prior_phase in ('pre_request','entitlement_intent','entitlement_dispatched','entitlement_observed','entitlement_denied','order_intent','order_reading','order_observed','stopped')),
 add column reconciliation_classification text check(reconciliation_classification in ('no_provider_dispatch','no_admin_dispatch','unknown_legacy_dispatch','unknown_entitlement_dispatch','partial_or_unknown_admin','observed_not_durable','metadata_conflict')),
 add column reconciliation_snapshot_hash text check(reconciliation_snapshot_hash is null or reconciliation_snapshot_hash~'^[a-f0-9]{64}$');

-- Old stopped rows lost their previous phase. A reason string is not dispatch proof.
-- Preserve this uncertainty as NULL; never backfill it to a made-up zero.
update operations.shopify_order_work_reservations set entitlement_request_count=case
 when phase in ('pre_request','entitlement_intent') then 0
 when phase in ('entitlement_dispatched','entitlement_observed','entitlement_denied','order_intent','order_reading','order_observed') then 1
 when entitlement_observed_at is not null and entitlement_source_hash is not null then 1
 else null end;

alter table operations.shopify_order_work_reservations add constraint shopify_order_reconciliation_record_complete check(
 (reconciliation_state='unreviewed' and reconciliation_version=0 and reconciliation_action_id is null and reconciled_at is null
  and reconciliation_prior_phase is null and reconciliation_classification is null and reconciliation_snapshot_hash is null and phase<>'reconciled')
 or (reconciliation_state<>'unreviewed' and reconciliation_version>0 and reconciliation_action_id is not null and reconciled_at is not null
  and reconciliation_prior_phase is not null and reconciliation_classification is not null and reconciliation_snapshot_hash is not null and phase='reconciled'));

-- Marker and phase change are in the same existing dispatch transaction and lock.
create or replace function operations.dispatch_shopify_order_entitlement(p_installation bigint,p_workspace uuid,p_generation bigint,p_shop text,p_domain text,p_key text,p_attempt uuid,p_fence bigint)
returns boolean language plpgsql security definer set search_path='' as $fn$
begin
 perform 1 from operations.refresh_control where singleton for update;
 if not operations.shopify_order_work_is_current(p_installation,p_workspace,p_generation,p_shop,p_domain,p_key,p_attempt,p_fence) then return false; end if;
 update operations.shopify_order_work_reservations set phase='entitlement_dispatched',entitlement_request_count=1
 where attempt_id=p_attempt and phase='entitlement_intent' and entitlement_request_count=0;
 if not found then return false; end if;
 update operations.refresh_control set revision=revision+1 where singleton;
 return true;
end
$fn$;

create function operations.shopify_order_reconciliation_owner(p_attempt uuid) returns jsonb
language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('installationId',r.installation_id::text,'workspaceId',r.workspace_id::text,
  'installGeneration',r.install_generation,'shopId',i.shop_id,'shopDomain',q.quota_contexts->'shopify_admin'->>'accountId')
 from operations.shopify_order_work_reservations r
 join operations.shopify_order_pending_ranges q on q.installation_id=r.installation_id and q.range_key=r.range_key
 join shopify.installations i on i.id=r.installation_id
 where r.attempt_id=p_attempt and q.workspace_id=r.workspace_id and q.install_generation=r.install_generation
$fn$;

-- Pure classification of an exact row image. The mutation passes its locked row,
-- never an earlier read snapshot or caller-provided request/termination flags.
create function operations.shopify_order_reconciliation_view(p_row jsonb,p_owner jsonb) returns jsonb
language plpgsql immutable set search_path='' as $fn$
declare classification text; partner integer:=(p_row->>'entitlement_request_count')::integer;
 admin integer:=(p_row->>'order_request_count')::integer; receipt boolean;
 observed boolean; phase text:=p_row->>'phase';
begin
 receipt:=p_row->>'entitlement_observed_at' is not null and p_row->>'entitlement_source_hash' is not null;
 observed:=p_row->>'order_observed_at' is not null and p_row->>'order_stats' is not null;
 if phase='reconciled' then classification:=p_row->>'reconciliation_classification';
 elsif p_row->>'status'='released' then classification:='already_released';
 elsif ((p_row->>'entitlement_observed_at' is null)<>(p_row->>'entitlement_source_hash' is null))
  or ((p_row->>'order_observed_at' is null)<>(p_row->>'order_stats' is null))
 then classification:='metadata_conflict';
 elsif admin>0 then
  if partner is distinct from 1 or not receipt then classification:='metadata_conflict';
  elsif observed and coalesce(p_row->'order_stats'->>'requests','')=admin::text then classification:='observed_not_durable';
  elsif not observed then classification:='partial_or_unknown_admin';
  else classification:='metadata_conflict'; end if;
 elsif observed then classification:='metadata_conflict';
 elsif partner is null then classification:='unknown_legacy_dispatch';
 elsif partner=0 and not receipt and phase in ('pre_request','entitlement_intent','stopped') then classification:='no_provider_dispatch';
 elsif partner=1 and receipt and phase in ('entitlement_observed','entitlement_denied','order_intent','stopped') then classification:='no_admin_dispatch';
 else classification:='unknown_entitlement_dispatch'; end if;
 return jsonb_build_object('attemptId',p_row->>'attempt_id','rangeKey',p_row->>'range_key','fence',(p_row->>'fence')::bigint,
  'owner',p_owner,'reservationStatus',p_row->>'status','phase',phase,'entitlementRequests',partner,'adminRequests',admin,'countsAreDispatchMarkers',true,
  'entitlementReceiptRecorded',receipt,'orderObservationRecorded',observed,'classification',classification,
  'reconciliationVersion',(p_row->>'reconciliation_version')::bigint,'reconciliationState',p_row->>'reconciliation_state',
  'reconciliationActionId',p_row->>'reconciliation_action_id','reconciledAt',p_row->>'reconciled_at','priorPhase',p_row->>'reconciliation_prior_phase',
  'snapshotHash',encode(sha256(convert_to(jsonb_build_array(p_row,p_owner)::text,'UTF8')),'hex'));
end
$fn$;

create function operations.read_shopify_order_reconciliation(p_attempt uuid) returns jsonb
language sql stable security definer set search_path='' as $fn$
 select operations.shopify_order_reconciliation_view(to_jsonb(r),o.owner)
 from operations.shopify_order_work_reservations r
 cross join lateral (select operations.shopify_order_reconciliation_owner(r.attempt_id) owner) o
 where r.attempt_id=p_attempt and o.owner is not null
$fn$;

create function operations.reconcile_shopify_order_work(p_attempt uuid,p_fence bigint,p_snapshot text,p_action uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare r operations.shopify_order_work_reservations%rowtype; owner jsonb; review jsonb; state text; release_slot boolean;
begin
 if p_attempt is null or p_fence is null or p_snapshot is null or p_snapshot!~'^[a-f0-9]{64}$' or p_action is null
 then raise exception 'SHOPIFY_ORDER_RECONCILIATION_INPUT_INVALID'; end if;
 perform 1 from operations.refresh_control where singleton for update;
 select * into r from operations.shopify_order_work_reservations where attempt_id=p_attempt for update;
 if not found then return jsonb_build_object('status','not_observed'); end if;
 owner:=operations.shopify_order_reconciliation_owner(p_attempt);
 if owner is null then return jsonb_build_object('status','scope_unavailable'); end if;
 review:=operations.shopify_order_reconciliation_view(to_jsonb(r),owner);
 if r.fence<>p_fence or review->>'snapshotHash'<>p_snapshot then return jsonb_build_object('status','stale_observation'); end if;
 if r.phase='reconciled' then return jsonb_build_object('status','already_recorded','review',review); end if;
 if r.status='released' then return jsonb_build_object('status','already_released','review',review); end if;
 state:=case review->>'classification'
  when 'no_provider_dispatch' then 'released_before_provider'
  when 'no_admin_dispatch' then 'released_before_admin'
  when 'partial_or_unknown_admin' then 'held_admin_prefix'
  when 'observed_not_durable' then 'held_uncommitted'
  when 'metadata_conflict' then 'held_metadata_conflict'
  else 'held_unknown' end;
 release_slot:=state in ('released_before_provider','released_before_admin');
 -- Fence old begin/dispatch/apply/observe callbacks even for held reservations:
 -- every existing authority gate excludes the new terminal 'reconciled' phase.
 update operations.shopify_order_work_reservations set phase='reconciled',
  status=case when release_slot then 'released' else 'reserved' end,
  released_at=case when release_slot then statement_timestamp() else null end,
  reconciliation_prior_phase=r.phase,reconciliation_classification=review->>'classification',
  reconciliation_state=state,reconciliation_version=r.reconciliation_version+1,
  reconciliation_action_id=p_action,reconciled_at=statement_timestamp(),reconciliation_snapshot_hash=p_snapshot
 where attempt_id=p_attempt;
 update operations.refresh_control set revision=revision+1 where singleton;
 select * into strict r from operations.shopify_order_work_reservations where attempt_id=p_attempt;
 return jsonb_build_object('status','recorded','review',operations.shopify_order_reconciliation_view(to_jsonb(r),owner));
end
$fn$;
revoke all on function operations.shopify_order_reconciliation_owner(uuid),operations.shopify_order_reconciliation_view(jsonb,jsonb),
 operations.read_shopify_order_reconciliation(uuid),operations.reconcile_shopify_order_work(uuid,bigint,text,uuid)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.read_shopify_order_reconciliation(uuid),operations.reconcile_shopify_order_work(uuid,bigint,text,uuid) to adstable_refresh_coordinator;
commit;
