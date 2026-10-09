import {createHash} from "node:crypto";

const SHOP_ID_PATTERN = /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/;
const APP_ID_PATTERN = /^gid:\/\/shopify\/App\/[1-9][0-9]*$/;
const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const ITEM_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;

export const SHOPIFY_PARTNER_API_VERSION = "2026-07";

export const ACTIVE_SUBSCRIPTION_QUERY = `#graphql
  query ActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      shop {
        id
        myshopifyDomain
      }
      billingPeriod
      cancelAtEndOfCycle
      trialEndsAt
      currentBillingCycle {
        startTime
        endTime
      }
      items {
        handle
        price {
          active
        }
      }
      pendingUpdate {
        billingPeriod
        items {
          handle
        }
      }
    }
  }
`;

function requiredDate(value, name) {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError(`${name} must be a valid Date`);
  }
  return value;
}

function optionalInstant(value, name) {
  if (value == null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`INVALID_${name.toUpperCase()}`);
  }
  return parsed.toISOString();
}

function normalizedDomain(value) {
  if (typeof value !== "string") throw new Error("INVALID_SHOP_DOMAIN");
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  if (!SHOP_DOMAIN_PATTERN.test(normalized)) throw new Error("INVALID_SHOP_DOMAIN");
  return normalized;
}

function verifiedInstallation(value) {
  if (!value || value.authority !== "shopify_installation_verified") {
    throw new Error("VERIFIED_INSTALLATION_REQUIRED");
  }
  if (!SHOP_ID_PATTERN.test(value.shopId || "")) throw new Error("INVALID_SHOPIFY_SHOP_GID");
  if (!Number.isSafeInteger(value.installGeneration) || value.installGeneration < 1) {
    throw new Error("INVALID_INSTALL_GENERATION");
  }
  return {
    shopId: value.shopId,
    shopDomain: normalizedDomain(value.shopDomain),
    installGeneration: value.installGeneration,
  };
}

function sourceHash(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function normalizeActiveSubscription(payload, installation, observedAt) {
  if (!payload || typeof payload !== "object") throw new Error("PARTNER_API_RESPONSE_REQUIRED");
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error("SHOPIFY_PARTNER_API_UNAVAILABLE");
  }
  if (!payload.data || !Object.hasOwn(payload.data, "activeSubscription")) {
    throw new Error("MALFORMED_ACTIVE_SUBSCRIPTION_RESPONSE");
  }

  const subscription = payload.data.activeSubscription;
  if (subscription === null) {
    const snapshot = {
      shopId: installation.shopId,
      shopDomain: installation.shopDomain,
      active: false,
      entitlementStatus: "subscription_required",
      billingPeriod: null,
      cancelAtEndOfCycle: false,
      trialEndsAt: null,
      currentCycleStart: null,
      currentCycleEnd: null,
      itemHandles: [],
      pendingItemHandles: [],
      observedAt: observedAt.toISOString(),
    };
    return {...snapshot, sourceHash: sourceHash(snapshot)};
  }

  if (
    subscription.shop?.id !== installation.shopId ||
    normalizedDomain(subscription.shop?.myshopifyDomain) !== installation.shopDomain
  ) {
    throw new Error("PARTNER_SUBSCRIPTION_SHOP_MISMATCH");
  }

  if (typeof subscription.billingPeriod !== "string" || subscription.billingPeriod.length === 0) {
    throw new Error("INVALID_BILLING_PERIOD");
  }
  if (typeof subscription.cancelAtEndOfCycle !== "boolean") {
    throw new Error("INVALID_CANCEL_AT_END_OF_CYCLE");
  }
  if (!Array.isArray(subscription.items) || subscription.items.length === 0) {
    throw new Error("ACTIVE_SUBSCRIPTION_ITEMS_REQUIRED");
  }
  const itemHandles = subscription.items.map((item) => {
    if (
      !ITEM_HANDLE_PATTERN.test(item?.handle || "") ||
      typeof item?.price?.active !== "boolean"
    ) {
      throw new Error("INVALID_ACTIVE_SUBSCRIPTION_ITEM");
    }
    return item.handle;
  });
  if (new Set(itemHandles).size !== itemHandles.length) {
    throw new Error("DUPLICATE_ACTIVE_SUBSCRIPTION_ITEM");
  }

  const trialEndsAt = optionalInstant(subscription.trialEndsAt, "trial_ends_at");
  const currentCycleStart = optionalInstant(
    subscription.currentBillingCycle?.startTime,
    "current_cycle_start",
  );
  const currentCycleEnd = optionalInstant(
    subscription.currentBillingCycle?.endTime,
    "current_cycle_end",
  );
  const isTrial = trialEndsAt !== null;

  if (isTrial) {
    if (new Date(trialEndsAt) <= observedAt || currentCycleStart !== null || currentCycleEnd !== null) {
      throw new Error("INCONSISTENT_TRIAL_SUBSCRIPTION");
    }
  } else if (
    currentCycleStart === null ||
    currentCycleEnd === null ||
    new Date(currentCycleEnd) <= new Date(currentCycleStart)
  ) {
    throw new Error("INCONSISTENT_ACTIVE_SUBSCRIPTION");
  }

  if (
    subscription.pendingUpdate != null &&
    (!Array.isArray(subscription.pendingUpdate.items) ||
      typeof subscription.pendingUpdate.billingPeriod !== "string")
  ) {
    throw new Error("INVALID_PENDING_SUBSCRIPTION");
  }
  const pendingItems = subscription.pendingUpdate?.items ?? [];
  const pendingItemHandles = pendingItems.map((item) => {
    if (!ITEM_HANDLE_PATTERN.test(item?.handle || "")) {
      throw new Error("INVALID_PENDING_SUBSCRIPTION_ITEM");
    }
    return item.handle;
  });

  const snapshot = {
    shopId: installation.shopId,
    shopDomain: installation.shopDomain,
    active: true,
    entitlementStatus: isTrial ? "trial" : "active",
    billingPeriod: subscription.billingPeriod,
    cancelAtEndOfCycle: subscription.cancelAtEndOfCycle,
    trialEndsAt,
    currentCycleStart,
    currentCycleEnd,
    itemHandles,
    pendingItemHandles,
    observedAt: observedAt.toISOString(),
  };
  return {...snapshot, sourceHash: sourceHash(snapshot)};
}

export async function reconcileShopifyAppPricingEntitlement({
  installation,
  appId,
  partnerApi,
  repository,
  observedAt = new Date(),
}) {
  const verified = verifiedInstallation(installation);
  if (!APP_ID_PATTERN.test(appId || "")) throw new Error("INVALID_SHOPIFY_APP_GID");
  requiredDate(observedAt, "observedAt");
  if (!partnerApi || typeof partnerApi.activeSubscription !== "function") {
    throw new TypeError("partnerApi.activeSubscription is required");
  }
  if (!repository || typeof repository.applySnapshot !== "function") {
    throw new TypeError("repository.applySnapshot is required");
  }

  const payload = await partnerApi.activeSubscription({
    apiVersion: SHOPIFY_PARTNER_API_VERSION,
    query: ACTIVE_SUBSCRIPTION_QUERY,
    variables: {appId, shopId: verified.shopId},
  });
  const snapshot = normalizeActiveSubscription(payload, verified, observedAt);

  const persisted = await repository.applySnapshot({
    ...snapshot,
    installGeneration: verified.installGeneration,
  });

  if (
    !persisted ||
    persisted.shopId !== verified.shopId ||
    persisted.shopDomain !== verified.shopDomain ||
    persisted.installGeneration !== verified.installGeneration ||
    persisted.entitlementStatus !== snapshot.entitlementStatus
  ) {
    throw new Error("ENTITLEMENT_PERSISTENCE_MISMATCH");
  }

  return Object.freeze({...persisted});
}
