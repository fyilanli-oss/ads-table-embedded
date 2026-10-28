import {abstractFetch,setAbstractFetchFunc} from "@shopify/shopify-api/runtime";
import {createShopifyAdminIdentitySdkBridge,closeShopifyAdminIdentitySdkBridge} from "./shopify-admin-sdk-quota-bridge.server.js";

// Explicit startup for a dedicated background SDK host, after shopify-api/adapters/node.
// Import alone has no effect. No web/auth startup wiring, native fetch fallback or reset.
let bridge=null,closed=false;
const fail=code=>new Error(`SHOPIFY_ADMIN_SDK_BOOTSTRAP_${code}`);
function current(){
  if(!bridge)throw fail("NOT_INITIALIZED");
  if(closed)throw fail("CLOSED");
  if(abstractFetch!==bridge.fetch){closed=true;closeShopifyAdminIdentitySdkBridge(bridge);throw fail("HOOK_CHANGED");}
  return bridge;
}
export function initializeShopifyAdminRefreshSdk(...args){
  if(args.length)throw fail("INPUT_INVALID");
  if(bridge)return current();
  if(closed)throw fail("CLOSED");
  // Do not replace an absent adapter or another component's custom SDK transport.
  if(typeof globalThis.fetch!=="function"||abstractFetch!==globalThis.fetch)throw fail("NODE_ADAPTER_REQUIRED");
  const prepared=createShopifyAdminIdentitySdkBridge();
  setAbstractFetchFunc(prepared.fetch);bridge=prepared;
  return current();
}
export function getShopifyAdminRefreshSdkBridge(...args){
  if(args.length)throw fail("INPUT_INVALID");
  return current();
}
export function closeShopifyAdminRefreshSdk(...args){
  if(args.length)throw fail("INPUT_INVALID");
  if(closed)return;
  closed=true;if(bridge)closeShopifyAdminIdentitySdkBridge(bridge);
  // Deliberately leave the terminal hook installed; no unguarded transport restoration.
}
