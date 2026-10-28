import test from "node:test";
import assert from "node:assert/strict";
import {reviewRefreshCandidatePrewrite as review} from "../../app/lib/providers/candidate-prewrite.server.js";

// Same behavioral assertions against each real SDK/fenced collection fixture.
export function candidatePrewriteCases({provider,fixture,nativeFixture,expected,empty,unresolved,productOnly}){
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
    ["account",v=>{v.accountId=provider==="meta"?"act_999":"999";}],["provider",v=>{v.provider=provider==="meta"?"google_ads":"meta";}]])
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
