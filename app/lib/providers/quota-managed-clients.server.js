import {createQuotaManagedFetch} from "../refresh/quota-native-fetch.server.js";
import {createShopifyPartnerApi} from "../shopify/partner-api.server.js";
import {createMetaReportingAuthorityRuntime} from "./meta-reporting-authority.server.js";
import {createGoogleReportingAuthorityRuntime} from "./google-reporting-authority.server.js";
import {createKlaviyoReportingAuthorityRuntime} from "./klaviyo-reporting-authority.server.js";

const clients=new WeakMap();
export function quotaManagedClientProvider(client) {return clients.get(client)??null;}

// Inactive server composition. Existing Production construction is NOT silently replaced.
// Resolver binds full verified client/project/account scopes from trusted configuration.
export function createQuotaManagedClients({guard,resolveOperation,lane,fetchFn=globalThis.fetch}) {
  const transport=provider=>createQuotaManagedFetch({provider,guard,resolveOperation,lane,fetchFn});
  const locked=options=>{
    if(Object.hasOwn(options??{},"fetchFn")||Object.hasOwn(options??{},"fetchImpl")) throw new Error("QUOTA_NATIVE_TRANSPORT_OVERRIDE_FORBIDDEN");
    return options??{};
  };
  const mark=(client,provider)=>{clients.set(client,provider);return client;};
  return Object.freeze({
    shopify:options=>mark(createShopifyPartnerApi({...locked(options),fetchImpl:transport("shopify_partner")}),"shopify_partner"),
    meta:options=>createMetaReportingAuthorityRuntime({...locked(options),fetchFn:transport("meta")}),
    google:options=>createGoogleReportingAuthorityRuntime({...locked(options),fetchFn:transport("google_ads")}),
    klaviyo:options=>createKlaviyoReportingAuthorityRuntime({...locked(options),fetchFn:transport("klaviyo")}),
  });
}
