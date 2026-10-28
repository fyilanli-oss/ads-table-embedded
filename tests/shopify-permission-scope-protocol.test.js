import test from "node:test";
import assert from "node:assert/strict";
import {SHOPIFY_PERMISSION_SCOPES_QUERY as query,shopifyPermissionScopeFamily as family,
  parseShopifyPermissionScopePage as parse,ShopifyPermissionScopeProtocolError} from "../app/lib/shopify/permission-scope-protocol.server.js";
const shop={id:"gid://shopify/Shop/12",myshopifyDomain:"test.myshopify.com"};
const body=()=>({data:{shop:{...shop},currentAppInstallation:{id:"gid://shopify/AppInstallation/9",
  accessScopes:[{handle:"read_products"},{handle:"read_orders"}]}},extensions:{ignored:"not copied"}});
for(const request of [{query},{query,variables:{}}])test(`exact native scope request classified ${Object.keys(request)}`,()=>{
  assert.equal(family(JSON.stringify(request)),"permission_scopes");
});
for(const request of [{query,variables:null},{query,variables:[]},{query,variables:{first:1}},{query,operationName:"AdsTablePermissionScopes"},
  {query:query+" "},{query:query.replace("accessScopes","other: accessScopes")},{query:"mutation {anything}"},[]])test(`unapproved request rejected ${JSON.stringify(request)}`,()=>{
  assert.equal(family(JSON.stringify(request)),null);
});
for(const raw of ["",null,42,"{",`{"query":${JSON.stringify(query)},"query":${JSON.stringify(query)}}`,JSON.stringify({query},null,2)," ".repeat(65537)])
  test(`noncanonical scope envelope rejected ${typeof raw}/${String(raw).length}`,()=>assert.equal(family(raw),null));
test("scope observation captures only immutable native installation and handles without granting access",()=>{
  const input=body(),result=parse({shop,body:input});input.data.currentAppInstallation.accessScopes[0].handle="changed";
  assert.deepEqual(result,{appInstallationId:"gid://shopify/AppInstallation/9",scopes:["read_products","read_orders"]});
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.scopes));assert.doesNotMatch(JSON.stringify(result),/not copied|authority|verified/);
});
const changes={
  noData:b=>delete b.data,partial:b=>{b.errors=[{message:"SECRET"}];},badErrors:b=>{b.errors={message:"SECRET"};},
  noShop:b=>delete b.data.shop,otherShop:b=>{b.data.shop.id="gid://shopify/Shop/13";},otherDomain:b=>{b.data.shop.myshopifyDomain="other.myshopify.com";},
  noApp:b=>{b.data.currentAppInstallation=null;},badId:b=>{b.data.currentAppInstallation.id="gid://shopify/Shop/9";},
  overflow:b=>{b.data.currentAppInstallation.id="gid://shopify/AppInstallation/18446744073709551616";},
  missingScopes:b=>delete b.data.currentAppInstallation.accessScopes,
  duplicate:b=>{b.data.currentAppInstallation.accessScopes=[{handle:"read_orders"},{handle:"read_orders"}];},
  badHandle:b=>{b.data.currentAppInstallation.accessScopes=[{handle:"READ_ORDERS"}];},nullHandle:b=>{b.data.currentAppInstallation.accessScopes=[null];},
  tooMany:b=>{b.data.currentAppInstallation.accessScopes=Array.from({length:101},(_,i)=>({handle:`read_${i}`}));}
};
for(const [name,change] of Object.entries(changes))test(`unsafe native scope response stops: ${name}`,()=>{
  const input=body();change(input);assert.throws(()=>parse({shop,body:input}),e=>e instanceof ShopifyPermissionScopeProtocolError&&!e.message.includes("SECRET"));
});
test("empty grants are observable missing access rather than malformed response",()=>{
  const input=body();input.data.currentAppInstallation.accessScopes=[];assert.deepEqual(parse({shop,body:input}).scopes,[]);
});
test("an absent expected shop cannot validate an absent returned shop",()=>{
  const input=body();delete input.data.shop;assert.throws(()=>parse({body:input}),/SHOP_MISMATCH/);
});
