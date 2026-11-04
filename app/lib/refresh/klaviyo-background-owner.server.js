import {createShopifyInstallationOwnerRepository} from "../database/shopify-installation-owner-repository.server.js";
import {permissionContext} from "../oauth/identity-permission-preflight.server.js";

const proofs=new WeakMap();
const fail=()=>{throw Error("KLAVIYO_BACKGROUND_OWNER_REQUIRED");};
// A private capability from the existing runtime-only installation RPC. No ID
// token or Admin verification is fabricated, and no browser input is accepted.
export async function loadKlaviyoBackgroundOwner({database,owner}) {
 const input=structuredClone(owner);
 permissionContext({provider:"shopify",...input});
 const current=await createShopifyInstallationOwnerRepository(database).load(input);
 if(!current)fail();
 const proof=Object.freeze({});proofs.set(proof,current);
 return Object.freeze({backgroundAuthority:proof,
  installationAuthority:Object.freeze({authority:"shopify_installation_verified",status:"active",
   workspaceId:current.workspaceId,installGeneration:current.installGeneration}),
  identity:Object.freeze({session:Object.freeze({authority:"shopify_database_owner_verified",shopDomain:current.shopDomain}),
   shop:Object.freeze({authority:"shopify_installation_record_verified",shopId:current.shopId,myshopifyDomain:current.shopDomain})})});
}
export function isKlaviyoBackgroundOwner(value) {
 const p=proofs.get(value?.backgroundAuthority);if(!p)return false;
 const a=value.installationAuthority,s=value.identity?.shop,t=value.identity?.session;
 return a?.authority==="shopify_installation_verified"&&a.status==="active"&&a.workspaceId===p.workspaceId
  &&a.installGeneration===p.installGeneration&&s?.authority==="shopify_installation_record_verified"
  &&s.shopId===p.shopId&&s.myshopifyDomain===p.shopDomain&&t?.authority==="shopify_database_owner_verified"&&t.shopDomain===p.shopDomain;
}
