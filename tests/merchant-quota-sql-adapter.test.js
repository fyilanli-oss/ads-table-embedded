import test from "node:test";
import assert from "node:assert/strict";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {createQuotaScopeResolver,quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
const input={claim:{workspaceId:"11111111-1111-4111-8111-111111111111",installGeneration:"1",provider:"google_ads",accountId:"111",id:"job1",fence:2},
  window:{from:"2026-10-01",to:"2026-10-01"},provider:"google_ads",entitlementReceipt:{observedAt:"2026-10-28T15:00:00Z"}};
const base={provider:"google_ads",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:1,accountId:"111",organizationId:null,apiVersion:"v24"};
const merchant={targetAccountId:"99",quotaAccountId:"98",apiVersion:"products/v1",bindingEpoch:2};
const descriptor={provider:"google_ads",family:"merchant_products",accountId:"99",organizationId:null,version:"products/v1",includes:[]};
test("Merchant SQL adapter keeps original Ads claim/window/receipt and accepts only the SQL-returned scope",async()=>{
  const calls=[],context={...base,merchant};
  const store=createRefreshWorkRepository({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{result:context}]};}});
  const current=await store.loadQuotaContext(input);assert.deepEqual(current,context);
  assert.deepEqual(calls[0].args,[input.claim.workspaceId,"1","google_ads","111","job1",2,"2026-10-01","2026-10-01","google_ads",input.entitlementReceipt.observedAt]);
  assert.doesNotMatch(calls[0].args.join(" "),/\b99\b|\b98\b|products\/v1/);
  const resolve=createQuotaScopeResolver({loadContext:()=>store.loadQuotaContext(input),store:{resolveRoute:async x=>x.routeKey}});
  assert.equal(await resolve(descriptor),quotaRouteIdentity(context,descriptor).routeKey);
});
test("Merchant transport never falls back to ordinary Ads scope when SQL omits Merchant",async()=>{
  for(const context of [base,null]){
    let routes=0;const store=createRefreshWorkRepository({query:async()=>({rows:[{result:context}]})});
    const resolve=createQuotaScopeResolver({loadContext:()=>store.loadQuotaContext(input),store:{resolveRoute:async x=>{routes++;return x.routeKey;}}});
    await assert.rejects(resolve(descriptor),/NOT_CONFIGURED/);assert.equal(routes,0);
  }
});
test("Merchant target pool epoch changes isolate routes while ordinary Ads route stays stable",()=>{
  const expected=quotaRouteIdentity({...base,merchant},descriptor);
  for(const patch of [{quotaAccountId:"97"},{bindingEpoch:3}])assert.notEqual(quotaRouteIdentity({...base,merchant:{...merchant,...patch}},descriptor).routeKey,expected.routeKey);
  const ads={...descriptor,family:"reporting_query",accountId:"111",version:"v24"};
  assert.deepEqual(quotaRouteIdentity(base,ads),quotaRouteIdentity({...base,merchant},ads));
});
test("Merchant SQL errors remain safe and never become fallback scope",async()=>{
  const store=createRefreshWorkRepository({query:async()=>{throw Error("SECRET");}});
  const resolve=createQuotaScopeResolver({loadContext:()=>store.loadQuotaContext(input),store:{resolveRoute:async()=>{throw Error("must not call");}}});
  await assert.rejects(resolve(descriptor),e=>e.message==="QUOTA_SCOPE_NOT_CONFIGURED");
});
