import {randomUUID} from "node:crypto";
import {shopifyPrewriteOwner} from "../providers/prewrite-owner.server.js";

const uuid=v=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash=v=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const safe=v=>Number.isSafeInteger(v)&&v>=0;
const classes=new Set(["already_released","no_provider_dispatch","no_admin_dispatch","unknown_legacy_dispatch",
  "unknown_entitlement_dispatch","partial_or_unknown_admin","observed_not_durable","metadata_conflict"]);
const states=new Set(["unreviewed","released_before_provider","released_before_admin","held_unknown","held_admin_prefix","held_uncommitted","held_metadata_conflict"]);
const phases=new Set(["pre_request","entitlement_intent","entitlement_dispatched","entitlement_observed","entitlement_denied","order_intent","order_reading","order_observed","stopped","reconciled"]);
const flags={authorizesDispatch:false,authorizesActivation:false,entitlementVerified:false,checkpointAdvanced:false,
  persistable:false,DatasetWritePerformed:false,resumeAuthorized:false,reloadFirstPageAuthorized:false,absenceProvesRollback:false};
const fail=()=>{throw Error("SHOPIFY_ORDER_RECONCILIATION_INPUT_INVALID");};
const freeze=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};

// Internal coordinator-only, explicit inspect then one-shot reconcile. No list/cron,
// provider or quota callback, claimed termination flag, timeout release, native retry,
// source-evidence discard, durable writer or activation can be supplied here.
export function createShopifyOrderReconciliation({database,...extra}={}){
  if(Object.keys(extra).length||typeof database?.query!=="function")fail();
  const inspections=new WeakMap();
  async function one(sql,args){
    const r=await database.query(sql,args);
    if(!Array.isArray(r?.rows)||r.rows.length!==1||!Object.hasOwn(r.rows[0],"result"))throw Error();
    return r.rows[0].result;
  }
  function validate(row,attemptId){
    if(!row||row.attemptId!==attemptId||!hash(row.rangeKey)||!hash(row.snapshotHash)||!safe(row.fence)||row.fence<1
      ||!["reserved","released"].includes(row.reservationStatus)||!phases.has(row.phase)||!classes.has(row.classification)
      ||!safe(row.adminRequests)||row.adminRequests>10000||![null,0,1].includes(row.entitlementRequests)
      ||row.countsAreDispatchMarkers!==true
      ||typeof row.entitlementReceiptRecorded!=="boolean"||typeof row.orderObservationRecorded!=="boolean"
      ||!safe(row.reconciliationVersion)||!states.has(row.reconciliationState)
      ||row.reconciliationActionId!==null&&!uuid(row.reconciliationActionId)
      ||row.reconciledAt!==null&&(typeof row.reconciledAt!=="string"||!Number.isFinite(Date.parse(row.reconciledAt)))
      ||row.priorPhase!==null&&!phases.has(row.priorPhase))throw Error();
    const owner=shopifyPrewriteOwner(row.owner);
    return freeze({...row,owner,workerFenced:row.phase==="reconciled"||row.reservationStatus==="released",...flags});
  }
  return Object.freeze({async inspect({attemptId,...overrides}={}){
    if(Object.keys(overrides).length||!uuid(attemptId))fail();
    try{
      const r=await one("select operations.read_shopify_order_reconciliation($1::uuid) as result",[attemptId]);
      if(r===null)return freeze({status:"not_observed",attemptId,reservationMayBeHeld:true,...flags});
      const view=validate(r,attemptId),result=freeze({status:"observed",review:view,readOnly:true,...flags});
      inspections.set(result,{attemptId,fence:r.fence,snapshot:r.snapshotHash});return result;
    }catch{return freeze({status:"needs_attention",reason:"reconciliation_read_unavailable",attemptId,reservationMayBeHeld:true,...flags});}
  },async reconcile({inspection,...overrides}={}){
    const h=inspections.get(inspection);if(Object.keys(overrides).length||!h)fail();
    // A lost reply consumes the capability; only a fresh explicit read may follow.
    inspections.delete(inspection);const actionId=randomUUID();
    try{
      const r=await one("select operations.reconcile_shopify_order_work($1::uuid,$2::bigint,$3::text,$4::uuid) as result",
        [h.attemptId,h.fence,h.snapshot,actionId]);
      if(["not_observed","scope_unavailable","stale_observation"].includes(r?.status))
        return freeze({status:r.status,attemptId:h.attemptId,recorded:false,reservationMayBeHeld:true,...flags});
      if(!["recorded","already_recorded","already_released"].includes(r?.status))throw Error();
      const review=validate(r.review,h.attemptId);
      if(!review.workerFenced||r.status==="recorded"&&review.reconciliationActionId!==actionId)throw Error();
      return freeze({status:r.status,attemptId:h.attemptId,actionId:review.reconciliationActionId,attemptedActionId:actionId,recorded:r.status!=="already_released",changed:r.status==="recorded",review,
        reservationRetained:review.reservationStatus==="reserved",workerFenced:true,...flags});
    }catch{return freeze({status:"needs_attention",reason:"reconciliation_write_unconfirmed",attemptId:h.attemptId,actionId,
      recorded:false,reservationMayBeHeld:true,...flags});}
  }});
}
