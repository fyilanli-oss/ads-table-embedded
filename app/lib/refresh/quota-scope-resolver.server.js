import {createHash} from "node:crypto";

const families={shopify_partner:["partner_graphql"],shopify_admin:["identity_product","identity_variant","identity_product_variant"],meta:["insights","product_insights","token","token_debug","account_discovery","revoke",
  "identity_ad","identity_adset","identity_creative","identity_product_set","catalog_products"],
  google_ads:["reporting_query","token","revoke","account_discovery","merchant_products"],klaviyo:["metrics","events","account_discovery","campaign_values","flow_values","token","revoke"]};
const key=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const fields=(value,names)=>value&&typeof value==="object"&&!Array.isArray(value)
  &&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=()=>{throw new Error("QUOTA_SCOPE_NOT_CONFIGURED");};
const merchantId=value=>typeof value==="string"&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;

// Trusted INTERNAL server input only; structural validation is NOT an authority check.
// loadContext must read current verified connection/client bindings for this execution,
// never choose an account or client from the requested URL or merchant input.
export function quotaRouteIdentity(context,descriptor) {
  const hasMerchant=context?.provider==="google_ads"&&Object.hasOwn(context,"merchant");
  if(!fields(context,["provider","clientScopeKey","connectionScopeKey","connectionEpoch","accountId","organizationId","apiVersion",...(hasMerchant?["merchant"]:[])])
    ||!fields(descriptor,["provider","family","accountId","organizationId","version","includes"])
    ||!families[context.provider]?.includes(descriptor.family)||descriptor.provider!==context.provider
    ||!key(context.clientScopeKey)||!key(context.connectionScopeKey)||!Number.isSafeInteger(context.connectionEpoch)||context.connectionEpoch<1
    ||!Array.isArray(descriptor.includes)||descriptor.includes.length>16
    ||descriptor.includes.some(v=>typeof v!=="string"||!/^[a-z][a-z0-9_.-]{0,63}$/.test(v))
    ||new Set(descriptor.includes).size!==descriptor.includes.length) fail();
  if(hasMerchant&&(!fields(context.merchant,["targetAccountId","quotaAccountId","apiVersion","bindingEpoch"])
    ||!merchantId(context.merchant.targetAccountId)||!merchantId(context.merchant.quotaAccountId)
    ||context.merchant.apiVersion!=="products/v1"||!Number.isSafeInteger(context.merchant.bindingEpoch)||context.merchant.bindingEpoch<1)) fail();
  const merchantRoute=context.provider==="google_ads"&&descriptor.family==="merchant_products";
  if(merchantRoute&&(!hasMerchant||descriptor.accountId!==context.merchant.targetAccountId||descriptor.version!==context.merchant.apiVersion)) fail();
  if(context.provider==="shopify_partner") {
    if(context.accountId!==null||descriptor.accountId!==null||!/^[1-9][0-9]*$/.test(context.organizationId??"")||descriptor.organizationId!==context.organizationId
      ||!/^\d{4}-\d{2}$/.test(context.apiVersion??"")) fail();
  } else if(context.provider==="shopify_admin") {
    if(typeof context.accountId!=="string"||context.accountId.length>253
      ||!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(context.accountId)||descriptor.accountId!==context.accountId
      ||context.organizationId!==null||descriptor.organizationId!==null||!/^\d{4}-(01|04|07|10)$/.test(context.apiVersion??""))fail();
  } else {
    const pattern=context.provider==="meta"?/^act_[0-9]+$/:context.provider==="google_ads"?/^[0-9]+$/:/^[A-Za-z0-9_-]{1,256}$/;
    if(typeof context.accountId!=="string"||context.accountId.length>256||!pattern.test(context.accountId)
      ||context.organizationId!==null||descriptor.organizationId!==null
      ||(!merchantRoute&&descriptor.accountId!==null&&descriptor.accountId!==context.accountId)) fail();
    const versionPattern=context.provider==="meta"?/^v[0-9]+\.[0-9]+$/:context.provider==="google_ads"?/^v[0-9]+$/:/^\d{4}-\d{2}-\d{2}$/;
    if(!versionPattern.test(context.apiVersion??"")) fail();
  }
  if(!merchantRoute&&descriptor.version!==null&&descriptor.version!==context.apiVersion) fail();
  const accountOnPath=(context.provider==="meta"&&["insights","product_insights"].includes(descriptor.family))
    ||context.provider==="shopify_admin"||(context.provider==="google_ads"&&descriptor.family==="reporting_query");
  if(!merchantRoute&&(accountOnPath?descriptor.accountId!==context.accountId:descriptor.accountId!==null)) fail();
  const unversioned=["token","revoke"].includes(descriptor.family)&&context.provider!=="meta";
  if(!merchantRoute&&!unversioned&&descriptor.version!==context.apiVersion) fail();
  if(context.provider!=="klaviyo"&&descriptor.includes.length!==0) fail();
  const canonical=["quota_route_v1",context.provider,context.clientScopeKey,context.connectionScopeKey,context.connectionEpoch,
    context.accountId,context.organizationId,context.apiVersion,descriptor.family,[...descriptor.includes].sort(),
    ...(merchantRoute?[context.merchant.targetAccountId,context.merchant.quotaAccountId,context.merchant.apiVersion,context.merchant.bindingEpoch]:[])];
  return Object.freeze({routeKey:createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    connectionScopeKey:context.connectionScopeKey,provider:context.provider});
}

export function createQuotaScopeResolver({loadContext,store}) {
  if(typeof loadContext!=="function"||typeof store?.resolveRoute!=="function") throw new Error("QUOTA_SCOPE_INPUT_INVALID");
  return async descriptor=>{
    try {
      const metadata=structuredClone(descriptor);
      // Callback receives only the provider, not URL-derived account selection or request contents.
      const context=structuredClone(await loadContext({provider:metadata.provider}));
      const identity=quotaRouteIdentity(context,metadata);
      const operation=await store.resolveRoute(identity);
      if(!key(operation)||operation!==identity.routeKey) fail();
      return operation;
    } catch {fail();}
  };
}
