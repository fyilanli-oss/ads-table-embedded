import {randomUUID} from "node:crypto";
import {sourceStoreOwner, sourcePayloadHash, canonicalSourceJson} from "./source-evidence-store.server.js";
import {validateRuleSourceObservation} from "./verified-mapping-store.server.js";

const fail = code => {throw Error("SOURCE_RULE_" + code);};
const id = x => typeof x === "string" && /^[1-9][0-9]{0,18}$/.test(x) && BigInt(x)<=9223372036854775807n;
const hash = x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const uuid = x => typeof x === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const same = (a,b) => canonicalSourceJson(a)===canonicalSourceJson(b);
const freeze = x => {if(x&&typeof x==="object"){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const instant = x => typeof x==="string" && Number.isFinite(Date.parse(x)) && new Date(x).toISOString()===x;
function single(result){if(result?.rows?.length!==1||!result.rows[0].result)fail("RESULT_INVALID");return result.rows[0].result;}
function proposalInput(p,owner,time){
 if(!p||Object.keys(p).sort().join()!=="basis,from,maxObservationAgeMs,previousRuleId,ruleKey,until"
  ||typeof p.ruleKey!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(p.ruleKey)
  ||(p.previousRuleId!==null&&!id(p.previousRuleId))||!instant(p.from)||!instant(p.until)||Date.parse(p.from)>time||Date.parse(p.until)<=time
  ||!Number.isSafeInteger(p.maxObservationAgeMs)||p.maxObservationAgeMs<1||p.maxObservationAgeMs>86400000)fail("PROPOSAL_INVALID");
 const b=p.basis,klaviyo=owner.provider==="klaviyo";
 if(!b||b.version!=="product-source-rule-v1"||b.provider!==owner.provider
  ||Object.keys(b).sort().join()!==(b.format==="shopify_market_product_variant"?"format,market,provider,version":"format,provider,version")
  ||(klaviyo?b.format!=="klaviyo_shopify_ordered_product":!["shopify_product_id","shopify_variant_id","shopify_market_product_variant"].includes(b.format))
  ||(b.format==="shopify_market_product_variant"&&!/^[A-Z]{2}$/.test(b.market??"")))fail("FORMAT_INVALID");
 return p;
}
function decisionInput(d,s,time){
 if(!d||Object.keys(d).sort().join()!=="decisionId,proposalHash,snapshotHash,status,validUntil"||d.status!=="approved"||!uuid(d.decisionId)
  ||d.snapshotHash!==s.snapshot.snapshotHash||d.proposalHash!==s.snapshot.proposalHash||!instant(d.validUntil)
  ||Date.parse(d.validUntil)<=time||Date.parse(d.validUntil)>s.expiresAt)fail("EXPLICIT_REVIEW_REQUIRED");
}
// Private server-only composition. No default reviewer, request route, credential,
// native call, inferred source configuration or role grant is installed here.
export function createSourceRuleRepository({database,cipher,reviewAuthority,now=Date.now}={}){
 if(typeof database?.query!=="function"||typeof cipher?.open!=="function"||typeof cipher?.seal!=="function"
  ||typeof reviewAuthority!=="function"||typeof now!=="function")fail("CONFIG_INVALID");
 const reviews=new WeakMap(),writes=new WeakMap();
 return Object.freeze({
  async review(input){try{
   input=structuredClone(input);const owner=sourceStoreOwner(input.owner),time=now();
   if(owner.provider==="shopify"||!id(input.mappingId))fail("INPUT_INVALID");
   const proposal=proposalInput(input.proposal,owner,time);
   const snapshot=structuredClone(single(await database.query("select identity.source_rule_review_state($1::jsonb,$2::bigint,$3::jsonb) as result",
    [JSON.stringify(owner),input.mappingId,canonicalSourceJson(proposal)])));
   const r=snapshot.rule,identity=JSON.parse(snapshot.mapping?.identityKey??"null");
   if(snapshot.mapping?.id!==input.mappingId||!hash(snapshot.proposalHash)||!same(snapshot.proposal,proposal)
    ||!Array.isArray(snapshot.references)||snapshot.references.length>32||!Array.isArray(snapshot.pages)
    ||snapshot.pages.reduce((n,p)=>n+p.plainBytes,0)>16711680
    ||!id(r?.version)||r.ruleKey!==proposal.ruleKey||!same(r.basis,proposal.basis)
    ||!same(r.applicability,{owner,identity,from:proposal.from,until:proposal.until,maxObservationAgeMs:proposal.maxObservationAgeMs}))fail("RESULT_INVALID");
   const observed=validateRuleSourceObservation(snapshot,owner,cipher,now()),s={owner,proposal,snapshot,...observed};
   const decision=structuredClone(await reviewAuthority(freeze({owner,identity,proposedRule:structuredClone(r),snapshotHash:snapshot.snapshotHash,
    proposalHash:snapshot.proposalHash,evidence:snapshot.references.map(x=>({id:x.id,role:x.role,recordHash:x.recordHash})),expiresAt:new Date(s.expiresAt).toISOString()})));
   decisionInput(decision,s,now());
   const value=freeze({mappingId:input.mappingId,ruleKey:proposal.ruleKey,version:r.version,status:"explicitly_reviewed"});
   reviews.set(value,{...s,decision});return value;
  }catch(error){if(/^(?:SOURCE_RULE_[A-Z_]+|MAPPING_STORE_[A-Z_]+|SOURCE_OWNER_CHANGED|SOURCE_PROVIDER_CHANGED)$/.test(error?.message??""))throw error;fail("REVIEW_FAILED");}},
  prepare(review,{policy,deadlineAt}={}){
   const s=reviews.get(review),time=now();if(!s)fail("REVIEW_REQUIRED");decisionInput(s.decision,s,time);
   if(!instant(deadlineAt)||Date.parse(deadlineAt)<=time||Date.parse(deadlineAt)>time+600000
    ||!policy||Object.keys(policy).sort().join()!=="until,version"||typeof policy.version!=="string"||policy.version.length<1||policy.version.length>128
    ||!instant(policy.until)||Date.parse(policy.until)<=time||Date.parse(policy.until)>Math.min(s.expiresAt,Date.parse(s.decision.validUntil)))fail("POLICY_INVALID");
   const operationId=randomUUID(),r=s.snapshot.rule;
   const projection={ruleKey:r.ruleKey,version:r.version,kind:r.kind,context:r.context,parserVersion:r.parserVersion,basis:r.basis,
    applicability:{...r.applicability,review:{...s.decision,sourceMappingId:review.mappingId}}};
   const page=cipher.seal({owner:s.owner,attemptId:operationId,ordinal:0,page:{key:"review",family:"source_rule_review",ordinal:0,origin:s.owner.provider,
    captureLayer:"collector_projection",numericFidelity:"decoded_only",fieldCoverage:["records"],schemaVersion:"source-rule-review-v1",sanitizerVersion:"source-rule-review-v1"},payload:{records:[projection]}});
   reviews.delete(review);
   const value=freeze({operationId,ruleKey:r.ruleKey,version:r.version});
   writes.set(value,{...s,used:false,p:{mappingId:review.mappingId,proposal:s.proposal,snapshotHash:s.snapshot.snapshotHash,decision:s.decision,
    policy:structuredClone(policy),deadlineAt,page,projectionHash:sourcePayloadHash(projection)}});return value;
  },
  async commit(value){
   const s=writes.get(value);if(!s||s.used)fail("PREPARED_WRITE_REQUIRED");s.used=true;
   try{
    const r=single(await database.query("select identity.commit_reviewed_source_rule($1::jsonb,$2::uuid,$3::jsonb) as result",[JSON.stringify(s.owner),value.operationId,JSON.stringify(s.p)]));
    if(r.status!=="committed"||!id(r.batchId)||!uuid(r.commitId)||!hash(r.digest)||r.manifest?.kind!=="source_rule_review_v1"
     ||r.manifest.sourceMappingId!==s.snapshot.mapping.id||r.manifest.sourceBatchId!==s.snapshot.sourceBatchId
     ||r.manifest.decisionId!==s.decision.decisionId||r.manifest.ruleKey!==value.ruleKey||r.manifest.ruleVersion!==value.version
     ||!id(r.manifest.ids?.["rule:reviewed"])||r.manifest.counts?.rules!==1)fail("RESULT_INVALID");
    return freeze({...r,historical:true,mappingVerified:false,reportNamespaceVerified:false,authorizesActivation:false,DatasetWritePerformed:false});
   }catch{fail("WRITE_UNCONFIRMED");}
  },
  async inspect({owner,operationId}){try{
   owner=sourceStoreOwner(owner);if(!uuid(operationId))fail("INPUT_INVALID");
   const r=single(await database.query("select evidence.read_source_receipt($1::jsonb,$2::uuid,0) as result",[JSON.stringify(owner),operationId]));
   if(r.status==="not_observed")return freeze({status:"not_observed",rollbackProven:false});
   if(!["committed","invalidated"].includes(r.status)||r.manifest?.kind!=="source_rule_review_v1")fail("RESULT_INVALID");
   return freeze({...r,historical:true,currentRuleVerified:false});
  }catch(error){if(/^SOURCE_RULE_[A-Z_]+$/.test(error?.message??""))throw error;fail("READ_FAILED");}}
 });
}
