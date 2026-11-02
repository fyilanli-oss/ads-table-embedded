import {randomUUID} from "node:crypto";
import {sourceStoreOwner, sourcePayloadHash, canonicalSourceJson} from "./source-evidence-store.server.js";
import {extractShopifyCandidate} from "../providers/catalog-shopify-candidate.server.js";
const fail = code => {throw Error("MAPPING_STORE_" + code);};
const id = x => typeof x === "string" && /^[1-9][0-9]{0,18}$/.test(x) && BigInt(x)<=9223372036854775807n;
const hash = x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const uuid = x => typeof x === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const freeze = x => {if(x && typeof x === "object"){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const future = (x,now) => Number.isFinite(Date.parse(x)) && Date.parse(x)>now;
const same = (a,b) => canonicalSourceJson(a) === canonicalSourceJson(b);
const scalar = x => typeof x === "string" ? x : x && Object.keys(x).join() === "jsonNumber" && /^[1-9][0-9]*$/.test(x.jsonNumber) ? x.jsonNumber : null;
const gid = (x,type) => typeof x === "string" && new RegExp("^gid://shopify/"+type+"/[1-9][0-9]{0,19}$").test(x);
function at(value,path){if(typeof path!=="string"||!/^\/(?:[a-zA-Z0-9_-]+)(?:\/[a-zA-Z0-9_-]+)*$/.test(path))fail("REFERENCE_INVALID");for(const k of path.slice(1).split("/")){if(!value||!Object.hasOwn(value,k))fail("REFERENCE_INVALID");value=value[k];}return value;}
function single(result){if(result?.rows?.length!==1||!result.rows[0].result)fail("RESULT_INVALID");return result.rows[0].result;}
function nativeCandidate(owner,m,r,row){
 if(owner.provider==="google_ads"){
  if(row.offerId!==m.nativeId||!same(m.context,{merchant_id:m.context.merchant_id,feed_label:row.feedLabel,content_language:row.contentLanguage,data_source:row.dataSource,legacy_local:row.legacyLocal===true}))fail("NATIVE_CONTEXT_MISMATCH");
  return extractShopifyCandidate(row.offerId,r.basis);
 }
 if(owner.provider==="meta"){
  const feed=!Object.hasOwn(row,"product_feed")?"missing":row.product_feed===null?"null":"observed";
  if(row.id!==m.nativeId||m.context.identity_namespace!=="catalog_product_id"||feed!==m.context.product_feed_state
   ||(feed==="observed"&&row.product_feed.id!==m.context.product_feed_id))fail("NATIVE_CONTEXT_MISMATCH");
  return extractShopifyCandidate(row.retailer_id,r.basis);
 }
 const p=row.attributes?.event_properties,ctx=m.context;
 const field=(v,k)=>!Object.hasOwn(v,k)?{state:"missing"}:v[k]===null?{state:"null"}:{state:v[k]===""?"empty":"observed",sourceType:typeof v[k]==="object"?"number":typeof v[k],value:v[k]};
 if(!p||!same(ctx.variant,field(p,"Variant ID"))||!same(ctx.legacy_variant,field(p,"VariantID"))||ctx.product_property!=="ProductID"||ctx.product_id_source_type!==(typeof p.ProductID==="string"?"string":"number")||scalar(p.ProductID)!==m.nativeId||row.relationships?.metric?.data?.id!==ctx.metric_id||ctx.integration!=="Shopify"||r.basis.format!=="klaviyo_shopify_ordered_product")fail("NATIVE_CONTEXT_MISMATCH");
 if(Object.hasOwn(p,"VariantID")&&(!Object.hasOwn(p,"Variant ID")||scalar(p.VariantID)!==scalar(p["Variant ID"])))fail("VARIANT_CONFLICT");
 const productId=scalar(p.ProductID),variantId=Object.hasOwn(p,"Variant ID")?scalar(p["Variant ID"]):null;
 if(!productId||!/^([1-9][0-9]{0,19})$/.test(productId)||BigInt(productId)>18446744073709551615n||(Object.hasOwn(p,"Variant ID")&&!variantId))fail("PRODUCT_INVALID");
 return {productId,variantId};
}
function verifyProof(proof,owner,proposed){
 if(!proof||proof.schemaVersion!=="shopify-product-verification-v1"||proof.providerMappingVerified!==false
  ||proof.outcome?.state!=="candidate_verified_in_shop"||proof.scope?.workspace_id!==owner.workspaceId
  ||String(proof.scope?.installation_generation)!==owner.generation||proof.scope?.shop_id!==owner.shopId||proof.scope?.shop_domain!==owner.shopDomain
  ||proof.response?.shop?.id!==owner.shopId||proof.response.shop.myshopifyDomain!==owner.shopDomain)fail("SHOPIFY_PROOF_REQUIRED");
 const product=proposed.productId===null?null:"gid://shopify/Product/"+proposed.productId;
 const variant=proposed.variantId===null?null:"gid://shopify/ProductVariant/"+proposed.variantId;
 if(!same(proof.request,{...(product?{productId:product}:{}),...(variant?{variantId:variant}:{})}))fail("REQUEST_MISMATCH");
 const observed=proof.response.product,v=proof.response.variant;
 if(product && (observed?.state!=="observed"||observed.id!==product||observed.legacyResourceId!==proposed.productId))fail("PRODUCT_MISMATCH");
 if(!product&&observed?.state!=="not_requested")fail("PRODUCT_MISMATCH");
 if(variant && (v?.state!=="observed"||v.id!==variant||v.legacyResourceId!==proposed.variantId||!gid(v.product?.id,"Product")
  ||v.product.legacyResourceId!==v.product.id.split("/").at(-1)||(product&&v.product.id!==product)))fail("VARIANT_MISMATCH");
 if(!variant&&v?.state!=="not_requested")fail("VARIANT_MISMATCH");
 return {productId:product??v.product.id,variantId:variant};
}
function validate(snapshot,owner,cipher,now){
 if(!snapshot||!same(snapshot.owner,owner)||!hash(snapshot.snapshotHash)||!id(snapshot.mapping?.id)||!id(snapshot.rule?.id)
  ||!id(snapshot.sourceBatchId)||!uuid(snapshot.sourceCommitId)||!hash(snapshot.sourceDigest)||!Array.isArray(snapshot.references)||snapshot.references.length<2||snapshot.references.length>100
  ||!Array.isArray(snapshot.pages)||snapshot.pages.length<1||snapshot.pages.length>100
  ||Buffer.byteLength(JSON.stringify(snapshot))>34000000)fail("SNAPSHOT_INVALID");
 const m=snapshot.mapping,r=snapshot.rule,identity=JSON.parse(m.identityKey);
 if(identity.provider!==owner.provider||identity.accountId!==owner.accountId||identity.nativeId!==m.nativeId||!same(identity.context,m.context)
  ||!future(m.retainUntil,now)||!future(r.retainUntil,now)||m.identityVersion!=="1"||r.parserVersion!=="product-mapping-v1"||r.kind!=="product_identity"||!same(r.context,m.context)
  ||r.basis.version!=="product-source-rule-v1"||r.basis.provider!==owner.provider||!same(r.applicability.owner,owner)
  ||!["unresolved","verified"].includes(m.state)||!id(m.revision)||!id(r.version))fail("CONTEXT_INVALID");
 const from=Date.parse(r.applicability.from),until=Date.parse(r.applicability.until),completed=Date.parse(snapshot.completedAt),age=r.applicability.maxObservationAgeMs;
 if(!Number.isSafeInteger(now)||![from,until,completed].every(Number.isFinite)||from>now||until<=now||completed>now||completed<from
  ||!Number.isSafeInteger(age)||age<1||age>86400000||now-completed>=age)fail("STALE");
 const pages=new Map();let bytes=0;
 for(const page of snapshot.pages){
  if(!id(page.id)||pages.has(page.id)||!uuid(page.attemptId)||!Number.isSafeInteger(page.batchOrdinal)||page.batchOrdinal<0
   ||!Number.isSafeInteger(page.plainBytes)||(bytes+=page.plainBytes)>16777216||page.plainBytes<1||!future(page.retainUntil,now))fail("EVIDENCE_BOUNDS");
  pages.set(page.id,{metadata:page,payload:cipher.open({owner,attemptId:page.attemptId,ordinal:page.batchOrdinal,page})});
 }
 const records=snapshot.references.map(ref=>{const p=pages.get(ref.pageId);if(!p||!id(ref.id)||!future(ref.retainUntil,now))fail("REFERENCE_INVALID");const row=at(p.payload,ref.locator);if(sourcePayloadHash(row)!==ref.recordHash)fail("RECORD_HASH_MISMATCH");return {ref,page:p.metadata,row};});
 const ruleRows=records.filter(x=>x.ref.target==="rule");
 const ruleProjection={ruleKey:r.ruleKey,version:r.version,kind:r.kind,context:r.context,parserVersion:r.parserVersion,basis:r.basis,applicability:r.applicability};
 if(!ruleRows.length||ruleRows.some(x=>x.page.family!=="source_rule_review"||x.page.schemaVersion!=="source-rule-review-v1"||!same(x.row,ruleProjection)))fail("RULE_EVIDENCE_REQUIRED");
 if(owner.provider==="klaviyo"&&!records.some(x=>x.ref.role==="metric"&&x.row.id===m.context.metric_id&&x.row.attributes?.name==="Ordered Product"&&x.row.attributes.integration?.name==="Shopify"))fail("METRIC_EVIDENCE_REQUIRED");
 const natives=records.filter(x=>x.ref.target==="mapping"&&["native_product","native_product_observation"].includes(x.ref.role));
 const checks=records.filter(x=>x.ref.target==="mapping"&&x.ref.role==="candidate_check");
 if(!natives.length||!checks.length)fail("NATIVE_EVIDENCE_REQUIRED");
 let accepted=null;
 const used=new Set();
 for(const native of natives){
  const expected=owner.provider==="google_ads"?"merchant_products":owner.provider==="meta"?"meta_catalog_products":"klaviyo_ordered_product_events";
  const schema=owner.provider==="google_ads"?"google-identity-allowlist-v1":owner.provider==="meta"?"meta-identity-allowlist-v1":"klaviyo-source-allowlist-v1";
  if(native.page.family!==expected||native.page.schemaVersion!==schema||native.page.origin!==owner.provider
   ||native.page.captureLayer!==(owner.provider==="klaviyo"?"native_response_projection":"collector_projection"))fail("NATIVE_FAMILY_INVALID");
  const proposed=nativeCandidate(owner,m,r,native.row);if(!proposed)fail("RULE_FORMAT_MISMATCH");
  const candidates=checks.filter(x=>owner.provider==="google_ads"?x.row.nativeProductId===m.nativeId&&same(x.row.context,m.context):owner.provider==="meta"?x.row.catalogProductId===m.nativeId&&x.row.retailerId===native.row.retailer_id&&x.row.context?.catalog_id===m.context.catalog_id:x.row.eventId===native.row.id);
  if(!candidates.length)fail("CANDIDATE_CHECK_REQUIRED");
  for(const check of candidates){
   const family=owner.provider==="google_ads"?"google":owner.provider;
   if(check.page.origin!==owner.provider||check.page.family!==family+"_candidate_checks"||check.page.schemaVersion!==family+"-candidate-check-v2"||check.page.captureLayer!=="collector_projection")fail("CHECK_SCHEMA_INVALID");
   const result=verifyProof(check.row.shopifyVerification,owner,proposed);if(accepted&&!same(accepted,result))fail("CONFLICTING_PROOFS");accepted=result;used.add(check.ref.id);
  }
 }
 if(checks.some(x=>!used.has(x.ref.id)))fail("UNMATCHED_CHECK");
 if(m.state==="verified"&&!same(accepted,{productId:m.productId,variantId:m.variantId}))fail("ACCEPTED_ID_MISMATCH");
 return {accepted,expiresAt:Math.min(until,completed+age,Date.parse(m.retainUntil),Date.parse(r.retainUntil),...snapshot.references.map(x=>Date.parse(x.retainUntil)),...snapshot.pages.map(x=>Date.parse(x.retainUntil)))};
}
export function createVerifiedMappingRepository({database,cipher,now=Date.now}={}){
 if(typeof database?.query!=="function"||typeof cipher?.open!=="function"||typeof now!=="function")fail("CONFIG_INVALID");
 const reviews=new WeakMap(),writes=new WeakMap();
 async function load(input,write){try {const owner=sourceStoreOwner(input.owner),lookup=Object.hasOwn(input,"identity");if(owner.provider==="shopify")fail("INPUT_INVALID");
  if(lookup){if(write||Object.hasOwn(input,"mappingId")||Object.hasOwn(input,"ruleId")||!input.identity||input.identity.provider!==owner.provider||input.identity.accountId!==owner.accountId
    ||Object.keys(input.identity).sort().join()!=="accountId,context,nativeId,provider"||Buffer.byteLength(canonicalSourceJson(input.identity))>8192)fail("INPUT_INVALID");}
  else if(!id(input.mappingId)||!id(input.ruleId))fail("INPUT_INVALID");
  const snapshot=single(await database.query(lookup?"select identity.lookup_verified_mapping($1::jsonb,$2::jsonb) as result":"select identity.mapping_review_state($1::jsonb,$2::bigint,$3::bigint,$4::boolean) as result",
   lookup?[JSON.stringify(owner),canonicalSourceJson(input.identity)]:[JSON.stringify(owner),input.mappingId,input.ruleId,write]));
  if(lookup?!same(JSON.parse(snapshot.mapping?.identityKey??"null"),input.identity):snapshot.mapping?.id!==input.mappingId||snapshot.rule?.id!==input.ruleId)fail("RESULT_INVALID");
  const verified=validate(snapshot,owner,cipher,now());return {snapshot,owner,...verified};
  }catch(error){if(/^(?:MAPPING_STORE_[A-Z_]+|MAPPING_[A-Z_]+|SOURCE_OWNER_CHANGED|SOURCE_PROVIDER_CHANGED)$/.test(error?.message??""))throw error;fail("READ_FAILED");}
 }
 return Object.freeze({
  async review(input){const state=await load(input,true);if(state.snapshot.mapping.state!=="unresolved")fail("UNRESOLVED_REQUIRED");const review=freeze({mappingId:input.mappingId,ruleId:input.ruleId,status:"reviewed_for_mapping_verification"});reviews.set(review,state);return review;},
  prepare(review,{policy,deadlineAt}={}){const s=reviews.get(review),time=now();if(!s)fail("REVIEW_REQUIRED");
   const end=Date.parse(deadlineAt),until=Date.parse(policy?.until);if(!Number.isFinite(end)||end<=time||end>time+600000||!Number.isFinite(until)||until<=time||until>s.expiresAt
    ||typeof policy?.version!=="string"||!policy.version.length||policy.version.length>128||Object.keys(policy).sort().join()!=="until,version")fail("POLICY_INVALID");
   reviews.delete(review);
   const operationId=randomUUID(),p={mappingId:review.mappingId,ruleId:review.ruleId,snapshotHash:s.snapshot.snapshotHash,...s.accepted,policy:structuredClone(policy),deadlineAt};
   const value=freeze({operationId,mappingId:review.mappingId,ruleId:review.ruleId});writes.set(value,{...s,p,used:false});return value;
  },
  async commit(value){const s=writes.get(value);if(!s||s.used)fail("PREPARED_WRITE_REQUIRED");s.used=true;
   try{const receipt=single(await database.query("select identity.commit_verified_mapping($1::jsonb,$2::uuid,$3::jsonb) as result",[JSON.stringify(s.owner),value.operationId,JSON.stringify(s.p)]));
    if(receipt.status!=="committed"||!id(receipt.batchId)||!uuid(receipt.commitId)||!hash(receipt.digest)||receipt.manifest?.kind!=="mapping_verification_v1"
     ||receipt.manifest.sourceBatchId!==s.snapshot.sourceBatchId||receipt.manifest.sourceMappingId!==value.mappingId||receipt.manifest.ruleId!==value.ruleId||!id(receipt.manifest.ids?.["mapping:accepted"])||receipt.manifest.counts?.mappings!==1)fail("RESULT_INVALID");
    return freeze({...receipt,historical:true,authorizesActivation:false,DatasetWritePerformed:false});
   }catch{fail("WRITE_UNCONFIRMED");}
  },
  async readCurrent(input){const s=await load(input,false);if(s.snapshot.mapping.state!=="verified")fail("NOT_VERIFIED");return freeze({status:"verified",mappingId:s.snapshot.mapping.id,ruleId:s.snapshot.rule.id,revision:s.snapshot.mapping.revision,...s.accepted,context:s.snapshot.mapping.context,owner:s.owner,reportNamespaceVerified:false,authorizesActivation:false,DatasetWritePerformed:false});},
  async inspect({owner,operationId}){try {owner=sourceStoreOwner(owner);if(!uuid(operationId))fail("INPUT_INVALID");const r=single(await database.query("select evidence.read_source_receipt($1::jsonb,$2::uuid,0) as result",[JSON.stringify(owner),operationId]));
   if(r.status==="not_observed")return freeze({status:"not_observed",rollbackProven:false});
   if(!["committed","invalidated"].includes(r.status)||r.manifest?.kind!=="mapping_verification_v1")fail("RECEIPT_INVALID");return freeze({...r,historical:true,currentMappingVerified:false});}catch(error){if(/^MAPPING_STORE_[A-Z_]+$/.test(error?.message??""))throw error;fail("READ_FAILED");}}
 });
}
