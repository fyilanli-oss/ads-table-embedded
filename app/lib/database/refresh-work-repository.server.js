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
