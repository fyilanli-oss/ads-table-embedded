import {refreshStopInput, refreshWorkIdentity} from "../refresh/work-stop-policy.server.js";

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
