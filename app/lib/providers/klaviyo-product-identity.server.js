import {normalizeKlaviyoOrderedProductEvent} from "./klaviyo-reporting.server.js";
import {verifyShopifyProductCandidate} from "../shopify/product-identity-verification.server.js";

export class KlaviyoProductIdentityError extends Error {
  constructor(code) { super(code); this.name = "KlaviyoProductIdentityError"; this.code = code; }
}
function fail(code) { throw new KlaviyoProductIdentityError(code); }
function freeze(value) {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}
function text(value) {return typeof value === "string" && value.length > 0 && value.length <= 256 && !/\s/.test(value);}
function sourceId(value) {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value)
    && BigInt(value) <= 18446744073709551615n ? value : null;
}
function scopeOf(authority, installation) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (authority?.platform !== "klaviyo" || ![authority.workspace_id, authority.provider_connection_id]
    .every(value => typeof value === "string" && uuid.test(value))
    || typeof authority.installation_id !== "string" || !/^[1-9][0-9]{0,18}$/.test(authority.installation_id)
    || BigInt(authority.installation_id) > 9223372036854775807n
    || !Number.isSafeInteger(authority.installation_generation) || authority.installation_generation < 1
    || !text(authority.platform_account_id) || installation?.authority !== "shopify_installation_verified"
    || installation.status !== "active" || authority.workspace_id !== installation.workspaceId
    || authority.installation_generation !== installation.installGeneration) fail("KLAVIYO_PRODUCT_IDENTITY_SCOPE_MISMATCH");
  return {workspace_id: authority.workspace_id, installation_id: authority.installation_id,
    installation_generation: authority.installation_generation, provider_connection_id: authority.provider_connection_id,
    platform: "klaviyo", platform_account_id: authority.platform_account_id};
}
function proposedIds(properties) {
  const product = properties.ProductID;
  const productId = product.state === "present" ? sourceId(product.value) : null;
  if (productId === null) return {state: "unresolved", reason: product.state === "absent"
    ? "source_product_id_absent" : product.value === null ? "source_product_id_null" : "source_product_id_invalid"};
  const documented = properties["Variant ID"], legacy = properties.VariantID;
  if (documented.state === "absent") {
    if (legacy.state === "present") return {state: "unresolved", reason: "legacy_variant_field_requires_source_evidence"};
    return {state: "candidate", productId, variantId: null, variant_observation: "absent"};
  }
  const variantId = sourceId(documented.value);
  if (variantId === null) return {state: "unresolved", reason: documented.value === null ? "source_variant_id_null" : "source_variant_id_invalid"};
  if (legacy.state === "present") {
    const legacyId = sourceId(legacy.value);
    if (legacyId === null) return {state: "unresolved", reason: "source_variant_alias_invalid"};
    if (legacyId !== variantId) return {state: "conflicting", reason: "source_variant_alias_conflict"};
  }
  return {state: "candidate", productId, variantId, variant_observation: "documented_field_observed"};
}

// Consumes native events and their native Shopify metric from trusted server collection.
// No caller DTO proves account access; lifecycle/current-source composition remains separate.
export async function resolveKlaviyoProductIdentities({events, metric, context, sourceAuthority,
  signal, maxEvents = 10000} = {}) {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 100000
    || !Array.isArray(events) || events.length > maxEvents) fail("KLAVIYO_PRODUCT_IDENTITY_EVENTS_INVALID");
  metric = structuredClone(metric);
  if (metric?.type !== "metric" || !text(metric.id) || metric.attributes?.name !== "Ordered Product"
    || metric.attributes?.integration?.name !== "Shopify") fail("KLAVIYO_PRODUCT_IDENTITY_METRIC_INVALID");
  const installation = structuredClone(context?.installation), shop = structuredClone(context?.shop);
  const scope = scopeOf(sourceAuthority, installation);
  if (shop?.authority !== "shopify_admin_verified") fail("KLAVIYO_PRODUCT_IDENTITY_SHOP_REQUIRED");
  const admin = typeof context?.admin?.graphql === "function" ? Object.freeze({graphql: context.admin.graphql.bind(context.admin)}) : null;
  if (signal?.aborted) fail("KLAVIYO_PRODUCT_IDENTITY_ABORTED");
  // Validate and detach every event before the first Shopify call. IDs are never derived from array position.
  const unique = new Map();
  for (const event of events) {
    const normalized = normalizeKlaviyoOrderedProductEvent(structuredClone(event));
    if (normalized.provider_metric_id !== metric.id) fail("KLAVIYO_PRODUCT_IDENTITY_EVENT_METRIC_MISMATCH");
    const previous = unique.get(normalized.provider_event_id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) fail("KLAVIYO_PRODUCT_IDENTITY_EVENT_CONFLICT");
    unique.set(normalized.provider_event_id, normalized);
  }
  const rows = [], mappings = [], checked = new Map();
  for (const row of unique.values()) {
    if (signal?.aborted) fail("KLAVIYO_PRODUCT_IDENTITY_ABORTED");
    const candidate = proposedIds(row.provider_product_properties);
    let resolution;
    if (candidate.state !== "candidate") resolution = {...candidate, shopify_product_id: null, shopify_variant_id: null, mapping_index: null};
    else {
      const key = JSON.stringify([candidate.productId, candidate.variantId]);
      if (!checked.has(key)) {
        const verified = await verifyShopifyProductCandidate({admin, shop, installation,
          productId: candidate.productId, variantId: candidate.variantId, signal});
        let mappingIndex = null;
        if (verified.state === "candidate_verified_in_shop") {
          mappingIndex = mappings.length;
          mappings.push({...scope, native_product_id: candidate.productId,
            product_context: {integration: "Shopify", metric_id: metric.id, native_variant_id: candidate.variantId},
            shopify_product_id: verified.candidate.product_id, shopify_variant_id: verified.candidate.variant_id,
            mapping_state: "candidate_verified_source_and_shop", mapping_evidence: {metric_id: metric.id,
              metric_name: "Ordered Product", integration_name: "Shopify", source_event_ids: [],
              product_property: "ProductID", variant_property: candidate.variantId === null ? null : "Variant ID",
              shopify: verified.evidence, shop_scope: verified.scope}});
        }
        checked.set(key, {state: mappingIndex === null ? verified.state : "candidate_verified_source_and_shop",
          reason: mappingIndex === null ? verified.reason : "Shopify_ordered_product_candidate_verified_current_source_composition_still_required",
          shopify_product_id: mappingIndex === null ? null : verified.candidate.product_id,
          shopify_variant_id: mappingIndex === null ? null : verified.candidate.variant_id, mapping_index: mappingIndex});
      }
      resolution = {...checked.get(key), variant_observation: candidate.variant_observation};
      if (resolution.mapping_index !== null) mappings[resolution.mapping_index].mapping_evidence.source_event_ids.push(row.provider_event_id);
    }
    rows.push({...row, standardized_product_id: resolution.shopify_product_id, product_identity_resolution: resolution});
  }
  return freeze({version: "1.0.0", scope, rows, mappings,
    mapping_references: "mapping_index_is_local_to_this_result_not_a_database_id",
    provider_link_verified: false, persistable: false, authorizes_activation: false,
    mapping_write_performed: false, sales_roles_changed: false, source_amounts_or_quantities_changed: false});
}
