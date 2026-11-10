import {randomUUID} from "node:crypto";
import {createRefreshPdSourceReader} from "../../app/lib/refresh/pd-source-reader.server.js";
import {sourceStoreFixture} from "./source-store-fixture.js";
import {deriveMaturityPolicy} from "../../app/lib/refresh/maturity-policy.server.js";

/** Entirely synthetic authority, credentials, quota and native HTTP. The actual
 * private reader, observation capability, encryption and readback code are used. */
export function maturityObservationFixture(provider = "meta", {owner: givenOwner, timeZone = "UTC", setting = "1d_click", clickDays = "0", now = Date.now, businessDate = "2026-11-01"} = {}) {
  const owner = givenOwner ?? {workspaceId: randomUUID(), installationId: "42", generation: "1", shopId: "gid://shopify/Shop/12",
    shopDomain: "maturity-fixture.myshopify.com", provider, connectionId: randomUUID(), connectionVersion: "2", credentialId: randomUUID(),
    accountId: provider === "meta" ? "act_123" : provider === "google_ads" ? "123" : "ABC123", selectionEpoch: provider === "klaviyo" ? null : "71"};
  const scopes = provider === "meta" ? ["ads_read", "catalog_management", "business_management", "pages_read_engagement", "pages_show_list"]
    : provider === "google_ads" ? ["https://www.googleapis.com/auth/adwords", "https://www.googleapis.com/auth/content"] : ["accounts:read", "campaigns:read", "flows:read", "events:read", "metrics:read"];
  const row = {installation_id: owner.installationId, workspace_id: owner.workspaceId, install_generation: owner.generation, installation_status: "active",
    shop_id: owner.shopId, shop_domain: owner.shopDomain, connection_id: owner.connectionId, credential_id: owner.credentialId,
    connection_version: Number(owner.connectionVersion), lifecycle_status: "connected", reporting_selection_epoch: owner.selectionEpoch,
    reporting_account_id: provider === "klaviyo" ? null : owner.accountId, granted_scopes: scopes,
    accounts: [{id: owner.accountId, kind: provider === "klaviyo" ? "account" : "advertiser", status: "active", reporting_eligible: true, currency: "USD", timezone: timeZone, login_account_id: null}]};
  const calls = [], json = data => new Response(JSON.stringify(data), {headers: {"content-type": "application/json"}});
  const config = {
    verified: {installationAuthority: {authority: "shopify_installation_verified", status: "active", workspaceId: owner.workspaceId, installGeneration: Number(owner.generation)},
      identity: {session: {authority: "shopify_id_token_verified", shopDomain: owner.shopDomain}, shop: {authority: "shopify_admin_verified", shopId: owner.shopId, myshopifyDomain: owner.shopDomain}}},
    claim: {workspaceId: owner.workspaceId, installGeneration: owner.generation, provider, accountId: owner.accountId, id: "maturity-synthetic-job", fence: 1},
    window: {from: businessDate, to: businessDate}, entitlementReceipt: {observedAt: new Date(now()).toISOString()},
    nativeMetadata: true, ...(provider === "google_ads" ? {googlePd: {flow: "search"}} : provider === "klaviyo" ? {klaviyoPd: {}} : {}),
    environment: {META_APP_SECRET: "synthetic-only", GOOGLE_ADS_OAUTH_CLIENT_ID: "synthetic-client", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "synthetic-only",
      GOOGLE_ADS_OAUTH_REDIRECT_URI: "https://embedded.adstable.app/auth/google-ads/callback", GOOGLE_ADS_DEVELOPER_TOKEN: "synthetic-only",
      KLAVIYO_CLIENT_ID: "synthetic-client", KLAVIYO_CLIENT_SECRET: "synthetic-only", KLAVIYO_OAUTH_REDIRECT_URI: "https://embedded.adstable.app/auth/klaviyo/callback"},
    limits: {maxElapsedMs: 10000, maxPages: 3, maxRows: 100, maxBytes: 100000}, now, readNow: () => new Date(now()),
    database: {query: async () => ({rows: [structuredClone(row)]})},
    tokenVault: {loadProviderTokenSet: async () => ({access_token: "synthetic-only", refresh_token: "synthetic-only", expires_at: new Date(now() + 3600000).toISOString(), scopes})},
    workStore: {loadBoundAuthority: async () => ({workspaceId: owner.workspaceId, installGeneration: owner.generation, provider, accountId: owner.accountId,
      installationVerified: true, connected: true, setupComplete: true, allowedWindow: true, connectionId: owner.connectionId, connectionVersion: Number(owner.connectionVersion)}),
      loadQuotaContext: async () => ({provider, clientScopeKey: "a".repeat(64), connectionScopeKey: "b".repeat(64), connectionEpoch: Number(owner.connectionVersion), accountId: owner.accountId, organizationId: null,
        apiVersion: provider === "meta" ? "v26.0" : provider === "google_ads" ? "v25" : "2026-10-15"})},
    quotaStore: {resolveRoute: async v => v.routeKey, reserve: async input => ({...input, status: "reserved", dispatchBeforeMs: now() + 1000, dispatchBudgetMs: 1000}), settle: async () => true, recordFeedback: async () => true, stop: async () => true},
    fetchFn: async (address, init) => {
      calls.push({address, init});
      if (address.includes("oauth2.googleapis.com")) return json({access_token: "synthetic-only", token_type: "Bearer", expires_in: 3600});
      if (provider === "google_ads") {
        const query = JSON.parse(init.body).query;
        if (/FROM customer$/.test(query)) return json({results: [{customer: {id: owner.accountId, currencyCode: "USD", timeZone}}]});
        if (/FROM conversion_action/.test(query)) return json({results: [{conversionAction: {resourceName: `customers/${owner.accountId}/conversionActions/1`, ownerCustomer: `customers/${owner.accountId}`,
          category: "PURCHASE", status: "ENABLED", countingType: "MANY_PER_CLICK", attributionModelSettings: {attributionModel: "GOOGLE_ADS_LAST_CLICK"}, clickThroughLookbackWindowDays: clickDays, viewThroughLookbackWindowDays: "0"}}]});
        return json({results: []});
      }
      if (provider === "klaviyo") {
        if (address.includes("/accounts")) return json({data: [{type: "account", id: owner.accountId, attributes: {preferred_currency: "USD", timezone: timeZone}}]});
        if (address.includes("/metrics")) return json({data: ["Placed Order", "Added to Cart", "Checkout Started"].map((name, i) => ({type: "metric", id: `metric${i}`, attributes: {name, integration: {name: "Shopify"}}})), links: {next: null}});
        return json({data: {attributes: {results: []}}, links: {next: null}});
      }
      return json({data: [{account_id: owner.accountId.slice(4), campaign_id: "10", campaign_name: "Root", adset_id: "20", adset_name: "Parent", ad_id: "30", ad_name: "Leaf",
        date_start: businessDate, date_stop: businessDate, account_currency: "USD", attribution_setting: setting, impressions: "10", spend: "30",
        ...(new URL(address).searchParams.has("breakdowns") ? {product_id: "synthetic-product"} : {})}]});
    },
  };
  return {owner, config, calls, row, read: () => createRefreshPdSourceReader(config).readEvidence()};
}

/** Fake SQL for failure/readback unit checks only, never PostgreSQL acceptance. */
export function maturityMemoryStore(owner) {
  const x = sourceStoreFixture({owner}), batches = new Map(), calls = []; let next = 100;
  const hooks = {};
  const database = {async query(sql, args) {
    calls.push({sql, args}); await hooks.query?.(sql, args);
    if (sql.includes("assert_source_owner")) return {rows: []};
    if (sql.includes("commit_source_batch")) {
      const body = JSON.parse(args[3]), batchId = String(++next), pages = body.pages.map((p, ordinal) => ({...p, id: String(++next), ordinal, available: true, expired: false, retentionPruned: false}));
      const receipt = {status: "committed", batchId, commitId: randomUUID(), digest: "a".repeat(64), sourceState: body.sourceState,
        manifest: {counts: Object.fromEntries(["pages", "references", "rules", "mappings", "orders", "lines", "journeys", "claims", "links"].map(k => [k, body[k].length]))}};
      batches.set(args[1], {receipt, pages}); return {rows: [{result: structuredClone(receipt)}]};
    }
    if (sql.includes("read_source_receipt")) return {rows: [{result: structuredClone(batches.get(args[1])?.receipt)}]};
    if (sql.includes("read_source_pages")) return {rows: [{result: structuredClone(batches.get(args[1])?.pages ?? [])}]};
    if (sql.includes("register_maturity_configuration")) {
      const b = batches.get(args[1]), payload = JSON.parse(args[2]), policy = deriveMaturityPolicy(payload);
      const result = {batchId: b.receipt.batchId, pageId: b.pages[0].id, payloadHash: b.pages[0].payloadHash, fingerprint: policy.fingerprint, policy, observedAt: payload.observedAt};
      b.receipt.manifest.maturityConfiguration = result; return {rows: [{result: structuredClone(result)}]};
    }
    throw Error("UNEXPECTED_SYNTHETIC_SQL");
  }};
  return {database, cipher: x.input.cipher, policy: x.input.policy, batches, calls, hooks,
    limits: {maxBytes: 1000000, maxRows: 100, deadlineAt: Date.now() + 60000, maxObservationAgeMs: 60000}};
}
