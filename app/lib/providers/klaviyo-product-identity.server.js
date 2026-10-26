import {KlaviyoReportingError} from "./klaviyo-reporting.server.js";
import {verifyShopifyProductCandidate} from "../shopify/product-identity-verification.server.js";

function fail(code) { throw new KlaviyoReportingError(code, code); }
function numericSourceId(field) {
  if (field?.state !== "present") return null;
  if (typeof field.value === "string" && field.value.length <= 256 && /^[1-9][0-9]*$/.test(field.value)) return field.value;
  if (Number.isSafeInteger(field.value) && field.value > 0) return String(field.value);
  return null;
}

// Consumes the normalized rows from the authenticated Shopify Ordered Product
// query, after attribution resolution. No metric/role/amount is recomputed here.
export async function resolveKlaviyoProductIdentities({rows, metric, context, sourceAuthority}) {
  if (metric?.type !== "metric" || typeof metric.id !== "string" || !metric.id
    || metric.attributes?.name !== "Ordered Product" || metric.attributes?.integration?.name !== "Shopify") {
    fail("KLAVIYO_PRODUCT_IDENTITY_METRIC_INVALID");
  }
  if (!Array.isArray(rows) || rows.length > 100000) fail("KLAVIYO_PRODUCT_IDENTITY_ROWS_INVALID");
  const installation = context?.installation;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (sourceAuthority?.platform !== "klaviyo"
    || !uuid.test(sourceAuthority.connection_id ?? "") || !uuid.test(sourceAuthority.workspace_id ?? "")
    || typeof sourceAuthority.account_id !== "string" || !sourceAuthority.account_id
    || sourceAuthority.account_id !== sourceAuthority.account_id.trim() || sourceAuthority.account_id.length > 256
    || sourceAuthority.workspace_id !== installation?.workspaceId
    || sourceAuthority.installation_generation !== installation?.installGeneration
    || installation?.status !== "active") fail("KLAVIYO_PRODUCT_IDENTITY_SCOPE_MISMATCH");
  sourceAuthority = Object.freeze({...sourceAuthority});
  context = {...context, installation: Object.freeze({...installation}), shop: Object.freeze({...context.shop})};
  const uniqueEvents = new Map();
  for (const row of rows) {
    if (typeof row?.provider_event_id !== "string" || !row.provider_event_id) fail("KLAVIYO_PRODUCT_IDENTITY_EVENT_ID_REQUIRED");
    if (row.provider_metric_id !== metric.id) fail("KLAVIYO_PRODUCT_IDENTITY_EVENT_METRIC_MISMATCH");
    const previous = uniqueEvents.get(row.provider_event_id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) fail("KLAVIYO_PRODUCT_IDENTITY_EVENT_CONFLICT");
    uniqueEvents.set(row.provider_event_id, row);
  }
  const mappings = [], resolvedRows = [], checked = new Map();
  for (const row of uniqueEvents.values()) {
    const properties = row.provider_product_properties;
    const productId = numericSourceId(properties?.ProductID);
    const variantObserved = properties?.VariantID?.state === "present";
    const variantId = numericSourceId(properties?.VariantID);
    let resolution;
    if (productId === null || (variantObserved && variantId === null)) {
      resolution = Object.freeze({state: "unresolved", reason: "source_product_or_variant_id_missing_or_invalid",
        shopify_product_id: null, shopify_variant_id: null, mapping_index: null});
    } else {
      // Local cache key only, never a DB key or a replacement for an event ID.
      const key = JSON.stringify([productId, variantId]);
      if (!checked.has(key)) {
        const verification = await verifyShopifyProductCandidate({...context, productId, variantId});
        let mappingIndex = null;
        if (verification.state === "candidate_verified_in_shop") {
          mappingIndex = mappings.length;
          mappings.push(Object.freeze({
            platform: "klaviyo", workspace_id: sourceAuthority.workspace_id,
            installation_generation: sourceAuthority.installation_generation,
            provider_connection_id: sourceAuthority.connection_id, platform_account_id: sourceAuthority.account_id,
            native_product_id: productId, shopify_product_id: verification.candidate.product_id,
            product_context: Object.freeze({integration: "Shopify", metric_id: metric.id, native_variant_id: variantId}),
            shopify_variant_id: verification.candidate.variant_id, mapping_state: "verified",
            mapping_evidence: Object.freeze({reader_version: "1.0.0", source: "Shopify Ordered Product", metric_id: metric.id,
              source_event_id: row.provider_event_id,
              product_property: Object.freeze({...properties.ProductID}),
              variant_property: properties.VariantID ? Object.freeze({...properties.VariantID}) : null,
              shopify: verification.evidence, shop_scope: verification.scope}),
          }));
        }
        checked.set(key, Object.freeze({state: mappingIndex === null ? verification.state : "verified",
          reason: mappingIndex === null ? verification.reason : "shopify_ordered_product_and_same_shop_product_verified",
          shopify_product_id: mappingIndex === null ? null : verification.candidate.product_id,
          shopify_variant_id: mappingIndex === null ? null : verification.candidate.variant_id,
          mapping_index: mappingIndex}));
      }
      resolution = checked.get(key);
    }
    resolvedRows.push(Object.freeze({...row, standardized_product_id: resolution.shopify_product_id,
      product_identity_resolution: resolution}));
  }
  return Object.freeze({version: "1.0.0", rows: Object.freeze(resolvedRows), mappings: Object.freeze(mappings),
    mapping_references: "mapping_index_is_local_to_this_result_not_a_database_id",
    mapping_write_performed: false, sales_roles_changed: false});
}
