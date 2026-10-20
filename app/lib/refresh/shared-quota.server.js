import {randomUUID} from "node:crypto";

// Trusted server composition only. NOT an identity/permission check or native provider adapter.
// No fallback, sleep, retry, refund, policy editing or production wiring.
export function createSharedQuotaGuard({store,now}) {
  if(!["reserve","stop","settle"].every(k=>typeof store?.[k]==="function")||typeof now!=="function") throw new Error("SHARED_QUOTA_INPUT_INVALID");
  return Object.freeze({
    async execute({operationKey,lane,run}) {
      if(!/^[a-f0-9]{64}$/.test(operationKey??"")||!["interactive","background"].includes(lane)||typeof run!=="function") throw new Error("SHARED_QUOTA_INPUT_INVALID");
      const attemptId=randomUUID();
      let permit;
      try {permit=await store.reserve({operationKey,lane,attemptId});} catch {return {status:"needs_attention",reason:"quota_store_unavailable"};}
      if(permit?.status!=="reserved") {
        return ["waiting","not_configured","stopped","clock_invalid","already_reserved"].includes(permit?.status)
          ?{status:permit.status}:{status:"needs_attention",reason:"quota_receipt_invalid"};
      }
      const current=now();
      if(permit.attemptId!==attemptId||permit.operationKey!==operationKey||!Number.isSafeInteger(permit.dispatchBeforeMs)
        ||!Number.isSafeInteger(current)||current<0||current>=permit.dispatchBeforeMs) {
        try {await store.settle({operationKey,attemptId});} catch {return {status:"needs_attention",reason:"quota_settlement_unavailable"};}
        return {status:"not_sent",reason:"quota_permit_invalid_or_expired"};
      }
      // A delayed/reused closure cannot invoke the provider again. One call in this execution.
      let response;
      try {response=await run();} catch {response={outcome:"unknown"};}
      if(response?.outcome==="success") {
        try {if(await store.settle({operationKey,attemptId})!==true) throw Error();} catch {return {status:"needs_attention",reason:"quota_settlement_unavailable"};}
        return {status:"returned",value:response.value};
      }
      let stopped=false;
      try {stopped=await store.stop({operationKey,attemptId})===true;} catch { /* independent alarm wiring is a later gate */ }
      return {status:stopped?"stopped":"needs_attention",reason:response?.outcome==="rejected"?"provider_rejected":"provider_outcome_unknown",stopRecorded:stopped};
    },
  });
}
