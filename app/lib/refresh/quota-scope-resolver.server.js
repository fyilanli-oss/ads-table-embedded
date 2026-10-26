import {createHash} from "node:crypto";

const families={shopify_partner:["partner_graphql"],meta:["insights","product_insights","token","token_debug","account_discovery","revoke"],
  google_ads:["reporting_query","token","revoke","account_discovery"],klaviyo:["metrics","events","event_detail","account_discovery","campaign_values","flow_values","token","revoke"]};
const key=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const fields=(value,names)=>value&&typeof value==="object"&&!Array.isArray(value)
  &&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const fail=()=>{throw new Error("QUOTA_SCOPE_NOT_CONFIGURED");};

// Trusted INTERNAL server input only; structural validation is NOT an authority check.
// loadContext must read current verified connection/client bindings for this execution,
// never choose an account or client from the requested URL or merchant input.
export function quotaRouteIdentity(context,descriptor) {
  if(!fields(context,["provider","clientScopeKey","connectionScopeKey","connectionEpoch","accountId","organizationId","apiVersion"])
    ||!fields(descriptor,["provider","family","accountId","organizationId","version","includes"])
    ||!families[context.provider]?.includes(descriptor.family)||descriptor.provider!==context.provider
    ||!key(context.clientScopeKey)||!key(context.connectionScopeKey)||!Number.isSafeInteger(context.connectionEpoch)||context.connectionEpoch<1
    ||!Array.isArray(descriptor.includes)||descriptor.includes.length>16
    ||descriptor.includes.some(v=>typeof v!=="string"||!/^[a-z][a-z0-9_.-]{0,63}$/.test(v))
    ||new Set(descriptor.includes).size!==descriptor.includes.length) fail();
  if(context.provider==="shopify_partner") {
    if(context.accountId!==null||descriptor.accountId!==null||!/^[1-9][0-9]*$/.test(context.organizationId??"")||descriptor.organizationId!==context.organizationId
      ||!/^\d{4}-\d{2}$/.test(context.apiVersion??"")) fail();
  } else {
    const pattern=context.provider==="meta"?/^act_[0-9]+$/:context.provider==="google_ads"?/^[0-9]+$/:/^[A-Za-z0-9_-]{1,256}$/;
    if(typeof context.accountId!=="string"||context.accountId.length>256||!pattern.test(context.accountId)
      ||context.organizationId!==null||descriptor.organizationId!==null
      ||(descriptor.accountId!==null&&descriptor.accountId!==context.accountId)) fail();
    const versionPattern=context.provider==="meta"?/^v[0-9]+\.[0-9]+$/:context.provider==="google_ads"?/^v[0-9]+$/:/^\d{4}-\d{2}-\d{2}$/;
    if(!versionPattern.test(context.apiVersion??"")) fail();
  }
  if(descriptor.version!==null&&descriptor.version!==context.apiVersion) fail();
  const accountOnPath=(context.provider==="meta"&&["insights","product_insights"].includes(descriptor.family))
    ||(context.provider==="google_ads"&&descriptor.family==="reporting_query");
  if(accountOnPath?descriptor.accountId!==context.accountId:descriptor.accountId!==null) fail();
  const unversioned=["token","revoke"].includes(descriptor.family)&&context.provider!=="meta";
  if(!unversioned&&descriptor.version!==context.apiVersion) fail();
  if(context.provider!=="klaviyo"&&descriptor.includes.length!==0) fail();
  const canonical=["quota_route_v1",context.provider,context.clientScopeKey,context.connectionScopeKey,context.connectionEpoch,
    context.accountId,context.organizationId,context.apiVersion,descriptor.family,[...descriptor.includes].sort()];
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
