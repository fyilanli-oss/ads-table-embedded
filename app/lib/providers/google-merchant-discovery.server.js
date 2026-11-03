import {createIdentityRuntimeAuthorityLoader, IdentityRuntimeAuthorityError} from "./identity-runtime-authority.server.js";
import {createGoogleAdsRestClient, googleAdsRestFailureMetadata} from "./google-ads-rest.server.js";
import {GOOGLE_MERCHANT_LINK_QUERY} from "./google-merchant-account-link.server.js";
import {runIdentityReadDeadline} from "./identity-read-deadline.server.js";
import {resolveReadOnlyShopifyRouteAuthority} from "../shopify/shopify-route-authority.server.js";

export const GOOGLE_MERCHANT_DISCOVERY_HEADER = "x-adstable-google-merchant-discovery";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const numeric = value => typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value)
  && BigInt(value) <= 9223372036854775807n;
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...keys].sort().join();
const limits = Object.freeze({timeoutMs: 20000, readTimeoutMs: 5000, maxBytes: 1048576, maxLinks: 1000});
class DiscoveryError extends Error {
  constructor(code) {super(code); this.code = code;}
}
const fail = code => {throw new DiscoveryError(code);};
const boundary = Object.freeze({product_read_performed: false, quota_account_resolved: false,
  provider_retry_performed: false, authorizes_activation: false});

// Absent is closed. This server-owned plan has no Merchant, token or caller override.
export function readGoogleMerchantDiscoveryPlan(environment, now = Date.now()) {
  const raw = environment?.ADSTABLE_GOOGLE_MERCHANT_DISCOVERY_PLAN;
  if (raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 4096 || !Number.isSafeInteger(now)) fail("configuration_required");
  let plan;
  try {plan = JSON.parse(raw);} catch {fail("configuration_required");}
  if (!exact(plan, ["operationId", "workspaceId", "installGeneration", "shopId", "shopDomain", "connectionId",
    "connectionVersion", "credentialId", "selectionId", "accountId", "expiresAt"])
    || ![plan.operationId, plan.workspaceId, plan.connectionId, plan.credentialId].every(v => typeof v === "string" && UUID.test(v))
    || ![plan.installGeneration, plan.selectionId, plan.accountId].every(numeric)
    || !Number.isSafeInteger(plan.connectionVersion) || plan.connectionVersion < 1
    || typeof plan.shopId !== "string" || !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(plan.shopId)
    || typeof plan.shopDomain !== "string" || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(plan.shopDomain)
    || typeof plan.expiresAt !== "string" || !Number.isFinite(Date.parse(plan.expiresAt))
    || Date.parse(plan.expiresAt) <= now || Date.parse(plan.expiresAt) > now + 900000) fail("configuration_required");
  return Object.freeze(plan);
}

function guard(signal, plan, now) {
  if (signal.aborted || !Number.isSafeInteger(now()) || now() >= Date.parse(plan.expiresAt)) fail("stopped");
}

async function readInput(request, signal) {
  return runIdentityReadDeadline({signal, timeoutMs: limits.readTimeoutMs, run: async child => {
    const reader = request.body?.getReader();
    if (!reader) fail("request_contract_invalid");
    const cancel = () => {void reader.cancel().catch(() => {});};
    child.addEventListener("abort", cancel, {once: true});
    try {
      const chunks = []; let bytes = 0;
      for (;;) {
        if (child.aborted) fail("stopped");
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1024) {cancel(); fail("request_contract_invalid");}
        chunks.push(part.value);
      }
      if (child.aborted) fail("stopped");
      try {return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(Buffer.concat(chunks)));}
      catch {fail("request_contract_invalid");}
    } finally {child.removeEventListener("abort", cancel); reader.releaseLock();}
  }});
}

// Bounds decoded response bytes even when content-length is absent or misleading.
async function boundedResponse(response, signal) {
  if (!response || typeof response.status !== "number" || !response.body?.getReader) fail("response_invalid");
  const reader = response.body.getReader();
  const cancel = () => {void reader.cancel().catch(() => {});};
  signal.addEventListener("abort", cancel, {once: true});
  try {
    const chunks = []; let bytes = 0;
    for (;;) {
      if (signal.aborted) fail("stopped");
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limits.maxBytes) {cancel(); fail("response_limit");}
      chunks.push(part.value);
    }
    if (signal.aborted) fail("stopped");
    const bodyBytes = Buffer.concat(chunks);
    let payload;
    try {payload = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bodyBytes));} catch {fail("response_invalid");}
    if (response.ok && !Object.hasOwn(payload ?? {}, "error")) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("response_invalid");
      // Proto JSON may omit an empty results array. An unrelated object is not empty links.
      if (!Object.hasOwn(payload, "results") && Object.keys(payload).some(key =>
        !["fieldMask", "nextPageToken", "totalResultsCount", "queryResourceConsumption"].includes(key))) fail("response_invalid");
      if (Object.hasOwn(payload, "fieldMask") && typeof payload.fieldMask !== "string") fail("response_invalid");
      if (Object.hasOwn(payload, "totalResultsCount")) {
        const count = payload.totalResultsCount;
        if (!(typeof count === "string" && /^[0-9]{1,19}$/.test(count)
          || Number.isSafeInteger(count) && count >= 0)) fail("response_invalid");
        if (BigInt(count) > BigInt(limits.maxLinks)) fail("response_limit");
      }
    }
    return new Response(bodyBytes, {status: response.status, headers: {"content-type": "application/json"}});
  } finally {signal.removeEventListener("abort", cancel); reader.releaseLock();}
}

function linksFromPage(page, accountId) {
  if (!Array.isArray(page?.results)) fail("response_invalid");
  if (page.next_page_token !== null && page.next_page_token !== "") fail("incomplete_response");
  if (page.results.length > limits.maxLinks) fail("response_limit");
  if (page.total_results_count !== null && page.total_results_count !== page.results.length) fail("incomplete_response");
  const names = new Set(), merchants = new Set();
  for (const row of page.results) {
    const link = row?.productLink;
    if (link?.type !== "MERCHANT_CENTER" || !numeric(link.productLinkId) || !numeric(link.merchantCenter?.merchantCenterId)
      || link.resourceName !== `customers/${accountId}/productLinks/${link.productLinkId}`
      || names.has(link.resourceName)) fail("response_invalid");
    names.add(link.resourceName); merchants.add(link.merchantCenter.merchantCenterId);
  }
  return {merchant_ids: [...merchants].sort(), link_count: page.results.length};
}

// One invocation uses only the existing current authority RPC and token-vault read.
// No jobs, dates, Merchant quota config, token renewal, persistence or SQL writes.
async function discover({verified, database, tokenVault, environment, plan, signal, now, fetchFn}) {
  guard(signal, plan, now);
  const owner = verified.installationAuthority, shop = verified.identity.shop;
  if (owner.workspaceId !== plan.workspaceId || String(owner.installGeneration) !== plan.installGeneration
    || shop.shopId !== plan.shopId || shop.myshopifyDomain !== plan.shopDomain) fail("authority_required");
  const read = task => runIdentityReadDeadline({signal, timeoutMs: limits.readTimeoutMs, run: async child => {
    if (child.aborted) fail("stopped");
    const result = await task();
    if (child.aborted) fail("stopped");
    return result;
  }});
  const authority = createIdentityRuntimeAuthorityLoader({verified, provider: "google_ads", signal, now: () => new Date(now()),
    database: {query: (sql, args) => read(() => database.query(sql, args))},
    tokenVault: {loadProviderTokenSet: args => read(() => tokenVault.loadProviderTokenSet(args))}});
  const first = await authority.loadCurrent();
  if (first.connectionId !== plan.connectionId || first.connectionVersion !== plan.connectionVersion
    || first.credentialId !== plan.credentialId || first.selectionEpoch !== plan.selectionId || first.account.id !== plan.accountId)
    fail("authority_required");
  const expectedUrl = `https://googleads.googleapis.com/v25/customers/${first.account.id}/googleAds:search`;
  let sent = false;
  const client = createGoogleAdsRestClient({accessToken: first.tokenSet.access_token,
    developerToken: environment.GOOGLE_ADS_DEVELOPER_TOKEN, loginCustomerId: first.account.login_account_id,
    fetchFn: async (url, init) => {
      guard(signal, plan, now);
      if (sent || url !== expectedUrl || init.method !== "POST"
        || init.body !== JSON.stringify({query: GOOGLE_MERCHANT_LINK_QUERY})) fail("request_contract_invalid");
      sent = true;
      return boundedResponse(await fetchFn(url, {...init, redirect: "error", signal}), signal);
    }});
  guard(signal, plan, now);
  const page = await client.search({customerId: first.account.id, query: GOOGLE_MERCHANT_LINK_QUERY});
  guard(signal, plan, now);
  const links = linksFromPage(page, first.account.id);
  // Loader pins current installation/selection/version/scopes and token content.
  await authority.loadCurrent();
  guard(signal, plan, now);
  return {status: "observed", complete: true, has_linked_merchant: links.link_count > 0, ...links, ...boundary};
}

export async function handleGoogleMerchantDiscoveryRequest({request, authenticateAdmin, database, tokenVault,
  environment = process.env, fetchFn = globalThis.fetch, now = Date.now}) {
  const json = (body, status) => new Response(JSON.stringify(body), {status,
    headers: {"cache-control": "no-store", "content-type": "application/json; charset=utf-8"}});
  const stopped = (reason, status = 409, extra = {}) => json({status: "stopped", reason, complete: false,
    merchant_ids: null, link_count: null, has_linked_merchant: null, ...boundary, ...extra}, status);
  // Capture environment before any await. Configuration never grants caller identity.
  const env = {...environment}; let plan;
  try {plan = readGoogleMerchantDiscoveryPlan(env, now());} catch {return stopped("configuration_required", 503);}
  if (!plan) return stopped("not_enabled", 503);
  if (request.method !== "POST" || request.headers.get(GOOGLE_MERCHANT_DISCOVERY_HEADER) !== "v1"
    || request.headers.has("x-adstable-google-acceptance")
    || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return stopped("request_contract_invalid", 400);
  if (typeof env.GOOGLE_ADS_DEVELOPER_TOKEN !== "string" || !env.GOOGLE_ADS_DEVELOPER_TOKEN
    || env.GOOGLE_ADS_DEVELOPER_TOKEN.length > 256 || /[\u0000-\u0020\u007f]/.test(env.GOOGLE_ADS_DEVELOPER_TOKEN)) return stopped("configuration_required", 503);
  try {
    return await runIdentityReadDeadline({signal: request.signal, timeoutMs: limits.timeoutMs, run: async signal => {
      const input = await readInput(request, signal);
      if (!exact(input, ["mode", "operationId"]) || input.mode !== "google_merchant_links_v1" || input.operationId !== plan.operationId)
        fail("request_contract_invalid");
      guard(signal, plan, now);
      const verified = await resolveReadOnlyShopifyRouteAuthority({request,
        database: {query: (sql, args) => runIdentityReadDeadline({signal, timeoutMs: limits.readTimeoutMs, run: async child => {
          guard(child, plan, now);
          const result = await database.query(sql, args);
          guard(child, plan, now);
          return result;
        }})}, authenticateAdmin: async req => {
        const context = await authenticateAdmin(req);
        guard(signal, plan, now);
        return {...context, admin: {...context.admin, graphql: (query, options) => {
          guard(signal, plan, now);
          return context.admin.graphql(query, {...options, tries: 1});
        }}};
      }});
      guard(signal, plan, now);
      const result = await discover({verified, database, tokenVault, environment: env, plan, signal, now, fetchFn});
      return json(result, 200);
    }});
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof DiscoveryError) return stopped(error.code, error.code === "request_contract_invalid" ? 400 : 409);
    if (error instanceof IdentityRuntimeAuthorityError) {
      if (error.code === "IDENTITY_RUNTIME_CREDENTIAL_REFRESH_REQUIRED") return stopped("credential_refresh_required");
      if (["IDENTITY_RUNTIME_AUTHORITY_CHANGED", "IDENTITY_RUNTIME_INSTALLATION_CHANGED"].includes(error.code)) return stopped("authority_changed");
      if (error.code === "IDENTITY_RUNTIME_ABORTED") return stopped("stopped");
    }
    const metadata = googleAdsRestFailureMetadata(error);
    return stopped(metadata ? "provider_error" : "read_unconfirmed", 409, metadata ? {provider_error: metadata} : {});
  }
}
