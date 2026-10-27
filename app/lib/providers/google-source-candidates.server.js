import {checkedCatalogSourceRule, exactIdentityContext, extractShopifyCandidate} from "./catalog-shopify-candidate.server.js";
import {verifyShopifyProductCandidate} from "../shopify/product-identity-verification.server.js";
import {permissionContext} from "../oauth/identity-permission-preflight.server.js";

// No tenant/source format has been proven and registered. Never add a rule from ID shape alone.
const REVIEWED_SOURCE_RULES = Object.freeze([]);
const ruleLoaders = new WeakSet();
export class GoogleSourceCandidateError extends Error {
  constructor(code) {super(code); this.name = "GoogleSourceCandidateError"; this.code = code;}
}
function fail(code) {throw new GoogleSourceCandidateError(code);}
function freeze(value) {
  if (value && typeof value === "object") {for (const v of Object.values(value)) freeze(v); Object.freeze(value);}
  return value;
}
function text(v) {return typeof v === "string" && v.length > 0 && v.length <= 8192 && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);}
function scopeOf(value) {
  const fields = ["workspace_id", "installation_generation", "provider_connection_id", "platform", "platform_account_id"];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!value || Object.keys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k))
    || value.platform !== "google_ads" || typeof value.workspace_id !== "string" || !uuid.test(value.workspace_id)
    || typeof value.provider_connection_id !== "string" || !uuid.test(value.provider_connection_id)
    || !Number.isSafeInteger(value.installation_generation) || value.installation_generation < 1
    || typeof value.platform_account_id !== "string" || !/^[1-9][0-9]{0,18}$/.test(value.platform_account_id)
    || BigInt(value.platform_account_id) > 9223372036854775807n) fail("GOOGLE_SOURCE_CANDIDATE_SCOPE_INVALID");
  return Object.fromEntries(fields.map(k => [k, value[k]]));
}
function productContext(value) {
  const fields = ["merchant_id", "feed_label", "content_language", "data_source", "legacy_local"];
  if (!value || Object.keys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k))
    || !/^[1-9][0-9]{0,18}$/.test(value.merchant_id ?? "") || typeof value.merchant_id !== "string"
    || BigInt(value.merchant_id) > 9223372036854775807n
    || !text(value.feed_label) || !text(value.content_language) || typeof value.legacy_local !== "boolean"
    || typeof value.data_source !== "string" || !new RegExp(`^accounts/${value.merchant_id}/dataSources/[1-9][0-9]*$`).test(value.data_source)) fail("GOOGLE_SOURCE_CANDIDATE_PRODUCT_CONTEXT_INVALID");
  return Object.fromEntries(fields.map(k => [k, value[k]]));
}
function key(value) {return JSON.stringify([scopeOf(value.scope), productContext(value.product_context), value.shop_id]);}

// Trusted server registry, not a form/request payload. Entries need reviewed native evidence.
// This owner+generation scope deliberately has NO installation PK; it is candidate evidence only.
export function createGoogleCandidateSourceRuleLoader({rules = REVIEWED_SOURCE_RULES} = {}) {
  if (!Array.isArray(rules) || rules.length > 10000) fail("GOOGLE_SOURCE_CANDIDATE_RULES_INVALID");
  const registry = new Map();
  for (const input of rules) {
    const rule = structuredClone(input);
    scopeOf(rule?.scope); productContext(rule?.product_context);
    if (!/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(rule.shop_id ?? "")) fail("GOOGLE_SOURCE_CANDIDATE_RULE_INVALID");
    const checked = checkedCatalogSourceRule(rule, {scope: rule.scope, productContext: rule.product_context, shopId: rule.shop_id},
      code => fail(`GOOGLE_SOURCE_CANDIDATE_${code}`));
    if (!checked) fail("GOOGLE_SOURCE_CANDIDATE_RULE_INVALID");
    const contextKey = key(rule);
    if (registry.has(contextKey)) fail("GOOGLE_SOURCE_CANDIDATE_RULE_CONFLICT");
    registry.set(contextKey, freeze(rule));
  }
  const loader = Object.freeze({load(input) {return registry.get(key(input)) ?? null;}});
  ruleLoaders.add(loader); return loader;
}

// Native Merchant records + source rule + same-shop observation, without canonical mapping.
export async function verifyGoogleMerchantSourceCandidates({source, ownerScope, context, sourceRules, signal,
  maxRows = 10000} = {}) {
  const scope = scopeOf(ownerScope), shop = structuredClone(context?.shop), installation = structuredClone(context?.installation);
  if (shop?.authority !== "shopify_admin_verified" || installation?.authority !== "shopify_installation_verified"
    || installation.status !== "active" || installation.workspaceId !== scope.workspace_id
    || installation.installGeneration !== scope.installation_generation) fail("GOOGLE_SOURCE_CANDIDATE_SHOP_SCOPE_MISMATCH");
  try {permissionContext({provider: "shopify", workspaceId: scope.workspace_id, installGeneration: scope.installation_generation,
    shopId: shop.shopId, shopDomain: shop.myshopifyDomain});} catch {fail("GOOGLE_SOURCE_CANDIDATE_SHOP_SCOPE_MISMATCH");}
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000 || source?.complete !== true
    || !Array.isArray(source.records) || source.records.length > maxRows || !ruleLoaders.has(sourceRules)
    || typeof source.context?.merchant_id !== "string" || !/^[1-9][0-9]{0,18}$/.test(source.context.merchant_id)
    || BigInt(source.context.merchant_id) > 9223372036854775807n) fail("GOOGLE_SOURCE_CANDIDATE_INPUT_INVALID");
  const records = structuredClone(source.records), merchantId = source.context?.merchant_id;
  if (signal?.aborted) fail("GOOGLE_SOURCE_CANDIDATE_ABORTED");
  const admin = typeof context?.admin?.graphql === "function" ? Object.freeze({graphql: context.admin.graphql.bind(context.admin)}) : null;
  const keys = new Set();
  // Validate and detach the whole native source before the first external call.
  for (const record of records) {
    const pc = productContext(record.product_context);
    const expectedKey = JSON.stringify([pc.merchant_id, pc.content_language, pc.feed_label, record.native_product_id, pc.legacy_local]);
    if (pc.merchant_id !== merchantId || !text(record.native_product_id) || record.key !== expectedKey || keys.has(record.key)
      || record.source_record?.offerId !== record.native_product_id || record.source_record?.feedLabel !== pc.feed_label
      || record.source_record?.contentLanguage !== pc.content_language || record.source_record?.dataSource !== pc.data_source
      || Object.hasOwn(record.source_record ?? {}, "legacyLocal") && typeof record.source_record.legacyLocal !== "boolean"
      || (record.source_record?.legacyLocal === true) !== pc.legacy_local
      || record.source_record?.name !== `accounts/${pc.merchant_id}/products/${pc.legacy_local ? "local~" : ""}${pc.content_language}~${pc.feed_label}~${record.native_product_id}`) fail("GOOGLE_SOURCE_CANDIDATE_SOURCE_INVALID");
    keys.add(record.key);
  }
  const rows = [], candidates = [], checks = new Map();
  for (const record of records) {
    if (signal?.aborted) fail("GOOGLE_SOURCE_CANDIDATE_ABORTED");
    const query = freeze({scope: {...scope}, product_context: record.product_context, shop_id: shop.shopId});
    const rule = sourceRules.load(query);
    let resolution = {state: "unresolved", reason: "verified_source_rule_required", candidate_index: null};
    if (rule !== null) {
      if (!checkedCatalogSourceRule(rule, {scope, productContext: record.product_context, shopId: shop.shopId},
        code => fail(`GOOGLE_SOURCE_CANDIDATE_${code}`))) fail("GOOGLE_SOURCE_CANDIDATE_RULE_INVALID");
      if (!exactIdentityContext(rule.scope, scope)) fail("GOOGLE_SOURCE_CANDIDATE_RULE_CONTEXT_MISMATCH");
      const proposed = extractShopifyCandidate(record.native_product_id, rule);
      if (!proposed) resolution.reason = "native_id_does_not_match_verified_rule";
      else {
        const candidateKey = JSON.stringify([proposed.productId, proposed.variantId]);
        if (!checks.has(candidateKey)) checks.set(candidateKey, await verifyShopifyProductCandidate({admin, shop, installation, ...proposed, signal}));
        const verified = checks.get(candidateKey);
        resolution = {state: verified.state, reason: verified.reason, candidate_index: null};
        if (verified.state === "candidate_verified_in_shop") {
          resolution = {state: verified.state, reason: "source_rule_and_same_shop_candidate_checked_not_canonical_mapping", candidate_index: candidates.length};
          candidates.push({native_product_id: record.native_product_id, product_context: record.product_context,
            shopify_product_id: verified.candidate.product_id, shopify_variant_id: verified.candidate.variant_id,
            candidate_state: "candidate_verified_source_and_shop", candidate_evidence: {source_rule: rule,
              source_record_key: record.key, source_id_field: "offerId", shopify: verified.evidence, shop_scope: verified.scope}});
        }
      }
    }
    rows.push({native_product_id: record.native_product_id, product_context: record.product_context, source_record_key: record.key,
      standardized_product_id: null, product_identity_verification: resolution});
  }
  return freeze({rows, candidates, candidate_scope: scope, candidate_references: "candidate_index_is_local_evidence_not_a_mapping_or_database_id",
    canonical_scope_ready: false, provider_link_verified: false, persistable: false, mapping_write_performed: false,
    authorizes_activation: false, source_facts_changed: false});
}
