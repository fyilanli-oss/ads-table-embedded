import {randomUUID} from "node:crypto";
export const SHOPIFY_ADMIN_COST_UNIT="shopify_admin_query_points";
function adminCostBudget(permit) {
  try {
    const budget=permit.costBudget;
    if(!budget||typeof budget!=="object"||Array.isArray(budget)||Object.keys(budget).sort().join(",")!=="reservedRequestedCost,unit")return null;
    const {unit,reservedRequestedCost}=budget;
    if(unit!==SHOPIFY_ADMIN_COST_UNIT||!Number.isSafeInteger(reservedRequestedCost)||reservedRequestedCost<1)return null;
    return reservedRequestedCost;
  } catch {return null;}
}

// Trusted server composition only. NOT an identity/permission check or native provider adapter.
// No fallback, sleep, retry, refund, policy editing or production wiring.
export function createSharedQuotaGuard({store,now,elapsedNow=()=>performance.now()}) {
  if(!["reserve","stop","settle"].every(k=>typeof store?.[k]==="function")||typeof now!=="function"||typeof elapsedNow!=="function") throw new Error("SHARED_QUOTA_INPUT_INVALID");
  return Object.freeze({
    async execute({operationKey,lane,run,beforeDispatch,requiredCostUnit}) {
      if(!/^[a-f0-9]{64}$/.test(operationKey??"")||!["interactive","background"].includes(lane)||typeof run!=="function"
        ||requiredCostUnit!==undefined&&requiredCostUnit!==SHOPIFY_ADMIN_COST_UNIT) throw new Error("SHARED_QUOTA_INPUT_INVALID");
      const attemptId=randomUUID();
      const started=elapsedNow();
      let permit;
      try {permit=await store.reserve({operationKey,lane,attemptId});} catch {return {status:"needs_attention",reason:"quota_store_unavailable"};}
      if(permit?.status!=="reserved") {
        return ["waiting","not_configured","stopped","clock_invalid","already_reserved"].includes(permit?.status)
          ?{status:permit.status}:{status:"needs_attention",reason:"quota_receipt_invalid"};
      }
      // Snapshot only a validated scalar from the SAME reservation before any further await.
      // SQL must prove this ceiling was charged to every applicable Admin cost scope.
      const requestedCostCeiling=requiredCostUnit===SHOPIFY_ADMIN_COST_UNIT?adminCostBudget(permit):null;
      if(requiredCostUnit!==undefined&&requestedCostCeiling===null) {
        try {if(await store.settle({operationKey,attemptId})!==true) throw Error();} catch {return {status:"needs_attention",reason:"quota_settlement_unavailable"};}
        return {status:"not_sent",reason:"quota_cost_budget_invalid"};
      }
      let dispatchCurrent=true;
      if(beforeDispatch!==undefined) {
        try {dispatchCurrent=typeof beforeDispatch==="function"&&await beforeDispatch()===true;} catch {dispatchCurrent=false;}
      }
      if(!dispatchCurrent) {
        try {if(await store.settle({operationKey,attemptId})!==true) throw Error();} catch {return {status:"needs_attention",reason:"quota_settlement_unavailable"};}
        return {status:"not_sent",reason:"authority_not_current"};
      }
      const current=now();
      const elapsed=elapsedNow()-started;
      if(permit.attemptId!==attemptId||permit.operationKey!==operationKey||!Number.isSafeInteger(permit.dispatchBeforeMs)
        ||!Number.isSafeInteger(permit.dispatchBudgetMs)||permit.dispatchBudgetMs<1||!Number.isFinite(started)||!Number.isFinite(elapsed)||elapsed<0||elapsed>=permit.dispatchBudgetMs
        ||!Number.isSafeInteger(current)||current<0||current>=permit.dispatchBeforeMs) {
        try {if(await store.settle({operationKey,attemptId})!==true) throw Error();} catch {return {status:"needs_attention",reason:"quota_settlement_unavailable"};}
        return {status:"not_sent",reason:"quota_permit_invalid_or_expired"};
      }
      // run must immediately perform exactly one boundary request, not a hidden multi-call/retry loop.
      let response;
      try {response=requiredCostUnit===undefined?await run():await run(requestedCostCeiling);} catch {response={outcome:"unknown"};}
      let feedbackRecorded=true;
      if(response?.feedback!=null) {
        try {feedbackRecorded=typeof store.recordFeedback==="function"&&await store.recordFeedback({operationKey,attemptId,feedback:response.feedback})===true;}
        catch {feedbackRecorded=false;}
      }
      if(response?.outcome==="success") {
        if(!feedbackRecorded) return {status:"needs_attention",reason:"quota_feedback_unavailable"};
        try {if(await store.settle({operationKey,attemptId})!==true) throw Error();} catch {return {status:"needs_attention",reason:"quota_settlement_unavailable"};}
        return {status:"returned",value:response.value};
      }
      let stopped=false;
      const knownResponse=response?.outcome==="rejected";
      const connectionFailure=knownResponse&&response?.connectionFailure===true;
      const quotaSignal=knownResponse&&!connectionFailure&&["shopify_partner_throttled","shopify_admin_throttled"].includes(response?.quotaSignal)?response.quotaSignal:null;
      const observation=knownResponse&&!connectionFailure&&response?.quotaObservation;
      try {stopped=await store.stop({operationKey,attemptId,knownResponse,connectionFailure,quotaSignal,...observation?{quotaObservation:observation}:{}})===true;} catch { /* independent alarm wiring is a later gate */ }
      if(!feedbackRecorded) return {status:"needs_attention",reason:"quota_feedback_unavailable",stopRecorded:stopped};
      return {status:stopped?"stopped":"needs_attention",reason:knownResponse&&response?.costBudgetExceeded===true&&requiredCostUnit===SHOPIFY_ADMIN_COST_UNIT
        ?"quota_cost_budget_exceeded":knownResponse?"provider_rejected":"provider_outcome_unknown",stopRecorded:stopped};
    },
  });
}
