import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";
import {isStoredDatasetSource} from "../../app/lib/database/dataset-source-reader.server.js";
import {sourceText} from "../../app/lib/database/dataset-source-values.server.js";
import {canonicalSourceJson} from "../../app/lib/database/source-evidence-store.server.js";
import {createVerifiedMappingRepository} from "../../app/lib/database/verified-mapping-store.server.js";

const equal = (a, b) => canonicalSourceJson(a) === canonicalSourceJson(b);
const fieldsByTable = {
  cpd_product_performance_facts: [["native_product_id", "product_mapping_id"]],
  cpd_product_sales_facts: [["native_sold_product_id", "sold_product_mapping_id"], ["native_advertised_product_id", "advertised_product_mapping_id"]],
};

function googleContext(source, row, nativeId, googleLinks) {
  const {owner} = source;
  const {merchant_id, feed_label, language} = row.product_context;
  if (!merchant_id || !feed_label || !language) return null;
  const reportKey = {merchant_id, feed_label, content_language: language};
  const links = googleLinks.filter(link => link.state === "reviewed_synthetic_report_link"
    && equal(link.owner, owner) && link.nativeId === nativeId && equal(link.window, source.scope.window)
    && equal(link.reportKey, reportKey));
  if (links.length !== 1) return null;
  const context = links[0].merchantContext;
  if (!context || !equal(reportKey, {merchant_id: context.merchant_id, feed_label: context.feed_label, content_language: context.content_language})
    || !context.data_source?.startsWith(`accounts/${merchant_id}/dataSources/`) || typeof context.legacy_local !== "boolean") return null;
  return context;
}

function field(properties, key) {
  if (!Object.hasOwn(properties, key)) return {state: "missing"};
  const value = properties[key];
  if (value === null) return {state: "null"};
  return {state: value === "" ? "empty" : "observed", sourceType: typeof value === "object" ? "number" : typeof value, value};
}

function klaviyoContext(source, row, nativeId) {
  if (!/^[1-9][0-9]{0,19}$/.test(nativeId) || BigInt(nativeId) > 18446744073709551615n) return null;
  const product = source.datasets.find(dataset => dataset.dataset === "product_performance");
  const pages = product?.pages ?? [];
  const metric = row.product_context.metric_id;
  const metricProved = pages.some(page => page.family === "klaviyo_metrics" && page.payload.records.some(record =>
    record.id === metric && record.attributes?.name === "Ordered Product" && record.attributes?.integration?.name === "Shopify"));
  const events = pages.filter(page => page.family === "klaviyo_ordered_product_events"
    && row.provenance.sources.some(ref => ref.page_id === page.ref.page_id && ref.batch_id === page.ref.batch_id))
    .flatMap(page => page.payload.records).filter(event => event.id === row.provider_event_id);
  if (!metricProved || events.length !== 1 || events[0].relationships?.metric?.data?.id !== metric) return null;
  const properties = events[0].attributes?.event_properties;
  if (!properties || sourceText(properties.ProductID, {nullable: true}) !== nativeId) return null;
  return {metric_id: metric, integration: "Shopify", product_property: "ProductID",
    product_id_source_type: typeof properties.ProductID === "string" ? "string" : "number",
    variant: field(properties, "Variant ID"), legacy_variant: field(properties, "VariantID")};
}

export function createSyntheticReportMapping({googleLinks = [], now = Date.now, mappingDatabase} = {}) {
  const links = structuredClone(googleLinks);
  return async ({source, projection, database, cipher}) => {
    assert.ok(isStoredDatasetSource(source));
    const {owner} = source;
    assert.ok(["google_ads", "klaviyo"].includes(owner.provider));
    const repository = createVerifiedMappingRepository({database: mappingDatabase ?? database, cipher, now});
    const current = new Map();
    for (const {table, row} of projection.rows) {
      assert.ok(!row.product_mapping_id && !row.sold_product_mapping_id && !row.advertised_product_mapping_id);
      const accepted = [];
      for (const [nativeField, mappingField] of fieldsByTable[table] ?? []) {
        const nativeId = row[nativeField];
        if (nativeId === null) continue;
        const context = owner.provider === "google_ads"
          ? googleContext(source, row, nativeId, links) : klaviyoContext(source, row, nativeId);
        if (!context) continue;
        const identity = {provider: owner.provider, accountId: owner.accountId, nativeId, context};
        const key = canonicalSourceJson(identity);
        if (!current.has(key)) {
          try {
            current.set(key, await repository.readCurrent({owner, identity}));
          } catch (error) {
            if (error.message !== "MAPPING_NOT_VERIFIED") throw error;
            current.set(key, null);
          }
        }
        const mapping = current.get(key);
        if (mapping) accepted.push({mappingField, mapping});
      }
      if (accepted.length === 0) continue;
      // SQL binds all product IDs on a sales fact against the same native context.
      // Distinct scopes cannot be represented on that row under the current schema.
      const {context} = accepted[0].mapping;
      if (accepted.some(({mapping}) => !equal(mapping.context, context))) continue;
      row.product_context = context;
      for (const {mappingField, mapping} of accepted) row[mappingField] = mapping.mappingId;
    }
  };
}

// This fixture loads an isolated copy at the real pre-write seam. The runtime
// entry point and its accepted argument list never receive a mapping override.
export function syntheticMappingReconciliationSource(original) {
  const argumentsEnd = "scheduled = false, googleDailyPackages = false}) {";
  const seam = "  const projection = projectors[bound.provider](source);";
  assert.equal(original.split(argumentsEnd).length, 2);
  assert.equal(original.split(seam).length, 2);
  return original.replace(argumentsEnd, "scheduled = false, googleDailyPackages = false, bindSyntheticMappings}) {")
    .replace(seam, `${seam}\n  if (!projection.holds.length && bindSyntheticMappings) await bindSyntheticMappings({source, projection, database, cipher});\n  stop();`);
}

export async function loadSyntheticMappingReconciliation() {
  const url = new URL("../../app/lib/database/dataset-reconciliation.server.js", import.meta.url);
  const candidateUrl = `${url.href}?syntheticShopifyReportMapping`;
  const candidate = syntheticMappingReconciliationSource(readFileSync(url, "utf8"));
  const hooks = registerHooks({load(href, context, next) {
    if (href === candidateUrl) return {format: "module", source: candidate, shortCircuit: true};
    return next(href, context);
  }});
  try {
    return (await import(candidateUrl)).reconcileStoredDatasetSources;
  } finally {
    hooks.deregister();
  }
}
