import test from "node:test";
import assert from "node:assert/strict";
import {createShopifyOrderPageRequest as request,shopifyOrderReadFamily as classify} from "../app/lib/shopify/order-read-protocol.server.js";
import {createQuotaManagedFetch,quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createQuotaScopeResolver,quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {SHOPIFY_PERMISSION_SCOPES_QUERY} from "../app/lib/shopify/permission-scope-protocol.server.js";

const families=["order_headers","order_lines","order_journey"];
const shop={id:"gid://shopify/Shop/12",myshopifyDomain:"test.myshopify.com"};
function spec(family="order_headers") {return request({family,shop,...family==="order_headers"?
  {range:{fromInclusive:"2026-10-01T00:00:00Z",toExclusive:"2026-10-02T00:00:00Z"}}:
  {orderId:"gid://shopify/Order/10",updatedAt:"2026-10-01T12:00:00Z"}});}
const raw=r=>JSON.stringify({query:r.query,variables:r.variables});
const context={provider:"shopify_admin",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:3,
  accountId:shop.myshopifyDomain,organizationId:null,apiVersion:"2026-10"};
function fixture() {
  const metadata=[],lookups=[],reservations=[],feedback=[],calls=[],q={};
  const store={resolveRoute:async x=>{lookups.push(x);return q.missing?null:x.routeKey;},reserve:async x=>{reservations.push(x);
    return {...x,status:"reserved",dispatchBeforeMs:Date.now()+10000,dispatchBudgetMs:10000,
      costBudget:{unit:"shopify_admin_query_points",reservedRequestedCost:10}};},
    settle:async()=>true,stop:async()=>true,recordFeedback:async x=>{feedback.push(x);return true;}};
  const resolve=createQuotaScopeResolver({store,loadContext:async()=>context});
  const fetch=createQuotaManagedFetch({provider:"shopify_admin",lane:"background",guard:createSharedQuotaGuard({store,now:Date.now}),
    resolveOperation:async d=>{metadata.push(d);return resolve(d);},isDispatchCurrent:async(d,k)=>await resolve(d)===k,
    fetchFn:async(...args)=>{calls.push(args);return Response.json({data:{},extensions:{cost:{requestedQueryCost:8,actualQueryCost:5,
      throttleStatus:{maximumAvailable:1000,currentlyAvailable:995,restoreRate:50}}}});}});
  return {q,metadata,lookups,reservations,feedback,calls,read:(r=spec(),version="2026-10")=>
    fetch(`https://test.myshopify.com/admin/api/${version}/graphql.json`,{method:"POST",body:typeof r==="string"?r:raw(r)})};
}

test("native scopes have distinct cost operation, same six-field private metadata and actual feedback",async()=>{
  const f=fixture();await f.read({query:SHOPIFY_PERMISSION_SCOPES_QUERY,variables:{}});
  assert.equal(f.metadata[0].family,"permission_scopes");assert.equal(f.calls.length,1);assert.equal(f.feedback[0].feedback.actualQueryCost,5);
  assert.equal(Object.keys(f.metadata[0]).sort().join(","),"accountId,family,includes,organizationId,provider,version");
  const keys=[...families,"identity_product","permission_scopes"].map(family=>quotaRouteIdentity(context,{provider:"shopify_admin",family,
    accountId:context.accountId,organizationId:null,version:"2026-10",includes:[]}).routeKey);
  assert.equal(new Set(keys).size,5);assert.doesNotMatch(JSON.stringify([f.metadata,f.lookups,f.reservations]),/accessScopes|AppInstallation|read_orders/);
});
test("missing native scope profile does not borrow existing product/order profile",async()=>{
  const f=fixture();f.q.missing=true;await assert.rejects(f.read({query:SHOPIFY_PERMISSION_SCOPES_QUERY}),e=>quotaBoundaryControl(e)?.status==="not_configured");
  assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);
});
for(const version of ["2026-07","2026-01","2027-01"])test(`native scope dependency rejects unreviewed version ${version}`,async()=>{
  const f=fixture();await assert.rejects(f.read({query:SHOPIFY_PERMISSION_SCOPES_QUERY},version),e=>quotaBoundaryControl(e)?.status==="not_configured");
  assert.equal(f.calls.length,0);assert.equal(f.metadata.length,0);
  assert.throws(()=>quotaRouteIdentity({...context,apiVersion:version},{provider:"shopify_admin",family:"permission_scopes",
    accountId:context.accountId,organizationId:null,version,includes:[]}));
});

for(const family of families)test(`exact ${family} reaches real resolver/guard with a distinct operation and typed point feedback`,async()=>{
  const f=fixture(),r=spec(family);assert.equal(classify(raw(r)),family);await f.read(r);
  assert.equal(f.metadata[0].family,family);assert.equal(f.metadata[0].version,"2026-10");
  assert.equal(f.reservations.length,1);assert.equal(f.calls.length,1);assert.equal(f.feedback[0].feedback.kind,"shopify_admin_cost_observed");
  assert.ok(f.metadata.every(x=>Object.keys(x).sort().join(",")==="accountId,family,includes,organizationId,provider,version"));
  assert.doesNotMatch(JSON.stringify([f.metadata,f.lookups,f.reservations,f.feedback]),/orderId|updated_at|gid:|first|after|2026-10-01/);
});

test("three order families do not borrow one another's or product identity's operation keys",()=>{
  const keys=[...families,"identity_product"].map(family=>quotaRouteIdentity(context,{provider:"shopify_admin",family,
    accountId:context.accountId,organizationId:null,version:context.apiVersion,includes:[]}).routeKey);
  assert.equal(new Set(keys).size,4);
});

for(const version of ["2026-07","2026-01","2027-01"])test(`order query is not guessed compatible with API ${version}`,async()=>{
  const f=fixture();await assert.rejects(f.read(spec(),version),e=>quotaBoundaryControl(e)?.status==="not_configured");
  assert.equal(f.metadata.length,0);assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);
  assert.throws(()=>quotaRouteIdentity({...context,apiVersion:version},{provider:"shopify_admin",family:"order_headers",
    accountId:context.accountId,organizationId:null,version,includes:[]}));
});

for(const family of families)test(`missing ${family} profile is not a product-profile or Partner fallback`,async()=>{
  const f=fixture();f.q.missing=true;await assert.rejects(f.read(spec(family)),e=>quotaBoundaryControl(e)?.status==="not_configured");
  assert.equal(f.metadata[0].family,family);assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);
});

for(const mutate of [b=>{b.variables.first=0;},b=>{b.variables.first=101;},b=>{b.variables.first="1";},
  b=>{b.variables.after="";},b=>{delete b.variables.after;},b=>{b.variables.scope="orders";},
  b=>{b.variables.query="status:paid";},b=>{b.variables.query="updated_at:>='2026-10-02T00:00:00Z' updated_at:<'2026-10-01T00:00:00Z'";},
  b=>{b.query=b.query.replace("orders(","aliased: orders(");},b=>{b.query+="\nquery Extra { shop { id } }";},
  b=>{b.operationName="AdsTableOrderHeaders";},b=>{b.variables=null;}])test("non-exact/modified/header request rejected before quota metadata or HTTP",async()=>{
  const f=fixture(),b=JSON.parse(raw(spec()));mutate(b);assert.equal(classify(JSON.stringify(b)),null);
  await assert.rejects(f.read(JSON.stringify(b)),e=>quotaBoundaryControl(e)?.status==="not_configured");
  assert.equal(f.calls.length,0);assert.equal(f.metadata.length,0);
});

test("duplicate JSON keys, array bodies and non-string requests cannot name an order family",()=>{
  const text=raw(spec());assert.equal(classify(text.replace('"variables":','"variables":{},"variables":')),null);
  for(const input of [null,{},"[]","{}",text+" ","x".repeat(65537)])assert.equal(classify(input),null);
});

for(const family of ["order_lines","order_journey"])test(`${family} cannot use malformed or missing Order identity`,()=>{
  for(const id of [undefined,10,"gid://shopify/Product/10","gid://shopify/Order/18446744073709551616"]){
    const b=JSON.parse(raw(spec(family)));b.variables.orderId=id;assert.equal(classify(JSON.stringify(b)),null);
  }
});
