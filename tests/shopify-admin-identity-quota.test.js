import test from "node:test";
import assert from "node:assert/strict";
import {shopifyAdminIdentityFamily,shopifyAdminCostFeedback} from "../app/lib/refresh/shopify-admin-identity-quota.server.js";
import {SHOPIFY_PRODUCT_CANDIDATE_QUERIES as queries,verifyShopifyProductCandidate} from "../app/lib/shopify/product-identity-verification.server.js";
import {createQuotaManagedFetch,quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createQuotaScopeResolver,quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";

const address="https://test.myshopify.com/admin/api/2026-07/graphql.json";
const gid=(type,n)=>`gid://shopify/${type}/${n}`;
const product={id:gid("Product","10"),legacyResourceId:"10"};
const shop={authority:"shopify_admin_verified",shopId:gid("Shop","12"),myshopifyDomain:"test.myshopify.com"};
const installation={authority:"shopify_installation_verified",workspaceId:"11111111-1111-4111-8111-111111111111",installGeneration:3,status:"active"};
const cost=()=>({requestedQueryCost:8,actualQueryCost:5,throttleStatus:{maximumAvailable:1000,currentlyAvailable:995,restoreRate:50}});
function body(family="identity_product_variant") {
  return JSON.stringify({query:queries[family],variables:{...(family!=="identity_variant"?{productId:product.id}:{}),
    ...(family!=="identity_product"?{variantId:gid("ProductVariant","20")}:{} )}});
}
function fixture() {
  const metadata=[],lookups=[],reservations=[],settles=[],stops=[],feedback=[],calls=[],q={costBudget:{unit:"shopify_admin_query_points",reservedRequestedCost:10}};
  const context={provider:"shopify_admin",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:3,
    accountId:shop.myshopifyDomain,organizationId:null,apiVersion:"2026-07"};
  const keys=new Map(Object.keys(queries).map(family=>[family,quotaRouteIdentity(context,{provider:"shopify_admin",family,
    accountId:context.accountId,organizationId:null,version:context.apiVersion,includes:[]}).routeKey]));
  const store={resolveRoute:async x=>{lookups.push(x);return [...keys.values()].includes(x.routeKey)&&!q.missing?x.routeKey:null;},
    reserve:async x=>{reservations.push(x);await q.reserving?.();if(q.wait)return {status:"waiting"};
      return {...x,status:"reserved",dispatchBeforeMs:Date.now()+10000,dispatchBudgetMs:10000,costBudget:q.costBudget};},
    settle:async x=>{settles.push(x);return true;},stop:async x=>{stops.push(x);return true;},
    recordFeedback:async x=>{feedback.push(x);return q.feedbackFailure!==true;}};
  const resolve=createQuotaScopeResolver({store,loadContext:async()=>{await q.loading?.();return q.lost?null:context;}});
  const fetchFn=createQuotaManagedFetch({provider:"shopify_admin",guard:createSharedQuotaGuard({store,now:Date.now}),lane:"background",
    resolveOperation:async d=>{metadata.push(d);return resolve(d);},isDispatchCurrent:async(d,k)=>await resolve(d)===k,
    fetchFn:async(url,init)=>{calls.push({url,init});if(q.throw)throw Error("SECRET-TRANSPORT");
      return new Response(JSON.stringify(q.payload??{data:{shop:{id:shop.shopId,myshopifyDomain:shop.myshopifyDomain},product,
        productVariant:{id:gid("ProductVariant","20"),legacyResourceId:"20",product}},extensions:{cost:cost()}}),
      {status:q.status??200,headers:{"content-type":"application/json"}});}});
  return {context,q,metadata,lookups,reservations,settles,stops,feedback,calls,
    read:(raw=body(),target=address,init={})=>fetchFn(target,{method:"POST",headers:{"X-Shopify-Access-Token":"SECRET-TOKEN"},body:raw,...init})};
}
for(const family of Object.keys(queries))test(`Admin exact existing ${family} read gets distinct scope and cost feedback`,async()=>{
  const f=fixture(),raw=body(family),r=await f.read(raw);assert.equal(r.status,200);assert.ok((await r.json()).data);
  assert.equal(f.reservations.length,1);assert.equal(f.settles.length,1);assert.equal(f.stops.length,0);
  assert.equal(f.metadata[0].family,family);assert.equal(f.metadata[0].accountId,shop.myshopifyDomain);
  assert.equal(f.calls[0].init.body,raw);assert.equal(f.calls[0].init.redirect,"error");
  assert.equal(f.feedback[0].feedback.kind,"shopify_admin_cost_observed");assert.equal(f.feedback[0].feedback.requestedQueryCost,8);
  assert.ok(f.lookups.every(x=>Object.keys(x).sort().join(",")==="connectionScopeKey,provider,routeKey"));
  assert.doesNotMatch(JSON.stringify([f.metadata,f.lookups,f.reservations,f.feedback]),/SECRET|gid:|productId|legacyResourceId|AdsTableVerify/);
});
test("Admin existing verifier passes all three unchanged query forms through real quota guard",async()=>{
  for(const [productId,variantId,family] of [["10",null,"identity_product"],[null,"20","identity_variant"],["10","20","identity_product_variant"]]){
    const f=fixture(),result=await verifyShopifyProductCandidate({shop,installation,productId,variantId,
      admin:{graphql:async(query,options)=>{assert.equal(options.tries,1);return f.read(JSON.stringify({query,variables:options.variables}));}}});
    assert.equal(f.metadata[0].family,family);assert.equal(result.state,"candidate_verified_in_shop");
    assert.equal(result.provider_link_verified,false);assert.equal(result.authorizes_activation,false);assert.equal(f.calls.length,1);
  }
});
for(const [name,mutate] of [["mutation",b=>{b.query="mutation { productDelete(input:{id:1}) { deletedProductId } }";}],
  ["extra selection",b=>{b.query=b.query.replace("shop { id", "shop { name id");}],
  ["alias",b=>{b.query=b.query.replace("shop {", "other: shop {");}],["extra operation",b=>{b.query+=" query Other { shop { name } }";}],
  ["missing variable",b=>{delete b.variables.productId;}],["extra variable",b=>{b.variables.private="SECRET";}],
  ["wrong type",b=>{b.variables.productId=10;}],["wrong GID",b=>{b.variables.productId=gid("ProductVariant","10");}],
  ["leading zero",b=>{b.variables.productId=gid("Product","010");}],["overflow",b=>{b.variables.productId=gid("Product","18446744073709551616");}],
  ["operationName",b=>{b.operationName="Other";}],
])test(`Admin ${name} rejected before scope/reservation/HTTP`,async()=>{
  const f=fixture(),b=JSON.parse(body());mutate(b);await assert.rejects(f.read(JSON.stringify(b)),e=>quotaBoundaryControl(e)?.status==="not_configured");
  assert.equal(f.metadata.length,0);assert.equal(f.reservations.length,0);assert.equal(f.calls.length,0);
});
for(const raw of ["not JSON","null","[]",'{"query":"mutation {}",'+body().slice(1)," "+body(),body()+" ","x".repeat(65537)])
  test("Admin malformed/noncanonical/duplicate JSON cannot authorize a query",()=>{assert.equal(shopifyAdminIdentityFamily(raw),null);});
for(const [name,target,init] of [["foreign domain",address.replace("test.myshopify.com","evil.com")],
  ["Partner endpoint","https://partners.shopify.com/123/api/2026-07/graphql.json"],
  ["query parameter",address+"?private=SECRET"],["fragment",address+"#private"],["trailing path",address+"/"],
  ["unversioned",address.replace("2026-07","latest")],["nonquarter version",address.replace("2026-07","2026-02")],
  ["GET",address,{method:"GET"}],["nonstandard port",address.replace(".com/",".com:444/")],
])test(`Admin ${name} cannot select a native family`,async()=>{
  const f=fixture();await assert.rejects(f.read(body(),target,init),e=>quotaBoundaryControl(e)?.status==="not_configured");assert.equal(f.calls.length,0);assert.equal(f.metadata.length,0);
});
for(const [name,change] of [["shop",c=>{c.accountId="other.myshopify.com";}],["app",c=>{c.clientScopeKey="c".repeat(64);}],
  ["epoch",c=>{c.connectionEpoch++;}],["API",c=>{c.apiVersion="2026-10";}],["Partner provider",c=>{c.provider="shopify_partner";}],
])test(`Admin trusted ${name} mismatch cannot borrow configured scope`,async()=>{
  const f=fixture();change(f.context);await assert.rejects(f.read());assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);
});
test("Admin missing profile/context and reservation-time drift never dispatch",async()=>{
  for(const mode of ["profile","context","drift"]){const f=fixture();if(mode==="profile")f.q.missing=true;
    if(mode==="context")f.q.lost=true;if(mode==="drift")f.q.reserving=()=>{f.context.connectionEpoch++;};
    await assert.rejects(f.read());assert.equal(f.calls.length,0);assert.equal(f.stops.length,0);assert.equal(f.settles.length,mode==="drift"?1:0);}
});
test("Admin distinct families and app-shop pairs have distinct routes; Partner never shares route",()=>{
  const f=fixture();const d={provider:"shopify_admin",family:"identity_product",accountId:shop.myshopifyDomain,organizationId:null,version:"2026-07",includes:[]};
  const key=quotaRouteIdentity(f.context,d).routeKey;
  for(const family of ["identity_variant","identity_product_variant"])assert.notEqual(quotaRouteIdentity(f.context,{...d,family}).routeKey,key);
  assert.notEqual(quotaRouteIdentity({...f.context,clientScopeKey:"c".repeat(64)},d).routeKey,key);
  assert.throws(()=>quotaRouteIdentity({...f.context,provider:"shopify_partner"},d));
});
test("Admin cost observations preserve real zero and fractional native restore rate without grant/refund",()=>{
  const c=cost();c.actualQueryCost=0;c.throttleStatus.currentlyAvailable=0;c.throttleStatus.restoreRate=0.5;
  const r=shopifyAdminCostFeedback(200,{extensions:{cost:c},data:{private:"SECRET"}});
  assert.equal(r.kind,"shopify_admin_cost_observed");assert.equal(r.actualQueryCost,0);assert.equal(r.currentlyAvailable,0);assert.equal(r.restoreRate,0.5);
  assert.equal(Object.keys(r).length,7);assert.doesNotMatch(JSON.stringify(r),/SECRET|private|refund|grant/);
});
test("Admin absent cost and unavailable actual cost remain missing/partial, never observed zero",()=>{
  assert.equal(shopifyAdminCostFeedback(200,{}).kind,"shopify_admin_cost_missing");const c=cost();c.actualQueryCost=null;
  const r=shopifyAdminCostFeedback(200,{extensions:{cost:c}});assert.equal(r.kind,"shopify_admin_cost_partial");assert.equal(r.actualQueryCost,null);
});
for(const [name,change] of [["string",c=>{c.requestedQueryCost="8";}],["negative",c=>{c.actualQueryCost=-1;}],
  ["over-requested",c=>{c.actualQueryCost=9;}],["NaN",c=>{c.throttleStatus.restoreRate=NaN;}],
  ["over-maximum",c=>{c.throttleStatus.currentlyAvailable=1001;}],["missing throttle",c=>{delete c.throttleStatus;}],
])test(`Admin ${name} cost cannot become budget or zero`,()=>{
  const c=cost();change(c);const r=shopifyAdminCostFeedback(200,{extensions:{cost:c}});assert.equal(r.kind,"shopify_admin_cost_invalid");assert.equal(r.actualQueryCost,null);
});
for(const [name,payload,status] of [["HTTP 200 THROTTLED",{errors:[{message:"SECRET",extensions:{code:"THROTTLED"}}],extensions:{cost:cost()}},200],
  ["HTTP 200 ACCESS_DENIED",{errors:[{message:"SECRET",extensions:{code:"ACCESS_DENIED"}}],extensions:{cost:cost()}},200],
  ["missing cost",{data:{}},200],["partial cost",{extensions:{cost:{...cost(),actualQueryCost:null}}},200],
  ["malformed errors",{errors:{message:"SECRET"},extensions:{cost:cost()}},200],
  ["native 429",{errors:[{message:"SECRET"}]},429],
])test(`Admin ${name} stops once and never emits Partner throttle signal`,async()=>{
  const f=fixture();f.q.payload=payload;f.q.status=status;
  if(status===200)await assert.rejects(f.read());else assert.equal((await f.read()).status,status);
  assert.equal(f.calls.length,1);assert.equal(f.stops.length,1);assert.equal(f.stops[0].quotaSignal,null);assert.equal(f.settles.length,0);
  assert.doesNotMatch(JSON.stringify([f.feedback,f.stops]),/SECRET/);
});
test("Admin feedback failure cannot publish success; unknown transport stops without not-sent proof",async()=>{
  for(const mode of ["feedback","transport"]){const f=fixture();if(mode==="feedback")f.q.feedbackFailure=true;else f.q.throw=true;
    await assert.rejects(f.read(),e=>!quotaBoundaryControl(e));assert.equal(f.calls.length,1);assert.equal(f.settles.length,0);
    if(mode==="transport")assert.equal(f.stops[0].knownResponse,false);}
});
test("Admin local waiting and pre-abort preserve authentic no-dispatch evidence",async()=>{
  const f=fixture();f.q.wait=true;await assert.rejects(f.read(),e=>quotaBoundaryControl(e)?.status==="waiting"&&quotaBoundaryControl(e).priorBoundaryAttempts===0);
  assert.equal(f.calls.length,0);const controller=new AbortController();controller.abort();const a=fixture();
  await assert.rejects(a.read(body(),address,{signal:controller.signal}),e=>quotaBoundaryControl(e)?.status==="not_sent");assert.equal(a.reservations.length,0);
});
for(const budget of [undefined,null,{unit:"requests",reservedRequestedCost:10},{unit:"shopify_admin_query_points",reservedRequestedCost:0}])
  test("Admin HTTP budget: no valid point receipt means zero HTTP even with caller header",async()=>{
    const f=fixture();f.q.costBudget=budget;await assert.rejects(f.read(body(),address,{headers:{"X-Requested-Cost-Budget":"999"}}),e=>quotaBoundaryControl(e)?.status==="not_sent");
    assert.equal(f.calls.length,0);assert.equal(f.reservations.length,1);assert.equal(f.settles.length,1);assert.equal(f.stops.length,0);
  });
test("Admin HTTP budget: requested cost exceeding reservation stops even when actual cost fits",async()=>{
  const f=fixture();f.q.costBudget.reservedRequestedCost=5;const c=cost();c.actualQueryCost=1;f.q.payload={data:{},extensions:{cost:c}};
  await assert.rejects(f.read(),/COST_BUDGET_EXCEEDED/);assert.equal(f.calls.length,1);assert.equal(f.stops.length,1);assert.equal(f.settles.length,0);
  assert.equal(f.feedback[0].feedback.requestedQueryCost,8);assert.equal(f.feedback[0].feedback.actualQueryCost,1);assert.equal(f.stops[0].quotaSignal,null);
  await assert.rejects(f.read(),e=>quotaBoundaryControl(e)?.priorBoundaryAttempts===1);assert.equal(f.calls.length,1);
});
test("Admin HTTP budget: partial native response still identifies requested-cost excess",async()=>{
  const f=fixture();f.q.costBudget.reservedRequestedCost=5;f.q.payload={extensions:{cost:{...cost(),actualQueryCost:null}}};
  await assert.rejects(f.read(),/COST_BUDGET_EXCEEDED/);assert.equal(f.calls.length,1);assert.equal(f.stops.length,1);
});
test("Admin HTTP budget: exact reserved ceiling and native zero are valid without any refund",async()=>{
  for(const points of [8,0]){const f=fixture();f.q.costBudget.reservedRequestedCost=8;const c=cost();c.requestedQueryCost=points;c.actualQueryCost=points;
    f.q.payload={data:{},extensions:{cost:c}};await f.read();assert.equal(f.reservations.length,1);assert.equal(f.settles.length,1);assert.equal(f.stops.length,0);
    assert.equal(f.feedback[0].feedback.requestedQueryCost,points);}
});
test("Admin HTTP budget: pre-dispatch mutation cannot enlarge admitted point receipt",async()=>{
  const f=fixture();let lookups=0;f.q.loading=()=>{if(++lookups===2)f.q.costBudget.reservedRequestedCost=999;};
  f.q.payload={extensions:{cost:{...cost(),requestedQueryCost:12,actualQueryCost:1}}};
  await assert.rejects(f.read(),/COST_BUDGET_EXCEEDED/);assert.equal(f.calls.length,1);assert.equal(f.stops.length,1);
});
test("Admin HTTP budget: feedback failure on excess still attempts persistent stop and never settles success",async()=>{
  const f=fixture();f.q.feedbackFailure=true;f.q.costBudget.reservedRequestedCost=5;
  await assert.rejects(f.read());assert.equal(f.calls.length,1);assert.equal(f.stops.length,1);assert.equal(f.settles.length,0);
});
