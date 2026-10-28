import {reviewShopifyOrderPrewrite} from "./order-prewrite.server.js";
import {reviewRefreshReferencePrewrite} from "../providers/reference-prewrite.server.js";
import {permissionContext} from "../oauth/identity-permission-preflight.server.js";
import {reviewKlaviyoOrderClaimPrewrite} from "../providers/klaviyo-order-prewrite.server.js";

export class ProviderClaimPrewriteError extends Error {
  constructor(code){super(`PROVIDER_CLAIM_PREWRITE_${code}`);this.name="ProviderClaimPrewriteError";}
}
const fail=code=>{throw new ProviderClaimPrewriteError(code);};
const freeze=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};

// Trusted selected provider scopes and completed observations only. An identity
// reference is not an order-level provider claim; never manufacture a matching key.
export function reviewShopifyProviderClaimReadiness({expected,current,previous=null,providers,...extra}={}){
  if(Object.keys(extra).length||!Array.isArray(providers)||providers.length<1||providers.length>10000)fail("INPUT_INVALID");
  const orderReview=reviewShopifyOrderPrewrite({expected,current,previous});
  const selected=new Set(),providerReviews=[];
  for(const input of providers){
    if(!input||Object.keys(input).sort().join(",")!=="expected,observation"
      ||!input.expected||Object.keys(input.expected).sort().join(",")!=="accountId,connectionId,connectionVersion,installGeneration,provider,shopDomain,shopId,workspaceId"
      ||!["meta","google_ads","klaviyo"].includes(input.expected.provider)
      ||!Number.isSafeInteger(input.expected.connectionVersion)||input.expected.connectionVersion<1)fail("PROVIDER_INPUT_INVALID");
    let scope;try{scope=permissionContext(input.expected);}catch{fail("PROVIDER_INPUT_INVALID");}
    if(["workspaceId","installGeneration","shopId","shopDomain"].some(key=>scope[key]!==orderReview.owner[key]))fail("OWNER_MISMATCH");
    const key=[scope.provider,scope.connectionId,scope.accountId],identity=JSON.stringify(key);
    if(selected.has(identity))fail("PROVIDER_DUPLICATE");selected.add(identity);
    const review=input.observation===null?null:reviewRefreshReferencePrewrite({expected:input.expected,observation:input.observation});
    const orderReferenceReview=review!==null&&scope.provider==="klaviyo"
      ?reviewKlaviyoOrderClaimPrewrite({expected:input.expected,observation:input.observation,current,previous}):null;
    providerReviews.push({key,scope:{...scope,connectionVersion:input.expected.connectionVersion},
      observationState:review===null?"observation_not_supplied":"completed_identity_observation",
      claimState:review===null?"not_assessed_without_provider_observation":review.providerClaimState,
      review,orderReferenceReview});
  }
  return freeze({status:"structurally_reviewed_open_gates",owner:orderReview.owner,orderReview,providerReviews,
    comparisonState:"not_assessed_readable_provider_order_claim_required",
    claimMatches:[],unmatchedClaims:null,ordersWithoutProviderClaim:null,
    sourceRanges:{Shopify:current.extractionRange,providers:providerReviews.map(row=>({key:row.key,
      businessWindow:row.review?.provenance.job.window??null}))},
    timeRangesEquated:false,ShopifyJourneyIsProviderClaim:false,aggregateDifferenceIsOverlap:false,
    salesTotalsCalculated:false,salesRolesChanged:false,providerClaimsReviewed:false,providerClaimVerified:false,exactOverlapVerified:false,
    nativePermissionVerified:false,canonicalScopeReady:false,persistable:false,authorizesActivation:false,DatasetWritePerformed:false,
    remaining:["readable_provider_order_claim_collection_and_verified_Shopify_order_identity_required_for_matching",
      "native_source_namespace_access_and_existing_SQL_profile_capacity_gates","existing_step14_review_before_canonical_tables_and_writers"]});
}
