import {dispatchRefreshPreflight} from "./preflight-bridge.server.js";

export const refreshTickGenerationValid=value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const stopped=new Set(["not_configured","not_current_generation","clock_invalid","duplicate"]);

// Internal composition only: no public route, cron activation, date defaults or provider retry.
export async function runScheduledRefreshCheck({store,generation,work}) {
  if(typeof store?.checkScheduledQueue!=="function"||!refreshTickGenerationValid(generation)) throw new Error("REFRESH_TICK_INPUT_INVALID");
  let receipt;
  try {
    receipt=await store.checkScheduledQueue({generation});
    if(stopped.has(receipt?.status)) return {status:receipt.status};
    if(receipt?.status!=="checked"||receipt.generation!==generation
      || ![receipt.sequence,receipt.queueRevision].every(n=>Number.isSafeInteger(n)&&n>0)
      || !Number.isSafeInteger(receipt.checkedAtMs)||receipt.checkedAtMs<0) throw new Error();
  } catch {
    // Unknown commit outcome: do not dispatch, retry or manufacture a successful heartbeat.
    return {status:"needs_attention",reason:"queue_check_unavailable"};
  }
  const queue={generation:receipt.generation,sequence:receipt.sequence,queueRevision:receipt.queueRevision,checkedAtMs:receipt.checkedAtMs};
  let interruptions;
  try {
    interruptions=await store.reviewInterruptedWork();
    if(interruptions?.status!=="not_configured" && (interruptions?.status!=="reviewed"
      || ![interruptions.stopped,interruptions.uncertain].every(n=>Number.isSafeInteger(n)&&n>=0))) throw new Error();
  } catch {
    return {status:"queue_checked",queue,work:{status:"needs_attention",reason:"interrupted_work_review_unavailable"}};
  }
  if(work===undefined) return {status:"queue_checked",queue,interruptions,work:{status:"work_policy_required"}};
  if(interruptions.status!=="reviewed") return {status:"queue_checked",queue,interruptions,work:{status:"not_configured"}};
  // Explicitly pick inputs. A work object cannot replace the store or inject a dispatch callback.
  try {
    const {buildWorkPlan,entitlementVerifier,readPage,validatePage,now}=work;
    return {status:"queue_checked",queue,interruptions,work:await dispatchRefreshPreflight({store,buildWorkPlan,entitlementVerifier,readPage,validatePage,now})};
  } catch {
    return {status:"queue_checked",queue,work:{status:"needs_attention",reason:"work_policy_invalid"}};
  }
}
