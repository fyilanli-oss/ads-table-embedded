import {checkedCatalogSourceRule, extractShopifyCandidate} from "./catalog-shopify-candidate.server.js";
import {verifyShopifyProductCandidate} from "../shopify/product-identity-verification.server.js";
import {permissionContext} from "../oauth/identity-permission-preflight.server.js";
import {META_GRAPH_VERSION} from "./meta-graph.server.js";

// No tenant/source format is proven here. Server entries require reviewed native evidence.
const REVIEWED_SOURCE_RULES = Object.freeze([]);
const ruleLoaders = new WeakSet();
export class MetaSourceCandidateError extends Error {
  constructor(code) {super(code); this.name = "MetaSourceCandidateError"; this.code = code;}
}
function fail(code) {throw new MetaSourceCandidateError(code);}
function freeze(value) {
  if (value && typeof value === "object") {for (const v of Object.values(value)) freeze(v); Object.freeze(value);}
  return value;
}
function nativeId(v) {return typeof v === "string" && /^[1-9][0-9]{0,29}$/.test(v);}
function text(v) {return typeof v === "string" && v.length > 0 && v.length <= 8192 && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);}
export function metaCandidateOwnerScope(value) {
  const fields = ["workspace_id", "installation_generation", "provider_connection_id", "platform", "platform_account_id"];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!value || Object.keys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k))
    || value.platform !== "meta" || typeof value.workspace_id !== "string" || !uuid.test(value.workspace_id)
    || typeof value.provider_connection_id !== "string" || !uuid.test(value.provider_connection_id)
    || !Number.isSafeInteger(value.installation_generation) || value.installation_generation < 1
    || typeof value.platform_account_id !== "string" || !/^act_[1-9][0-9]{0,29}$/.test(value.platform_account_id)) fail("META_SOURCE_CANDIDATE_SCOPE_INVALID");
  return Object.fromEntries(fields.map(k => [k, value[k]]));
}
function productContext(value) {
  const fields = ["catalog_id", ...(Object.hasOwn(value ?? {}, "product_feed_id") ? ["product_feed_id"] : [])];
  if (!value || Object.keys(value).length !== fields.length || fields.some(k => !nativeId(value[k]))) fail("META_SOURCE_CANDIDATE_PRODUCT_CONTEXT_INVALID");
  return Object.fromEntries(fields.map(k => [k, value[k]]));
}
function key(value) {return JSON.stringify([metaCandidateOwnerScope(value.scope), productContext(value.product_context), value.shop_id]);}

// Owner+generation scope is candidate context only, never the canonical installation-PK scope.
export function createMetaCandidateSourceRuleLoader({rules = REVIEWED_SOURCE_RULES} = {}) {
  if (!Array.isArray(rules) || rules.length > 10000) fail("META_SOURCE_CANDIDATE_RULES_INVALID");
  const registry = new Map();
  for (const input of rules) {
    const rule = structuredClone(input);
    metaCandidateOwnerScope(rule?.scope); productContext(rule?.product_context);
    if (!/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(rule.shop_id ?? "")) fail("META_SOURCE_CANDIDATE_RULE_INVALID");
    if (!checkedCatalogSourceRule(rule, {scope: rule.scope, productContext: rule.product_context, shopId: rule.shop_id},
      code => fail(`META_SOURCE_CANDIDATE_${code}`))) fail("META_SOURCE_CANDIDATE_RULE_INVALID");
    const contextKey = key(rule);
    if (registry.has(contextKey)) fail("META_SOURCE_CANDIDATE_RULE_CONFLICT");
    registry.set(contextKey, freeze(rule));
  }
  const loader = Object.freeze({load(input) {return registry.get(key(input)) ?? null;}});
  ruleLoaders.add(loader); return loader;
}

// Catalog source candidates only: no Insights product namespace or sale/role interpretation.
export async function verifyMetaCatalogSourceCandidates({source, ownerScope, context, sourceRules, signal, maxRows = 10000} = {}) {
  const scope = metaCandidateOwnerScope(ownerScope), shop = structuredClone(context?.shop), installation = structuredClone(context?.installation);
  if (shop?.authority !== "shopify_admin_verified" || installation?.authority !== "shopify_installation_verified"
    || installation.status !== "active" || installation.workspaceId !== scope.workspace_id
    || installation.installGeneration !== scope.installation_generation) fail("META_SOURCE_CANDIDATE_SHOP_SCOPE_MISMATCH");
  try {permissionContext({provider: "shopify", workspaceId: scope.workspace_id, installGeneration: scope.installation_generation,
    shopId: shop.shopId, shopDomain: shop.myshopifyDomain});} catch {fail("META_SOURCE_CANDIDATE_SHOP_SCOPE_MISMATCH");}
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000 || source?.complete !== true
    || !Array.isArray(source.records) || source.records.length > maxRows || !ruleLoaders.has(sourceRules)
    || !nativeId(source.context?.catalog_id) || source.context.graph_version !== META_GRAPH_VERSION) fail("META_SOURCE_CANDIDATE_INPUT_INVALID");
  const records = structuredClone(source.records), catalogId = source.context.catalog_id;
  const admin = typeof context?.admin?.graphql === "function" ? Object.freeze({graphql: context.admin.graphql.bind(context.admin)}) : null;
  if (signal?.aborted) fail("META_SOURCE_CANDIDATE_ABORTED");
  const keys = new Set();
  // Detach and validate ALL source projections before the first Admin request.
  for (const record of records) {
    const pc = productContext(record.product_context), raw = record.source_record;
    const hasFeed = Object.hasOwn(raw ?? {}, "product_feed") && raw.product_feed !== null;
    if (pc.catalog_id !== catalogId || !nativeId(record.catalog_product_id) || !text(record.retailer_id)
      || record.key !== JSON.stringify([catalogId, record.catalog_product_id]) || keys.has(record.key)
      || raw?.id !== record.catalog_product_id || raw?.retailer_id !== record.retailer_id
      || raw?.product_catalog?.id !== catalogId || hasFeed !== Object.hasOwn(pc, "product_feed_id")
      || hasFeed && raw.product_feed?.id !== pc.product_feed_id) fail("META_SOURCE_CANDIDATE_SOURCE_INVALID");
    keys.add(record.key);
  }
  const rows = [], candidates = [], checks = new Map();
  for (const record of records) {
    if (signal?.aborted) fail("META_SOURCE_CANDIDATE_ABORTED");
    const rule = sourceRules.load(freeze({scope: {...scope}, product_context: record.product_context, shop_id: shop.shopId}));
    let resolution = {state: "unresolved", reason: "verified_source_rule_required", candidate_index: null};
    if (rule !== null) {
      if (!checkedCatalogSourceRule(rule, {scope, productContext: record.product_context, shopId: shop.shopId},
        code => fail(`META_SOURCE_CANDIDATE_${code}`))) fail("META_SOURCE_CANDIDATE_RULE_INVALID");
      // Never parse Meta's internal catalog product ID, group IDs or custom fields.
      const proposed = extractShopifyCandidate(record.retailer_id, rule);
      if (!proposed) resolution.reason = "retailer_id_does_not_match_verified_rule";
      else {
        const candidateKey = JSON.stringify([proposed.productId, proposed.variantId]);
        if (!checks.has(candidateKey)) checks.set(candidateKey, await verifyShopifyProductCandidate({admin, shop, installation, ...proposed, signal}));
        const verified = checks.get(candidateKey);
        resolution = {state: verified.state, reason: verified.reason, candidate_index: null};
        if (verified.state === "candidate_verified_in_shop") {
          resolution = {state: verified.state, reason: "source_rule_and_same_shop_candidate_checked_not_canonical_mapping", candidate_index: candidates.length};
          candidates.push({catalog_product_id: record.catalog_product_id, retailer_id: record.retailer_id, product_context: record.product_context,
            shopify_product_id: verified.candidate.product_id, shopify_variant_id: verified.candidate.variant_id,
            candidate_state: "candidate_verified_source_and_shop", candidate_evidence: {source_rule: rule,
              source_record_key: record.key, source_id_field: "retailer_id", shopify: verified.evidence, shop_scope: verified.scope}});
        }
      }
    }
    rows.push({catalog_product_id: record.catalog_product_id, retailer_id: record.retailer_id,
      product_context: record.product_context, source_record_key: record.key, standardized_product_id: null, product_identity_verification: resolution});
  }
  return freeze({rows, candidates, candidate_scope: scope, candidate_references: "candidate_index_is_local_evidence_not_a_mapping_or_database_id",
    proves_Insights_identity_namespace: false, canonical_scope_ready: false, provider_link_verified: false, persistable: false,
    mapping_write_performed: false, authorizes_activation: false, source_facts_changed: false});
}
