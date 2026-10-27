import {createScopeResolvedQuotaClients} from "../providers/quota-managed-clients.server.js";
import {refreshWorkIdentity} from "./work-stop-policy.server.js";
import {createQuotaScopeResolver} from "./quota-scope-resolver.server.js";
import {createSharedQuotaGuard} from "./shared-quota.server.js";
import {createQuotaManagedFetch} from "./quota-native-fetch.server.js";
import {collectKlaviyoNativeIdentityEvidence, collectKlaviyoIdentityMessageEvidence} from "../providers/klaviyo-identity-collection.server.js";
import {klaviyoBusinessDayTimeframe} from "../providers/klaviyo-reporting.server.js";

// Explicit background-only composition. SQL supplies current authority and owner scope handles.
// No caller account/context loader override; never a setup OAuth or interactive authority shortcut.
function refreshQuotaOptions({workStore,quotaStore,claim,window,entitlementReceipt,now,fetchFn,...extra} = {}) {
  if(Object.keys(extra).length||typeof workStore?.loadQuotaContext!=="function") throw Error("REFRESH_QUOTA_BINDING_INPUT_INVALID");
  refreshWorkIdentity(claim,{claimRequired:true});
  if(![window?.from,window?.to].every(v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v))||window.from>window.to) throw Error("REFRESH_QUOTA_BINDING_INPUT_INVALID");
  const execution=structuredClone({claim,window,entitlementReceipt});
  const pinned=new Map();
  return {store:quotaStore,now,lane:"background",fetchFn,
    loadContext:async({provider})=>{
      if(provider!=="shopify_partner"&&provider!==execution.claim.provider) return null;
      const context=await workStore.loadQuotaContext({...structuredClone(execution),provider});
      if(!context) return null;
      const identity=JSON.stringify([context.provider,context.clientScopeKey,context.connectionScopeKey,context.connectionEpoch,
        context.accountId,context.organizationId,context.apiVersion,context.merchant
          ?[context.merchant.targetAccountId,context.merchant.quotaAccountId,context.merchant.apiVersion,context.merchant.bindingEpoch]:null]);
      if(pinned.has(provider)&&pinned.get(provider)!==identity) return null;
      pinned.set(provider,identity);
      return context;
    }};
}

export function createRefreshQuotaClients(options) {
  return createScopeResolvedQuotaClients(refreshQuotaOptions(options));
}

// Inactive background constructor. Existing SQL rechecks fenced claim/window/entitlement
// and approved quota inventory at each boundary. No caller resolver/guard/account override.
export function createRefreshKlaviyoIdentityReader({verified,database,tokenVault,mode,signal,
  readNow=()=>new Date(),maxElapsedMs,maxPages,maxEvents,maxMetrics,maxIncluded,maxMessageRows,...quotaOptions} = {}) {
  const claim=structuredClone(quotaOptions.claim),window=structuredClone(quotaOptions.window);
  const owner=structuredClone(verified?.installationAuthority),shop=structuredClone(verified?.identity?.shop);
  if(!["native","message"].includes(mode)||claim?.provider!=="klaviyo"||typeof window?.from!=="string"||window.from!==window.to
    ||owner?.authority!=="shopify_installation_verified"||owner.status!=="active"||owner.workspaceId!==claim.workspaceId
    ||String(owner.installGeneration)!==claim.installGeneration||typeof verified?.context?.admin?.graphql!=="function"
    ||typeof readNow!=="function"||typeof quotaOptions.entitlementReceipt?.observedAt!=="string"
    ||!Number.isFinite(Date.parse(quotaOptions.entitlementReceipt.observedAt))) throw Error("REFRESH_KLAVIYO_IDENTITY_INPUT_INVALID");
  klaviyoBusinessDayTimeframe({businessDate:window.from,timeZone:"UTC"});
  const caller={installationAuthority:owner,identity:{shop,session:{authority:verified.identity?.session?.authority,
    shopDomain:verified.identity?.session?.shopDomain}},context:{admin:{graphql:verified.context.admin.graphql.bind(verified.context.admin)}}};
  const binding=refreshQuotaOptions(quotaOptions);
  const resolve=createQuotaScopeResolver({store:binding.store,loadContext:async input=>{
    if(input.provider!=="klaviyo") return null;
    const context=await binding.loadContext(input);
    return context?.provider==="klaviyo"&&context.accountId===claim.accountId?context:null;
  }});
  const transport=createQuotaManagedFetch({provider:"klaviyo",lane:"background",fetchFn:binding.fetchFn,
    guard:createSharedQuotaGuard({store:binding.store,now:binding.now}),resolveOperation:resolve,
    isDispatchCurrent:async(metadata,key)=>await resolve(metadata)===key});
  const collect=mode==="native"?collectKlaviyoNativeIdentityEvidence:collectKlaviyoIdentityMessageEvidence;
  const options={verified:caller,database,tokenVault,businessDate:window.from,fetchFn:transport,signal,now:readNow,
    maxElapsedMs,maxPages,maxEvents,maxMetrics,maxIncluded,maxMessageRows};
  let used=false;
  return Object.freeze({async readEvidence(...args){
    if(args.length) throw Error("REFRESH_KLAVIYO_IDENTITY_OVERRIDE_FORBIDDEN");
    if(used) throw Error("REFRESH_KLAVIYO_IDENTITY_EXECUTION_USED");
    used=true; return collect(options);
  }});
}
