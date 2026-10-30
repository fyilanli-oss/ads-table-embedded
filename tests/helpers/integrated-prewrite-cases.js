import test from "node:test";
import assert from "node:assert/strict";
import {reviewRefreshIntegratedPrewrite as review} from "../../app/lib/refresh/integrated-prewrite-review.server.js";
import {runRefreshPdPrewriteChunk} from "../../app/lib/refresh/pd-prewrite-chunk.server.js";
import {refreshCandidateObservationContext} from "../../app/lib/refresh/quota-authority-binding.server.js";
import {fixture as orderFixture} from "./shopify-order-fixture.js";
import {pdSourceObservation} from "./pd-source-observation.js";

export function integratedPrewriteCases({provider,fixture,expected,empty}) {
  async function collect() {
    const f=fixture(), observation=await f.create().readEvidence(), scope=expected();
    const {job}=refreshCandidateObservationContext(observation);
    const pd=await pdSourceObservation(scope,job,job.window);
    const claim={workspaceId:scope.workspaceId,installGeneration:String(scope.installGeneration),provider,accountId:scope.accountId,id:job.id,fence:job.fence};
    return {f,pd,input:{claim,window:job.window,pdObservation:pd.observation,identity:{expected:scope,observation}}};
  }
  test(`${provider} integrated prewrite: actual PD, candidate/reference and Shopify Order/LineItem guards share scope without numerical joins`,async()=>{
    const {f,pd,input}=await collect(), s=orderFixture(), current=await s.create().readEvidence();
    const n=f.calls.length+f.adminCalls.length+f.queries.length+s.calls.length;
    const r=review({...input,shopify:{current,previous:current}});
    assert.equal(r.status,"structurally_reviewed_open_gates");assert.equal(r.referenceReview.candidateReview.scope.accountId,expected().accountId);
    assert.equal(r.orderReview.orderReview.orders.length,1);assert.equal(r.orderReview.orderReview.orders[0].change,"replay");
    assert.equal(r.orderReview.orderReview.orders[0].lines.length,2);assert.equal(r.interactionReview.state,"not_supplied");
    assert.equal(r.pdState,pd.observation.records?.status??"records_not_supplied");
    for(const k of ["persistable","publishable","authorizesActivation","DatasetWritePerformed","salesRolesChanged","productMappingAssigned","exactOverlapVerified","timeRangesEquated"])
      assert.equal(r[k],false);
    assert.ok(Object.isFrozen(r));assert.equal(f.calls.length+f.adminCalls.length+f.queries.length+s.calls.length,n);
  });
  test(`${provider} integrated prewrite: Orders not supplied remains distinct from observed empty`,async()=>{
    const {input}=await collect(), s=orderFixture();s.rows.headers=[];
    assert.equal(review(input).ordersState,"not_supplied");
    const r=review({...input,shopify:{current:await s.create().readEvidence()}});
    assert.equal(r.ordersState,"observed_empty");assert.equal(r.orderReview.ordersWithoutProviderClaim,null);
  });
  test(`${provider} integrated prewrite: source JSON copies are not genuine observations`,async()=>{
    const {input}=await collect();
    assert.throws(()=>review({...input,pdObservation:structuredClone(input.pdObservation)}),/PD_OBSERVATION_REQUIRED/);
    assert.throws(()=>review({...input,identity:{...input.identity,observation:structuredClone(input.identity.observation)}}),/IDENTITY_EXECUTION_MISMATCH/);
  });
  test(`${provider} integrated prewrite: foreign Shopify shop cannot join same-provider data`,async()=>{
    const {input}=await collect(), s=orderFixture({shop:{id:"gid://shopify/Shop/99",myshopifyDomain:"other.myshopify.com"}});
    const current=await s.create().readEvidence();
    assert.throws(()=>review({...input,shopify:{current}}),/OWNER_MISMATCH/);
  });
  test(`${provider} integrated prewrite: wrong claim/fence/day and post-read scope substitution are rejected`,async()=>{
    const {input}=await collect();
    for(const claim of [{...input.claim,id:"other"},{...input.claim,fence:99}])assert.throws(()=>review({...input,claim}),/IDENTITY_EXECUTION_MISMATCH/);
    assert.throws(()=>review({...input,window:{from:"2026-10-02",to:"2026-10-02"}}),/IDENTITY_EXECUTION_MISMATCH/);
    assert.throws(()=>review({...input,identity:{...input.identity,expected:{...input.identity.expected,connectionVersion:99}}}),/PD_IDENTITY_SCOPE_MISMATCH/);
    assert.throws(()=>review({...input,shopify:{current:{},claims:[]}}),/INPUT_INVALID/);
    assert.throws(()=>review({...input,claims:[]}),/INPUT_INVALID/);
  });
  if(provider==="meta") test("Meta integrated prewrite: actual worker carries guarded families and blocks an altered bundle",async()=>{
    const {pd,input}=await collect(), {claim:ignoredClaim,window:ignoredWindow,entitlementReceipt,now,...source}=pd.config;
    const stages=[];
    const worker={claim:{...input.claim,cost:{requests:64,dbWrites:32,connections:4,rows:100,bytes:300000}},window:input.window,now,
      limits:{deadlineAt:100000,requestTimeoutMs:10000,finishReserveMs:100,maxRows:100,maxBytes:300000},loadAuthority:pd.authority,
      verifyEntitlement:async()=>({status:"verified",receipt:entitlementReceipt}),isEntitlementCurrent:async()=>true,
      store:{advanceStage:async s=>{stages.push(s.stage);return true;},isClaimCurrent:async()=>true,
        readAdmissionSnapshot:async()=>({state:{revision:1}}),recordStop:async()=>({recorded:true})}};
    const r=await runRefreshPdPrewriteChunk({worker,source,prewrite:{identity:input.identity}});
    assert.equal(r.status,"awaiting_dataset");assert.equal(r.integration_review.referenceReview.candidateReview.counts.candidates,1);
    assert.equal(r.handoff_kind,"integrated_prewrite_review");assert.equal(r.rows[0].raw_metrics.spend_value,0);
    assert.equal(r.persistable,false);assert.equal(r.integration_review.productMappingAssigned,false);
    const bad=await runRefreshPdPrewriteChunk({worker,source,prewrite:{identity:{...input.identity,expected:{...input.identity.expected,connectionVersion:99}}}});
    assert.equal(bad.status,"paused");assert.equal(bad.source_review.reason,"INTEGRATED_PREWRITE_PD_IDENTITY_SCOPE_MISMATCH");assert.equal(bad.rows,undefined);
  });
}
