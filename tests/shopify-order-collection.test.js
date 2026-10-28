import test,{after} from "node:test";
import assert from "node:assert/strict";
import "@shopify/shopify-api/adapters/node";
import {isShopifyAdminOrderSdkClient,closeShopifyAdminOrderSdkClient} from "../app/lib/refresh/shopify-admin-sdk-quota-bridge.server.js";
import {createRefreshShopifyAdminOrderClient} from "../app/lib/refresh/quota-authority-binding.server.js";
import {createShopifyOrderReadExecution} from "../app/lib/shopify/order-collection.server.js";
import {SHOPIFY_ORDER_READ_QUERIES as queries} from "../app/lib/shopify/order-read-protocol.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {refreshQuotaWait} from "../app/lib/refresh/quota-work-wait.server.js";
import {reviewShopifyOrderPrewrite} from "../app/lib/shopify/order-prewrite.server.js";
import {reviewShopifyProviderClaimReadiness} from "../app/lib/shopify/provider-claim-prewrite.server.js";

import {fixture,connection,gid,shop,workspace,stamp,money,header,line,visit,gate,pause,prewriteOwner,restoreShopifyOrderFixtureFetch} from "./helpers/shopify-order-fixture.js";
after(restoreShopifyOrderFixtureFetch);

test("claim gate: three selected but missing provider observations remain three unknown claim states",async()=>{
  const f=fixture(),current=await f.create().readEvidence(),providers=["meta","google_ads","klaviyo"].map((provider,i)=>({
    expected:{...prewriteOwner(),provider,connectionId:"22222222-2222-4222-8222-222222222222",connectionVersion:2,accountId:["act_123","123","account1"][i]},observation:null}));
  const r=reviewShopifyProviderClaimReadiness({expected:prewriteOwner(),current,providers});
  assert.equal(r.providerReviews.length,3);assert.ok(r.providerReviews.every(row=>row.observationState==="observation_not_supplied"));
  assert.equal(r.orderReview.orders.length,1);assert.equal(r.ordersWithoutProviderClaim,null);assert.equal(r.unmatchedClaims,null);assert.equal(r.exactOverlapVerified,false);
  assert.deepEqual(r.providerReviews.map(row=>row.scope.provider),["meta","google_ads","klaviyo"]);
});
test("claim gate: empty selection, invalid scope and per-provider invented claims are not a successful review",async()=>{
  const f=fixture(),current=await f.create().readEvidence(),input={expected:{...prewriteOwner(),provider:"klaviyo",
    connectionId:"22222222-2222-4222-8222-222222222222",connectionVersion:2,accountId:"account1"},observation:null};
  for(const providers of [[],null,[{...input,claims:[]}],[{expected:{...input.expected,provider:"unknown"},observation:null}],
    [{expected:{...input.expected,connectionVersion:0},observation:null}],[{expected:input.expected}]])
    assert.throws(()=>reviewShopifyProviderClaimReadiness({expected:prewriteOwner(),current,providers}),/INPUT_INVALID/);
});

test("real fenced SDK collects all three independent paginations and explicit consistency reads",async()=>{
  const f=fixture(),reader=f.create(),result=await reader.readEvidence();
  assert.equal(result.state,"collected");assert.equal(result.orders.length,1);assert.equal(result.orders[0].lineItems.length,2);
  assert.equal(result.orders[0].journey.moments.length,3);assert.equal(result.journeyPagesComplete,true);assert.equal(f.calls.length,10);
  assert.equal(result.stats.requests,f.calls.length);assert.equal(result.stats.rows,8);assert.ok(result.stats.SDKResponseBytes>0);
  assert.equal(f.reservations.length,f.calls.length);assert.equal(f.feedback.length,f.calls.length);assert.equal(f.auth.length,0);
  assert.equal(result.scope.job.provider,"meta");assert.equal(result.scope.job.fence,2);assert.equal(result.scope.installation_id,null);
  assert.equal(result.orders[0].lineItems[0].product.id,result.orders[0].lineItems[1].product.id);
  assert.notEqual(result.orders[0].lineItems[0].id,result.orders[0].lineItems[1].id);
  for(const flag of ["nativePermissionVerified","historicalCoverageVerified","providerClaimVerified","exactOverlapVerified","canonicalScopeReady","authorizesActivation","persistable","DatasetWritePerformed"])assert.equal(result[flag],false);
  assert.equal(result.consistency.atomicSnapshotVerified,false);assert.equal(result.consistency.journeyMiddleUnchangedVerified,false);
  assert.ok(Object.isFrozen(result.orders[0].lineItems[0]));await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);
  assert.doesNotMatch(JSON.stringify([f.loads,f.lookups,f.reservations,f.feedback]),/SECRET|updated_at|orderId|gid:/);
});

test("empty selected range still gets final header and authority recheck, without claiming history access",async()=>{
  const f=fixture();f.rows.headers=[];const result=await f.create().readEvidence();assert.deepEqual(result.orders,[]);
  assert.equal(f.calls.length,4);assert.equal(f.calls.filter(c=>c.family==="order_headers").length,2);assert.equal(result.historicalCoverageVerified,false);
});

test("native scopes use same SDK quota path before and after data without permission or protected-data proof",async()=>{
  const f=fixture(),r=await f.create().readEvidence();
  assert.equal(f.calls[0].family,"permission_scopes");assert.equal(f.calls.at(-1).family,"permission_scopes");
  assert.equal(r.nativeScopeListObserved,true);assert.equal(r.nativePermissionVerified,false);
  assert.equal(r.nativeScopeObservation.before.assessment.scopeStatus,"observed_sufficient");
  assert.equal(r.nativeScopeObservation.after.assessment.authorizesActivation,false);
  assert.ok(Object.isFrozen(r.nativeScopeObservation.before.evidence.scopes));
  assert.doesNotMatch(JSON.stringify(f.lookups),/read_orders|AppInstallation|accessScopes/);
});
for(const handles of [[],["read_orders"],["read_products"]])test(`missing current scopes stop before any order HTTP ${handles}`,async()=>{
  const f=fixture();f.q.native=({family,payload})=>{if(family==="permission_scopes")payload.data.currentAppInstallation.accessScopes=handles.map(handle=>({handle}));};
  await assert.rejects(f.create().readEvidence(),/SCOPES_REQUIRED/);assert.equal(f.calls.length,1);
});
test("native write grants satisfy existing read policy without asking for new grants",async()=>{
  const f=fixture();f.q.native=({family,payload})=>{if(family==="permission_scopes")payload.data.currentAppInstallation.accessScopes=[{handle:"write_orders"},{handle:"write_products"}];};
  const r=await f.create().readEvidence();assert.equal(r.nativeScopeListObserved,true);assert.equal(r.authorizesActivation,false);
});
test("history flag requires native read_all_orders before data",async()=>{
  const f=fixture();f.config.includeOrderHistory=true;await assert.rejects(f.create().readEvidence(),/SCOPES_REQUIRED/);assert.equal(f.calls.length,1);
});
test("history scope observed still does not prove approval or historical order coverage",async()=>{
  const f=fixture();f.config.includeOrderHistory=true;
  f.q.native=({family,payload})=>{if(family==="permission_scopes")payload.data.currentAppInstallation.accessScopes.push({handle:"read_all_orders"});};
  const reader=f.create();f.config.includeOrderHistory=false;const r=await reader.readEvidence();
  assert.equal(r.nativeScopeObservation.includeOrderHistory,true);assert.equal(r.historicalCoverageVerified,false);assert.equal(r.nativePermissionVerified,false);
});
for(const [name,pattern,change] of [
  ["revoked",/SCOPES_REQUIRED/,app=>{app.accessScopes=[];}],
  ["new grant",/SCOPES_CHANGED/,app=>app.accessScopes.push({handle:"read_inventory"})],
  ["other app",/APP_INSTALLATION_CHANGED/,app=>{app.id=gid("AppInstallation","10");}]
])test(`final native scope ${name} discards collected data`,async()=>{
  const f=fixture();f.q.native=({family,scopeRead,payload})=>{if(family==="permission_scopes"&&scopeRead===2)change(payload.data.currentAppInstallation);};
  const reader=f.create();await assert.rejects(reader.readEvidence(),pattern);assert.equal(f.calls.length,10);await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);
});
test("scope order is not a grant change",async()=>{
  const f=fixture();f.q.native=({family,scopeRead,payload})=>{if(family==="permission_scopes"&&scopeRead===2)payload.data.currentAppInstallation.accessScopes.reverse();};
  assert.equal((await f.create().readEvidence()).nativeScopeListObserved,true);
});
for(const [name,change] of [["wrong shop",b=>{b.data.shop.id=gid("Shop","13");}],
  ["partial",b=>{b.errors=[{message:"SECRET"}];}],["bad grants",b=>{b.data.currentAppInstallation.accessScopes=[{handle:null}];}]])
  test(`bad scope response stops safely before orders: ${name}`,async()=>{
    const f=fixture();f.q.native=({family,payload})=>{if(family==="permission_scopes")change(payload);};
    await assert.rejects(f.create().readEvidence(),e=>!/SECRET/.test(e.message));assert.equal(f.calls.length,1);
  });
test("nonboolean history selection rejected before HTTP",()=>{
  const f=fixture();f.config.includeOrderHistory="true";assert.throws(f.create,/INPUT_INVALID/);assert.equal(f.calls.length,0);
});
test("final scope wait retains all previous physical attempts",async()=>{
  const f=fixture();f.q.waitAt=10;let error;try{await f.create().readEvidence();}catch(e){error=e;}
  assert.equal(quotaBoundaryControl(error).priorBoundaryAttempts,9);assert.equal(f.calls.length,9);
});

for(const state of ["pending","missing","missing_moments"])test(`journey ${state} preserves sales without claiming completed attribution or retrying pending pages`,async()=>{
  const f=fixture();f.q.native=({family,payload})=>{if(family!=="order_journey")return;
    if(state==="missing")payload.data.order.customerJourneySummary=null;
    else if(state==="pending")payload.data.order.customerJourneySummary.ready=false;
    else payload.data.order.customerJourneySummary.moments=null;
  };
  const result=await f.create().readEvidence();assert.equal(result.state,"journey_incomplete");assert.equal(result.salesPagesComplete,true);
  assert.equal(result.journeyPagesComplete,false);assert.equal(result.orders[0].lineItems.length,2);
  assert.equal(result.orders[0].journey.state,state==="pending"?"journey_pending":state==="missing"?"journey_unavailable":"journey_moments_unavailable");
  assert.equal(f.calls.filter(c=>c.family==="order_journey").length,2,"first observation and final consistency only, no pending cursor continuation");
});

test("ready journey with no visits is enumerated empty but has no paid/provider attribution proof",async()=>{
  const f=fixture();f.rows.moments=[];const result=await f.create().readEvidence();assert.equal(result.state,"collected");
  assert.equal(result.orders[0].journey.firstVisit,null);assert.deepEqual(result.orders[0].journey.moments,[]);
  assert.equal(result.providerClaimVerified,false);
});

for(const change of ["updated","removed","added"])test(`final selected header set ${change} cannot publish combined sales`,async()=>{
  const f=fixture();f.q.native=({family,scan,payload,variables})=>{if(family!=="order_headers"||scan!==2)return;
    if(change==="updated")payload.data.orders.edges[0].node.currentTotalPriceSet=money("1.00");
    else if(change==="removed")payload.data.orders=connection([],variables,"headers");
    else {payload.data.orders=connection([header(),header("11")],variables,"headers");}
  };
  const reader=f.create();await assert.rejects(reader.readEvidence(),/ORDER_SET_CHANGED/);
  await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);
});

for(const phase of ["order_lines","final_journey"])test(`${phase} detects changed order version without replay`,async()=>{
  const f=fixture();f.q.native=({family,journeyStart,payload})=>{
    if(family==="order_lines"&&phase==="order_lines"||family==="order_journey"&&journeyStart===2&&phase==="final_journey")
      payload.data.order.updatedAt="2026-10-01T12:00:01Z";
  };
  await assert.rejects(f.create().readEvidence(),/ORDER_CHANGED/);assert.equal(f.calls.filter(c=>c.family==="order_headers").length,1);
});

for(const phase of ["page","final"])test(`journey summary drift during ${phase} observations is not hidden by unchanged Order updatedAt`,async()=>{
  const f=fixture();f.q.native=({family,variables,journeyStart,payload})=>{if(family==="order_journey"&&(phase==="page"?variables.after!==null:journeyStart===2))
    payload.data.order.customerJourneySummary.lastVisit=visit("99");};
  await assert.rejects(f.create().readEvidence(),/JOURNEY_CHANGED/);
});

test("malformed cursor or raw GraphQL error stops collection and never returns partial success",async()=>{
  for(const mode of ["cursor","GraphQL"]){const f=fixture();f.q.native=({family,payload})=>{if(family!=="order_lines")return;
    if(mode==="cursor")payload.data.order.lineItems.pageInfo.endCursor="wrong";else payload.errors=[{message:"SECRET",extensions:{code:"ACCESS_DENIED"}}];};
    await assert.rejects(f.create().readEvidence(),e=>/PAGE_INVALID|COLLECTION_FAILED/.test(e.message)&&!e.message.includes("SECRET"));
    assert.equal(f.calls.length,3);assert.equal(f.auth.length,0);
  }
});

for(const status of [401,403,429])test(`native ${status} first error consumes execution without auth recovery or retry`,async()=>{
  const f=fixture();f.q.status=status;const reader=f.create();await assert.rejects(reader.readEvidence(),/COLLECTION_FAILED/);
  assert.equal(f.calls.length,1);assert.equal(f.stops.length,1);assert.equal(f.auth.length,0);await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);
});

for(const at of [1,2])test(`quota wait at physical boundary ${at} preserves genuine previous-attempt receipt`,async()=>{
  const f=fixture();f.q.waitAt=at;let error;try{await f.create().readEvidence();}catch(e){error=e;}
  assert.equal(quotaBoundaryControl(error)?.status,"waiting");assert.equal(quotaBoundaryControl(error)?.priorBoundaryAttempts,at-1);
  assert.equal(f.calls.length,at-1);assert.equal(Boolean(refreshQuotaWait(error,"provider_page",f.config.claim)),at===1);
});

for(const [key,value,code] of [["maxRequests",2,"REQUEST_LIMIT"],["maxRows",1,"ROW_LIMIT"],["maxBytes",1,"BYTE_LIMIT"]])
  test(`collection enforces total ${key}, closes reader and does not continue`,async()=>{
    const f=fixture();f.config.limits[key]=value;const reader=f.create();await assert.rejects(reader.readEvidence(),new RegExp(code));
    const sent=f.calls.length;await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);assert.equal(f.calls.length,sent);
    if(key==="maxRequests")assert.equal(sent,2);
  });

test("explicit bounds are captured before caller mutation and are never supplied as native cost budgets",async()=>{
  const f=fixture(),reader=f.create();f.config.range.fromInclusive="2000-01-01T00:00:00Z";f.config.limits.pageSize=100;
  f.config.claim.fence=99;f.config.verified.installationAuthority.installGeneration=99;
  const result=await reader.readEvidence();assert.equal(result.scope.job.fence,2);
  assert.equal(result.extractionRange.fromInclusive,"2026-10-01T00:00:00Z");assert.equal(f.calls.find(c=>c.family==="order_headers").variables.first,1);
  assert.ok(f.loads.every(x=>x.claim.fence===2));assert.ok(f.reservations.every(x=>Object.keys(x).sort().join(",")==="attemptId,lane,operationKey"));
});

for(const limits of [null,{}, {maxElapsedMs:1000,maxRequests:1,maxRows:1,maxBytes:1,pageSize:101}])test("missing or invalid total limits stop before work lookup or HTTP",()=>{
  const f=fixture();f.config.limits=limits;assert.throws(f.create,/INPUT_INVALID|LIMITS_INVALID/);assert.equal(f.calls.length,0);assert.equal(f.loads.length,0);
});

test("reader rejects caller recheck/authority callback override before work or HTTP",()=>{
  const f=fixture();f.config.checkCurrent=async()=>true;assert.throws(f.create,/INPUT_INVALID/);assert.equal(f.loads.length,0);assert.equal(f.calls.length,0);
});

test("current repository still blocks Admin collection before SQL/native activation gate",async()=>{
  const f=fixture();let sql=0;f.config.workStore=createRefreshWorkRepository({query:async()=>{sql++;throw Error("must not run");}});
  await assert.rejects(f.create().readEvidence(),/AUTHORITY_CHANGED/);assert.equal(sql,0);assert.equal(f.calls.length,0);
});

test("final current authority loss after last header HTTP prevents publication",async()=>{
  const f=fixture();f.q.native=({family,scan})=>{if(family==="order_headers"&&scan===2)f.q.lost=true;};
  await assert.rejects(f.create().readEvidence(),/AUTHORITY_CHANGED/);
});

for(const stage of ["loading","native"])test(`one total deadline stops ignored ${stage} dependency and prevents late pages`,async()=>{
  const f=fixture(),entered=gate(),release=gate();f.config.limits.maxElapsedMs=120;
  f.q[stage]=async()=>{entered.resolve();await release.promise;};
  const reader=f.create(),pending=reader.readEvidence().catch(e=>e);await entered.promise;
  const error=await pending;assert.match(error.message,/DEADLINE_EXCEEDED/);release.resolve();await pause(50);
  assert.equal(f.calls.length,stage==="native"?1:0);await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);
});

test("total deadline is not reset for each successfully returned page",async()=>{
  const f=fixture();f.config.limits.maxElapsedMs=100;f.q.delay=40;
  await assert.rejects(f.create().readEvidence(),/DEADLINE_EXCEEDED/);assert.ok(f.calls.length<8);
});

test("pre-abort and in-flight cancellation close the one-shot reader without further calls",async()=>{
  const a=fixture();a.config.signal=AbortSignal.abort();await assert.rejects(a.create().readEvidence(),/ABORTED/);assert.equal(a.calls.length,0);
  const f=fixture(),entered=gate(),release=gate(),controller=new AbortController();f.config.signal=controller.signal;
  f.q.native=async()=>{entered.resolve();await release.promise;};const reader=f.create(),pending=reader.readEvidence().catch(e=>e);
  await entered.promise;controller.abort();assert.match((await pending).message,/ABORTED/);release.resolve();await pause(30);assert.equal(f.calls.length,1);
});

test("collection cannot use a fake native client and explicit closing of a genuine order SDK client is permanent",async()=>{
  assert.throws(()=>createShopifyOrderReadExecution({client:{graphql:async()=>{}},checkCurrent:async()=>true,limits:{}}),/INPUT_INVALID/);
  const f=fixture(),{range,limits,...options}=f.config,client=createRefreshShopifyAdminOrderClient(options);
  assert.equal(isShopifyAdminOrderSdkClient(client),true);assert.equal(isShopifyAdminOrderSdkClient({...client}),false);
  closeShopifyAdminOrderSdkClient(client);await assert.rejects(client.graphql(queries.order_headers,{variables:{first:1,after:null,query:"x"}}),/EXECUTION_CLOSED/);
  assert.equal(f.calls.length,0);
});

test("multiple orders retain separate sale lines and equal-timestamp header order may change on final scan",async()=>{
  const f=fixture();f.rows.headers.push(header("11"));
  f.q.native=({family,payload,variables,scan})=>{
    if(family==="order_headers"&&scan===2)payload.data.orders=connection([...f.rows.headers].reverse(),variables,"headers");
    if(family==="order_lines"&&variables.orderId===gid("Order","11"))
      payload.data.order.lineItems.edges.forEach(e=>{e.node.id=gid("LineItem",String(100+Number(e.node.id.split("/").at(-1))));});
  };
  const result=await f.create().readEvidence();assert.equal(result.orders.length,2);
  assert.ok(result.orders.every(o=>o.lineItems.length===2&&o.journey.moments.length===3));
  assert.notEqual(result.orders[0].lineItems[0].id,result.orders[1].lineItems[0].id);
  assert.equal(result.orders[0].lineItems[0].product.id,result.orders[1].lineItems[0].product.id);
});

test("native nullable product, current zero, cancellation and refunded money are retained without a sales formula",async()=>{
  const f=fixture();f.rows.headers[0].cancelledAt=stamp;f.rows.headers[0].totalRefundedSet=money("50.00");
  f.rows.lines[0].product=null;f.rows.lines[0].variant=null;f.rows.lines[0].currentQuantity=0;
  const result=await f.create().readEvidence(),o=result.orders[0];assert.equal(o.header.cancelledAt,stamp);
  assert.equal(o.header.totalRefundedSet.shopMoney.amount,"50.00");assert.equal(o.lineItems[0].quantity,1);
  assert.equal(o.lineItems[0].currentQuantity,0);assert.equal(o.lineItems[0].productIdentityState,"unavailable");
  assert.equal(Object.hasOwn(result,"revenue"),false);assert.equal(Object.hasOwn(result,"SalesRole"),false);
});

test("invalid range and caller per-read override cannot change the bound extraction",async()=>{
  const f=fixture(),reader=f.create();await assert.rejects(reader.readEvidence({range:{}}),/OVERRIDE_FORBIDDEN/);
  assert.equal(f.calls.length,0);await reader.readEvidence();assert.equal(f.calls.length,10);
  const bad=fixture();bad.config.range.toExclusive=bad.config.range.fromInclusive;assert.throws(bad.create,/RANGE_INVALID/);assert.equal(bad.loads.length,0);
});

test("collector cannot dispatch through missing SDK global hook",async()=>{
  const f=fixture(),reader=f.create();restoreShopifyOrderFixtureFetch();
  await assert.rejects(reader.readEvidence(),/COLLECTION_FAILED/);assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);
});

test("caller callbacks throwing provider-like order error text cannot leak it as a trusted protocol error",async()=>{
  const f=fixture();f.q.throw=true;await assert.rejects(f.create().readEvidence(),e=>e.message==="SHOPIFY_ORDER_COLLECTION_FAILED");
  assert.equal(f.calls.length,1);assert.equal(f.stops.length,1);
});

test("current authority is also checked when there are no orders to collect",async()=>{
  const f=fixture();f.rows.headers=[];f.q.native=({scan})=>{if(scan===2)f.q.lost=true;};
  await assert.rejects(f.create().readEvidence(),/AUTHORITY_CHANGED/);assert.equal(f.calls.length,3);
});

function version(f,time="2026-10-01T13:00:00Z"){
  f.rows.headers.forEach(h=>{h.updatedAt=time;});
  f.q.native=({payload})=>{if(payload.data.order)payload.data.order.updatedAt=time;};
}
test("prewrite: genuine completed collection yields independent Order and LineItem keys, no write authority",async()=>{
  const f=fixture(),current=await f.create().readEvidence(),before=f.calls.length;
  const r=reviewShopifyOrderPrewrite({expected:prewriteOwner(),current});assert.equal(f.calls.length,before);
  assert.deepEqual(r.orders[0].key,[workspace,shop.id,gid("Order","10")]);
  assert.deepEqual(r.orders[0].lines[0].key,[workspace,shop.id,gid("Order","10"),gid("LineItem","1")]);
  assert.notDeepEqual(r.orders[0].lines[0].key,r.orders[0].lines[1].key);
  assert.equal(r.orders[0].lines[0].observed.product.id,r.orders[0].lines[1].observed.product.id);
  assert.equal(r.orders[0].change,"new");assert.equal(r.orders[0].observed,current.orders[0].header);
  assert.equal(r.provenance.currentScope,current.scope);assert.ok(Object.isFrozen(r.orders[0].lines[0].key));
  for(const flag of ["persistable","authorizesActivation","DatasetWritePerformed","nativePermissionVerified","canonicalScopeReady","providerClaimVerified","exactOverlapVerified","atomicSnapshotVerified","missingRecordsProveDeletion"])assert.equal(r[flag],false);
});
test("prewrite: identical read replay does not sum amounts or duplicate line rows",async()=>{
  const f=fixture(),previous=await f.create().readEvidence(),current=await f.create().readEvidence();
  const r=reviewShopifyOrderPrewrite({expected:prewriteOwner(),previous,current});assert.equal(r.orders.length,1);assert.equal(r.orders[0].lines.length,2);
  assert.equal(r.orders[0].change,"replay");assert.ok(r.orders[0].lines.every(l=>l.change==="unchanged"));
  assert.equal(r.orders[0].lines[0].observed.originalTotalSet.shopMoney.amount,"50.00");
});
test("prewrite: the same branded observation can be reviewed twice without another read or accumulation",async()=>{
  const f=fixture(),current=await f.create().readEvidence(),n=f.calls.length;
  const r=reviewShopifyOrderPrewrite({expected:prewriteOwner(),previous:current,current});
  assert.equal(r.orders[0].change,"replay");assert.equal(f.calls.length,n);
});
for(const [name,change] of [["workspace",v=>{v.workspaceId="22222222-2222-4222-8222-222222222222";}],
  ["generation",v=>{v.installGeneration=4;}],["shop",v=>{v.shopId=gid("Shop","13");}],
  ["domain",v=>{v.shopDomain="other.myshopify.com";}]])test(`prewrite: wrong expected ${name} rejects current observation`,async()=>{
  const f=fixture(),current=await f.create().readEvidence(),expected=prewriteOwner();change(expected);
  assert.throws(()=>reviewShopifyOrderPrewrite({expected,current}),/OWNER_MISMATCH/);
});
for(const name of ["plain JSON","forged flags","null","wrapper"])test(`prewrite: ${name} is not a genuine collection observation`,async()=>{
  const f=fixture(),r=await f.create().readEvidence(),current=name==="plain JSON"?structuredClone(r):name==="forged flags"?
    {...r,nativePermissionVerified:true,persistable:true}:name==="null"?null:{observation:r};
  assert.throws(()=>reviewShopifyOrderPrewrite({expected:prewriteOwner(),current}),/OBSERVATION_REQUIRED/);
});
test("prewrite: unbranded previous JSON cannot become stored replay evidence",async()=>{
  const f=fixture(),current=await f.create().readEvidence();assert.throws(()=>reviewShopifyOrderPrewrite({expected:prewriteOwner(),current,previous:structuredClone(current)}),/OBSERVATION_REQUIRED/);
});
test("prewrite: old installation observation cannot mix into current generation",async()=>{
  const f=fixture(),previous=await f.create().readEvidence();f.config.verified.installationAuthority.installGeneration=4;f.config.claim.installGeneration="4";
  const current=await f.create().readEvidence(),expected={...prewriteOwner(),installGeneration:4};
  assert.throws(()=>reviewShopifyOrderPrewrite({expected,previous,current}),/OWNER_MISMATCH/);
});
test("prewrite: AppInstallation drift between completed reads stops comparison",async()=>{
  const f=fixture(),previous=await f.create().readEvidence();
  f.q.native=({family,payload})=>{if(family==="permission_scopes")payload.data.currentAppInstallation.id=gid("AppInstallation","10");};
  const current=await f.create().readEvidence();assert.throws(()=>reviewShopifyOrderPrewrite({expected:prewriteOwner(),previous,current}),/APP_INSTALLATION_CHANGED/);
});
for(const [name,change] of [["order amount",f=>{f.rows.headers[0].totalPriceSet=money("99.00");}],
  ["line quantity",f=>{f.rows.lines[0].quantity=2;}],["line amount",f=>{f.rows.lines[0].originalTotalSet=money("99.00");}],
  ["missing line",f=>{f.rows.lines.pop();}],["added line",f=>{f.rows.lines.push(line("3"));}]])
test(`prewrite: same updatedAt with conflicting ${name} never silently chooses a version`,async()=>{
  const f=fixture(),previous=await f.create().readEvidence();change(f);const current=await f.create().readEvidence();
  assert.throws(()=>reviewShopifyOrderPrewrite({expected:prewriteOwner(),previous,current}),/SAME_VERSION_CONFLICT/);
});
test("prewrite: line pagination order is not a conflicting replay",async()=>{
  const f=fixture(),previous=await f.create().readEvidence();f.rows.lines.reverse();const current=await f.create().readEvidence();
  assert.equal(reviewShopifyOrderPrewrite({expected:prewriteOwner(),previous,current}).orders[0].change,"replay");
});
test("prewrite: older current native version cannot replace a newer observation",async()=>{
  const f=fixture();version(f);const previous=await f.create().readEvidence();version(f,stamp);const current=await f.create().readEvidence();
  assert.throws(()=>reviewShopifyOrderPrewrite({expected:prewriteOwner(),previous,current}),/STALE_VERSION/);
});
test("prewrite: newer refund/cancellation facts retain original/current/zero values without calculation",async()=>{
  const f=fixture(),previous=await f.create().readEvidence();version(f);f.rows.headers[0].cancelledAt="2026-10-01T12:30:00Z";
  f.rows.headers[0].totalRefundedSet=money("45.00");f.rows.headers[0].currentTotalPriceSet=money("0.00");
  f.rows.lines[0].currentQuantity=0;f.rows.lines[0].priceAfterAllDiscountsBeforeTaxesSet=money("0.00");const current=await f.create().readEvidence();
  const r=reviewShopifyOrderPrewrite({expected:prewriteOwner(),previous,current}),o=r.orders[0];
  assert.equal(o.change,"new_version");assert.equal(o.lines[0].change,"changed");assert.equal(o.lines[0].observed.quantity,1);assert.equal(o.lines[0].observed.currentQuantity,0);
  assert.equal(o.lines[0].observed.originalTotalSet.shopMoney.amount,"50.00");assert.equal(o.observed.totalRefundedSet.shopMoney.amount,"45.00");
  assert.equal(o.observed.currentTotalPriceSet.shopMoney.amount,"0.00");assert.equal(o.observed.cancelledAt,"2026-10-01T12:30:00Z");
});
test("prewrite: same LineItem ID cannot belong to two different orders in one collection",async()=>{
  const f=fixture();f.rows.headers.push(header("11"));const current=await f.create().readEvidence();
  assert.throws(()=>reviewShopifyOrderPrewrite({expected:prewriteOwner(),current}),/LINE_OWNER_CONFLICT/);
});
test("prewrite: an old LineItem ID cannot move into another order between observations",async()=>{
  const f=fixture(),previous=await f.create().readEvidence();f.rows.headers=[header("11")];const current=await f.create().readEvidence();
  assert.throws(()=>reviewShopifyOrderPrewrite({expected:prewriteOwner(),previous,current}),/LINE_OWNER_CONFLICT/);
});
test("prewrite: an absent order in a later extraction is unobserved rather than deleted or zero",async()=>{
  const f=fixture(),previous=await f.create().readEvidence();f.rows.headers=[];const current=await f.create().readEvidence();
  const r=reviewShopifyOrderPrewrite({expected:prewriteOwner(),previous,current});assert.deepEqual(r.orders,[]);
  assert.deepEqual(r.previousOrderKeysNotObserved,[[workspace,shop.id,gid("Order","10")]]);assert.equal(r.missingRecordsProveDeletion,false);
});
test("prewrite: missing line in a newer version is an observed difference, no delete or zero row is invented",async()=>{
  const f=fixture(),previous=await f.create().readEvidence();version(f);f.rows.lines.pop();const current=await f.create().readEvidence();
  const r=reviewShopifyOrderPrewrite({expected:prewriteOwner(),previous,current});assert.equal(r.orders[0].lines.length,1);
  assert.deepEqual(r.orders[0].previousLineKeysNotObserved,[[workspace,shop.id,gid("Order","10"),gid("LineItem","2")]]);
});
test("prewrite: null product/variant identity keeps the sale line and its native LineItem key",async()=>{
  const f=fixture();f.rows.lines[0].product=null;f.rows.lines[0].variant=null;const current=await f.create().readEvidence();
  const r=reviewShopifyOrderPrewrite({expected:prewriteOwner(),current});assert.equal(r.orders[0].lines[0].observed.product,null);
  assert.equal(r.orders[0].lines[0].observed.productIdentityState,"unavailable");assert.equal(r.orders[0].lines.length,2);
});
test("prewrite: incomplete journey remains separate from complete sales",async()=>{
  const f=fixture();f.q.native=({family,payload})=>{if(family==="order_journey")payload.data.order.customerJourneySummary.ready=false;};
  const current=await f.create().readEvidence(),r=reviewShopifyOrderPrewrite({expected:prewriteOwner(),current});
  assert.equal(r.salesPagesComplete,true);assert.equal(r.journeyPagesComplete,false);assert.equal(r.orders[0].journey.state,"journey_pending");assert.equal(r.orders[0].lines.length,2);
});
test("prewrite: journey change without sales version change is a separate observation, no role or overlap claim",async()=>{
  const f=fixture(),previous=await f.create().readEvidence();f.rows.moments=[];const current=await f.create().readEvidence();
  const r=reviewShopifyOrderPrewrite({expected:prewriteOwner(),previous,current});assert.equal(r.orders[0].change,"replay");assert.equal(r.orders[0].journeyChange,"changed");
  assert.equal(r.providerClaimVerified,false);assert.equal(r.exactOverlapVerified,false);
});
test("prewrite: provider job/date metadata remains provenance and never enters Shopify order keys",async()=>{
  const f=fixture(),previous=await f.create().readEvidence();f.config.claim.provider="google_ads";f.config.claim.accountId="123";f.config.claim.id="another-job";
  const current=await f.create().readEvidence(),r=reviewShopifyOrderPrewrite({expected:prewriteOwner(),previous,current});
  assert.equal(r.orders[0].change,"replay");assert.equal(r.provenance.currentScope.job.provider,"google_ads");assert.equal(r.provenance.previousScope.job.provider,"meta");
  assert.equal(r.orders[0].key.length,3);assert.equal(r.orders[0].lines[0].key.length,4);
});
for(const change of [v=>{delete v.shopId;},v=>{v.installGeneration=0;},v=>{v.persistable=true;}])test("prewrite: missing/invalid owner or permission-like override is rejected",()=>{
  const expected=prewriteOwner();change(expected);assert.throws(()=>reviewShopifyOrderPrewrite({expected,current:{}}),/INPUT_INVALID/);
});
