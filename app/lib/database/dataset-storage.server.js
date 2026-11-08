import {createHash, randomUUID} from "node:crypto";
import {canonicalSourceJson, sourceStoreOwner} from "./source-evidence-store.server.js";

// Private storage boundary, deliberately not a provider projector or report
// publisher. Only reviewed server projections may construct this DTO. A source
// reference proves storage lineage; it does not prove provider field semantics.
export const DATASET_STORAGE_VERSION = "eo05b-storage-v1";
export const DATASET_GRAIN_VERSION = "eo05b-native-grain-v1";
export const DATASET_EXTENSION_VERSION = "eo05b-extensions-v1";
const metrics = Object.freeze({
  pd_facts: ["impression", "ad_click", "spend_value", "add_to_cart", "add_to_cart_value", "checkout", "checkout_value", "purchase", "purchase_value"],
  cpd_product_performance_facts: ["impression", "click", "spend_value"],
  cpd_product_sales_facts: ["sales_quantity", "sales_value"],
});
const common = ["business_date", "source_timezone", "reporting_scope", "source_identity", "metric_support", "observation_state",
  "metric_extensions", "extension_schema_version", "provenance", "source_batch_id", "source_completeness", "source_currency",
  "target_currency", "fx_rate_id", "fx_state", "fx_engine_version"];
const hierarchy = ["root_entity_type", "root_entity_id", "root_entity_name", "parent_entity_type", "parent_entity_id", "parent_entity_name", "campaign_type"];
const specific = {
  pd_facts: ["entity_type", "entity_id", "entity_name", ...hierarchy],
  cpd_product_performance_facts: ["channel_type", "channel_id", "channel_resolution", ...hierarchy, "native_product_id", "product_context", "product_mapping_id"],
  cpd_product_sales_facts: ["channel_type", "channel_id", "channel_resolution", ...hierarchy, "provider_event_id", "occurred_at", "native_sold_product_id",
    "native_advertised_product_id", "product_context", "sold_product_mapping_id", "advertised_product_mapping_id", "sales_role", "sales_role_evidence", "native_sales_metrics"],
};
const ids = /^(?:[1-9][0-9]{0,18})$/;
const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const prepared = new WeakMap();
const preparedFx = new WeakMap();
const fail = code => {throw Error("DATASET_" + code);};
const digest = value => createHash("sha256").update(value).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function exact(value, keys) {
  if (!object(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) fail("SHAPE_INVALID");
}
function id(value) {return typeof value === "string" && ids.test(value) && BigInt(value) <= 9223372036854775807n;}
function text(value, nullable = false) {return nullable && value === null || typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value);}
function date(value) {return typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;}
function instant(value) {return typeof value === "string" && Number.isFinite(Date.parse(value)) && /^\d{4}-/.test(value);}
function frozen(value) {if (value && typeof value === "object") {Object.values(value).forEach(frozen); Object.freeze(value);} return value;}

/** No binary floating point, exponent, rounding or coercion at this boundary. */
export function datasetDecimal(value) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 128 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/.test(value)) fail("DECIMAL_INVALID");
  return value;
}

function validateIdentity(table, row) {
  // A namespace is not a query family: overlapping queries must use the same
  // reviewed native identity. No inferred Channel/mapping/role/name in this key.
  const identity = row.source_identity;
  exact(identity, ["kind", "namespace", "native"]);
  const nativeKeys = ["entity_type", "entity_id", "campaign_id", "ad_group_id", "asset_group_id", "merchant_id", "catalog_id", "feed_label", "language",
    "product_id", "sold_product_id", "advertised_product_id", "event_id"];
  if (!["daily", "event"].includes(identity.kind) || !text(identity.namespace) || !object(identity.native)
    || !Object.keys(identity.native).length || Object.keys(identity.native).length > 16
    || Object.entries(identity.native).some(([k, v]) => !nativeKeys.includes(k) || !/^[a-z][a-z0-9_]{0,63}$/.test(k) || !text(v, true)
      || /(?:amount|value|name|mapping|role|channel|currency|version|epoch|connection|credential|job|attempt|receipt|cursor)/.test(k))) fail("IDENTITY_INVALID");
  if (identity.kind === "event") {
    if (table !== "cpd_product_sales_facts" || identity.namespace !== "ordered_product" || Object.keys(identity.native).length !== 1
      || identity.native.event_id !== row.provider_event_id || !text(row.provider_event_id)) fail("EVENT_IDENTITY_INVALID");
  } else if (!date(row.business_date) || !text(row.source_timezone) || !object(row.reporting_scope) || !Object.keys(row.reporting_scope).length) fail("DAILY_SCOPE_REQUIRED");
  const namespace = {pd_facts: "entity_performance", cpd_product_performance_facts: "product_performance", cpd_product_sales_facts: "product_sales"};
  if (identity.kind === "daily" && identity.namespace !== namespace[table]) fail("IDENTITY_INVALID");
  if (table === "pd_facts" && (identity.native.entity_id !== row.entity_id || identity.native.entity_type !== row.entity_type)
    || table === "cpd_product_performance_facts" && identity.native.product_id !== row.native_product_id
    || table === "cpd_product_sales_facts" && identity.kind === "daily" && identity.native.sold_product_id !== row.native_sold_product_id) fail("IDENTITY_INVALID");
}

export function datasetNativeKey({owner, table, row}) {
  const o = sourceStoreOwner(owner);
  if (!metrics[table] || o.provider === "shopify") fail("TABLE_INVALID");
  validateIdentity(table, row);
  const s = row.source_identity;
  const tuple = [DATASET_GRAIN_VERSION, o.workspaceId, o.installationId, o.generation, o.provider, o.accountId, table,
    s.kind, s.namespace, s.native,
    ...(s.kind === "daily" ? [row.business_date, row.source_timezone, row.reporting_scope, row.source_currency] : [])];
  const canonical = canonicalSourceJson(tuple);
  return {canonical, hash: digest(canonical)};
}

function validateRow(owner, table, row) {
  exact(row, [...common, ...specific[table], ...metrics[table]]);
  if (row.business_date !== null && !date(row.business_date) || !text(row.source_timezone, true) || !object(row.reporting_scope)
    || !id(row.source_batch_id) || !["complete", "partial"].includes(row.source_completeness)) fail("ROW_INVALID");
  exact(row.metric_support, metrics[table]); exact(row.observation_state, metrics[table]);
  for (const key of metrics[table]) {
    datasetDecimal(row[key]);
    const support = row.metric_support[key], observation = row.observation_state[key];
    if (!["supported", "unsupported", "unknown"].includes(support) || !["present", "missing", "unknown", "unsupported"].includes(observation)
      || (row[key] !== null) !== (support === "supported" && observation === "present")
      || support === "unsupported" && observation !== "unsupported") fail("METRIC_STATE_INVALID");
  }
  // v1 intentionally registers no optional provider fields. Adding a real metric
  // is a reviewed registry revision, never an arbitrary JSON passthrough.
  if (row.extension_schema_version !== DATASET_EXTENSION_VERSION || !object(row.metric_extensions)
    || Object.keys(row.metric_extensions).length || Buffer.byteLength(canonicalSourceJson(row.metric_extensions)) > 16384) fail("EXTENSION_UNREGISTERED");
  exact(row.provenance, ["projection_version", "sources"]);
  if (!text(row.provenance.projection_version) || !Array.isArray(row.provenance.sources) || !row.provenance.sources.length
    || row.provenance.sources.length > 32) fail("PROVENANCE_INVALID");
  for (const ref of row.provenance.sources) {
    exact(ref, ["batch_id", "commit_id", "request_digest", "page_id", "payload_hash"]);
    if (!id(ref.batch_id) || !id(ref.page_id) || !uuid.test(ref.commit_id) || !hash.test(ref.request_digest) || !hash.test(ref.payload_hash)) fail("PROVENANCE_INVALID");
  }
  if (!row.provenance.sources.some(r => r.batch_id === row.source_batch_id)) fail("PRIMARY_SOURCE_REQUIRED");
  for (const field of ["source_currency", "target_currency"]) if (row[field] !== null && !/^[A-Z]{3}$/.test(row[field])) fail("CURRENCY_INVALID");
  if (!["identity", "verified", "missing", "unsupported", "conflicting"].includes(row.fx_state) || row.fx_rate_id !== null && !id(row.fx_rate_id)
    || !text(row.fx_engine_version, true)) fail("FX_INVALID");
  if (row.fx_state === "identity" && (!row.source_currency || row.source_currency !== row.target_currency || row.fx_rate_id !== null)
    || row.fx_state === "verified" && (!row.source_currency || !row.target_currency || !row.fx_rate_id || !row.fx_engine_version)
    || !["identity", "verified"].includes(row.fx_state) && row.fx_rate_id !== null) fail("FX_INVALID");
  for (const key of specific[table]) {
    if (key.endsWith("_mapping_id")) {if (row[key] !== null && !id(row[key])) fail("MAPPING_INVALID");}
    else if (["product_context", "sales_role_evidence", "native_sales_metrics"].includes(key)) {if (!object(row[key])) fail("ROW_INVALID");}
    else if (key === "occurred_at") {if (row[key] !== null && !instant(row[key])) fail("TIME_INVALID");}
    else if (!text(row[key], !["entity_type", "entity_id", "channel_resolution", "sales_role"].includes(key))) fail("ROW_INVALID");
  }
  if (table !== "pd_facts") {
    if (!["verified", "unresolved", "conflicting", "not_applicable"].includes(row.channel_resolution)
      || row.channel_resolution === "verified" && (!row.channel_type || !row.channel_id)
      || row.channel_resolution !== "verified" && (row.channel_type !== null || row.channel_id !== null)) fail("CHANNEL_INVALID");
  }
  if (table === "cpd_product_performance_facts" && (owner.provider === "klaviyo" || row.native_product_id === null)) fail("PRODUCT_GRAIN_REQUIRED");
  if (table === "cpd_product_sales_facts") {
    if (!["Advertised", "Cross-sell", "Assisted", "Triggered", "Unclassified"].includes(row.sales_role)
      || row.sales_role !== "Unclassified" && !Object.keys(row.sales_role_evidence).length
      || owner.provider === "klaviyo" && (row.source_identity.kind !== "event" || row.occurred_at === null)
      || owner.provider !== "klaviyo" && row.source_identity.kind === "event") fail("SALES_EVIDENCE_REQUIRED");
  }
  const key = datasetNativeKey({owner, table, row});
  // Bounded sanitizer rejects PII/secret keys anywhere, including extensions.
  const json = canonicalSourceJson(row);
  if (Buffer.byteLength(json) > 65536) fail("ROW_TOO_LARGE");
  return {...structuredClone(row), native_key_canonical: key.canonical, native_key_hash: key.hash,
    grain_version: DATASET_GRAIN_VERSION, row_schema_version: DATASET_STORAGE_VERSION, payload_digest: digest(json)};
}

/** Single-use capability; policy is explicit and not inferred from UI range. */
export function prepareDatasetWrite({owner, rows, policy, now, operationId = randomUUID()} = {}) {
  const bound = sourceStoreOwner(owner);
  if (bound.provider === "shopify" || !uuid.test(operationId) || !Array.isArray(rows) || rows.length < 1 || rows.length > 200
    || !instant(now)) fail("INPUT_INVALID");
  exact(policy, ["version", "until"]);
  if (!text(policy.version) || !instant(policy.until) || Date.parse(policy.until) <= Date.parse(now)) fail("RETENTION_REQUIRED");
  const keys = new Set();
  const normalized = rows.map(item => {
    exact(item, ["table", "row"]);
    if (!metrics[item.table]) fail("TABLE_INVALID");
    const row = validateRow(bound, item.table, item.row), key = item.table + ":" + row.native_key_hash;
    if (keys.has(key)) fail("DUPLICATE_NATIVE_KEY"); keys.add(key);
    return {table: item.table, row};
  });
  const body = {version: DATASET_STORAGE_VERSION, operationId, policy: structuredClone(policy), rows: normalized};
  if (Buffer.byteLength(canonicalSourceJson(body)) > 1048576) fail("WRITE_TOO_LARGE");
  const capability = frozen({owner: bound, body: frozen(body)});
  prepared.set(capability, {used: false}); return capability;
}

export function createDatasetStorageRepository(database) {
  if (typeof database?.query !== "function") fail("DATABASE_REQUIRED");
  return Object.freeze({
    async recordFx(write) {
      const state = preparedFx.get(write);
      if (!state || state.used) fail("CAPABILITY_REQUIRED"); state.used = true;
      try {
        const result = await database.query("select analytics.record_dataset_fx($1::jsonb) as result", [JSON.stringify(write)]);
        const row = result?.rows?.length === 1 ? result.rows[0].result : null;
        if (!row || !id(row.id) || row.fx_rate !== write.fx_rate || row.fx_provider !== write.fx_provider
          || row.rate_version !== write.rate_version || row.source_currency !== write.source_currency || row.target_currency !== write.target_currency
          || row.fx_rate_date !== write.fx_rate_date) fail("RESULT_INVALID");
        return frozen(structuredClone(row));
      } catch {fail("WRITE_UNCONFIRMED");}
    },
    async commit(write) {
      const state = prepared.get(write);
      if (!state || state.used) fail("CAPABILITY_REQUIRED"); state.used = true;
      try {
        const result = await database.query("select analytics.commit_dataset_storage($1::jsonb,$2::jsonb) as result", [JSON.stringify(write.owner), JSON.stringify(write.body)]);
        const receipt = result?.rows?.length === 1 ? result.rows[0].result : null;
        if (!receipt || receipt.status !== "stored" || receipt.operationId !== write.body.operationId || !hash.test(receipt.digest)
          || receipt.consumerReceipt !== false || !Array.isArray(receipt.rows) || receipt.rows.length !== write.body.rows.length
          || receipt.rows.some((r, i) => !id(r.id) || r.table !== write.body.rows[i].table || r.nativeKeyHash !== write.body.rows[i].row.native_key_hash)) fail("RESULT_INVALID");
        return frozen(structuredClone(receipt));
      } catch {fail("WRITE_UNCONFIRMED");}
    },
    async inspect({owner, sourceBatchId, operationId}) {
      const bound = sourceStoreOwner(owner);
      if (!id(sourceBatchId) || !uuid.test(operationId)) fail("INPUT_INVALID");
      try {
        const result = await database.query("select analytics.inspect_dataset_storage($1::jsonb,$2::bigint,$3::uuid) as result", [JSON.stringify(bound), sourceBatchId, operationId]);
        if (result?.rows?.length !== 1) fail("RESULT_INVALID");
        return frozen(structuredClone(result.rows[0].result));
      } catch {fail("READ_FAILED");}
    },
  });
}

/** Storage for separately reviewed FX proof; this does not select/fetch a source. */
export function prepareDatasetFx(rate) {
  exact(rate, ["source_currency", "target_currency", "fx_rate_date", "fx_rate", "fx_provider", "rate_version", "source_reference", "fetched_at", "fx_schema_version"]);
  datasetDecimal(rate.fx_rate);
  if (!rate.fx_rate || rate.fx_rate === "0" || !/^[A-Z]{3}$/.test(rate.source_currency) || !/^[A-Z]{3}$/.test(rate.target_currency)
    || rate.source_currency === rate.target_currency || !date(rate.fx_rate_date) || !instant(rate.fetched_at)
    || !text(rate.fx_provider) || !text(rate.rate_version) || !text(rate.fx_schema_version) || !object(rate.source_reference)
    || !Object.keys(rate.source_reference).length || Buffer.byteLength(canonicalSourceJson(rate.source_reference)) > 16384) fail("FX_INVALID");
  const write = frozen(structuredClone(rate)); preparedFx.set(write, {used: false}); return write;
}
