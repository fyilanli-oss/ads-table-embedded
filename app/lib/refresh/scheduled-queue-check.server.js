import {dispatchRefreshPreflight} from "./preflight-bridge.server.js";
import {createScheduledDatasetPostgresClient} from "../database/dataset-postgres.server.js";

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
    const {buildWorkPlan,entitlementVerifier,readPage,validatePage,now,loadDatasetInputs}=work;
    return {status:"queue_checked",queue,interruptions,work:await dispatchRefreshPreflight({store,buildWorkPlan,entitlementVerifier,readPage,validatePage,now,loadDatasetInputs})};
  } catch {
    return {status:"queue_checked",queue,work:{status:"needs_attention",reason:"work_policy_invalid"}};
  }
}

// Trusted scheduler composition. A request cannot supply work or credentials.
export async function runScheduledRefreshWithDataset({store, generation, work, environment, poolFactory}) {
  if (typeof work?.loadDatasetInputs !== "function") throw Error("REFRESH_DATASET_INPUT_INVALID");
  let database;
  let result;
  try {
    result = await runScheduledRefreshCheck({store, generation, work: {...work, async loadDatasetInputs(scope) {
      const inputs = await work.loadDatasetInputs(scope);
      if (inputs.fxResolver !== undefined) throw Error("REFRESH_DATASET_FX_POLICY_REQUIRED");
      database = createScheduledDatasetPostgresClient({environment, deadlineAt: scope.deadlineAt, now: work.now, poolFactory});
      return {owner: inputs.owner, cipher: inputs.cipher, batches: inputs.batches, expectedRevision: inputs.expectedRevision,
        database};
    }}});
  } finally {
    if (database) {
      try { await database.close(); }
      catch { if (result) result = {...result, datasetConnectionCleanup: "unconfirmed"}; }
    }
  }
  return result;
}
