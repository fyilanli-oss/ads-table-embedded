import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION = "eo05b-demo-v1";
export const DIRECTORY = "contracts/demo/eo05b-v1";
export const SOURCE = Object.freeze({
  repository: "fyilanli-oss/ads-table-dev",
  path: "codex-input/adstable_one_funnel_compare_all_v2_75_safe_clean_pass8_markup_cleanup-1.html",
  git_blob_sha: "87413af1318cbdb3efbe1104e283d7294bc0c219",
  sha256: "fece0e65ac8c2d20c440d0f98cd510449bd170cf5beccf33e4a6c2cab4db9c35",
  file_bytes: 751960,
  source_json_sha256: "c769f354fa2d4ae5b75dd7758156c00f48d69bc22ba1f00ff2b68b9ed1066f9c",
  source_json_bytes: 458500,
});
export const METRICS = Object.freeze(["impression", "ad_click", "spend_value", "add_to_cart", "add_to_cart_value", "checkout", "checkout_value", "purchase", "purchase_value"]);
const providers = Object.freeze({Google: "google_ads", Meta: "meta", Klaviyo: "klaviyo"});
const fail = reason => { throw new Error("DEMO_FIXTURE_" + reason); };
export const sha256 = value => createHash("sha256").update(value).digest("hex");
const serialize = value => JSON.stringify(value, null, 2) + "\n";

/** Reads one pinned JSON literal; never evaluates the surrounding legacy program. */
export function extractSource(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== SOURCE.file_bytes || sha256(bytes) !== SOURCE.sha256 ||
      createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest("hex") !== SOURCE.git_blob_sha) fail("SOURCE_HASH");
  const html = bytes.toString("utf8"), marker = "const SOURCE_ROWS=";
  const markerStart = html.indexOf(marker);
  if (markerStart < 0 || html.indexOf(marker, markerStart + marker.length) !== -1) fail("SOURCE_MARKER");
  const start = markerStart + marker.length;
  if (html[start] !== "[") fail("SOURCE_ARRAY");
  let depth = 0, quoted = false, escaped = false, end = -1;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) { end = i + 1; break; }
  }
  if (end < 0) fail("SOURCE_ARRAY");
  const literal = html.slice(start, end);
  if (Buffer.byteLength(literal) !== SOURCE.source_json_bytes || sha256(literal) !== SOURCE.source_json_sha256) fail("SOURCE_JSON_HASH");
  return literal;
}

export function validateArchive(literal) {
  if (typeof literal !== "string" || Buffer.byteLength(literal) !== SOURCE.source_json_bytes || sha256(literal) !== SOURCE.source_json_sha256) fail("ARCHIVE_HASH");
  const rows = JSON.parse(literal);
  if (!Array.isArray(rows) || rows.length !== 1000) fail("ARCHIVE_ROWS");
  return rows;
}

function dateValue(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("DATE");
  const ms = Date.parse(date + "T00:00:00.000Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) fail("DATE");
  return ms;
}
const shiftDate = (date, days) => {
  const value = new Date(dateValue(date) + days * 86400000).toISOString().slice(0, 10);
  dateValue(value);
  return value;
};

export function projectMetrics(provider, raw) {
  if (!Object.values(providers).includes(provider) || !raw || typeof raw !== "object" || Array.isArray(raw)) fail("METRICS");
  const metrics = {}, support = {}, observations = {};
  for (const metric of METRICS) {
    const unsupported = provider === "klaviyo" && metric === "spend_value";
    const value = raw[metric];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) fail("METRIC_VALUE");
    support[metric] = unsupported ? "unsupported" : value === undefined ? "unknown" : "supported";
    metrics[metric] = support[metric] === "supported" ? value : null;
    observations[metric] = support[metric] === "supported" ? value === 0 ? "zero" : "present" : support[metric] === "unsupported" ? "unsupported" : "absent";
  }
  return {metrics, support, observations};
}

/** Explicit demo mapping only; names in the old HTML are not provider identity evidence. */
function hierarchy(provider, dimensions, id) {
  const names = provider === "meta"
    ? [["campaign", dimensions.campaign], ["ad_set", dimensions.adgroup], ["ad", dimensions.ad]]
    : provider === "google_ads"
      ? [["campaign", dimensions.campaign], ["ad_group", dimensions.adgroup], ["ad", dimensions.ad]]
      : [["flow", dimensions.campaign], ["flow_message", dimensions.ad]];
  let lineage = "";
  return {
    kind: provider === "google_ads" ? "google_standard" : provider === "meta" ? "meta" : "klaviyo_flow",
    mapping_basis: "explicit_synthetic_overlay_not_native_evidence",
    nodes: names.map(([kind, name]) => {
      lineage += "/" + kind + ":" + name;
      return {kind, id: id(kind + ":" + lineage), name};
    }),
  };
}

function build(rows, {mode = "golden", workspace = "default", demoClock = null} = {}) {
  if (typeof workspace !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(workspace)) fail("WORKSPACE");
  if (!["golden", "rolling_demo"].includes(mode) || (mode === "golden" && demoClock !== null)) fail("MODE");
  const offset = mode === "rolling_demo" ? (dateValue(demoClock) - dateValue("2026-07-20")) / 86400000 : 0;
  const workspaceId = `demo:${VERSION}:${workspace}`;
  const normalized = rows.flatMap((source, index) => {
    const dimensions = source.dimensions, provider = providers[dimensions.platform];
    if (!provider || dimensions.traffic_type !== "paid") return [];
    const id = value => `${workspaceId}:${provider}:${sha256(value).slice(0, 32)}`;
    // Legacy spend does not establish native Klaviyo spend support.
    const {metrics, support, observations} = projectMetrics(provider, source.raw_metrics);
    return [{
      fixture_version: VERSION, workspace_kind: "demo", workspace_id: workspaceId,
      installed_shop_id: `${workspaceId}:shop`, provider, provider_account_id: id("account"),
      provider_business_date: shiftDate(dimensions.date, offset), installed_shop_timezone: "UTC",
      source_currency: dimensions.currency, reporting_currency: dimensions.currency,
      fx: {kind: "same_currency_identity", rate: "1", provider: null},
      metric_support_state: support, observation_state: observations, raw_metrics: metrics,
      freshness_state: "synthetic_fixture", data_origin: "synthetic_demo", provider_truth: false,
      hierarchy: hierarchy(provider, dimensions, id),
      source: {archive_row_index: index, original_business_date: dimensions.date, row_sha256: sha256(JSON.stringify(source))},
    }];
  });
  return {
    fixture_version: VERSION, mode, workspace_key: workspace, demo_clock: demoClock,
    data_origin: "synthetic_demo", provider_truth: false, workspace_kind: "demo",
    display_label: "Synthetic demo data — not live provider data",
    source: {...SOURCE},
    numeric_semantics: "legacy_JSON_IEEE754_values_not_native_decimal_precision_evidence",
    calculated_metrics: "archive_expected_values_only_recompute_in_EO06A",
    product_evidence: false, runtime_seed_authorized: false,
    rows: normalized,
  };
}

export function createGolden(literal, options = {}) {
  if (Object.keys(options).some(key => key !== "workspace")) fail("OPTIONS");
  return build(validateArchive(literal), options);
}

/** Supported schema subset is deliberately explicit; unhandled keywords fail closed. */
export function validateSchema(value, schema, location = "$", definitions = schema.$defs ?? {}) {
  const keywords = ["$schema", "$id", "$defs", "$ref", "title", "description", "type", "const", "enum", "pattern", "minimum", "required", "properties", "additionalProperties", "items", "minItems", "maxItems"];
  for (const key of Object.keys(schema)) if (!keywords.includes(key)) fail("SCHEMA_KEYWORD:" + key);
  if (schema.$ref) {
    if (!schema.$ref.startsWith("#/$defs/") || !definitions[schema.$ref.slice(8)]) fail("SCHEMA_REF");
    return validateSchema(value, definitions[schema.$ref.slice(8)], location, definitions);
  }
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value;
  if (schema.type && ![schema.type].flat().some(t => t === type || t === "number" && type === "integer")) fail("SCHEMA_TYPE:" + location);
  if (typeof value === "number" && !Number.isFinite(value)) fail("SCHEMA_NUMBER:" + location);
  if (Object.hasOwn(schema, "const") && !isDeepStrictEqual(value, schema.const)) fail("SCHEMA_CONST:" + location);
  if (schema.enum && !schema.enum.some(v => isDeepStrictEqual(v, value))) fail("SCHEMA_ENUM:" + location);
  if (typeof value === "string" && schema.pattern && !new RegExp(schema.pattern).test(value)) fail("SCHEMA_PATTERN:" + location);
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) fail("SCHEMA_MINIMUM:" + location);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) fail("SCHEMA_LENGTH:" + location);
    if (schema.items) value.forEach((item, i) => validateSchema(item, schema.items, `${location}[${i}]`, definitions));
  } else if (value && typeof value === "object") {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail("SCHEMA_REQUIRED:" + location + "." + key);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) validateSchema(item, schema.properties[key], location + "." + key, definitions);
      else if (schema.additionalProperties === false) fail("SCHEMA_EXTRA:" + location + "." + key);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validateSchema(item, schema.additionalProperties, location + "." + key, definitions);
    }
  }
  return true;
}

export function validateFixture(fixture, literal) {
  const rows = validateArchive(literal);
  const schema = JSON.parse(fs.readFileSync(path.join(root, DIRECTORY, "schema.json"), "utf8"));
  validateSchema(fixture, schema);
  const expected = build(rows, {mode: fixture.mode, workspace: fixture.workspace_key, demoClock: fixture.demo_clock});
  if (!isDeepStrictEqual(fixture, expected)) fail("SOURCE_PARITY");
  const keys = fixture.rows.map(row => [row.workspace_id, row.provider, row.provider_business_date, row.hierarchy.nodes.at(-1).id].join("|"));
  if (new Set(keys).size !== keys.length) fail("DUPLICATE_GRAIN");
  return {rows: keys.length, google_ads: 200, meta: 200, klaviyo: 100, provider_truth: false};
}

export function projectRolling(golden, demoClock, literal) {
  validateFixture(golden, literal);
  if (golden.mode !== "golden") fail("GOLDEN_REQUIRED");
  const rolling = build(validateArchive(literal), {mode: "rolling_demo", workspace: golden.workspace_key, demoClock});
  validateFixture(rolling, literal);
  return rolling;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, sourcePath] = process.argv.slice(2), directory = path.join(root, DIRECTORY);
  if (command === "extract") {
    if (!sourcePath || process.argv.length !== 4) fail("USAGE");
    const literal = extractSource(fs.readFileSync(sourcePath));
    const golden = createGolden(literal), rolling = projectRolling(golden, "2026-11-10", literal);
    fs.writeFileSync(path.join(directory, "source-rows.json"), literal);
    fs.writeFileSync(path.join(directory, "golden.json"), serialize(golden));
    fs.writeFileSync(path.join(directory, "rolling-2026-11-10.json"), serialize(rolling));
  } else if (command !== "check" || sourcePath) fail("USAGE");
  const literal = fs.readFileSync(path.join(directory, "source-rows.json"), "utf8");
  for (const name of ["golden.json", "rolling-2026-11-10.json"]) {
    console.log(name, validateFixture(JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")), literal));
  }
}
