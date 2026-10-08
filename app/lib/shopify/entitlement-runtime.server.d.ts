import type {VerifiedShopifyAdminIdentity} from "./admin-identity.server.js";

export function createProductionShopifyEntitlementRuntime(args?: {
  environment?: NodeJS.ProcessEnv;
  database?: unknown;
  partnerApi?: unknown;
}): {
  reconcile(identity: VerifiedShopifyAdminIdentity): Promise<unknown>;
};
