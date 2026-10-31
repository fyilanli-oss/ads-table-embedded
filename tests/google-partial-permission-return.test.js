import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import test from "node:test";
import ts from "typescript";
import {installedShopifySettingsUrl} from "../app/lib/shopify/installed-app-return.server.js";

function loadRoute(file,overrides){
  const location=new URL(`../app/routes/${file}`,import.meta.url),require=createRequire(location),exports={};
  const compiled=ts.transpileModule(readFileSync(location,"utf8"),{compilerOptions:{
    jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  new Function("require","exports",compiled)(id=>Object.hasOwn(overrides,id)?overrides[id]:require(id),exports);
  return exports;
}
const nodes=e=>!e||typeof e!=="object"?[]:Array.isArray(e)?e.flatMap(nodes):[e,...nodes(e.props?.children)];
const text=e=>Array.isArray(e)?e.map(text).join(""):e&&typeof e==="object"?text(e.props?.children)
  :e==null||typeof e==="boolean"?"":String(e);
const shop="synthetic-store.myshopify.com";
const require=createRequire(import.meta.url);

function harness({outcome="pending_permissions",inspect={state:"disconnected"},error=null,enabled=true}={}){
  const h={calls:[],logs:[],opened:[],state:null};
  const runtime={oauthBoundary:{claimCallback:async()=>{h.calls.push("claim");return{workspaceId:"synthetic",installGeneration:1};}},
    callbackReturn:async()=>({shopDomain:shop}),completeCallback:async()=>{
      h.calls.push("complete");if(error)throw error;return{outcome};
    },inspect:async()=>{h.calls.push("inspect");return inspect;}};
  const server={authenticate:{admin:async()=>assert.fail("authority resolver owns authentication")},database:{},providerTokenVault:{},permissionSetup:{},
    permissionRelease:{availability:{google_ads:enabled,meta:false,klaviyo:false,shopify_products:false,shopify_orders:false}}};
  const logger=require("../app/lib/server-error-log.server.js");
  const callback=loadRoute("auth.google-ads.callback.ts",{
    "../shopify.server":server,
    "../lib/oauth/google-oauth-runtime.server.js":{createGoogleOAuthRuntime:()=>runtime},
    "../lib/server-error-log.server.js":{logPermissionFailure:args=>{
      const saved=console.error;console.error=line=>h.logs.push(JSON.parse(line));
      try{logger.logPermissionFailure(args);}finally{console.error=saved;}
    }},
  });
  const verified={installationAuthority:{workspaceId:"synthetic",installGeneration:1},identity:{shop:{shopId:"synthetic"}}};
  const permissions={busy:false,content:null,providerContent:()=>null,open:feature=>h.opened.push(feature)};
  const react=require("react");
  const settings=loadRoute("_admin.settings.tsx",{
    "../shopify.server":server,
    "../lib/oauth/google-oauth-runtime.server.js":{createGoogleOAuthRuntime:()=>runtime},
    "../lib/oauth/meta-oauth-runtime.server.js":{createMetaOAuthRuntime:()=>({inspect:async()=>({state:"disconnected"})})},
    "../lib/oauth/klaviyo-oauth-runtime.server.js":{createKlaviyoOAuthRuntime:()=>({inspect:async()=>({state:"disconnected"})})},
    "../lib/shopify/shopify-route-authority.server.js":{resolveShopifyRouteAuthority:async()=>verified},
    "../lib/shopify/product-permission-status.server.js":{readShopifyPermissionStatuses:async()=>({products:"missing",orders:"missing"})},
    "../components/use-permission-settings":{usePermissionSettings:()=>permissions},
    "../components/product-access-removal":{ProductAccessRemoval:"ProductAccessRemoval"},
    "../components/order-access-removal":{OrderAccessRemoval:"OrderAccessRemoval"},
    react:{...react,useRef:value=>({current:value}),useState:value=>[typeof value==="function"?value():value,()=>{}],useEffect:()=>{}},
    "react-router":{useLoaderData:()=>h.state,useActionData:()=>undefined,useNavigation:()=>({state:"idle"}),
      useRevalidator:()=>({state:"idle",revalidate:()=>assert.fail("automatic revalidation")}),
      useFetcher:()=>({state:"idle",data:undefined,submit:()=>assert.fail("automatic request")}),
      useSubmit:()=>()=>assert.fail("automatic submission")},
  });
  h.return=()=>callback.loader({request:new Request("https://embedded.adstable.app/auth/google-ads/callback?state=synthetic&code=synthetic")});
  h.load=async target=>h.state=await settings.loader({request:new Request(target)});
  h.render=()=>{h.tree=settings.default();return h.tree;};
  return h;
}

test("actual Google callback → Settings loader → card keeps partial permission resumable without automatic OAuth",async()=>{
  const h=harness(),response=await h.return(),target=response.headers.get("location");
  assert.equal(response.status,302);assert.equal(response.headers.get("cache-control"),"no-store");
  assert.equal(new URL(target).searchParams.get("google_status"),"permissions_incomplete");
  assert.equal(new URL(target).pathname,"/store/synthetic-store/apps/adstable-1/settings");
  await h.load(target);assert.equal(h.state.view,"permissions_incomplete");h.render();
  const section=nodes(h.tree).find(e=>e.type==="s-section"&&e.props.heading==="Google Ads");
  assert.ok(nodes(section).some(e=>e.type==="s-banner"&&e.props.tone==="warning"&&e.props.heading==="Google setup is incomplete"));
  assert.match(text(section),/Both Google Ads and Merchant Center access are required/);
  for(const other of nodes(h.tree).filter(e=>e.type==="s-section"&&e!==section))assert.doesNotMatch(text(other),/Both Google Ads and Merchant Center/);
  assert.deepEqual(h.opened,[]);assert.deepEqual(h.calls,["claim","complete","inspect"]);
  const button=nodes(section).find(e=>e.type==="s-button"&&text(e)==="Resume setup");
  assert.ok(button);assert.equal(button.props.disabled,undefined);
  button.props.onClick();assert.deepEqual(h.opened,["google_ads"]);assert.deepEqual(h.calls,["claim","complete","inspect"]);
  await h.load(target);assert.equal(h.state.view,"permissions_incomplete","reload preserves explanation");
  assert.deepEqual(h.logs,[{event:"adstable_permission_error",code:"OAUTH_IDENTITY_SCOPE_NOT_GRANTED",feature:"google_ads",intent:"permission_callback",requestId:null}]);
});

for(const [outcome,status] of [["denied","cancelled"],["pending_account_selection","pending"],["reporting_account_selected","pending"]]){
  test(`Google ${outcome} keeps its existing callback result`,async()=>{
    const h=harness({outcome}),r=await h.return();assert.equal(new URL(r.headers.get("location")).searchParams.get("google_status"),status);
    assert.equal(h.logs.length,0);await h.load(r.headers.get("location"));
    assert.notEqual(h.state.view,"permissions_incomplete");
    if(outcome==="denied")assert.equal(h.state.notice,"cancelled");
  });
}

for(const inspect of [
  {state:"connected",connection:{accounts:[{id:"1",name:"Synthetic"}],reportingAccountId:"1"}},
  {state:"pending_account_selection",pending:{scopes:["https://www.googleapis.com/auth/content"]},accounts:[]},
  {state:"pending_reporting_account_selection",accounts:[]},
])test(`server-read ${inspect.state} overrides an old incomplete return hint`,async()=>{
  const h=harness({inspect});await h.load(installedShopifySettingsUrl(shop,{googleStatus:"permissions_incomplete"}));
  assert.notEqual(h.state.view,"permissions_incomplete");assert.deepEqual(h.opened,[]);
});

test("general Google callback error is safely classified and never mislabeled as missing permissions",async()=>{
  const error=Object.assign(new Error("raw SECRET"),{code:"GOOGLE_ADS_OAUTH_TOKEN_EXCHANGE_FAILED",detail:"SECRET",cause:{token:"SECRET"}});
  const h=harness({error}),r=await h.return();await h.load(r.headers.get("location"));
  assert.equal(h.state.view,"error");assert.equal(h.logs[0].code,"GOOGLE_ADS_OAUTH_TOKEN_EXCHANGE_FAILED");
  assert.equal(h.logs[0].intent,"permission_callback");assert.doesNotMatch(JSON.stringify(h.logs),/SECRET/);
  assert.deepEqual(h.calls,["claim","complete","inspect"]);assert.deepEqual(h.opened,[]);
});

test("incomplete return hint never grants connection authority or enables a closed Google setup",async()=>{
  const h=harness({enabled:false});await h.load(installedShopifySettingsUrl(shop,{googleStatus:"permissions_incomplete"}));h.render();
  assert.equal(h.state.view,"permissions_incomplete");
  const section=nodes(h.tree).find(e=>e.type==="s-section"&&e.props.heading==="Google Ads");
  assert.equal(nodes(section).find(e=>e.type==="s-button"&&text(e)==="Resume setup").props.disabled,true);
  assert.deepEqual(h.opened,[]);assert.deepEqual(h.calls,["inspect"]);
  for(const feature of ["metaStatus","klaviyoStatus"])assert.throws(()=>installedShopifySettingsUrl(shop,{[feature]:"permissions_incomplete"}),/STATUS_INVALID/);
});
