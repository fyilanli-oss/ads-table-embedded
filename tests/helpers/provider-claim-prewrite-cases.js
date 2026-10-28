import test from "node:test";
import assert from "node:assert/strict";
import {fixture as orderFixture,prewriteOwner} from "./shopify-order-fixture.js";
import {reviewShopifyProviderClaimReadiness} from "../../app/lib/shopify/provider-claim-prewrite.server.js";

// Each provider supplies its actual fenced SDK collector, not a fabricated review DTO.
export function providerClaimPrewriteCases({provider,fixture,expected,empty}){
  const collect=async()=>{const f=fixture(),observation=await f.create().readEvidence();return {f,observation};};
  const review=(current,observation,options={})=>reviewShopifyProviderClaimReadiness({expected:prewriteOwner(),current,
    providers:[{expected:expected(),observation}],...options});
  test(`${provider} claim gate: same-owner identity and Shopify observations stay separate without inferred matches`,async()=>{
    const {f,observation}=await collect(),s=orderFixture(),current=await s.create().readEvidence();
    const before=JSON.stringify({current,observation}),io=[f.calls.length,f.adminCalls.length,f.queries.length,s.calls.length],r=review(current,observation);
    assert.equal(r.orderReview.orders.length,1);assert.equal(r.providerReviews.length,1);assert.equal(r.providerReviews[0].scope.provider,provider);
    assert.equal(r.providerReviews[0].claimState,"not_collected_in_identity_observation");assert.equal(r.providerReviews[0].observationState,"completed_identity_observation");
    assert.equal(r.comparisonState,"not_assessed_readable_provider_order_claim_required");assert.deepEqual(r.claimMatches,[]);
    assert.equal(r.unmatchedClaims,null);assert.equal(r.ordersWithoutProviderClaim,null);
    assert.equal(r.orderReview.orders[0].observed,current.orders[0].header);assert.equal(r.orderReview.orders[0].journey,current.orders[0].journey);
    assert.equal(r.sourceRanges.Shopify,current.extractionRange);assert.deepEqual(r.sourceRanges.providers[0].businessWindow,{from:"2026-10-01",to:"2026-10-01"});
    for(const field of ["timeRangesEquated","ShopifyJourneyIsProviderClaim","aggregateDifferenceIsOverlap","salesTotalsCalculated","salesRolesChanged",
      "providerClaimsReviewed","providerClaimVerified","exactOverlapVerified","nativePermissionVerified","canonicalScopeReady","persistable","authorizesActivation","DatasetWritePerformed"])assert.equal(r[field],false);
    assert.deepEqual(review(current,observation),r);assert.equal(JSON.stringify({current,observation}),before);
    assert.deepEqual([f.calls.length,f.adminCalls.length,f.queries.length,s.calls.length],io);assert.ok(Object.isFrozen(r.providerReviews));
  });
  test(`${provider} claim gate: empty Shopify source does not label provider references unmatched`,async()=>{
    const {observation}=await collect(),s=orderFixture();s.rows.headers=[];const r=review(await s.create().readEvidence(),observation);
    assert.deepEqual(r.orderReview.orders,[]);assert.equal(r.unmatchedClaims,null);assert.equal(r.exactOverlapVerified,false);
  });
  test(`${provider} claim gate: observed empty provider source is distinct from missing observation`,async()=>{
    const f=fixture();empty(f);const observation=await f.create().readEvidence(),s=orderFixture(),current=await s.create().readEvidence();
    const r=review(current,observation),missing=review(current,null);
    assert.equal(r.providerReviews[0].review.candidateReview.observedEmpty,true);assert.equal(r.providerReviews[0].claimState,"not_collected_in_identity_observation");
    assert.equal(missing.providerReviews[0].observationState,"observation_not_supplied");assert.equal(missing.providerReviews[0].claimState,"not_assessed_without_provider_observation");
    assert.equal(missing.providerReviews[0].review,null);assert.equal(missing.sourceRanges.providers[0].businessWindow,null);assert.equal(missing.ordersWithoutProviderClaim,null);
  });
  test(`${provider} claim gate: replay keeps one Shopify order and original independent sale lines`,async()=>{
    const {observation}=await collect(),s=orderFixture(),current=await s.create().readEvidence(),r=review(current,observation,{previous:current});
    assert.equal(r.orderReview.orders.length,1);assert.equal(r.orderReview.orders[0].change,"replay");assert.equal(r.orderReview.orders[0].lines.length,2);
    assert.equal(r.orderReview.orders[0].observed,current.orders[0].header);assert.equal(r.salesTotalsCalculated,false);assert.deepEqual(r.claimMatches,[]);
  });
  test(`${provider} claim gate: incomplete Shopify journey does not erase sales or become a provider claim`,async()=>{
    const {observation}=await collect(),s=orderFixture();s.q.native=({family,payload})=>{if(family==="order_journey")payload.data.order.customerJourneySummary.ready=false;};
    const current=await s.create().readEvidence(),r=review(current,observation);
    assert.equal(r.orderReview.orders.length,1);assert.equal(r.orderReview.journeyPagesComplete,false);assert.equal(r.providerClaimVerified,false);assert.equal(r.orderReview.orders[0].journey.ready,false);
  });
  test(`${provider} claim gate: mixed workspace/generation/shop/domain is rejected even without provider observation`,async()=>{
    const s=orderFixture(),current=await s.create().readEvidence();
    for(const patch of [{workspaceId:"44444444-4444-4444-8444-444444444444"},{installGeneration:4},{shopId:"gid://shopify/Shop/13"},{shopDomain:"other.myshopify.com"}])
      assert.throws(()=>review(current,null,{providers:[{expected:{...expected(),...patch},observation:null}]}),/OWNER_MISMATCH/);
  });
  test(`${provider} claim gate: completed observation copies cannot replace original source provenance`,async()=>{
    const {observation}=await collect(),s=orderFixture(),current=await s.create().readEvidence();
    assert.throws(()=>review(current,structuredClone(observation)),/OBSERVATION_REQUIRED/);
    assert.throws(()=>review(structuredClone(current),observation),/OBSERVATION_REQUIRED/);
    assert.throws(()=>review(current,observation,{providers:[{expected:{...expected(),connectionVersion:3},observation}]}),/OWNER_MISMATCH/);
  });
  test(`${provider} claim gate: duplicate selection and caller fabricated claim/join options rejected`,async()=>{
    const {observation}=await collect(),s=orderFixture(),current=await s.create().readEvidence(),input={expected:expected(),observation};
    assert.throws(()=>review(current,observation,{providers:[input,input]}),/PROVIDER_DUPLICATE/);
    assert.throws(()=>review(current,observation,{claims:[{orderId:current.orders[0].header.id}]}),/INPUT_INVALID/);
    assert.throws(()=>review(current,observation,{matchBy:"product_and_amount"}),/INPUT_INVALID/);
  });
}
