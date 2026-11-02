import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {verifiedMappingFixture} from "./fixtures/verified-mapping-fixture.js";
import {createSourceRuleRepository} from "../app/lib/database/source-rule-store.server.js";
import {sourcePayloadHash} from "../app/lib/database/source-evidence-store.server.js";

function fixture(provider="google_ads",options={}){
 const f=verifiedMappingFixture(provider),snapshot=f.snapshot();
 const proposal={ruleKey:"reviewed-rule",previousRuleId:null,basis:f.rule.basis,from:f.rule.applicability.from,until:f.rule.applicability.until,maxObservationAgeMs:600000};
 const rulePageIds=new Set(snapshot.references.filter(x=>x.target==="rule").map(x=>x.pageId));
 snapshot.references=snapshot.references.filter(x=>x.target==="mapping");snapshot.pages=snapshot.pages.filter(x=>!rulePageIds.has(x.id));
 snapshot.proposal=structuredClone(proposal);snapshot.proposalHash="c".repeat(64);snapshot.previousRuleId=null;
 snapshot.rule={...snapshot.rule,id:"1",ruleKey:proposal.ruleKey,applicability:{...f.rule.applicability,identity:JSON.parse(snapshot.mapping.identityKey)}};
 const calls=[],decisions=[];let submitted,clock=f.now;
 const reviewAuthority=async request=>{decisions.push(request);return {status:"approved",decisionId:randomUUID(),snapshotHash:request.snapshotHash,proposalHash:request.proposalHash,validUntil:request.expiresAt};};
 const database={async query(sql,args){calls.push({sql,args});if(sql.includes("source_rule_review_state"))return {rows:[{result:snapshot}]};
  if(sql.includes("read_source_receipt"))return {rows:[{result:options.receipt??{status:"not_observed"}}]};
  submitted=JSON.parse(args[2]);if(options.lost)throw Error("sensitive-provider-body");
  return {rows:[{result:{status:"committed",batchId:"4",commitId:randomUUID(),digest:"e".repeat(64),manifest:{kind:"source_rule_review_v1",sourceMappingId:"1",sourceBatchId:"1",decisionId:submitted.decision.decisionId,ruleKey:proposal.ruleKey,ruleVersion:"1",ids:{"rule:reviewed":"9"},counts:{rules:1}}}}]};}};
 const repository=createSourceRuleRepository({database,cipher:f.cipher,reviewAuthority:options.authority??reviewAuthority,now:()=>clock});
 const input={owner:f.owner,mappingId:"1",proposal};
 return {...f,snapshot,proposal,input,calls,decisions,repository,database,reviewAuthority,get submitted(){return submitted;},tick:ms=>clock+=ms};
}
for(const provider of ["google_ads","meta","klaviyo"])test(provider+" explicitly reviewed rule seals exact evidence projection and writes once",async()=>{
 const f=fixture(provider),review=await f.repository.review(f.input),prepared=f.repository.prepare(review,{policy:f.policy,deadlineAt:f.deadlineAt});
 const receipt=await f.repository.commit(prepared);assert.equal(receipt.mappingVerified,false);assert.equal(receipt.authorizesActivation,false);
 assert.equal(f.calls.length,2);assert.equal(f.decisions.length,1);assert.ok(Object.isFrozen(f.decisions[0]));
 const projection=f.cipher.open({owner:f.owner,attemptId:prepared.operationId,ordinal:0,page:f.submitted.page}).records[0];
 assert.equal(projection.applicability.review.decisionId,f.submitted.decision.decisionId);assert.deepEqual(projection.applicability.identity,JSON.parse(f.snapshot.mapping.identityKey));
 assert.equal(projection.ruleKey,f.proposal.ruleKey);await assert.rejects(f.repository.commit(prepared),/PREPARED_WRITE_REQUIRED/);
 assert.throws(()=>f.repository.prepare(review,{policy:f.policy,deadlineAt:f.deadlineAt}),/REVIEW_REQUIRED/);
});
test("no default reviewer or native shape can grant reviewed rule",()=>{
 const f=fixture();assert.throws(()=>createSourceRuleRepository({database:f.database,cipher:f.cipher}),/CONFIG_INVALID/);
});
for(const [name,mutate] of [
 ["unsupported format",f=>f.input.proposal.basis.format="guess"],
 ["wrong provider",f=>f.input.proposal.basis.provider="meta"],
 ["missing predecessor",f=>delete f.input.proposal.previousRuleId],
 ["zero age",f=>f.input.proposal.maxObservationAgeMs=0],
 ["infinite expiry",f=>f.input.proposal.until="infinity"],
 ["unsafe key",f=>f.input.proposal.ruleKey="customer@email"]
])test(name+" fails before SQL/reviewer",async()=>{
 const f=fixture();mutate(f);await assert.rejects(f.repository.review(f.input));assert.equal(f.calls.length,0);assert.equal(f.decisions.length,0);
});
for(const [name,mutate]of [
 ["wrong product",f=>{f.entries[1].row.shopifyVerification.response.product.id="gid://shopify/Product/999";const page=f.snapshot.pages[1];Object.assign(page,f.cipher.seal({owner:f.owner,attemptId:page.attemptId,ordinal:page.batchOrdinal,page,payload:{records:[f.entries[1].row]}}));f.snapshot.references[1].recordHash=sourcePayloadHash(f.entries[1].row);}],
 ["wrong record hash",f=>f.snapshot.references[0].recordHash="0".repeat(64)],
 ["wrong identity",f=>f.snapshot.rule.applicability.identity.nativeId="other"],
 ["changed proposal",f=>f.snapshot.proposal.ruleKey="other"],
 ["missing native evidence",f=>f.snapshot.references=f.snapshot.references.filter(x=>x.role==="candidate_check")],
 ["expired page",f=>f.snapshot.pages[0].retainUntil=new Date(f.now-1).toISOString()],
 ["too many references",f=>f.snapshot.references=Array.from({length:33},()=>f.snapshot.references[0])],
 ["review page budget not reserved",f=>f.snapshot.pages[0].plainBytes=16711681]
])test(name+" cannot reach explicit reviewer",async()=>{
 const f=fixture();mutate(f);await assert.rejects(f.repository.review(f.input));assert.equal(f.decisions.length,0);
});
for(const change of [d=>({...d,status:"denied"}),d=>({...d,snapshotHash:"0".repeat(64)}),d=>({...d,proposalHash:"0".repeat(64)}),d=>({...d,validUntil:"2000-01-01T00:00:00.000Z"}),d=>({...d,extra:true})])test("unbound, denied or expired decision cannot prepare a rule",async()=>{
 const f=fixture("google_ads",{authority:async r=>change({status:"approved",decisionId:randomUUID(),snapshotHash:r.snapshotHash,proposalHash:r.proposalHash,validUntil:r.expiresAt})});
 await assert.rejects(f.repository.review(f.input),/EXPLICIT_REVIEW_REQUIRED/);assert.equal(f.calls.length,1);
});
test("serialized and other repository reviews cannot authorize write",async()=>{
 const f=fixture(),r=await f.repository.review(f.input),other=createSourceRuleRepository({database:f.database,cipher:f.cipher,reviewAuthority:f.reviewAuthority});
 for(const value of [structuredClone(r),JSON.parse(JSON.stringify(r))])assert.throws(()=>f.repository.prepare(value,{policy:f.policy,deadlineAt:f.deadlineAt}),/REVIEW_REQUIRED/);
 assert.throws(()=>other.prepare(r,{policy:f.policy,deadlineAt:f.deadlineAt}),/REVIEW_REQUIRED/);
});
test("expiry and explicit finite policy rechecked at prepare",async()=>{
 const f=fixture(),r=await f.repository.review(f.input);assert.throws(()=>f.repository.prepare(r,{policy:{...f.policy,until:f.rule.retainUntil},deadlineAt:f.deadlineAt}),/POLICY_INVALID/);
 f.tick(600001);assert.throws(()=>f.repository.prepare(r,{policy:f.policy,deadlineAt:f.deadlineAt}),/EXPLICIT_REVIEW_REQUIRED/);
});
test("input, driver results and policy detached before asynchronous work",async()=>{
 const f=fixture(),r=await f.repository.review(f.input);f.snapshot.snapshotHash="0".repeat(64);f.proposal.ruleKey="mutated";
 const policy=structuredClone(f.policy),p=f.repository.prepare(r,{policy,deadlineAt:f.deadlineAt});policy.version="mutated";
 // Receipt uses original key although the deliberately mutated fake driver does not.
 await assert.rejects(f.repository.commit(p),/WRITE_UNCONFIRMED/);
 assert.equal(f.submitted.snapshotHash,"a".repeat(64));assert.equal(f.submitted.proposal.ruleKey,"reviewed-rule");assert.equal(f.submitted.policy.version,"synthetic-policy");
});
test("lost write is consumed and explicit inspection does not claim rollback",async()=>{
 const f=fixture("google_ads",{lost:true}),r=await f.repository.review(f.input),p=f.repository.prepare(r,{policy:f.policy,deadlineAt:f.deadlineAt});
 await assert.rejects(f.repository.commit(p),/^Error: SOURCE_RULE_WRITE_UNCONFIRMED$/);await assert.rejects(f.repository.commit(p),/PREPARED_WRITE_REQUIRED/);
 assert.deepEqual(await f.repository.inspect({owner:f.owner,operationId:p.operationId}),{status:"not_observed",rollbackProven:false});assert.equal(f.calls.filter(x=>x.sql.includes("commit_reviewed")).length,1);
});
test("arbitrary database/reviewer errors are not exposed or retried",async()=>{
 const f=fixture("google_ads",{authority:async()=>{throw Error("provider-body-private-value");}});await assert.rejects(f.repository.review(f.input),/^Error: SOURCE_RULE_REVIEW_FAILED$/);assert.equal(f.calls.length,1);
});
test("evidence expiring during the read cannot reach the reviewer",async()=>{
 const f=fixture(),query=f.database.query;f.database.query=async(...args)=>{const result=await query(...args);f.tick(600001);return result;};
 await assert.rejects(f.repository.review(f.input));assert.equal(f.decisions.length,0);
});
