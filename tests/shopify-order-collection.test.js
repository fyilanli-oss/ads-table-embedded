import test,{after} from "node:test";
import assert from "node:assert/strict";
import "@shopify/shopify-api/adapters/node";
import {shopifyApi,ApiVersion,LogSeverity,Session} from "@shopify/shopify-api";
import {abstractFetch,setAbstractFetchFunc} from "@shopify/shopify-api/runtime";
import {createShopifyAdminIdentitySdkBridge,isShopifyAdminOrderSdkClient,closeShopifyAdminOrderSdkClient} from "../app/lib/refresh/shopify-admin-sdk-quota-bridge.server.js";
import {createRefreshShopifyOrderReader,createRefreshShopifyAdminOrderClient} from "../app/lib/refresh/quota-authority-binding.server.js";
import {createShopifyOrderReadExecution} from "../app/lib/shopify/order-collection.server.js";
import {SHOPIFY_ORDER_READ_QUERIES as queries} from "../app/lib/shopify/order-read-protocol.server.js";
import {SHOPIFY_PERMISSION_SCOPES_QUERY} from "../app/lib/shopify/permission-scope-protocol.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {refreshQuotaWait} from "../app/lib/refresh/quota-work-wait.server.js";

const original=abstractFetch;after(()=>setAbstractFetchFunc(original));
const sdkRoot=import.meta.resolve("@shopify/shopify-app-react-router/server");
const {graphqlClientFactory}=await import(new URL("./clients/admin/graphql.mjs",sdkRoot));
const {handleClientErrorFactory}=await import(new URL("./authenticate/admin/helpers/handle-client-error.mjs",sdkRoot));
const api=shopifyApi({apiKey:"a".repeat(32),apiSecretKey:"b".repeat(32),hostName:"example.com",apiVersion:ApiVersion.October26,
  isEmbeddedApp:true,logger:{level:LogSeverity.Error,log:()=>{}}});
const gid=(t,n)=>`gid://shopify/${t}/${n}`;
const shop={id:gid("Shop","12"),myshopifyDomain:"test.myshopify.com"};
const workspace="11111111-1111-4111-8111-111111111111",stamp="2026-10-01T12:00:00Z";
const money=(amount="0.00")=>({shopMoney:{amount,currencyCode:"USD"},presentmentMoney:{amount,currencyCode:"EUR"}});
function header(n="10") {return {id:gid("Order",n),createdAt:"2026-09-30T12:00:00Z",updatedAt:stamp,processedAt:stamp,cancelledAt:null,
  test:false,taxesIncluded:false,currencyCode:"USD",presentmentCurrencyCode:"EUR",displayFinancialStatus:"PAID",
  ...Object.fromEntries(["subtotalPriceSet","currentSubtotalPriceSet","originalTotalPriceSet","totalPriceSet","currentTotalPriceSet",
    "totalTaxSet","currentTotalTaxSet","totalDiscountsSet","currentTotalDiscountsSet","totalShippingPriceSet",
    "currentShippingPriceSet","totalRefundedSet"].map(k=>[k,money()]))};}
function line(n) {return {id:gid("LineItem",n),quantity:1,currentQuantity:1,isGiftCard:false,product:{id:gid("Product","100")},
  variant:{id:gid("ProductVariant","200"),product:{id:gid("Product","100")}},originalTotalSet:money("50.00"),
  discountedTotalSet:money("45.00"),priceAfterAllDiscountsBeforeTaxesSet:money("45.00")};}
const visit=n=>({__typename:"CustomerVisit",id:gid("CustomerVisit",n),occurredAt:"2026-09-30T12:00:00Z",source:"facebook",sourceDescription:null,sourceType:"SOCIAL"});
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function connection(rows,variables,prefix) {
  const offset=variables.after===null?0:Number(variables.after.split(":").at(-1))+1;
  const selected=rows.slice(offset,offset+variables.first);
  return {edges:selected.map((node,i)=>({cursor:`${prefix}:${offset+i}`,node})),
    pageInfo:{hasNextPage:offset+selected.length<rows.length,endCursor:selected.length?`${prefix}:${offset+selected.length-1}`:null}};
}
function fixture() {
  const calls=[],loads=[],lookups=[],reservations=[],settles=[],stops=[],feedback=[],auth=[],q={headerScans:0,journeyStarts:0,scopeReads:0};
  const rows={headers:[header()],lines:[line("1"),line("2")],moments:[visit("1"),visit("2"),visit("3")]};
  const bridge=createShopifyAdminIdentitySdkBridge();setAbstractFetchFunc(bridge.fetch);
  const session=new Session({id:`offline_${shop.myshopifyDomain}`,shop:shop.myshopifyDomain,state:"synthetic",isOnline:false,
    accessToken:"SECRET-TOKEN",scope:"read_orders,read_products"});
  const admin={graphql:graphqlClientFactory({params:{api,logger:{debug:()=>{}}},session,
    handleClientError:handleClientErrorFactory({request:new Request("https://example.com"),onError:async x=>auth.push(x)})})};
  const context={provider:"shopify_admin",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:3,
    accountId:shop.myshopifyDomain,organizationId:null,apiVersion:"2026-10"};
  const keys=[...Object.keys(queries),"permission_scopes"].map(family=>quotaRouteIdentity(context,{provider:"shopify_admin",family,accountId:context.accountId,
    organizationId:null,version:context.apiVersion,includes:[]}).routeKey);
  const quotaStore={resolveRoute:async x=>{lookups.push(x);return q.missing?null:keys.includes(x.routeKey)?x.routeKey:null;},
    reserve:async x=>{reservations.push(x);await q.reserving?.();if(q.waitAt===reservations.length)return {status:"waiting"};
      // Synthetic receipt/cost only. No native profile or point limit is established.
      return {...x,status:"reserved",dispatchBeforeMs:Date.now()+10000,dispatchBudgetMs:10000,
        costBudget:{unit:"shopify_admin_query_points",reservedRequestedCost:10}};},
    settle:async x=>{settles.push(x);return true;},stop:async x=>{stops.push(x);return true;},
    recordFeedback:async x=>{feedback.push(x);return true;}};
  const config={verified:{installationAuthority:{authority:"shopify_installation_verified",workspaceId:workspace,installGeneration:3,status:"active"},
    identity:{shop:{authority:"shopify_admin_verified",shopId:shop.id,myshopifyDomain:shop.myshopifyDomain},
      session:{authority:"shopify_id_token_verified",shopDomain:shop.myshopifyDomain}},context:{admin}},sdkBridge:bridge,
    claim:{workspaceId:workspace,installGeneration:"3",provider:"meta",accountId:"act_1",id:"job1",fence:2},
    window:{from:"2026-10-01",to:"2026-10-01"},entitlementReceipt:{observedAt:"2026-10-28T06:00:00Z"},
    range:{fromInclusive:"2026-10-01T00:00:00Z",toExclusive:"2026-10-02T00:00:00Z"},
    limits:{maxElapsedMs:10000,maxRequests:100,maxRows:1000,maxBytes:1000000,pageSize:1},now:Date.now,quotaStore,
    workStore:{loadQuotaContext:async input=>{loads.push(input);await q.loading?.();return q.lost?null:context;}},
    fetchFn:async(endpoint,init)=>{
      const request=JSON.parse(init.body),family=request.query===SHOPIFY_PERMISSION_SCOPES_QUERY?"permission_scopes":Object.entries(queries).find(([,v])=>v===request.query)?.[0],v=request.variables;
      calls.push({family,variables:structuredClone(v),signal:init.signal});
      if(family==="order_headers"&&v.after===null)q.headerScans++;
      if(family==="order_journey"&&v.after===null)q.journeyStarts++;
      if(family==="permission_scopes")q.scopeReads++;
      const data={shop:structuredClone(shop)};
      if(family==="permission_scopes")data.currentAppInstallation={id:gid("AppInstallation","9"),accessScopes:[{handle:"read_products"},{handle:"read_orders"}]};
      else if(family==="order_headers")data.orders=connection(rows.headers,v,"headers");
      else {
        data.order={id:v.orderId,updatedAt:stamp};
        if(family==="order_lines")data.order.lineItems=connection(rows.lines,v,"lines");
        else data.order.customerJourneySummary={ready:true,firstVisit:rows.moments[0]??null,lastVisit:rows.moments.at(-1)??null,
          moments:connection(rows.moments,v,"moments")};
      }
      const payload={data,extensions:{cost:{requestedQueryCost:8,actualQueryCost:5,
        throttleStatus:{maximumAvailable:1000,currentlyAvailable:995,restoreRate:50}}}};
      await q.native?.({family,variables:v,payload,scan:q.headerScans,journeyStart:q.journeyStarts,scopeRead:q.scopeReads});
      if(q.delay)await pause(q.delay);if(q.throw)throw Error("SECRET-NATIVE");
      return Response.json(payload,{status:q.status??200});
    }};
  return {q,rows,calls,loads,lookups,reservations,settles,stops,feedback,auth,config,context,create:()=>createRefreshShopifyOrderReader(config)};
}

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
  const f=fixture(),reader=f.create();setAbstractFetchFunc(original);
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
