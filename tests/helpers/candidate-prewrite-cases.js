import test from "node:test";
import assert from "node:assert/strict";
import {reviewRefreshCandidatePrewrite as review,reviewRefreshCandidatePrewriteCurrent as currentReview} from "../../app/lib/providers/candidate-prewrite.server.js";
import {reviewRefreshReferencePrewriteCurrent} from "../../app/lib/providers/reference-prewrite.server.js";

// Same behavioral assertions against each real SDK/fenced collection fixture.
export function candidatePrewriteCases({provider,fixture,nativeFixture,expected,empty,unresolved,productOnly}){
  test(`${provider} prewrite: SQL installation and selection keys are checked without promotion`,async()=>{
    const f=fixture(),observation=await f.create().readEvidence(),r=review({expected:expected(),observation});
    assert.equal(r.scope.installationId,"42");assert.equal(r.installationIdentityChecked,true);
    assert.equal(r.scope.reportingSelectionEpoch,provider==="klaviyo"?null:"71");
    assert.equal(r.reportingSelectionEpochChecked,true);assert.equal(r.authorityReobserved,false);
    assert.equal(r.canonicalScopeReady,false);assert.equal(r.persistable,false);
  });
  for(const key of ["installationId","reportingSelectionEpoch"])test(`${provider} prewrite: wrong canonical key rejected ${key}`,async()=>{
    const f=fixture(),observation=await f.create().readEvidence(),scope=expected();scope[key]="99";
    assert.throws(()=>review({expected:scope,observation}),/OWNER_MISMATCH|INPUT_INVALID/);
  });
  test(`${provider} current prewrite: one fresh metadata SQL read, no native/vault IO or write authority`,async()=>{
    const f=fixture(),observation=await f.create().readEvidence(),before=f.queries.length,native=f.calls.length+f.adminCalls.length;
    const r=await currentReview({expected:expected(),observation,database:f.config.database});
    assert.equal(f.queries.length,before+1);assert.equal(f.calls.length+f.adminCalls.length,native);
    assert.equal(r.authorityReobserved,true);assert.equal(r.atomicWriteGuardVerified,false);assert.equal(r.persistable,false);
  });
  for(const change of ["installation","version",...provider==="klaviyo"?[]:["same_account_epoch"]])
    test(`${provider} current prewrite: post-collection authority drift rejected ${change}`,async()=>{
      const f=fixture(),observation=await f.create().readEvidence();
      if(change==="installation")f.state.installationId="99";
      if(change==="version")f.state.version++;
      if(change==="same_account_epoch")f.state.selectionEpoch="99";
      await assert.rejects(currentReview({expected:expected(),observation,database:f.config.database}),/AUTHORITY_CHANGED/);
    });
  test(`${provider} current prewrite: caller mutation during read cannot change captured expected owner`,async()=>{
    const f=fixture(),observation=await f.create().readEvidence(),scope=expected();
    f.hooks.query=()=>{scope.installationId="99";};
    const r=await currentReview({expected:scope,observation,database:f.config.database});assert.equal(r.scope.installationId,"42");
  });
  test(`${provider} current prewrite: canceled or failed lookup never retries or leaks bodies`,async()=>{
    const f=fixture(),observation=await f.create().readEvidence(),before=f.queries.length,controller=new AbortController();controller.abort();
    await assert.rejects(currentReview({expected:expected(),observation,database:f.config.database,signal:controller.signal}),/ABORTED/);
    assert.equal(f.queries.length,before);f.hooks.query=()=>{throw Error("SECRET-SQL");};
    await assert.rejects(currentReview({expected:expected(),observation,database:f.config.database}),/^CandidatePrewriteError: CANDIDATE_PREWRITE_AUTHORITY_READ_FAILED$/);
    assert.equal(f.queries.length,before+1);
  });
  test(`${provider} current reference review retains actual owner metadata and open gates`,async()=>{
    const f=fixture(),observation=await f.create().readEvidence();
    const r=await reviewRefreshReferencePrewriteCurrent({expected:expected(),observation,database:f.config.database});
    assert.equal(r.authorityReobserved,true);assert.equal(r.candidateReview.authorityReobserved,true);
    assert.equal(r.persistable,false);assert.equal(r.providerClaimsReviewed,false);
  });
  test(`${provider} prewrite: genuine completed candidate batch is checked without extra IO or promotion`,async()=>{
    const f=fixture(),observation=await f.create().readEvidence(),n=f.calls.length+f.adminCalls.length;
    const r=review({expected:expected(),observation});assert.equal(f.calls.length+f.adminCalls.length,n);
    assert.equal(r.rows.length,1);assert.equal(r.counts.candidates,1);assert.equal(r.observedEmpty,false);
    assert.equal(r.rows[0].observed,observation.product_identity_candidates.rows[0]);assert.equal(r.rows[0].candidateIndex,0);
    assert.equal(r.rows[0].candidateShopifyProductId,observation.product_identity_candidates.candidates[0].shopify_product_id);
    assert.equal(r.rows[0].standardizedProductId,null);assert.equal(r.provenance.provider,provider);
    assert.ok(Object.isFrozen(r.rows[0].sourceReference));
    for(const k of ["providerLinkVerified","canonicalScopeReady","nativePermissionVerified","persistable","authorizesActivation","mappingWritePerformed",
      "DatasetWritePerformed","salesRolesChanged","exactOverlapVerified","reportLinksReviewed","providerClaimsReviewed"])assert.equal(r[k],false);
    assert.doesNotMatch(JSON.stringify(r),/SECRET|secret-access|secret-app|secret-developer|private-profile|private@/);
  });
  test(`${provider} prewrite: repeated structural review does not accumulate or duplicate rows`,async()=>{
    const f=fixture(),observation=await f.create().readEvidence();const a=review({expected:expected(),observation}),b=review({expected:expected(),observation});
    assert.deepEqual(a,b);assert.equal(a.rows.length,1);assert.equal(a.counts.candidates,1);
  });
  for(const [name,mutate] of [["workspace",v=>{v.workspaceId="99999999-9999-4999-8999-999999999999";}],["generation",v=>{v.installGeneration++;}],
    ["shop",v=>{v.shopId="gid://shopify/Shop/99";}],["domain",v=>{v.shopDomain="other.myshopify.com";}],
    ["connection",v=>{v.connectionId="99999999-9999-4999-8999-999999999999";}],["credential version",v=>{v.connectionVersion++;}],
    ["account",v=>{v.accountId=provider==="meta"?"act_999":"999";}],["provider",v=>{v.provider=provider==="meta"?"google_ads":"meta";v.reportingSelectionEpoch="71";}]])
    test(`${provider} prewrite: wrong ${name} cannot pass expected owner`,async()=>{
      const f=fixture(),observation=await f.create().readEvidence(),scope=expected();mutate(scope);
      assert.throws(()=>review({expected:scope,observation}),/OWNER_MISMATCH/);
    });
  for(const kind of ["clone","spread","forged trust flags"])test(`${provider} prewrite: ${kind} cannot forge collection provenance`,async()=>{
    const f=fixture(),original=await f.create().readEvidence(),observation=kind==="clone"?structuredClone(original):
      kind==="spread"?{...original}:{...original,persistable:true,provider_link_verified:true,canonical_scope_ready:true};
    assert.throws(()=>review({expected:expected(),observation}),/OBSERVATION_REQUIRED/);
  });
  test(`${provider} prewrite: native-only reader output is not candidate completion evidence`,async()=>{
    const f=nativeFixture(),observation=await f.create().readEvidence();assert.throws(()=>review({expected:expected(),observation}),/OBSERVATION_REQUIRED/);
  });
  test(`${provider} prewrite: observed empty source stays empty without invented candidate or zero metric`,async()=>{
    const f=fixture();empty(f);const observation=await f.create().readEvidence(),r=review({expected:expected(),observation});
    assert.equal(r.observedEmpty,true);assert.deepEqual(r.rows,[]);assert.equal(r.counts.candidates,0);assert.equal(f.adminCalls.length,0);
  });
  test(`${provider} prewrite: unresolved source is retained with reason and null canonical identity`,async()=>{
    const f=fixture();unresolved(f);const observation=await f.create().readEvidence(),r=review({expected:expected(),observation});
    assert.equal(r.rows[0].state,"unresolved");assert.ok(r.rows[0].reason);assert.equal(r.rows[0].candidateIndex,null);
    assert.equal(r.rows[0].candidateShopifyProductId,null);assert.equal(r.rows[0].standardizedProductId,null);assert.equal(r.counts.unresolved,1);
  });
  test(`${provider} prewrite: conflicting Shopify parent stays conflicting without candidate promotion`,async()=>{
    const f=fixture();f.q.adminNative=p=>{p.data.productVariant.product={id:"gid://shopify/Product/999",legacyResourceId:"999"};};
    const observation=await f.create().readEvidence(),r=review({expected:expected(),observation});
    assert.equal(r.rows[0].state,"conflicting");assert.equal(r.counts.conflicting,1);assert.equal(r.rows[0].candidateIndex,null);
  });
  test(`${provider} prewrite: explicit product-only source keeps a null variant without creating one`,async()=>{
    const f=fixture();productOnly(f);const observation=await f.create().readEvidence(),r=review({expected:expected(),observation});
    assert.equal(r.counts.candidates,1);assert.equal(r.rows[0].candidateShopifyVariantId,null);assert.equal(r.rows[0].standardizedProductId,null);
  });
  for(const mutate of [v=>{delete v.connectionId;},v=>{v.connectionVersion=0;},v=>{v.scopes=[];}])
    test(`${provider} prewrite: incomplete owner or grant-like override rejected`,()=>{
      const scope=expected();mutate(scope);assert.throws(()=>review({expected:scope,observation:{}}),/INPUT_INVALID/);
    });
}
