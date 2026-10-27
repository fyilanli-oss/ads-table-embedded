import {AsyncLocalStorage} from "node:async_hooks";
import {isQuotaManagedFetchForProvider} from "./quota-native-fetch.server.js";
import {shopifyAdminIdentityFamily} from "./shopify-admin-identity-quota.server.js";
import {IdentityReadDeadlineError,runIdentityReadDeadline} from "../providers/identity-read-deadline.server.js";
const wrappedClients=new WeakSet();

// Inactive SDK hook. Explicit bootstrap installation is a separate gate; no global setter,
// fallback fetch, token/session loader, config change or authority inference here.
export function createShopifyAdminIdentitySdkBridge() {
  const context=new AsyncLocalStorage();
  const fail=code=>new Error(`SHOPIFY_ADMIN_SDK_${code}`);
  async function fetch(input,init) {
    const call=context.getStore();
    if(!call)throw fail("UNBOUND_HTTP");
    if(call.closed||call.signal.aborted||call.failure)throw call.failure??fail("EXECUTION_CLOSED");
    if(call.requests++!==0) {call.failure=fail("EXTRA_HTTP_FORBIDDEN");throw call.failure;}
    try {
      const response=await call.transport(input,{...init,signal:call.signal});
      if(call.closed||call.signal.aborted)throw fail("EXECUTION_CLOSED");
      // Quota stop was already persisted. Do not hand native 401/403 to SDK auth recovery.
      if(!response?.ok)throw fail("NATIVE_REQUEST_FAILED");
      return response;
    } catch(error) {call.failure=error;throw error;}
  }
  function wrap({admin,transport,signal,timeoutMs=120000,...extra}={}) {
    if(Object.keys(extra).length||typeof admin?.graphql!=="function"||wrappedClients.has(admin)||!isQuotaManagedFetchForProvider(transport,"shopify_admin")
      ||signal!==undefined&&!(signal instanceof AbortSignal)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw fail("INPUT_INVALID");
    const graphql=admin.graphql.bind(admin);
    let busy=false,failed=false;
    const client=Object.freeze({async graphql(query,options={}) {
      if(busy)throw fail("CONCURRENT_CALL_FORBIDDEN");
      if(failed)throw fail("EXECUTION_CLOSED");
      let variables,external;
      try {
        if(!options||typeof options!=="object"||Object.keys(options).some(k=>!["variables","tries","signal"].includes(k))
          ||options.tries!==undefined&&options.tries!==1||options.signal!==undefined&&!(options.signal instanceof AbortSignal))throw Error();
        variables=structuredClone(options.variables);
        if(!shopifyAdminIdentityFamily(JSON.stringify({query,variables})))throw Error();
        const signals=[signal,options.signal].filter(Boolean);external=signals.length?AbortSignal.any(signals):undefined;
      } catch {throw fail("INPUT_INVALID");}
      busy=true;let call;
      try {
        return await runIdentityReadDeadline({signal:external,timeoutMs,run:child=>{
          call={transport,signal:child,requests:0,closed:false,failure:null};
          return context.run(call,async()=>{
            const response=await graphql(query,{variables,tries:1,signal:child});
            if(call.failure)throw call.failure;
            if(call.requests!==1) {call.failure=fail("BOUNDARY_NOT_OBSERVED");throw call.failure;}
            if(!response?.ok||typeof response.json!=="function") {call.failure=fail("RESPONSE_INVALID");throw call.failure;}
            return response;
          });
        }});
      } catch(error) {
        failed=true;
        if(error instanceof IdentityReadDeadlineError)throw error;
        throw call?.failure??fail("REQUEST_FAILED");
      } finally {busy=false;if(call)call.closed=true;}
    }});
    wrappedClients.add(client);return client;
  }
  return Object.freeze({fetch,wrap});
}
