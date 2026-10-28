import {refreshCandidateObservationContext} from "../refresh/quota-authority-binding.server.js";
import {permissionContext} from "../oauth/identity-permission-preflight.server.js";
import {stableJson} from "./common-adapter.server.js";
import {normalizeKlaviyoOrderedProductEvent} from "./klaviyo-reporting.server.js";

export class CandidatePrewriteError extends Error {
  constructor(code){super(`CANDIDATE_PREWRITE_${code}`);this.name="CandidatePrewriteError";}
}
const fail=code=>{throw new CandidatePrewriteError(code);};
const equal=(a,b)=>stableJson(a)===stableJson(b);
const freeze=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};

// Trusted expected scope, completed in-process source evidence, structural review only.
// No report metrics, namespace inference, source-rule extraction or SQL writes here.
export function reviewRefreshCandidatePrewrite({expected,observation,...extra}={}){
  if(Object.keys(extra).length||!expected||Object.keys(expected).sort().join(",")!=="accountId,connectionId,connectionVersion,installGeneration,provider,shopDomain,shopId,workspaceId"
    ||!["meta","google_ads","klaviyo"].includes(expected.provider)||!Number.isSafeInteger(expected.connectionVersion)||expected.connectionVersion<1)fail("INPUT_INVALID");
  let scope;try{scope=permissionContext(expected);}catch{fail("INPUT_INVALID");}
  const provenance=refreshCandidateObservationContext(observation);if(!provenance)fail("OBSERVATION_REQUIRED");
  if(["provider","workspaceId","installGeneration","shopId","shopDomain","accountId"].some(k=>provenance[k]!==scope[k])
    ||observation.provider!==scope.provider||observation.installation?.workspaceId!==scope.workspaceId
    ||observation.installation?.installGeneration!==scope.installGeneration||observation.shop?.shopId!==scope.shopId
    ||observation.shop?.myshopifyDomain!==scope.shopDomain||observation.connection_id!==scope.connectionId
    ||observation.connection_version!==expected.connectionVersion
    ||(scope.provider==="klaviyo"?observation.account?.id:observation.account_id)!==scope.accountId)fail("OWNER_MISMATCH");
  const batch=observation.product_identity_candidates;
  if(!batch||!Array.isArray(batch.rows)||!Array.isArray(batch.candidates)||batch.candidates.length>batch.rows.length
    ||batch.canonical_scope_ready!==false||batch.provider_link_verified!==false||batch.persistable!==false
    ||batch.authorizes_activation!==false||batch.mapping_write_performed!==false)fail("CANDIDATE_BATCH_INVALID");
  const klaviyo=scope.provider==="klaviyo",records=klaviyo?observation.events:observation.native_source?.records;
  if(!Array.isArray(records)||(!klaviyo&&observation.native_source.complete!==true))fail("SOURCE_INCOMPLETE");
  const source=new Map();
  for(const record of records){const key=klaviyo?record.id:record.key;if(source.has(key))fail("SOURCE_DUPLICATE");source.set(key,record);}
  if(batch.rows.length!==source.size)fail("SOURCE_COVERAGE_MISMATCH");
  if(!klaviyo&&!equal(batch.candidate_scope,{workspace_id:scope.workspaceId,installation_generation:scope.installGeneration,
    provider_connection_id:scope.connectionId,platform:scope.provider,platform_account_id:scope.accountId}))fail("CANDIDATE_SCOPE_MISMATCH");
  const rows=[],seen=new Set(),references=new Map();
  for(const row of batch.rows){
    const key=klaviyo?row.provider_event_id:row.source_record_key,native=source.get(key),v=row.product_identity_verification;
    if(seen.has(key))fail("ROW_DUPLICATE");seen.add(key);
    if(!native||row.standardized_product_id!==null||!v||!["candidate_verified_in_shop","unresolved","conflicting"].includes(v.state)
      ||typeof v.reason!=="string"||!v.reason)fail("ROW_INVALID");
    if(klaviyo){
      const {product_identity_verification,...facts}=row;
      if(row.provider_metric_id!==observation.metric.id||!equal(facts,normalizeKlaviyoOrderedProductEvent(native)))fail("SOURCE_MISMATCH");
    }else if(!equal(row.product_context,native.product_context)||scope.provider==="google_ads"&&row.native_product_id!==native.native_product_id
      ||scope.provider==="meta"&&(row.catalog_product_id!==native.catalog_product_id||row.retailer_id!==native.retailer_id))fail("SOURCE_MISMATCH");
    let candidate=null;
    if(v.candidate_index===null){if(v.state==="candidate_verified_in_shop")fail("REFERENCE_MISSING");}
    else {
      if(v.state!=="candidate_verified_in_shop"||!Number.isSafeInteger(v.candidate_index)||v.candidate_index<0||v.candidate_index>=batch.candidates.length)fail("REFERENCE_INVALID");
      candidate=batch.candidates[v.candidate_index];const e=candidate?.candidate_evidence;
      if(!candidate||candidate.candidate_state!==(klaviyo?"candidate_verified_in_shop":"candidate_verified_source_and_shop")
        ||!equal(e?.shop_scope,{workspace_id:scope.workspaceId,installation_generation:scope.installGeneration,shop_id:scope.shopId,shop_domain:scope.shopDomain})
        ||typeof candidate.shopify_product_id!=="string"||!e.shopify||e.shopify.product?.id!==candidate.shopify_product_id&&e.shopify.variant?.product?.id!==candidate.shopify_product_id
        ||e.shopify.product!==null&&e.shopify.product?.id!==candidate.shopify_product_id
        ||candidate.shopify_variant_id===null&&e.shopify.variant!==null
        ||candidate.shopify_variant_id!==null&&(e.shopify.variant?.id!==candidate.shopify_variant_id||e.shopify.variant?.product?.id!==candidate.shopify_product_id))fail("SHOPIFY_EVIDENCE_MISMATCH");
      if(klaviyo){
        if(v.shopify_product_id!==candidate.shopify_product_id||v.shopify_variant_id!==candidate.shopify_variant_id
          ||candidate.native_product_id!==String(row.provider_product_properties.ProductID.value)
          ||candidate.product_context.metric_id!==row.provider_metric_id||e.metric_id!==row.provider_metric_id
          ||e.metric_name!=="Ordered Product"||e.integration_name!=="Shopify")fail("REFERENCE_SOURCE_MISMATCH");
        if(candidate.shopify_variant_id===null?candidate.product_context.native_variant_id!==null:
          candidate.product_context.native_variant_id!==String(row.provider_product_properties["Variant ID"].value)
          ||candidate.product_context.native_variant_id!==candidate.shopify_variant_id.split("/").at(-1))fail("REFERENCE_SOURCE_MISMATCH");
      }else if(!equal(candidate.product_context,row.product_context)||e.source_record_key!==key
        ||!equal(e.source_rule?.product_context,row.product_context)||e.source_rule?.shop_id!==scope.shopId
        ||!equal(e.source_rule.scope,batch.candidate_scope)
        ||scope.provider==="google_ads"&&(candidate.native_product_id!==row.native_product_id||e.source_id_field!=="offerId")
        ||scope.provider==="meta"&&(candidate.catalog_product_id!==row.catalog_product_id||candidate.retailer_id!==row.retailer_id||e.source_id_field!=="retailer_id"))fail("REFERENCE_SOURCE_MISMATCH");
      const ids=references.get(v.candidate_index)??[];ids.push(key);references.set(v.candidate_index,ids);
    }
    rows.push({sourceReference:{family:klaviyo?"events":scope.provider==="meta"?"catalog_products":"merchant_products",nativeKey:key,
      context:klaviyo?{metric_id:row.provider_metric_id}:row.product_context},
      state:v.state,reason:v.reason,candidateIndex:v.candidate_index,candidateShopifyProductId:candidate?.shopify_product_id??null,
      candidateShopifyVariantId:candidate?.shopify_variant_id??null,standardizedProductId:null,observed:row});
  }
  for(let i=0;i<batch.candidates.length;i++){
    if(!references.has(i))fail("ORPHAN_CANDIDATE");
    if(klaviyo){const ids=batch.candidates[i].candidate_evidence.source_event_ids;
      if(!Array.isArray(ids)||new Set(ids).size!==ids.length||!equal([...ids].sort(),[...references.get(i)].sort()))fail("EVENT_REFERENCE_MISMATCH");}
  }
  return freeze({status:"structurally_reviewed_open_gates",scope:{...scope,connectionVersion:expected.connectionVersion},provenance,rows,
    observedEmpty:rows.length===0,counts:{sourceRows:rows.length,candidates:batch.candidates.length,
      unresolved:rows.filter(r=>r.state==="unresolved").length,conflicting:rows.filter(r=>r.state==="conflicting").length},
    candidateReferencesChecked:true,reportLinksReviewed:false,providerClaimsReviewed:false,
    providerLinkVerified:false,canonicalScopeReady:false,nativePermissionVerified:false,persistable:false,
    authorizesActivation:false,mappingWritePerformed:false,DatasetWritePerformed:false,salesRolesChanged:false,exactOverlapVerified:false,
    remaining:["report_Message_and_provider_claim_reconciliation","native_source_namespace_and_access_proof","existing_step14_review_before_canonical_tables_and_writers"]});
}
