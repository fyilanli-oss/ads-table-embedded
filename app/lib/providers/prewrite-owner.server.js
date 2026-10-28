import {permissionContext} from "../oauth/identity-permission-preflight.server.js";

export function sqlIdentityKey(value){
  return typeof value==="string"&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
}
export function providerPrewriteOwner(value){
  if(!value||Object.keys(value).sort().join(",")!=="accountId,connectionId,connectionVersion,installGeneration,installationId,provider,reportingSelectionEpoch,shopDomain,shopId,workspaceId"
    ||!["meta","google_ads","klaviyo"].includes(value.provider)||!sqlIdentityKey(value.installationId)
    ||!Number.isSafeInteger(value.connectionVersion)||value.connectionVersion<1
    ||(value.provider==="klaviyo"?value.reportingSelectionEpoch!==null:!sqlIdentityKey(value.reportingSelectionEpoch)))throw Error("PREWRITE_OWNER_INVALID");
  return Object.freeze({...permissionContext(value),installationId:value.installationId,
    reportingSelectionEpoch:value.reportingSelectionEpoch,connectionVersion:value.connectionVersion});
}
export function shopifyPrewriteOwner(value){
  if(!value||Object.keys(value).sort().join(",")!=="installGeneration,installationId,shopDomain,shopId,workspaceId"
    ||!sqlIdentityKey(value.installationId))throw Error("PREWRITE_OWNER_INVALID");
  return Object.freeze({...permissionContext({provider:"shopify",...value}),installationId:value.installationId});
}
