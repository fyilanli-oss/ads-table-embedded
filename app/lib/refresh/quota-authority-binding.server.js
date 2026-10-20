import {createScopeResolvedQuotaClients} from "../providers/quota-managed-clients.server.js";
import {refreshWorkIdentity} from "./work-stop-policy.server.js";

// Explicit background-only composition. SQL supplies current authority and owner scope handles.
// No caller account/context loader override; never a setup OAuth or interactive authority shortcut.
export function createRefreshQuotaClients({workStore,quotaStore,claim,window,entitlementReceipt,now,fetchFn,...extra}) {
  if(Object.keys(extra).length||typeof workStore?.loadQuotaContext!=="function") throw Error("REFRESH_QUOTA_BINDING_INPUT_INVALID");
  refreshWorkIdentity(claim,{claimRequired:true});
  if(![window?.from,window?.to].every(v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v))||window.from>window.to) throw Error("REFRESH_QUOTA_BINDING_INPUT_INVALID");
  const execution=structuredClone({claim,window,entitlementReceipt});
  const pinned=new Map();
  return createScopeResolvedQuotaClients({store:quotaStore,now,lane:"background",fetchFn,
    loadContext:async({provider})=>{
      if(provider!=="shopify_partner"&&provider!==execution.claim.provider) return null;
      const context=await workStore.loadQuotaContext({...structuredClone(execution),provider});
      if(!context) return null;
      const identity=JSON.stringify([context.provider,context.clientScopeKey,context.connectionScopeKey,context.connectionEpoch,
        context.accountId,context.organizationId,context.apiVersion]);
      if(pinned.has(provider)&&pinned.get(provider)!==identity) return null;
      pinned.set(provider,identity);
      return context;
    }});
}
