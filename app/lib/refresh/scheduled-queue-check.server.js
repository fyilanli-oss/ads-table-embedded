import {dispatchRefreshPreflight} from "./preflight-bridge.server.js";
import {createScheduledDatasetPostgresClient} from "../database/dataset-postgres.server.js";
import {planDatasetBootstrap} from "./dataset-bootstrap.server.js";

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
    if (work.hourly === true && typeof loadDatasetInputs !== "function") throw Error("REFRESH_DATASET_INPUT_INVALID");
    const inputs = {buildWorkPlan,entitlementVerifier,readPage,validatePage,now,loadDatasetInputs};
    const result = work.hourly === true
      ? await dispatchHourlyRefresh({store, work: inputs})
      : await dispatchRefreshPreflight({store, ...inputs});
    return {status:"queue_checked",queue,interruptions,work:result};
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

// Trusted hourly worker. Keep the HTTP heartbeat and its narrow role separate.
export function createHourlyRefreshCoordinator() {
  let tail = Promise.resolve();
  let failed = false;
  return ({store, work}) => dispatchHourlyRefresh({store, work, coordinateAdmission(reserve) {
    const next = tail.then(async () => {
      if (failed) return {status:"needs_attention",reason:"admission_unavailable",reservationMayExist:true};
      try {return await reserve();}
      catch (error) {failed = true; throw error;}
    });
    tail = next.catch(() => {});
    return next;
  }});
}

export function dispatchHourlyRefresh({store, work, coordinateAdmission}) {
  const startedAt = work.now();
  const hour = startedAt - startedAt % 3600000;
  let completed;
  return dispatchRefreshPreflight({
    ...work,
    coordinateAdmission,
    store: {...store, async readPreflightSnapshot() {
      const snapshot = await store.readHourlyPreflightSnapshot({hour});
      if (!Array.isArray(snapshot?.completedHourlyDays)) throw Error("REFRESH_HOUR_INVALID");
      completed = new Set(snapshot.completedHourlyDays.map(day => JSON.stringify(day)));
      return snapshot;
    }},
    async buildWorkPlan(source) {
      const {days} = planDatasetBootstrap({now: new Date(startedAt).toISOString(), timeZone: source.timezone, eligibleFromMs: source.eligibleFromMs});
      const owner = [source.workspaceId, source.installGeneration, source.provider, source.accountId];
      const day = days.find(d => d.state === "requires_current_admission" && !completed.has(JSON.stringify([...owner, d.businessDate])));
      if (!day || work.now() >= hour + 3600000) return null;
      const window = {from: day.businessDate, to: day.businessDate};
      const plan = await work.buildWorkPlan(source, window);
      if (plan === null || work.now() >= hour + 3600000) return null;
      const deadlineAt = Math.min(plan.limits?.deadlineAt, hour + 3600000);
      if (deadlineAt - work.now() < plan.limits?.requestTimeoutMs + plan.limits?.finishReserveMs) return null;
      return {...plan, limits: {...plan.limits, deadlineAt}, window, partitionId: "hourly:" + hour, workClass: "hourly_hot_window"};
    },
  });
}
