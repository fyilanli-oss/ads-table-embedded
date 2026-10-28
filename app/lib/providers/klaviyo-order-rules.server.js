import {permissionContext} from "../oauth/identity-permission-preflight.server.js";
import {stableJson} from "./common-adapter.server.js";

const loaders=new WeakSet();
const text=v=>typeof v==="string"&&v.length>0&&v.length<=2048&&v===v.trim()&&!/[\u0000-\u0020\u007f]/.test(v);
const fail=()=>{throw Error("KLAVIYO_ORDER_IDENTITY_RULE_INVALID");};
function scopeOf(input){
  if(!input||Object.keys(input).sort().join(",")!=="accountId,connectionId,connectionVersion,installGeneration,provider,shopDomain,shopId,workspaceId"
    ||input.provider!=="klaviyo"||!Number.isSafeInteger(input.connectionVersion)||input.connectionVersion<1)fail();
  try{return Object.freeze({...permissionContext(input),connectionVersion:input.connectionVersion});}catch{fail();}
}
const keyOf=({scope,metricId,integrationId})=>stableJson([scopeOf(scope),metricId,integrationId]);

// Reviewed server registry only. No production source rule or default ID format.
export function createKlaviyoOrderIdentityRuleLoader({rules=[]}={}){
  if(!Array.isArray(rules)||rules.length>10000)fail();
  const registry=new Map();
  for(const input of rules){
    const r=structuredClone(input);
    if(!r||Object.keys(r).sort().join(",")!=="format,integration_id,metric_id,property,scope,source_reference,state"
      ||r.state!=="verified_order_identity_rule"||r.property!=="OrderId"
      ||!["Shopify_Order_GID","Shopify_Order_legacy_ID"].includes(r.format)
      ||![r.metric_id,r.integration_id,r.source_reference].every(text))fail();
    r.scope=scopeOf(r.scope);const key=keyOf({scope:r.scope,metricId:r.metric_id,integrationId:r.integration_id});
    if(registry.has(key))throw Error("KLAVIYO_ORDER_IDENTITY_RULE_CONFLICT");
    registry.set(key,Object.freeze(r));
  }
  const loader=Object.freeze({load(query){return registry.get(keyOf(query))??null;}});loaders.add(loader);return loader;
}
export const isKlaviyoOrderIdentityRuleLoader=value=>loaders.has(value);
