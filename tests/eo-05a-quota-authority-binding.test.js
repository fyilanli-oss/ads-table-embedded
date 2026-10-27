import test from "node:test";
import assert from "node:assert/strict";
import {createRefreshQuotaClients} from "../app/lib/refresh/quota-authority-binding.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {readFileSync} from "node:fs";

const claim=()=>({workspaceId:"00000000-0000-4000-8000-000000000001",installGeneration:"1",provider:"google_ads",accountId:"111",id:"test",fence:1});
const window={from:"2026-10-19",to:"2026-10-19"};
const context=()=>({provider:"shopify_partner",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:1,accountId:null,organizationId:"123",apiVersion:"2026-07"});
const request={apiVersion:"2026-07",query:"query { activeSubscription { id } }",variables:{}};
test("quota inventory installation FK uses the established bigint installation identity",()=>{
  const sql=readFileSync(new URL("../supabase/migrations/20261020161840_eo05a_quota_authority_binding.sql",import.meta.url),"utf8");
  assert.match(sql,/installation_id bigint not null references shopify\.installations\(id\)/);
});
function fixture() {
  const state={context:context(),calls:0,stops:0,settles:0,loads:[],onReserve:async()=>{}};
  const workStore={loadQuotaContext:async input=>{state.loads.push(input);return state.context;}};
  const quotaStore={resolveRoute:async x=>x.routeKey,reserve:async input=>{await state.onReserve();return {...input,status:"reserved",dispatchBeforeMs:1000,dispatchBudgetMs:1000};},
    stop:async()=>{state.stops++;return true;},settle:async()=>{state.settles++;return true;}};
  const config={workStore,quotaStore,claim:claim(),window,now:()=>0,fetchFn:async()=>{state.calls++;return new Response('{"data":{"activeSubscription":null}}',{headers:{"content-type":"application/json"}});}};
  const client=()=>createRefreshQuotaClients(config).shopify({environment:{SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"SYNTHETIC"}});
  return {state,config,client};
}
test("current work is loaded before lookup AND after quota reservation without merchant identity overrides",async()=>{
  const f=fixture(),client=f.client();f.config.claim.accountId="999";
  await client.activeSubscription(request);assert.equal(f.state.calls,1);assert.equal(f.state.loads.length,2);
  assert.ok(f.state.loads.every(x=>x.claim.accountId==="111"&&x.provider==="shopify_partner"&&x.window.from===window.from));
  assert.equal(f.state.stops,0);assert.equal(f.state.settles,1);
  assert.throws(()=>createRefreshQuotaClients({...f.config,loadContext:async()=>context()}),/INPUT_INVALID/);
});
test("Disconnect, lost claim or changed account during quota await sends zero HTTP without shared stop or retry",async()=>{
  for(const change of [()=>null,()=>({...context(),connectionEpoch:2}),()=>({...context(),clientScopeKey:"c".repeat(64)})]) {
    const f=fixture();f.state.onReserve=async()=>{f.state.context=change();};
    await assert.rejects(f.client().activeSubscription(request),e=>quotaBoundaryControl(e)?.status==="not_sent");
    assert.equal(f.state.calls,0);assert.equal(f.state.stops,0);assert.equal(f.state.settles,1);
  }
});
test("missing authority blocks before reservation; changed context never repins an existing execution",async()=>{
  const f=fixture(),client=f.client();await client.activeSubscription(request);
  f.state.context={...context(),connectionEpoch:2};
  await assert.rejects(client.activeSubscription(request),e=>quotaBoundaryControl(e)?.status==="not_configured");assert.equal(f.state.calls,1);
  const g=fixture();g.state.context=null;
  await assert.rejects(g.client().activeSubscription(request));assert.equal(g.state.calls,0);assert.equal(g.state.settles,0);
});
test("authority recheck time counts against dispatch permit; database failure never dispatches",async()=>{
  let time=0,calls=0,settles=0;
  const store={reserve:async x=>({...x,status:"reserved",dispatchBeforeMs:10,dispatchBudgetMs:10}),settle:async()=>{settles++;return true;},stop:async()=>{throw Error("must not stop");}};
  const guard=createSharedQuotaGuard({store,now:()=>time,elapsedNow:()=>time});
  const base={operationKey:"a".repeat(64),lane:"background",run:async()=>{calls++;return {outcome:"success"};}};
  assert.equal((await guard.execute({...base,beforeDispatch:async()=>{time=11;return true;}})).status,"not_sent");
  time=0;assert.equal((await guard.execute({...base,beforeDispatch:async()=>{throw Error("SECRET");}})).reason,"authority_not_current");
  assert.equal(calls,0);assert.equal(settles,2);
});
test("database adapter binds fenced claim, exact window and fresh entitlement receipt; no raw token or caller context",async()=>{
  const queries=[],store=createRefreshWorkRepository({query:async(sql,args)=>{queries.push({sql,args});return {rows:[{result:null}]};}});
  await store.loadQuotaContext({claim:claim(),window,provider:"google_ads",entitlementReceipt:{observedAt:"2026-10-20T00:00:00Z"}});
  assert.match(queries[0].sql,/load_refresh_quota_context/);assert.equal(queries[0].args.length,10);assert.equal(queries[0].args[9],"2026-10-20T00:00:00Z");
  await assert.rejects(store.loadQuotaContext({claim:claim(),window,provider:"meta"}),/INPUT_INVALID/);
});

function merchantBindingFixture() {
  const f=fixture();f.state.context={provider:"google_ads",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:1,
    accountId:"111",organizationId:null,apiVersion:"v25",merchant:{targetAccountId:"99",quotaAccountId:"98",apiVersion:"products/v1",bindingEpoch:1}};
  f.config.fetchFn=async address=>{f.state.calls++;return new Response(JSON.stringify(address.includes("oauth2")
    ?{access_token:"SYNTHETIC",token_type:"Bearer",expires_in:3600}:{results:[]}),{headers:{"content-type":"application/json"}});};
  const api=createRefreshQuotaClients(f.config).google({
    database:{query:async()=>({rows:[{connection_id:"22222222-2222-4222-8222-222222222222",credential_id:"33333333-3333-4333-8333-333333333333",
      granted_scopes:["https://www.googleapis.com/auth/adwords"],reporting_account_id:"111",accounts:[{id:"111",kind:"advertiser",reporting_eligible:true,login_account_id:null,currency:"USD",timezone:"UTC"}]}]})},
    tokenVault:{loadProviderTokenSet:async()=>({refresh_token:"SYNTHETIC"})},
    environment:{GOOGLE_ADS_OAUTH_CLIENT_ID:"client",GOOGLE_ADS_OAUTH_CLIENT_SECRET:"SYNTHETIC",GOOGLE_ADS_OAUTH_REDIRECT_URI:"https://embedded.adstable.app/auth/google-ads/callback"}});
  return {...f,run:()=>api.readEvidencePage({installationAuthority:{authority:"shopify_installation_verified",workspaceId:claim().workspaceId,installGeneration:1,status:"active"},
    queryFamily:"cart_data_product_sales_daily",dateWindow:{start:window.from,end:window.to}})};
}
test("background execution pins trusted Merchant target, quota pool and binding epoch even on an Ads/OAuth route",async()=>{
  for(const change of [m=>{m.targetAccountId="100";},m=>{m.quotaAccountId="97";},m=>{m.bindingEpoch++;}]) {
    const f=merchantBindingFixture();f.state.onReserve=async()=>{change(f.state.context.merchant);};
    await assert.rejects(f.run(),e=>quotaBoundaryControl(e)?.status==="not_sent");
    assert.equal(f.state.calls,0);assert.equal(f.state.stops,0);assert.equal(f.state.settles,1);
  }
});
test("equivalent Merchant context field ordering does not break execution pin",async()=>{
  const f=merchantBindingFixture();f.state.onReserve=async()=>{f.state.context.merchant=Object.fromEntries(Object.entries(f.state.context.merchant).reverse());};
  await f.run();assert.equal(f.state.calls,2);assert.equal(f.state.stops,0);
});
