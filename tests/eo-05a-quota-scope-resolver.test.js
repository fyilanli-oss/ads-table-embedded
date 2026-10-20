import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {createQuotaScopeResolver,quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {createScopeResolvedQuotaClients} from "../app/lib/providers/quota-managed-clients.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createQuotaManagedFetch,quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";

const context=(provider="google_ads")=>({provider,clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:1,
  accountId:provider==="shopify_partner"?null:provider==="meta"?"act_123":provider==="google_ads"?"123":"KLAVIYO1",
  organizationId:provider==="shopify_partner"?"123":null,apiVersion:provider==="shopify_partner"?"2026-07":provider==="meta"?"v26.0":provider==="google_ads"?"v24":"2026-10-15"});
const descriptor=(provider="google_ads")=>({provider,family:provider==="shopify_partner"?"partner_graphql":provider==="meta"?"insights":provider==="google_ads"?"reporting_query":"events",
  accountId:["meta","google_ads"].includes(provider)?context(provider).accountId:null,organizationId:context(provider).organizationId,version:context(provider).apiVersion,includes:[]});
test("canonical route binds client connection epoch account version family and include set, not lane or request content",()=>{
  const c=context(),d=descriptor(),original=quotaRouteIdentity(c,d);
  assert.match(original.routeKey,/^[a-f0-9]{64}$/);assert.equal(original.connectionScopeKey,c.connectionScopeKey);
  for(const patch of [{clientScopeKey:"c".repeat(64)},{connectionScopeKey:"d".repeat(64)},{connectionEpoch:2}]) assert.notEqual(quotaRouteIdentity({...c,...patch},d).routeKey,original.routeKey);
  assert.notEqual(quotaRouteIdentity(c,{...d,family:"account_discovery",accountId:null}).routeKey,original.routeKey);
  const k=context("klaviyo"),kd={...descriptor("klaviyo"),includes:["metric","attributions"]};
  assert.equal(quotaRouteIdentity(k,kd).routeKey,quotaRouteIdentity(k,{...kd,includes:[...kd.includes].reverse()}).routeKey);
  assert.notEqual(quotaRouteIdentity(k,kd).routeKey,quotaRouteIdentity(k,{...kd,includes:[]}).routeKey);
});
test("wrong provider account version organization duplicate include missing context or extra secret field fail before lookup",async()=>{
  for(const [c,d] of [[null,descriptor()],[context(),{...descriptor(),accountId:"999"}],[context(),{...descriptor(),accountId:null}],
    [context(),{...descriptor(),provider:"meta"}],[context(),{...descriptor(),version:"v23"}],
    [{...context(),access_token:"SECRET"},descriptor()],[context(),{...descriptor(),body:"SECRET"}],
    [context("shopify_partner"),{...descriptor("shopify_partner"),organizationId:"999"}],
    [context("klaviyo"),{...descriptor("klaviyo"),includes:["metric","metric"]}],
    [context(),{...descriptor(),family:"new_unknown_endpoint"}]]) {
    let lookups=0;const resolve=createQuotaScopeResolver({loadContext:async()=>c,store:{resolveRoute:async()=>{lookups++;return "c".repeat(64);}}});
    await assert.rejects(resolve(d),/^Error: QUOTA_SCOPE_NOT_CONFIGURED$/);assert.equal(lookups,0);
  }
});
test("authoritative context is loaded on EACH boundary and cannot be selected from URL-derived account input",async()=>{
  const c=context(),lookups=[],loads=[];
  const resolve=createQuotaScopeResolver({loadContext:async input=>{loads.push(input);return c;},store:{resolveRoute:async x=>{lookups.push(x);return x.routeKey;}}});
  await resolve(descriptor());c.connectionEpoch++;await resolve(descriptor());
  assert.deepEqual(loads,[{provider:"google_ads"},{provider:"google_ads"}]);assert.notEqual(lookups[0].routeKey,lookups[1].routeKey);
  assert.deepEqual(Object.keys(lookups[0]).sort(),["connectionScopeKey","provider","routeKey"]);
});
test("OAuth without URL account still binds verified connection account and client rather than token or request body",()=>{
  for(const provider of ["google_ads","klaviyo"]) {
    const c=context(provider),d={...descriptor(provider),family:"token",accountId:null,version:null};
    const first=quotaRouteIdentity(c,d);
    assert.notEqual(quotaRouteIdentity({...c,accountId:provider==="google_ads"?"999":"OTHER"},d).routeKey,first.routeKey);
  }
});
test("Klaviyo API revision is inspected without exposing headers or tokens; missing revision cannot route",async()=>{
  let calls=0;const c=context("klaviyo");
  const resolve=createQuotaScopeResolver({loadContext:async()=>c,store:{resolveRoute:async x=>x.routeKey}});
  const fetch=createQuotaManagedFetch({provider:"klaviyo",lane:"background",resolveOperation:resolve,
    guard:{execute:async({run})=>({status:"returned",value:(await run()).value})},fetchFn:async()=>{calls++;return new Response("{}");}});
  await assert.rejects(fetch("https://a.klaviyo.com/api/events"),e=>quotaBoundaryControl(e)?.status==="not_configured");
  assert.equal(calls,0);await fetch("https://a.klaviyo.com/api/events",{headers:{revision:"2026-10-15",authorization:"Bearer SECRET"}});assert.equal(calls,1);
});
test("scope-resolved native factory uses the SAME store for resolution and debit and forbids alternate guard or resolver",async()=>{
  let lookups=0,reserves=0,calls=0;const c=context("shopify_partner");
  const store={resolveRoute:async identity=>{lookups++;assert.equal(identity.connectionScopeKey,c.connectionScopeKey);return identity.routeKey;},
    reserve:async input=>{reserves++;return {...input,status:"reserved",dispatchBeforeMs:100,dispatchBudgetMs:1000};},settle:async()=>true,stop:async()=>true};
  const config={store,now:()=>0,loadContext:async()=>c,lane:"background",fetchFn:async()=>{calls++;return new Response('{"data":{"activeSubscription":null}}',{headers:{"content-type":"application/json"}});}};
  const client=createScopeResolvedQuotaClients(config).shopify({environment:{SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"SYNTHETIC"}});
  await client.activeSubscription({apiVersion:"2026-07",query:"query { activeSubscription { id } }",variables:{}});
  assert.equal(lookups,2);assert.equal(reserves,1);assert.equal(calls,1);
  for(const override of [{guard:{}},{resolveOperation:async()=>"a".repeat(64)}]) assert.throws(()=>createScopeResolvedQuotaClients({...config,...override}),/OVERRIDE_FORBIDDEN/);
  c.organizationId="999";await assert.rejects(client.activeSubscription({apiVersion:"2026-07",query:"q",variables:{}}));assert.equal(calls,1);
});
test("missing mapping and store errors never authorize a call or leak underlying details",async()=>{
  for(const lookup of [async()=>null,async()=>"a".repeat(64),async()=>({operationKey:"a".repeat(64)}),async()=>{throw Error("SECRET DATABASE");}]) {
    const resolve=createQuotaScopeResolver({loadContext:async()=>context(),store:{resolveRoute:lookup}});
    await assert.rejects(resolve(descriptor()),/^Error: QUOTA_SCOPE_NOT_CONFIGURED$/);
  }
  const queries=[],store=createSharedQuotaRepository({query:async(sql,args)=>{queries.push({sql,args});return {rows:[{result:null}]};}});
  const identity=quotaRouteIdentity(context(),descriptor());assert.equal(await store.resolveRoute(identity),null);
  assert.deepEqual(queries[0].args,[identity.routeKey,identity.connectionScopeKey,identity.provider]);
  assert.match(queries[0].sql,/resolve_shared_api_quota_route/);
  await assert.rejects(store.resolveRoute({routeKey:randomUUID(),connectionScopeKey:"a".repeat(64),provider:"google_ads"}),/INPUT_INVALID/);
});
test("profile gate checks all bindings and limits again at reservation without activating configuration",()=>{
  const c=JSON.parse(readFileSync(new URL("../contracts/eo-05a-quota-scope-resolver-v1.json",import.meta.url),"utf8"));
  const sql=readFileSync(new URL(`../${c.migration}`,import.meta.url),"utf8");
  assert.match(sql,/if op.route_required then/);assert.match(sql,/API_QUOTA_ROUTE_CHANGED/);assert.match(sql,/force row level security/);
  assert.match(sql,/q.max_units::text/);assert.match(sql,/b.units::text/);assert.match(sql,/p.domain_id=p_domain and op.provider=p_provider/);
  for(const k of ["live_activation","live_apply_authorized","native_configuration_inserted","Dataset_write","hourly_data_scope_selected","listing_tree_resumed"])assert.equal(c[k],false);
});
