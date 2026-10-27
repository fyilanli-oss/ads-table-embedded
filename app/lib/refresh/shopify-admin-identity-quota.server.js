import {SHOPIFY_PRODUCT_CANDIDATE_QUERIES} from "../shopify/product-identity-verification.server.js";

// Exact existing query shapes, not a general GraphQL parser or permission/owner proof.
export function shopifyAdminIdentityFamily(raw) {
  if(typeof raw!=="string"||raw.length>65536)return null;
  try {
    const body=JSON.parse(raw);
    // The SDK uses JSON serialization. Reject duplicate keys/ambiguous JSON too.
    if(JSON.stringify(body)!==raw||!body||Object.keys(body).sort().join(",")!=="query,variables")return null;
    const family=Object.entries(SHOPIFY_PRODUCT_CANDIDATE_QUERIES).find(([,query])=>query===body.query)?.[0];
    if(!family||!body.variables||typeof body.variables!=="object"||Array.isArray(body.variables))return null;
    const keys=family==="identity_product"?["productId"]:family==="identity_variant"?["variantId"]:["productId","variantId"];
    if(Object.keys(body.variables).sort().join(",")!==keys.sort().join(","))return null;
    for(const key of keys) {
      const match=new RegExp(`^gid://shopify/${key==="productId"?"Product":"ProductVariant"}/([1-9][0-9]{0,19})$`).exec(body.variables[key]);
      if(typeof body.variables[key]!=="string"||!match||BigInt(match[1])>18446744073709551615n)return null;
    }
    return family;
  } catch {return null;}
}

// Observation only: never grants capacity, refunds usage, guesses plan/limits or reopens a stop.
// Existing SQL feedback storage does not accept this shape yet (step14 review gate).
export function shopifyAdminCostFeedback(status,payload) {
  const httpStatus=Number.isSafeInteger(status)&&status>=100&&status<=599?status:null;
  const empty=kind=>({kind,httpStatus,requestedQueryCost:null,actualQueryCost:null,
    maximumAvailable:null,currentlyAvailable:null,restoreRate:null});
  if(httpStatus===null)return empty("shopify_admin_cost_invalid");
  const cost=payload?.extensions?.cost;
  if(cost===undefined)return empty("shopify_admin_cost_missing");
  if(!cost||typeof cost!=="object"||Array.isArray(cost))return empty("shopify_admin_cost_invalid");
  const throttle=cost.throttleStatus;
  const {requestedQueryCost:requested,actualQueryCost:actual}=cost;
  const number=v=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER;
  if(!Number.isSafeInteger(requested)||requested<0||actual!==null&&(!Number.isSafeInteger(actual)||actual<0||actual>requested)
    ||!throttle||!number(throttle.maximumAvailable)||!number(throttle.currentlyAvailable)||!number(throttle.restoreRate)
    ||throttle.currentlyAvailable>throttle.maximumAvailable)return empty("shopify_admin_cost_invalid");
  return {kind:actual===null?"shopify_admin_cost_partial":"shopify_admin_cost_observed",httpStatus,requestedQueryCost:requested,actualQueryCost:actual,
    maximumAvailable:throttle.maximumAvailable,currentlyAvailable:throttle.currentlyAvailable,restoreRate:throttle.restoreRate};
}
