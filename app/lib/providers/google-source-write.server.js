import {bindShopifyProductVerification} from "../shopify/product-identity-verification.server.js";
import {takeGoogleIdentitySourceCapture} from "./google-identity-collection.server.js";
import {prepareSourceWrite, sourcePayloadHash} from "../database/source-evidence-store.server.js";

// A genuine completed collector is required. This boundary stores observations and
// unresolved/conflicting identities only; it cannot accept a reviewed rule or verified mapping.
export function prepareGoogleIdentitySourceWrite({observation,attemptId,policy,cipher,limits,now,...extra}={}){
  if(Object.keys(extra).length)throw Error("GOOGLE_SOURCE_WRITE_INPUT_INVALID");
  const capture=takeGoogleIdentitySourceCapture(observation),pages=[],records={references:[],rules:[],mappings:[],orders:[],lines:[],journeys:[],claims:[],links:[]};
  const mappings=new Map(),linkRefs=[];
  const verificationChecks = new Map(capture.productChecks.map(check => [sourcePayloadHash([check.nativeId, check.context]), bindShopifyProductVerification(check.verification, capture.owner)]));
  for(const [ordinal,p] of capture.pages.entries()){
    const key="p"+ordinal,payload={...p.payload,...p.phase?{phase:p.phase}:{}};
    pages.push({key,family:p.family,ordinal,origin:"google_ads",captureLayer:"collector_projection",numericFidelity:"decoded_only",
      fieldCoverage:Object.keys(payload),schemaVersion:"google-identity-allowlist-v1",sanitizerVersion:"google-identity-source-v1",payload});
    for(const [n,row] of p.payload.records.entries()){
      const ref=key+"r"+n,product=p.family==="merchant_products";
      records.references.push({key:ref,page:key,locatorKind:"row",locator:"/records/"+n,nativeType:product?"MerchantProduct":"ProductLink",
        nativeId:product?row.offerId:row.resourceName,state:"present"});
      if(!product){if(row.merchantCenter.merchantCenterId===capture.merchantId)linkRefs.push(ref);continue;}
      const context={merchant_id:capture.merchantId,feed_label:row.feedLabel,content_language:row.contentLanguage,data_source:row.dataSource,legacy_local:row.legacyLocal===true};
      const candidate=observation.product_identity_candidates?.rows.find(r=>r.native_product_id===row.offerId
        &&Object.keys(context).every(k=>r.product_context[k]===context[k]));
      const state=candidate?.product_identity_verification.state==="conflicting"?"conflicting":"unresolved";
      const mapping="m"+records.mappings.length;
      records.mappings.push({key:mapping,rule:null,identity:{provider:"google_ads",accountId:capture.owner.accountId,nativeId:row.offerId,context},
        revision:"1",nativeId:row.offerId,context,productId:null,variantId:null,state,verifiedAt:null,
        applicability:{state:"verification_pending",reason:candidate?.product_identity_verification.reason??"verified_source_rule_required"}});
      records.links.push({reference:ref,targetType:"mapping",target:mapping,role:"native_product"});mappings.set(mapping,row.offerId);
    }
  }
  if(linkRefs.length<2)throw Error("GOOGLE_SOURCE_LINK_EVIDENCE_REQUIRED");
  for(const mapping of mappings.keys())for(const reference of linkRefs)records.links.push({reference,targetType:"mapping",target:mapping,role:"relationship"});
  // Existing candidate checks remain observations, not accepted rules/mappings.
  if(observation.product_identity_candidates){
    const rows=observation.product_identity_candidates.rows.map(row=>({nativeProductId:row.native_product_id,context:row.product_context,
      state:row.product_identity_verification.state,reason:row.product_identity_verification.reason,
      shopifyVerification:verificationChecks.get(sourcePayloadHash([row.native_product_id,row.product_context]))??null,
      candidate:row.product_identity_verification.candidate_index===null?null:observation.product_identity_candidates.candidates[row.product_identity_verification.candidate_index]}));
    const key="candidate-checks";
    pages.push({key,family:"google_candidate_checks",ordinal:pages.length,origin:"google_ads",captureLayer:"collector_projection",numericFidelity:"decoded_only",
      fieldCoverage:["records"],schemaVersion:"google-candidate-check-v2",sanitizerVersion:"google-identity-source-v1",payload:{records:rows}});
    for(const [i,row] of rows.entries()){
      const ref="candidate"+i;records.references.push({key:ref,page:key,locatorKind:"row",locator:"/records/"+i,nativeType:"CandidateCheck",nativeId:row.nativeProductId,state:"present"});
      const target=records.mappings.find(m=>m.nativeId===row.nativeProductId&&Object.keys(m.context).every(k=>m.context[k]===row.context[k]));
      if(!target)throw Error("GOOGLE_SOURCE_CANDIDATE_REFERENCE_INVALID");records.links.push({reference:ref,targetType:"mapping",target:target.key,role:"candidate_check"});
    }
  }
  const write=prepareSourceWrite({owner:capture.owner,attemptId,ordinal:0,sourceState:"complete",policy,cipher,limits,now,pages,records});
  return Object.freeze({write,merchantId:capture.merchantId,completedAt:capture.completedAt});
}
