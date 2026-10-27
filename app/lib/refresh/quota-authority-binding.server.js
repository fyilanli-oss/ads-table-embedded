import {createScopeResolvedQuotaClients} from "../providers/quota-managed-clients.server.js";
import {refreshWorkIdentity} from "./work-stop-policy.server.js";
import {createQuotaScopeResolver} from "./quota-scope-resolver.server.js";
import {createSharedQuotaGuard} from "./shared-quota.server.js";
import {createQuotaManagedFetch} from "./quota-native-fetch.server.js";
import {collectKlaviyoNativeIdentityEvidence, collectKlaviyoIdentityMessageEvidence} from "../providers/klaviyo-identity-collection.server.js";
import {klaviyoBusinessDayTimeframe} from "../providers/klaviyo-reporting.server.js";
import {collectMetaNativeIdentityEvidence} from "../providers/meta-identity-collection.server.js";
import {metaIdentityReportWindow} from "../providers/meta-report-candidates.server.js";
import {collectGoogleMerchantIdentityEvidence} from "../providers/google-identity-collection.server.js";
import {isShopifyAdminIdentitySdkBridge} from "./shopify-admin-sdk-quota-bridge.server.js";
import {normalizeShopDomain} from "../shopify/installation-authority.server.js";

// Explicit background-only composition. SQL supplies current authority and owner scope handles.
// No caller account/context loader override; never a setup OAuth or interactive authority shortcut.
function refreshQuotaOptions({workStore,quotaStore,claim,window,entitlementReceipt,now,fetchFn,...extra} = {},{admin=false}={}) {
  if(Object.keys(extra).length||typeof workStore?.loadQuotaContext!=="function") throw Error("REFRESH_QUOTA_BINDING_INPUT_INVALID");
  refreshWorkIdentity(claim,{claimRequired:true});
  if(![window?.from,window?.to].every(v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v))||window.from>window.to) throw Error("REFRESH_QUOTA_BINDING_INPUT_INVALID");
  const execution=structuredClone({claim,window,entitlementReceipt});
  const pinned=new Map();
  return {store:quotaStore,now,lane:"background",fetchFn,
    loadContext:async({provider})=>{
      if(provider!=="shopify_partner"&&provider!==execution.claim.provider&&!(admin&&provider==="shopify_admin")) return null;
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

function identityTransport(binding,provider,claim,merchantTarget) {
  const resolve=createQuotaScopeResolver({store:binding.store,loadContext:async input=>{
    if(input.provider!==provider) return null;
    const context=await binding.loadContext(input);
    return context?.provider===provider&&context.accountId===claim.accountId
      &&(merchantTarget===undefined||context.merchant?.targetAccountId===merchantTarget)?context:null;
  }});
  return createQuotaManagedFetch({provider,lane:"background",fetchFn:binding.fetchFn,
    guard:createSharedQuotaGuard({store:binding.store,now:binding.now}),resolveOperation:resolve,
    isDispatchCurrent:async(metadata,key)=>await resolve(metadata)===key});
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
  const transport=identityTransport(binding,"klaviyo",claim);
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

// Native-only: candidate/report modes must wait for distinct Shopify Admin quota binding.
// Target IDs/config are captured inputs, not account authority or product namespace proof.
export function createRefreshMetaIdentityReader({verified,database,tokenVault,adId,adSetId,campaignId,catalogId,
  config,signal,readNow=()=>new Date(),maxElapsedMs,maxPages,maxRows,...quotaOptions} = {}) {
  const claim=structuredClone(quotaOptions.claim),window=structuredClone(quotaOptions.window);
  const owner=structuredClone(verified?.installationAuthority),shop=structuredClone(verified?.identity?.shop);
  if(claim?.provider!=="meta"||typeof window?.from!=="string"||window.from!==window.to
    ||owner?.authority!=="shopify_installation_verified"||owner.status!=="active"||owner.workspaceId!==claim.workspaceId
    ||String(owner.installGeneration)!==claim.installGeneration||typeof verified?.context?.admin?.graphql!=="function"
    ||typeof readNow!=="function"||typeof quotaOptions.entitlementReceipt?.observedAt!=="string"
    ||!Number.isFinite(Date.parse(quotaOptions.entitlementReceipt.observedAt))) throw Error("REFRESH_META_IDENTITY_INPUT_INVALID");
  metaIdentityReportWindow({start:window.from,end:window.to});
  const caller={installationAuthority:owner,identity:{shop,session:{authority:verified.identity?.session?.authority,
    shopDomain:verified.identity?.session?.shopDomain}},context:{admin:{graphql:verified.context.admin.graphql.bind(verified.context.admin)}}};
  const nativeConfig=structuredClone(config);
  const binding=refreshQuotaOptions(quotaOptions),transport=identityTransport(binding,"meta",claim);
  const options={verified:caller,database,tokenVault,adId,adSetId,campaignId,catalogId,config:nativeConfig,
    fetchFn:transport,signal,now:readNow,maxElapsedMs,maxPages,maxRows};
  let used=false;
  return Object.freeze({async readEvidence(...args){
    if(args.length) throw Error("REFRESH_META_IDENTITY_OVERRIDE_FORBIDDEN");
    if(used) throw Error("REFRESH_META_IDENTITY_EXECUTION_USED");
    used=true; return collectMetaNativeIdentityEvidence(options);
  }});
}

// Native-only. Merchant inventory comes only from fenced workStore context, never caller
// quotaAccountId/default Ads ID. Existing SQL needs its separately reviewed inventory read.
export function createRefreshGoogleIdentityReader({verified,database,tokenVault,merchantId,developerToken,signal,
  readNow=()=>new Date(),maxElapsedMs,maxPages,maxRows,maxLinkPages,maxLinks,...quotaOptions} = {}) {
  const claim=structuredClone(quotaOptions.claim),window=structuredClone(quotaOptions.window);
  const owner=structuredClone(verified?.installationAuthority),shop=structuredClone(verified?.identity?.shop);
  const day=window?.from;
  if(claim?.provider!=="google_ads"||typeof day!=="string"||day!==window.to||!/^\d{4}-\d{2}-\d{2}$/.test(day)
    ||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day
    ||typeof merchantId!=="string"||!/^\d{1,19}$/.test(merchantId)||merchantId.startsWith("0")||BigInt(merchantId)>9223372036854775807n
    ||owner?.authority!=="shopify_installation_verified"||owner.status!=="active"||owner.workspaceId!==claim.workspaceId
    ||String(owner.installGeneration)!==claim.installGeneration||typeof verified?.context?.admin?.graphql!=="function"
    ||typeof readNow!=="function"||typeof quotaOptions.entitlementReceipt?.observedAt!=="string"
    ||!Number.isFinite(Date.parse(quotaOptions.entitlementReceipt.observedAt))) throw Error("REFRESH_GOOGLE_IDENTITY_INPUT_INVALID");
  const caller={installationAuthority:owner,identity:{shop,session:{authority:verified.identity?.session?.authority,
    shopDomain:verified.identity?.session?.shopDomain}},context:{admin:{graphql:verified.context.admin.graphql.bind(verified.context.admin)}}};
  const binding=refreshQuotaOptions(quotaOptions),transport=identityTransport(binding,"google_ads",claim,merchantId);
  const options={verified:caller,database,tokenVault,merchantId,developerToken,fetchFn:transport,signal,now:readNow,
    maxElapsedMs,maxPages,maxRows,maxLinkPages,maxLinks};
  let used=false;
  return Object.freeze({async readEvidence(...args){
    if(args.length) throw Error("REFRESH_GOOGLE_IDENTITY_OVERRIDE_FORBIDDEN");
    if(used) throw Error("REFRESH_GOOGLE_IDENTITY_EXECUTION_USED");
    used=true;return collectGoogleMerchantIdentityEvidence(options);
  }});
}

// Inactive Admin-only client for an existing fenced provider job. The current repository
// adapter/SQL rejects Admin context until the separately required step14 review is done.
export function createRefreshShopifyAdminIdentityClient({verified,sdkBridge,signal,timeoutMs,...quotaOptions}={}) {
  const claim=structuredClone(quotaOptions.claim),window=structuredClone(quotaOptions.window);
  const owner=structuredClone(verified?.installationAuthority),shop=structuredClone(verified?.identity?.shop);
  const session=structuredClone(verified?.identity?.session),day=window?.from;
  if(!isShopifyAdminIdentitySdkBridge(sdkBridge)||typeof day!=="string"||day!==window.to||!/^\d{4}-\d{2}-\d{2}$/.test(day)
    ||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day
    ||owner?.authority!=="shopify_installation_verified"||owner.status!=="active"||owner.workspaceId!==claim?.workspaceId
    ||!Number.isSafeInteger(owner.installGeneration)||owner.installGeneration<1||String(owner.installGeneration)!==claim?.installGeneration
    ||shop?.authority!=="shopify_admin_verified"||!/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(shop.shopId??"")
    ||session?.authority!=="shopify_id_token_verified"||session.shopDomain!==shop.myshopifyDomain
    ||typeof verified?.context?.admin?.graphql!=="function"||typeof quotaOptions.entitlementReceipt?.observedAt!=="string"
    ||!Number.isFinite(Date.parse(quotaOptions.entitlementReceipt.observedAt)))throw Error("REFRESH_SHOPIFY_ADMIN_IDENTITY_INPUT_INVALID");
  if(normalizeShopDomain(shop.myshopifyDomain)!==shop.myshopifyDomain)throw Error("REFRESH_SHOPIFY_ADMIN_IDENTITY_INPUT_INVALID");
  const admin={graphql:verified.context.admin.graphql.bind(verified.context.admin)};
  const binding=refreshQuotaOptions(quotaOptions,{admin:true});
  const resolve=createQuotaScopeResolver({store:binding.store,loadContext:async input=>{
    if(input.provider!=="shopify_admin")return null;
    const context=await binding.loadContext(input);
    return context?.provider==="shopify_admin"&&context.accountId===shop.myshopifyDomain?context:null;
  }});
  const transport=createQuotaManagedFetch({provider:"shopify_admin",lane:"background",fetchFn:binding.fetchFn,
    guard:createSharedQuotaGuard({store:binding.store,now:binding.now}),resolveOperation:resolve,
    isDispatchCurrent:async(metadata,key)=>await resolve(metadata)===key});
  return sdkBridge.wrap({admin,transport,signal,timeoutMs});
}
