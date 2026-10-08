import {shopIdentitySha256} from "./shop-identity.server.js";

const SHOP_ID_PATTERN = /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/;
const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeShopDomain(value) {
  if (typeof value !== "string") throw new TypeError("shop domain is required");
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  if (!SHOP_DOMAIN_PATTERN.test(normalized)) {
    throw new TypeError("shop domain must be a canonical myshopify.com domain");
  }
  return normalized;
}

function verifiedSession(value) {
  if (!value || value.authority !== "shopify_id_token_verified") {
    throw new Error("VERIFIED_SHOPIFY_ID_TOKEN_REQUIRED");
  }
  return {shopDomain: normalizeShopDomain(value.shopDomain)};
}

function verifiedShop(value) {
  if (!value || value.authority !== "shopify_admin_verified") {
    throw new Error("VERIFIED_SHOPIFY_ADMIN_IDENTITY_REQUIRED");
  }
  if (typeof value.shopId !== "string" || !SHOP_ID_PATTERN.test(value.shopId)) {
    throw new Error("INVALID_SHOPIFY_SHOP_GID");
  }
  return {
    shopId: value.shopId,
    shopDomain: normalizeShopDomain(value.myshopifyDomain),
  };
}

function acceptedResult(value, expectedShop) {
  if (!value || value.shopId !== expectedShop.shopId || value.shopDomain !== expectedShop.shopDomain) {
    throw new Error("INSTALLATION_PERSISTENCE_MISMATCH");
  }
  if (!UUID_PATTERN.test(value.workspaceId || "")) {
    throw new Error("INVALID_WORKSPACE_AUTHORITY");
  }
  if (!Number.isSafeInteger(value.installGeneration) || value.installGeneration < 1) {
    throw new Error("INVALID_INSTALL_GENERATION");
  }
  if (
    value.status !== "active"
    || !["created", "existing", "reactivated", "new_generation"].includes(value.disposition)
  ) {
    throw new Error("INSTALLATION_NOT_ACTIVE");
  }
  return Object.freeze({
    workspaceId: value.workspaceId,
    installGeneration: value.installGeneration,
    status: "active",
    disposition: value.disposition,
  });
}

export async function bootstrapWorkspaceInstallation({session, shop, verifiedAt, repository}) {
  const sessionIdentity = verifiedSession(session);
  const shopIdentity = verifiedShop(shop);
  if (sessionIdentity.shopDomain !== shopIdentity.shopDomain) {
    throw new Error("SHOP_ID_TOKEN_ADMIN_IDENTITY_MISMATCH");
  }
  if (!(verifiedAt instanceof Date) || Number.isNaN(verifiedAt.valueOf())) {
    throw new TypeError("verifiedAt must be a valid Date");
  }
  if (!repository || typeof repository.bootstrap !== "function") {
    throw new TypeError("repository.bootstrap is required");
  }

  const persisted = await repository.bootstrap({
    shopId: shopIdentity.shopId,
    shopDomain: shopIdentity.shopDomain,
    shopIdentitySha256: shopIdentitySha256(shopIdentity.shopId),
    verifiedAt: verifiedAt.toISOString(),
  });

  return acceptedResult(persisted, shopIdentity);
}
