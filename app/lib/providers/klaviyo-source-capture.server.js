import {KLAVIYO_REPORTING_API_REVISION, KLAVIYO_REPORTING_STATISTICS} from "./klaviyo-reporting.server.js";

const fail = () => {throw Error("KLAVIYO_SOURCE_RESPONSE_INVALID");};
const numeric = new WeakSet();
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (v, k) => object(v) && Object.hasOwn(v, k);
const select = (v, keys) => Object.fromEntries(keys.filter(k => own(v, k)).map(k => [k, structuredClone(v[k])]));
function scalarSelect(v, keys) {
  for (const k of keys) if (own(v, k) && v[k] !== null && typeof v[k] === "object" && !numeric.has(v[k])) fail();
  return select(v, keys);
}

// Bounded JSON grammar, no Number conversion. Duplicate keys and prototype keys
// are rejected before a projection can hide conflicting native values.
function parse(text) {
  let at = 0, nodes = 0;
  const whitespace = () => {while (/[\t\n\r ]/.test(text[at] ?? "!")) at++;};
  function string() {
    if (text[at] !== '"') fail(); const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '"') {try {return JSON.parse(text.slice(start, at));} catch {fail();}}
      if (c === "\\") at++;
    }
    fail();
  }
  function value(depth) {
    if (++nodes > 100000 || depth > 32) fail(); whitespace(); const c = text[at];
    if (c === '"') return string();
    if (c === "{" || c === "[") {
      at++; const array = c === "[", result = array ? [] : {}, keys = new Set(), close = array ? "]" : "}";
      whitespace(); if (text[at] === close) {at++; return result;}
      for (;;) {
        whitespace(); let key;
        if (!array) {
          key = string(); if (keys.has(key) || /^(?:__proto__|constructor|prototype)$/i.test(key)) fail(); keys.add(key);
          whitespace(); if (text[at++] !== ":") fail();
        }
        const child = value(depth + 1); if (array) result.push(child); else result[key] = child;
        whitespace(); if (text[at] === close) {at++; return result;} if (text[at++] !== ",") fail();
      }
    }
    for (const [word, v] of [["true", true], ["false", false], ["null", null]]) if (text.startsWith(word, at)) {at += word.length; return v;}
    const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at))?.[0];
    if (!token || token.length > 1024) fail(); at += token.length;
    const result = {jsonNumber: token}; numeric.add(result); return result;
  }
  const result = value(0); whitespace(); if (at !== text.length) fail(); return result;
}
function decode(v) {
  if (numeric.has(v)) return Number(v.jsonNumber);
  if (Array.isArray(v)) return v.map(decode);
  if (object(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  return v;
}
function metric(row) {
  const result = select(row, ["type", "id"]);
  if (own(row, "attributes")) {result.attributes = select(row.attributes, ["name"]);
    if (own(row.attributes, "integration")) result.attributes.integration = row.attributes.integration === null ? null : select(row.attributes.integration, ["name", "id"]);}
  return result;
}
function attribution(row) {
  const result = select(row, ["type", "id"]), relations = {};
  for (const k of ["campaign", "campaign-message", "flow", "flow-message", "flow-message-variation", "event", "attributed-event"])
    if (own(row.relationships, k)) relations[k] = {data: row.relationships[k]?.data === null ? null : select(row.relationships[k]?.data, ["type", "id"])};
  result.relationships = relations; return result;
}
const properties = ["ProductID", "VariantID", "Variant ID", "SKU", "ProductName", "Name", "Variant Name", "Quantity", "$value", "OrderId"];
function event(row, detail) {
  const result = select(row, ["type", "id"]); result.attributes = scalarSelect(row?.attributes, detail ? ["datetime", "timestamp"] : ["datetime", "timestamp", "uuid"]);
  if (!detail && own(row?.attributes, "event_properties")) {
    const p = row.attributes.event_properties;
    // A native object resembling our numeric tag is not a native number.
    result.attributes.event_properties = scalarSelect(p, properties);
  }
  const relations = {};
  if (own(row?.relationships, "metric")) relations.metric = {data: select(row.relationships.metric?.data, ["type", "id"])};
  if (!detail && own(row?.relationships, "attributions")) {
    if (!Array.isArray(row.relationships.attributions?.data)) fail();
    relations.attributions = {data: row.relationships.attributions.data.map(r => select(r, ["type", "id"]))};
  }
  result.relationships = relations; return result;
}
function projection(body, path) {
  if (!object(body)) fail(); let family, records;
  if (path === "/api/accounts/") {
    family = "klaviyo_account"; if (!Array.isArray(body.data)) fail();
    records = body.data.map(row => ({...select(row, ["type", "id"]), attributes: select(row.attributes, ["timezone", "preferred_currency"])}));
  } else if (path === "/api/metrics") {
    family = "klaviyo_metrics"; if (!Array.isArray(body.data)) fail(); records = body.data.map(metric);
  } else if (path === "/api/events" || /^\/api\/events\/[A-Za-z0-9_-]+$/.test(path)) {
    const detail = path !== "/api/events"; family = detail ? "klaviyo_interaction" : "klaviyo_ordered_product_events";
    const rows = detail ? [body.data] : body.data; if (!Array.isArray(rows)) fail(); records = rows.map(row => event(row, detail));
  } else if (["/api/campaign-values-reports", "/api/flow-values-reports"].includes(path)) {
    const kind = path.includes("campaign") ? "campaign" : "flow"; family = "klaviyo_" + kind + "_report";
    const rows = body.data?.attributes?.results; if (!Array.isArray(rows)) fail();
    const fields = [kind + "_id", kind + "_name", kind + "_message_id", kind + "_message_name", "variation", "variation_name", "send_channel"];
    records = rows.map(row => ({groupings: scalarSelect(row.groupings, fields), statistics: scalarSelect(row.statistics, KLAVIYO_REPORTING_STATISTICS)}));
  } else fail();
  const included = [];
  if (own(body, "included")) {
    if (!Array.isArray(body.included)) fail();
    for (const row of body.included) if (row?.type === "metric") included.push(metric(row)); else if (row?.type === "attribution") included.push(attribution(row));
  }
  return {family, payload: {records, included, revision: KLAVIYO_REPORTING_API_REVISION,
    ...(own(body.links, "next") ? {hasNext: body.links.next !== null} : {})}};
}

// The unchanged quota boundary returns the original Response. A clone is bounded
// and projected before encryption; raw body, profiles, URLs and tokens never escape.
export function createKlaviyoSourceCapture({maxBytes, check, signal}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16777216 || typeof check !== "function") fail();
  const pages = []; let total = 0;
  return Object.freeze({
    async read(response, endpoint) {
      check(); if (typeof response?.clone !== "function") fail();
      const reader = response.clone().body?.getReader(); if (!reader) fail();
      const chunks = [], cancel = () => {reader.cancel().catch(() => {});};
      signal?.addEventListener("abort", cancel, {once: true});
      try {
        for (;;) {check(); const {done, value} = await reader.read(); check(); if (done) break;
          total += value.byteLength; if (total > maxBytes) fail(); chunks.push(Buffer.from(value));}
        const text = new TextDecoder("utf-8", {fatal: true}).decode(Buffer.concat(chunks)), lossless = parse(text);
        const body = await response.json(); check();
        if (JSON.stringify(body) !== JSON.stringify(decode(lossless))) fail();
        pages.push(projection(lossless, new URL(endpoint).pathname)); return body;
      } catch {cancel(); response.body?.cancel().catch(() => {}); fail();} finally {signal?.removeEventListener("abort", cancel); reader.releaseLock();}
    },
    finish() {return structuredClone(pages);},
  });
}
