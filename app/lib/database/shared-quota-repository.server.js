// Unassigned internal coordinator role only; web runtime is intentionally NOT granted access.
export function createSharedQuotaRepository(database) {
  if(typeof database?.query!=="function") throw new Error("SHARED_QUOTA_INPUT_INVALID");
  const valid=({operationKey,attemptId})=>/^[a-f0-9]{64}$/.test(operationKey??"")&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(attemptId??"");
  async function result(sql,args) {
    try {
      const r=await database.query(sql,args);
      if(r?.rows?.length!==1||!Object.hasOwn(r.rows[0],"result")) throw Error();
      return r.rows[0].result;
    } catch {throw new Error("SHARED_QUOTA_STORE_UNAVAILABLE");}
  }
  return Object.freeze({
    async reserve(input) {
      if(!valid(input)||!["interactive","background"].includes(input.lane)) throw new Error("SHARED_QUOTA_INPUT_INVALID");
      return result("select operations.reserve_shared_api_quota($1::text,$2::uuid,$3::text) as result",[input.operationKey,input.attemptId,input.lane]);
    },
    async stop(input) {
      if(!valid(input)) throw new Error("SHARED_QUOTA_INPUT_INVALID");
      return await result("select operations.stop_shared_api_quota($1::text,$2::uuid) as result",[input.operationKey,input.attemptId])===true;
    },
    async settle(input) {
      if(!valid(input)) throw new Error("SHARED_QUOTA_INPUT_INVALID");
      return await result("select operations.settle_shared_api_quota($1::text,$2::uuid) as result",[input.operationKey,input.attemptId])===true;
    },
    async cleanup({limit}) {
      if(!Number.isSafeInteger(limit)||limit<1||limit>1000) throw new Error("SHARED_QUOTA_INPUT_INVALID");
      return result("select operations.cleanup_shared_api_quota($1::integer) as result",[limit]);
    },
  });
}
