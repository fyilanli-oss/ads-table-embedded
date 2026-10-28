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
    async recordFeedback({operationKey,attemptId,feedback}) {
      if(typeof feedback?.kind==="string"&&feedback.kind.startsWith("shopify_admin_cost_")) {
        const points=["requestedQueryCost","actualQueryCost","maximumAvailable","currentlyAvailable","restoreRate"];
        const observed=feedback.kind==="shopify_admin_cost_observed",partial=feedback.kind==="shopify_admin_cost_partial";
        const number=v=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER;
        if(!valid({operationKey,attemptId})||!feedback||typeof feedback!=="object"||Array.isArray(feedback)
          ||Object.keys(feedback).sort().join(",")!=="actualQueryCost,currentlyAvailable,httpStatus,kind,maximumAvailable,requestedQueryCost,restoreRate"
          ||!["shopify_admin_cost_observed","shopify_admin_cost_partial","shopify_admin_cost_missing","shopify_admin_cost_invalid"].includes(feedback.kind)
          ||!Number.isInteger(feedback.httpStatus)||feedback.httpStatus<100||feedback.httpStatus>599
          ||(observed||partial?(!Number.isSafeInteger(feedback.requestedQueryCost)||feedback.requestedQueryCost<0
            ||(observed?(!Number.isSafeInteger(feedback.actualQueryCost)||feedback.actualQueryCost<0||feedback.actualQueryCost>feedback.requestedQueryCost):feedback.actualQueryCost!==null)
            ||![feedback.maximumAvailable,feedback.currentlyAvailable,feedback.restoreRate].every(number)||feedback.currentlyAvailable>feedback.maximumAvailable)
            :points.some(k=>feedback[k]!==null))) throw new Error("SHARED_QUOTA_INPUT_INVALID");
        return await result("select operations.record_shopify_admin_quota_feedback($1::text,$2::uuid,$3::jsonb) as result",[operationKey,attemptId,JSON.stringify(feedback)])===true;
      }
      if(!valid({operationKey,attemptId})||!feedback||typeof feedback!=="object"||Array.isArray(feedback)
        ||Object.keys(feedback).sort().join(",")!=="httpStatus,kind,limit,remaining,resetSeconds,retryAfterSeconds"
        ||!["steady","retry_after","missing","invalid"].includes(feedback.kind)
        ||!Number.isInteger(feedback.httpStatus)||feedback.httpStatus<100||feedback.httpStatus>599
        ||[feedback.limit,feedback.remaining,feedback.resetSeconds,feedback.retryAfterSeconds].some(v=>v!==null&&(!Number.isSafeInteger(v)||v<0))) throw new Error("SHARED_QUOTA_INPUT_INVALID");
      return await result("select operations.record_shared_api_quota_feedback($1::text,$2::uuid,$3::jsonb) as result",[operationKey,attemptId,JSON.stringify(feedback)])===true;
    },
    async resolveRoute({routeKey,connectionScopeKey,provider}) {
      if(![routeKey,connectionScopeKey].every(v=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v))
        ||!["shopify_partner","shopify_admin","meta","google_ads","klaviyo"].includes(provider)) throw new Error("SHARED_QUOTA_INPUT_INVALID");
      const operation=await result("select operations.resolve_shared_api_quota_route($1::text,$2::text,$3::text) as result",[routeKey,connectionScopeKey,provider]);
      if(operation!==null&&(typeof operation!=="string"||!/^[a-f0-9]{64}$/.test(operation))) throw new Error("SHARED_QUOTA_STORE_UNAVAILABLE");
      return operation;
    },
    async reserve(input) {
      if(!valid(input)||!["interactive","background"].includes(input.lane)) throw new Error("SHARED_QUOTA_INPUT_INVALID");
      return result("select operations.reserve_shared_api_quota($1::text,$2::uuid,$3::text) as result",[input.operationKey,input.attemptId,input.lane]);
    },
    async stop(input) {
      const {knownResponse=false,connectionFailure=false,quotaSignal=null}=input;
      if(!valid(input)||typeof knownResponse!=="boolean"||typeof connectionFailure!=="boolean"||![null,"shopify_partner_throttled","shopify_admin_throttled"].includes(quotaSignal)
        ||(connectionFailure&&!knownResponse)||(quotaSignal!==null&&(!knownResponse||connectionFailure))) throw new Error("SHARED_QUOTA_INPUT_INVALID");
      if(input.quotaObservation!=null) {
        const d=input.quotaObservation;
        if(!knownResponse||connectionFailure||quotaSignal!==null||!d||Object.keys(d).sort().join(",")!=="code,scope"
          ||!["ACCOUNT","DEVELOPER"].includes(d.scope)
          ||!["RESOURCE_EXHAUSTED","RESOURCE_TEMPORARILY_EXHAUSTED","EXCESSIVE_SHORT_TERM_QUERY_RESOURCE_CONSUMPTION","EXCESSIVE_LONG_TERM_QUERY_RESOURCE_CONSUMPTION"].includes(d.code)) throw new Error("SHARED_QUOTA_INPUT_INVALID");
        return await result("select operations.stop_shared_api_quota_google_observed($1::text,$2::uuid,$3::text,$4::text) as result",[input.operationKey,input.attemptId,d.scope,d.code])===true;
      }
      return await result("select operations.stop_shared_api_quota_scoped($1::text,$2::uuid,$3::boolean,$4::boolean,$5::text) as result",
        [input.operationKey,input.attemptId,knownResponse,connectionFailure,quotaSignal])===true;
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
