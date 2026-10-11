import {
  createGoogleAdsRestClient,
  GOOGLE_ADS_OAUTH_SCOPE,
} from "./google-ads-rest.server.js";

const MAX_DISCOVERED_ACCOUNTS = 1000;
const CUSTOMER_CLIENT_QUERY = [
  "SELECT",
  "customer_client.client_customer,",
  "customer_client.id,",
  "customer_client.descriptive_name,",
  "customer_client.currency_code,",
  "customer_client.time_zone,",
  "customer_client.manager,",
  "customer_client.status,",
  "customer_client.level",
  "FROM customer_client",
  "WHERE customer_client.level <= 1",
].join(" ");

function validDate(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError("now must return a valid Date");
  }
  return value.toISOString();
}

function customerId(value) {
  const normalized = String(value ?? "").replaceAll("-", "");
  if (!/^[0-9]+$/.test(normalized)) {
    throw new Error("GOOGLE_DISCOVERED_CUSTOMER_ID_INVALID");
  }
  return normalized;
}

function accountName(value, id) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return id;
}

function normalizeStatus(value) {
  return typeof value === "string" && value.length <= 100 ? value : null;
}

function normalizedAccount(value, loginAccountId) {
  const id = customerId(value?.id ?? value?.clientCustomer);
  const manager = value?.manager === true;
  const status = normalizeStatus(value?.status);
  return Object.freeze({
    id,
    name: accountName(value?.descriptiveName, id),
    kind: manager ? "manager" : "advertiser",
    reportingEligible: !manager,
    status,
    currency:
      typeof value?.currencyCode === "string" && /^[A-Z]{3}$/.test(value.currencyCode)
        ? value.currencyCode
        : null,
    timezone:
      typeof value?.timeZone === "string" && value.timeZone.length <= 100
        ? value.timeZone
        : null,
    loginAccountId: customerId(loginAccountId),
  });
}

function directClient({accessToken, developerToken, fetchFn}) {
  return createGoogleAdsRestClient({
    accessToken,
    developerToken,
    loginCustomerId: null,
    fetchFn,
  });
}

export async function discoverGoogleAdsAccounts({
  accessToken,
  developerToken,
  fetchFn = fetch,
  now = () => new Date(),
} = {}) {
  const googleAds = directClient({accessToken, developerToken, fetchFn});
  const accessible = await googleAds.listAccessibleCustomers();
  if (accessible.customers.length < 1) {
    throw new Error("GOOGLE_ACCESSIBLE_CUSTOMERS_EMPTY");
  }

  const accounts = new Map();
  let queriedRootCount = 0;
  let lastFailure = null;

  for (const accessibleCustomer of accessible.customers) {
    const rootId = customerId(accessibleCustomer.customer_id);
    let result;
    try {
      // Preserve the proven legacy discovery contract: every directly accessible
      // root is queried without login-customer-id, and customer_client returns the
      // root plus its immediate children. Managers remain access paths only.
      result = await googleAds.search({
        customerId: rootId,
        query: CUSTOMER_CLIENT_QUERY,
      });
      queriedRootCount += 1;
    } catch (error) {
      lastFailure = error;
      continue;
    }

    for (const row of result.results) {
      const value = row?.customerClient;
      if (!value) throw new Error("GOOGLE_CUSTOMER_CLIENT_SCHEMA_CHANGED");
      const level = Number(value.level);
      if (!Number.isSafeInteger(level) || level < 0 || level > 1) {
        throw new Error("GOOGLE_CUSTOMER_CLIENT_LEVEL_INVALID");
      }
      const account = normalizedAccount(value, rootId);
      const existing = accounts.get(account.id);
      if (!existing || existing.loginAccountId === null) {
        accounts.set(account.id, account);
      }
      if (accounts.size > MAX_DISCOVERED_ACCOUNTS) {
        throw new Error("GOOGLE_ACCOUNT_DISCOVERY_LIMIT_EXCEEDED");
      }
    }
  }

  if (queriedRootCount === 0 && lastFailure) throw lastFailure;
  if (accounts.size < 1) {
    throw new Error("GOOGLE_ADS_ENABLED_CUSTOMERS_EMPTY");
  }

  return Object.freeze({
    verifiedAt: validDate(now),
    scopes: Object.freeze([GOOGLE_ADS_OAUTH_SCOPE]),
    accounts: Object.freeze(
      [...accounts.values()].sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === "manager" ? -1 : 1;
        return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
      }),
    ),
  });
}

export const GOOGLE_ACCOUNT_DISCOVERY_QUERIES = Object.freeze({
  customerClient: CUSTOMER_CLIENT_QUERY,
});
