import {refreshStopInput, refreshWorkIdentity} from "../refresh/work-stop-policy.server.js";
import {takeRefreshQuotaWait} from "../refresh/quota-work-wait.server.js";
import {refreshTickGenerationValid} from "../refresh/scheduled-queue-check.server.js";

// Not wired to any route/worker. Requires the separately provisioned internal coordinator role.
export function createRefreshWorkRepository(database) {
  if (typeof database?.query !== "function") throw new TypeError("database.query is required");
  async function result(sql, parameters = []) {
    try {
      const response = await database.query(sql, parameters);
      if (!Array.isArray(response?.rows) || response.rows.length !== 1 || !Object.hasOwn(response.rows[0], "result")) throw new Error();
      return response.rows[0].result;
    } catch { throw new Error("REFRESH_WORK_REPOSITORY_UNAVAILABLE"); }
  }
  async function readAdmissionSnapshot() {
    const snapshot = await result("select operations.read_refresh_admission_snapshot() as result");
    if (!snapshot?.state || !snapshot.budget || !snapshot.bounds) throw new Error("REFRESH_WORK_NOT_CONFIGURED");
    return structuredClone(snapshot);
  }
  return Object.freeze({
    readAdmissionSnapshot,
    async reviewInterruptedWork() {
      return result("select operations.review_refresh_interrupted_work() as result");
    },
    async checkScheduledQueue({generation}) {
      if(!refreshTickGenerationValid(generation)) throw new Error("REFRESH_WORK_INPUT_INVALID");
      return result("select operations.check_refresh_queue_on_tick($1::uuid) as result",[generation]);
    },
    async loadQuotaContext({claim,window,provider,entitlementReceipt}) {
      if(!["shopify_partner",claim?.provider].includes(provider)||![window?.from,window?.to].every(v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v))) throw new Error("REFRESH_WORK_INPUT_INVALID");
      const observed=entitlementReceipt?.observedAt??null;
      if(observed!==null&&(typeof observed!=="string"||Number.isNaN(Date.parse(observed)))) throw new Error("REFRESH_WORK_INPUT_INVALID");
      return result("select operations.load_refresh_quota_context($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::date,$8::date,$9::text,$10::timestamptz) as result",
        [...refreshWorkIdentity(claim,{claimRequired:true}),window.from,window.to,provider,observed]);
    },
    async deferQuotaWait({claim,window,wait}) {
      const boundary=takeRefreshQuotaWait(wait,claim);
      if(!boundary||!/^\d{4}-\d{2}-\d{2}$/.test(window?.from??"")||!/^\d{4}-\d{2}-\d{2}$/.test(window?.to??"")) throw new Error("REFRESH_WORK_INPUT_INVALID");
      return await result("select operations.defer_refresh_quota_wait($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::date,$8::date,$9::text) as result",
        [...refreshWorkIdentity(claim,{claimRequired:true}),window.from,window.to,boundary])===true;
    },
    async readPreflightSnapshot() {
      return result("select operations.read_refresh_preflight_snapshot() as result");
    },
    async commitPreflight({expectedRevision,queueRevision,nextState,source,window,partitionId,deadlineAt}) {
      if(![expectedRevision,queueRevision].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isSafeInteger(deadlineAt)||deadlineAt<1||!nextState||!source||!window||typeof partitionId!=="string") throw new Error("REFRESH_WORK_INPUT_INVALID");
      return await result("select operations.commit_refresh_preflight_with_deadline($1::bigint,$2::bigint,$3::jsonb,$4::jsonb,$5::jsonb,$6::text,$7::bigint) as result",
        [expectedRevision,queueRevision,JSON.stringify(nextState),JSON.stringify(source),JSON.stringify(window),partitionId,deadlineAt])===true;
    },
    async loadBoundAuthority({claim,window}) {
      if(!window||typeof window.from!=="string"||typeof window.to!=="string") throw new Error("REFRESH_WORK_INPUT_INVALID");
      return result("select operations.load_refresh_bound_authority($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::date,$8::date) as result",
        [...refreshWorkIdentity(claim,{claimRequired:true}),window.from,window.to]);
    },
    async checkQueueFromAuthority({expectedRevision}) {
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0) throw new Error("REFRESH_WORK_INPUT_INVALID");
      return result("select operations.check_refresh_queue_from_authority($1::bigint) as result",[expectedRevision]);
    },
    async readInventoryStatus() {
      return result("select operations.read_refresh_inventory_status() as result");
    },
    async loadRefreshInstallation({claim}) {
      return result("select operations.load_refresh_entitlement_installation($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint) as result", refreshWorkIdentity(claim,{claimRequired:true}));
    },
    async applyEntitlementSnapshot({claim,snapshot}) {
      return result("select operations.apply_refresh_entitlement_snapshot($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::jsonb) as result",
        [...refreshWorkIdentity(claim,{claimRequired:true}),JSON.stringify(snapshot)]);
    },
    async isEntitlementCurrent({claim,receipt}) {
      if(typeof receipt?.observedAt!=="string" || Number.isNaN(Date.parse(receipt.observedAt))) throw new Error("REFRESH_WORK_INPUT_INVALID");
      return await result("select operations.refresh_entitlement_is_current($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::timestamptz) as result",
        [...refreshWorkIdentity(claim,{claimRequired:true}),receipt.observedAt])===true;
    },
    async readQueueCheck() {
      return result("select operations.read_refresh_queue_check() as result");
    },
    async commitQueueCheck({expectedRevision, inventory}) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !inventory) throw new Error("REFRESH_WORK_INPUT_INVALID");
      return result("select operations.commit_refresh_queue_check($1::bigint,$2::jsonb) as result", [expectedRevision, JSON.stringify(inventory)]);
    },
    async advanceStage({claim,window,expectedStage,stage,rows=0,bytes=0}) {
      const stages=[null,"checking_authority","request_intent","response_received","ready_for_dataset"];
      if(stages.indexOf(stage)!==stages.indexOf(expectedStage)+1||!stages.includes(expectedStage)||!stages.includes(stage)
        || !Number.isSafeInteger(rows)||rows<0||!Number.isSafeInteger(bytes)||bytes<0
        || !/^\d{4}-\d{2}-\d{2}$/.test(window?.from??"")||!/^\d{4}-\d{2}-\d{2}$/.test(window?.to??"")||window.from>window.to) throw new Error("REFRESH_WORK_INPUT_INVALID");
      return await result("select operations.advance_refresh_work_stage($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::text,$8::text,$9::bigint,$10::bigint,$11::date,$12::date) as result",
        [...refreshWorkIdentity(claim,{claimRequired:true}),expectedStage,stage,rows,bytes,window.from,window.to])===true;
    },
    async readStage({claim}) {
      return result("select operations.read_refresh_work_stage($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint) as result",
        refreshWorkIdentity(claim,{claimRequired:true}));
    },
    async recordStop(input) {
      return result("select operations.record_refresh_work_stop($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::text,$8::bigint) as result", refreshStopInput(input));
    },
    async readStop({job}) {
      return result("select operations.read_refresh_work_stop($1::uuid,$2::bigint,$3::text,$4::text,$5::text) as result", refreshWorkIdentity(job).slice(0,5));
    },
    // Ownership observation only. Dataset writes must check under the SAME transaction lock.
    async isClaimCurrent({claim}) {
      return await result("select operations.refresh_claim_is_current($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint) as result",
        refreshWorkIdentity(claim, {claimRequired:true})) === true;
    },
    async resolveStop({job, expectedVersion}) {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("REFRESH_WORK_INPUT_INVALID");
      return await result("select operations.resolve_refresh_work_stop($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint) as result",
        [...refreshWorkIdentity(job).slice(0,5), expectedVersion]) === true;
    },
    async readState() { return (await readAdmissionSnapshot()).state; },
    async compareAndSwap({expectedRevision, nextState}) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !nextState) throw new Error("REFRESH_WORK_INPUT_INVALID");
      return await result("select operations.commit_refresh_admissions($1::bigint,$2::jsonb) as result", [expectedRevision, JSON.stringify(nextState)]) === true;
    },
    async finishClaim({claim, outcome}) {
      if (!["completed", "paused"].includes(outcome) || !claim || !Number.isSafeInteger(claim.fence) || claim.fence < 1) throw new Error("REFRESH_WORK_INPUT_INVALID");
      return await result("select operations.finish_refresh_work($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::text) as result",
        [claim.workspaceId, claim.installGeneration, claim.provider, claim.accountId, claim.id, claim.fence, outcome]) === true;
    },
  });
}
