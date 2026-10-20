import {randomUUID} from "node:crypto";

// Trusted server composition only. NOT an identity/permission check or native provider adapter.
// No fallback, sleep, retry, refund, policy editing or production wiring.
export function createSharedQuotaGuard({store,now,elapsedNow=()=>performance.now()}) {
  if(!["reserve","stop","settle"].every(k=>typeof store?.[k]==="function")||typeof now!=="function"||typeof elapsedNow!=="function") throw new Error("SHARED_QUOTA_INPUT_INVALID");
  return Object.freeze({
    async execute({operationKey,lane,run,beforeDispatch}) {
      if(!/^[a-f0-9]{64}$/.test(operationKey??"")||!["interactive","background"].includes(lane)||typeof run!=="function") throw new Error("SHARED_QUOTA_INPUT_INVALID");
      const attemptId=randomUUID();
      const started=elapsedNow();
      let permit;
      try {permit=await store.reserve({operationKey,lane,attemptId});} catch {return {status:"needs_attention",reason:"quota_store_unavailable"};}
      if(permit?.status!=="reserved") {
        return ["waiting","not_configured","stopped","clock_invalid","already_reserved"].includes(permit?.status)
          ?{status:permit.status}:{status:"needs_attention",reason:"quota_receipt_invalid"};
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
      try {response=await run();} catch {response={outcome:"unknown"};}
      if(response?.outcome==="success") {
        try {if(await store.settle({operationKey,attemptId})!==true) throw Error();} catch {return {status:"needs_attention",reason:"quota_settlement_unavailable"};}
        return {status:"returned",value:response.value};
      }
      let stopped=false;
      const knownResponse=response?.outcome==="rejected";
      const connectionFailure=knownResponse&&response?.connectionFailure===true;
      const quotaSignal=knownResponse&&!connectionFailure&&response?.quotaSignal==="shopify_partner_throttled"?response.quotaSignal:null;
      try {stopped=await store.stop({operationKey,attemptId,knownResponse,connectionFailure,quotaSignal})===true;} catch { /* independent alarm wiring is a later gate */ }
      return {status:stopped?"stopped":"needs_attention",reason:response?.outcome==="rejected"?"provider_rejected":"provider_outcome_unknown",stopRecorded:stopped};
    },
  });
}
