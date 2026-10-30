import {createIdentityAuthorityRepository} from "../database/identity-authority-repository.server.js";
import {createRefreshQuotaClients} from "./quota-authority-binding.server.js";
import {refreshWorkIdentity} from "./work-stop-policy.server.js";
import {quotaBoundaryControl} from "./quota-native-fetch.server.js";
import {GOOGLE_PD_QUERY_FAMILIES} from "../providers/google-reporting.server.js";
import {klaviyoTokenRequiresRefresh} from "../providers/klaviyo-api.server.js";
import {GOOGLE_PD_FLOW_FAMILIES, composeGooglePdSnapshot} from "../providers/google-pd-orchestration.server.js";
import {composeKlaviyoPdSnapshot} from "../providers/klaviyo-pd-orchestration.server.js";
import {bridgePdReadSnapshot} from "../providers/pd-record-orchestration.server.js";
import {preparePdNativeMetadata, bindNativePdRecordMetadata} from "../providers/pd-native-metadata.server.js";
import {stableJson} from "../providers/common-adapter.server.js";

// Private in-process proof. A serialized snapshot cannot become an observation.
const observedReads = new WeakMap();
export const isRefreshPdSourceObservation = value => observedReads.has(value);
export function refreshPdStoredPermissionScopes(value) {return observedReads.get(value)?.granted_scopes??null;}
export function refreshPdSetupBindingMatches(value,other) {
  const b=observedReads.get(value);
  return !!b && !!other && b.shop_id===other.shopId && b.shop_domain===other.shopDomain
    && b.credential_id===other.credentialId && b.login_account_id===other.loginAccountId
    && stableJson(b.granted_scopes)===stableJson(other.scopes);
}
export function refreshPdSourceAuthorityMatches(observation, row) {
  const b = observedReads.get(observation);
  if (!b || !row || row.installationStatus !== "active" || row.status !== "connected"
    || !Array.isArray(row.accounts) || row.accounts.length < 1 || row.accounts.length > 3
    || new Set(row.accounts.map(a => a.id)).size !== row.accounts.length) return false;
  const account = row.accounts?.find(a => a.id === b.platform_account_id);
  return row.installationId === b.installation_id && row.workspaceId === b.workspace_id
    && row.installGeneration === b.installation_generation && row.shopId === b.shop_id && row.shopDomain === b.shop_domain
    && row.connectionId === b.provider_connection_id && row.connectionVersion === b.connection_version
    && row.credentialId === b.credential_id && row.selectionEpoch === b.reporting_selection_epoch
    && row.reportingAccountId === b.canonical_reporting_account_id
    && stableJson([...(row.grantedScopes ?? [])].sort()) === stableJson(b.granted_scopes)
    && account?.reporting_eligible === true && account.currency === b.source_currency && account.timezone === b.source_timezone
    && (account.login_account_id ?? null) === b.login_account_id
    && (b.provider === "klaviyo" ? row.accounts.length === 1 && account.kind === "account" && account.status === "active"
      : account.kind === "advertiser");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = v => typeof v === "string" && v.length > 0 && v === v.trim();
function fail(code) { throw new Error(`PD_SOURCE_${code}`); }
function copy(value) {
  if (value === null || typeof value !== "object") return value;
  return Object.freeze(Array.isArray(value) ? value.map(copy)
    : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)])));
}
function date(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

/** Internal, explicit background entry. It does not mount a route, schedule work,
 * compose metrics, resolve product identity, classify roles or write a Dataset.
 * All dependencies are server-owned; none may be supplied from request JSON.
 */
export function createRefreshPdSourceReader({verified, database, tokenVault, workStore, quotaStore,
  claim: suppliedClaim, window: suppliedWindow, entitlementReceipt, queryFamily, googlePd, klaviyoPd, recordBridge, nativeMetadata = false,
  environment = process.env, signal, now = Date.now, readNow = () => new Date(),
  fetchFn = globalThis.fetch, limits, ...extra} = {}) {
  if (Object.keys(extra).length) fail("INPUT_INVALID");
  if (typeof nativeMetadata !== "boolean" || nativeMetadata && (googlePd?.compositionContext !== undefined
    || klaviyoPd?.compositionContexts !== undefined || suppliedClaim?.provider === "google_ads" && !googlePd
    || suppliedClaim?.provider === "klaviyo" && !klaviyoPd)) fail("INPUT_INVALID");
  if (recordBridge !== undefined && (!recordBridge || typeof recordBridge !== "object" || Array.isArray(recordBridge)
    || Object.keys(recordBridge).some(k => k !== "metadata"))) fail("INPUT_INVALID");
  const claim = structuredClone(suppliedClaim), window = structuredClone(suppliedWindow);
  refreshWorkIdentity(claim, {claimRequired: true});
  if (klaviyoPd !== undefined && (claim.provider !== "klaviyo" || !klaviyoPd || typeof klaviyoPd !== "object" || Array.isArray(klaviyoPd)
    || Object.keys(klaviyoPd).some(k => k !== "compositionContexts")
    || klaviyoPd.compositionContexts !== undefined && (!klaviyoPd.compositionContexts || typeof klaviyoPd.compositionContexts !== "object"
      || Array.isArray(klaviyoPd.compositionContexts) || Object.keys(klaviyoPd.compositionContexts).some(k => !["campaign", "flow"].includes(k)))
    || !Number.isSafeInteger(limits?.maxPages) || limits.maxPages < 1 || limits.maxPages > 100 || limits.maxRows > 20_000)) fail("INPUT_INVALID");
  const owner = copy(verified?.installationAuthority), shop = copy(verified?.identity?.shop);
  if (owner?.authority !== "shopify_installation_verified" || owner.status !== "active"
    || owner.workspaceId !== claim.workspaceId || String(owner.installGeneration) !== claim.installGeneration
    || verified?.identity?.session?.authority !== "shopify_id_token_verified"
    || shop?.authority !== "shopify_admin_verified" || !text(shop.shopId)
    || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop.myshopifyDomain ?? "")
    || verified.identity.session.shopDomain !== shop.myshopifyDomain
    || !UUID.test(owner.workspaceId) || !date(window?.from) || window.from !== window.to
    || typeof database?.query !== "function" || typeof tokenVault?.loadProviderTokenSet !== "function"
    || typeof workStore?.loadBoundAuthority !== "function" || typeof workStore?.loadQuotaContext !== "function"
    || typeof fetchFn !== "function" || typeof now !== "function" || typeof readNow !== "function"
    || !["maxElapsedMs", "maxRows", "maxBytes"].every(k => Number.isSafeInteger(limits?.[k]) && limits[k] > 0)
    || limits.maxElapsedMs > 2_147_483_647
    || (claim.provider === "google_ads" ? googlePd === undefined ? !GOOGLE_PD_QUERY_FAMILIES.includes(queryFamily)
      : queryFamily !== undefined || !Object.hasOwn(GOOGLE_PD_FLOW_FAMILIES, googlePd?.flow ?? "")
        || Object.keys(googlePd).some(k => !["flow", "compositionContext"].includes(k))
        || !Number.isSafeInteger(limits?.maxPages) || limits.maxPages < 1 || limits.maxPages > 20 || limits.maxRows > 20_000
      : queryFamily !== undefined || googlePd !== undefined)) fail("INPUT_INVALID");
  const boundLimits = copy(limits), env = {...environment}, receipt = structuredClone(entitlementReceipt);
  const pd = googlePd === undefined ? null : copy(googlePd);
  const kpd = klaviyoPd === undefined ? null : copy(klaviyoPd);
  const bridge = recordBridge === undefined ? null : copy(recordBridge);
  const query = database.query.bind(database), loadToken = tokenVault.loadProviderTokenSet.bind(tokenVault);
  const loadBound = workStore.loadBoundAuthority.bind(workStore), loadQuota = workStore.loadQuotaContext.bind(workStore);
  // Existing reporting readers may request reauthorization/rotation on failures.
  // This entry is read-only: it never converts a failed read into a credential write.
  const readDatabase = {query(sql, values) {
    if (!/^select \* from integrations\.(load_provider_identity_authority|load_provider_account_authority|load_provider_connection_lifecycle_by_owner)\(/.test(sql.trim())) fail("WRITE_FORBIDDEN");
    return query(sql, values);
  }};
  const authority = createIdentityAuthorityRepository(readDatabase);
  let used = false, baseline = null, started, stopped = false;
  const controller = new AbortController();
  const check = () => {
    if (signal?.aborted || controller.signal.aborted || stopped) fail("EXECUTION_STOPPED");
    const current = now();
    if (!Number.isSafeInteger(current) || current < started || current - started >= boundLimits.maxElapsedMs) fail("DEADLINE_EXCEEDED");
  };
  async function currentContext() {
    check();
    const work = await loadBound({claim: structuredClone(claim), window: structuredClone(window)});
    check();
    if (!work || ["workspaceId", "installGeneration", "provider", "accountId"].some(k => work[k] !== claim[k])
      || ["installationVerified", "connected", "setupComplete", "allowedWindow"].some(k => work[k] !== true)) fail("WORK_AUTHORITY_REQUIRED");
    const a = await authority.load({workspaceId: owner.workspaceId, installGeneration: owner.installGeneration,
      provider: claim.provider, shopId: shop.shopId, shopDomain: shop.myshopifyDomain});
    check();
    if (!a || a.installationStatus !== "active" || a.status !== "connected"
      || a.workspaceId !== owner.workspaceId || a.installGeneration !== owner.installGeneration
      || a.shopId !== shop.shopId || a.shopDomain !== shop.myshopifyDomain
      || !UUID.test(a.connectionId) || !UUID.test(a.credentialId)
      || !Number.isSafeInteger(a.connectionVersion) || a.connectionVersion < 1
      || work.connectionId !== a.connectionId || work.connectionVersion !== a.connectionVersion
      || !Array.isArray(a.accounts) || !a.accounts.length || a.accounts.length > 3
      || new Set(a.accounts.map(v => v.id)).size !== a.accounts.length) fail("ACCOUNT_AUTHORITY_REQUIRED");
    const account = a.accounts.find(v => v.id === claim.accountId);
    if (!account || account.reporting_eligible !== true
      || (claim.provider === "klaviyo" ? a.accounts.length !== 1 || a.reportingAccountId !== null
        || account.kind !== "account" || account.status !== "active"
        : account.kind !== "advertiser" || a.reportingAccountId !== claim.accountId)) fail("ACCOUNT_AUTHORITY_REQUIRED");
    if (!/^[A-Z]{3}$/.test(account.currency ?? "") || !text(account.timezone)) fail("ACCOUNT_METADATA_REQUIRED");
    try { new Intl.DateTimeFormat("en", {timeZone: account.timezone}); }
    catch { fail("ACCOUNT_METADATA_REQUIRED"); }
    const context = {workspace_id: a.workspaceId, installation_id: a.installationId,
      installation_generation: a.installGeneration, shop_id: a.shopId, shop_domain: a.shopDomain,
      provider: claim.provider, provider_connection_id: a.connectionId, connection_version: a.connectionVersion,
      credential_id: a.credentialId, reporting_selection_epoch: a.selectionEpoch,
      platform_account_id: account.id, canonical_reporting_account_id: a.reportingAccountId,
      source_currency: account.currency, source_timezone: account.timezone,
      login_account_id: account.login_account_id ?? null, granted_scopes: [...(a.grantedScopes ?? [])].sort()};
    if (baseline !== null && JSON.stringify(context) !== JSON.stringify(baseline)) fail("AUTHORITY_CHANGED");
    if (baseline === null) baseline = copy(context);
    return context;
  }
  return Object.freeze({async readEvidence(...args) {
    if (args.length) fail("OVERRIDE_FORBIDDEN");
    if (used) fail("EXECUTION_USED");
    used = true;
    started = now();
    if (!Number.isSafeInteger(started) || started < 0) fail("CLOCK_INVALID");
    let timer;
    let abort;
    try {
      // Race the whole read (SQL/vault/body included), not just response headers.
      const deadline = new Promise((_, reject) => {timer = setTimeout(() => {
        stopped = true; controller.abort(); reject(new Error("PD_SOURCE_DEADLINE_EXCEEDED"));
      }, boundLimits.maxElapsedMs);});
      const cancelled = new Promise((_, reject) => {
        abort = () => {stopped = true; controller.abort(); reject(new Error("PD_SOURCE_EXECUTION_STOPPED"));};
        signal?.addEventListener("abort", abort, {once: true});
        if (signal?.aborted) abort();
      });
      const operation = (async () => {
        await currentContext();
        const clients = createRefreshQuotaClients({workStore: {loadQuotaContext: async input => {
          await currentContext();
          const value = await loadQuota(input);
          await currentContext();
          return value;
        }}, quotaStore, claim, window, entitlementReceipt: receipt, now,
        fetchFn: async (input, init) => {
          await currentContext();
          const response = await fetchFn(input, {...init, signal: init?.signal
            ? AbortSignal.any([init.signal, controller.signal]) : controller.signal});
          await currentContext();
          return response;
        }});
        const config = {database: readDatabase, tokenVault: {loadProviderTokenSet: async input => {
          await currentContext();
          if (input.provider !== claim.provider || input.credentialId !== baseline.credential_id
            || input.installationAuthority?.workspaceId !== owner.workspaceId
            || input.installationAuthority?.installGeneration !== owner.installGeneration) fail("CREDENTIAL_SCOPE_MISMATCH");
          const token = await loadToken(input);
          await currentContext();
          if (claim.provider === "klaviyo" && klaviyoTokenRequiresRefresh(token, readNow)) fail("CREDENTIAL_REFRESH_REQUIRED");
          return structuredClone(token);
        }}, environment: env, now: readNow};
        const dateWindow = {start: window.from, end: window.to};
        let evidence;
        if (claim.provider === "google_ads") {
          const client = clients.google(config);
          evidence = pd ? await client.readPdEvidenceSnapshot({installationAuthority: owner, dateWindow, flow: pd.flow,
            limits: {maxPages: boundLimits.maxPages, maxRows: boundLimits.maxRows, maxBytes: boundLimits.maxBytes}, nativeMetadata})
            : await client.readEvidencePage({installationAuthority: owner, queryFamily, dateWindow});
        }
        else if (claim.provider === "meta") evidence = await clients.meta({...config, appSecret: env.META_APP_SECRET})
          .readDailyEvidenceSnapshot({installationAuthority: owner, dateWindow, includePromotedProductMetrics: true, nativeMetadata});
        else evidence = await clients.klaviyo(config).readPdEvidenceSnapshot({installationAuthority: owner, businessDate: window.from,
          nativeMetadata,
          ...(kpd ? {limits: {maxPages: boundLimits.maxPages, maxRows: boundLimits.maxRows, maxBytes: boundLimits.maxBytes}} : {})});
        await currentContext();
        const observed = evidence.authority;
        if (evidence.provider !== claim.provider || observed?.connection_id !== baseline.provider_connection_id
          || (claim.provider === "klaviyo" ? observed.connected_account_id : observed.reporting_account_id) !== claim.accountId) fail("READER_SCOPE_MISMATCH");
        const currency = claim.provider === "klaviyo" ? observed.connected_account_currency : observed.reporting_account_currency;
        const timezone = claim.provider === "klaviyo" ? observed.connected_account_timezone : observed.reporting_account_timezone;
        if (claim.provider !== "meta" && (currency !== baseline.source_currency || timezone !== baseline.source_timezone)) fail("READER_METADATA_MISMATCH");
        if (claim.provider === "google_ads" && !pd && evidence.page.next_cursor !== null) fail("PARTIAL_READ");
        if (claim.provider === "klaviyo" && evidence.complete !== true && (!kpd || evidence.status !== "configuration_missing")) fail("INCOMPLETE_READ");
        const pages = claim.provider === "google_ads" ? pd ? [evidence.results.performance, evidence.results.conversions] : [evidence.page] : claim.provider === "meta"
          ? [evidence.channel, evidence.product] : [evidence.results.metrics, ...evidence.results.reports];
        if (claim.provider === "klaviyo") {
          if (evidence.business_date !== window.from) fail("NATIVE_DATE_MISMATCH");
        } else for (const page of pages) for (const row of page.rows) {
          if (claim.provider === "google_ads") {
            if (row.customer?.id !== claim.accountId || row.segments?.date !== window.from) fail("NATIVE_SCOPE_MISMATCH");
          } else if (row.account_id !== claim.accountId.slice(4) || row.date_start !== window.from || row.date_stop !== window.from
            || row.account_currency != null && row.account_currency !== baseline.source_currency) fail("NATIVE_SCOPE_MISMATCH");
        }
        const rows = pages.reduce((n, p) => n + p.rows.length, 0);
        if (rows > boundLimits.maxRows || Buffer.byteLength(JSON.stringify(evidence), "utf8") > boundLimits.maxBytes) fail("RESULT_BOUND_EXCEEDED");
        // Do not fabricate Meta attribution settings/time basis or a common fingerprint.
        // Ancestor IDs, metric units and request evidence remain in the native envelope.
        const {credential_id, granted_scopes, ...safeContext} = baseline;
        const sourceContext = {...safeContext, business_date: window.from,
          job_or_run_id: claim.id, claim_fence: claim.fence,
          reporting_time_basis: claim.provider === "klaviyo" ? "send_date" : claim.provider === "google_ads" ? "interaction_date" : null,
          attribution_fingerprint: null, metric_units_fingerprint: null,
          metadata_state: "native_rows_and_request_evidence_preserved_not_composition_ready"};
        const prepared = nativeMetadata ? preparePdNativeMetadata({sourceContext, evidence}) : null;
        if (prepared?.status === "prepared") {
          sourceContext.metadata_state = claim.provider === "klaviyo" ? "native_account_with_documented_default_attribution_reference"
            : "native_read_time_metadata_prepared_not_historical_authority";
          sourceContext.reporting_time_basis = claim.provider === "meta" ? "impression_date" : sourceContext.reporting_time_basis;
        }
        const blocked = prepared?.status === "blocked" ? {status: "blocked", reason: prepared.reason, rows: [], publishable: false} : null;
        const composition = blocked ?? (pd ? composeGooglePdSnapshot({sourceContext, evidence, compositionContext: prepared?.composition_context ?? pd.compositionContext})
          : kpd ? composeKlaviyoPdSnapshot({sourceContext, evidence, compositionContexts: prepared?.composition_contexts ?? kpd.compositionContexts}) : null);
        const recordMetadata = prepared ? bindNativePdRecordMetadata({prepared, composition, evidence, sourceContext, supplied: bridge?.metadata}) : bridge?.metadata;
        const missingTarget = prepared?.status === "prepared" && !/^[A-Z]{3}$/.test(recordMetadata?.expected_target_currency ?? "");
        const records = prepared?.status === "blocked" || missingTarget ? {status: "blocked", reason: missingTarget ? "reporting_currency_reference_required" : prepared.reason,
          rows: [], canonical_validated: false, persistable: false, authorizes_activation: false, canonical_scope_ready: false, publishable: false}
          : bridge || prepared ? bridgePdReadSnapshot({sourceContext, evidence, composition, metadata: recordMetadata}) : null;
        if (pd || kpd || bridge || nativeMetadata) await currentContext();
        check();
        const result = copy({status: "source_read", source_context: sourceContext, evidence,
          ...(composition ? {composition} : {}),
          ...(records ? {records} : {}),
          ...(prepared ? {native_metadata: prepared} : {}),
          rows_observed: rows, canonical_scope_ready: false, authorizes_activation: false, persistable: false, publishable: false});
        if ((pd || kpd || bridge || nativeMetadata) && Buffer.byteLength(JSON.stringify(result), "utf8") > boundLimits.maxBytes) fail("RESULT_BOUND_EXCEEDED");
        observedReads.set(result, baseline);
        return result;
      })();
      return await Promise.race([operation, deadline, cancelled]);
    } catch (error) {
      // Keep authentic quota wait proof available to the existing worker.
      if (quotaBoundaryControl(error)) throw error;
      if (/^PD_SOURCE_[A-Z_]+$/.test(error?.message ?? "")) throw error;
      fail("READ_FAILED");
    } finally {stopped = true; controller.abort(); clearTimeout(timer); signal?.removeEventListener("abort", abort);}
  }});
}
