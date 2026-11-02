import {createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual} from "node:crypto";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const classes = ["metadata", "raw", "identity", "order", "claim"];
const groups = ["pages", "references", "rules", "mappings", "orders", "lines", "journeys", "claims", "links"];
const prepared = new WeakMap();
const fail = code => {throw new Error("SOURCE_STORE_" + code);};
const object = v => v !== null && typeof v === "object" && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;
const id = v => typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
const text = (v, max = 512) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
const instant = v => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const freeze = v => {if (v && typeof v === "object") {Object.values(v).forEach(freeze); Object.freeze(v);} return v;};

// Canonical application bytes, not a claim about original HTTP wire bytes.
export function canonicalSourceJson(value) {
  let nodes = 0, characters = 0;
  const take = s => {characters += s.length; if (characters > 16777216) fail("JSON_BOUNDS"); return s;};
  function visit(v, depth) {
    if (++nodes > 100000 || depth > 32) fail("JSON_BOUNDS");
    if (v === null || typeof v === "boolean") return take(JSON.stringify(v));
    if (typeof v === "string") {
      if (v.length > 65536 || v.includes("\0")) fail("JSON_BOUNDS");
      return take(JSON.stringify(v));
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v) || !Number.isSafeInteger(v)) fail("LOSSY_NUMBER");
      return take(JSON.stringify(v));
    }
    if (Array.isArray(v)) return "[" + v.map(x => visit(x, depth + 1)).join(",") + "]";
    if (!object(v)) fail("JSON_TYPE");
    return "{" + Object.keys(v).sort().map(k => {
      if (/^(?:__proto__|constructor|prototype)$/i.test(k)
        || /token|secret|password|authorization|cookie|email|phone|address|customer|profile/i.test(k)) fail("PRIVATE_FIELD");
      if (k.length > 512) fail("JSON_BOUNDS");
      return take(JSON.stringify(k)) + ":" + visit(v[k], depth + 1);
    }).join(",") + "}";
  }
  return visit(value, 0);
}
export const sourcePayloadHash = value => createHash("sha256").update(canonicalSourceJson(value)).digest("hex");

export function sourceStoreOwner(value) {
  if (!object(value)) fail("OWNER_INVALID");
  const common = ["workspaceId", "installationId", "generation", "shopId", "shopDomain", "provider"];
  const ads = ["connectionId", "connectionVersion", "accountId", "selectionEpoch", "credentialId"];
  const keys = [...common, ...(value.provider === "shopify" ? [] : ads)].sort();
  if (Object.keys(value).sort().join() !== keys.join() || !uuid.test(value.workspaceId) || !id(value.installationId)
    || !id(value.generation) || !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(value.shopId)
    || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value.shopDomain)
    || !["shopify", "google_ads", "meta", "klaviyo"].includes(value.provider)) fail("OWNER_INVALID");
  if (value.provider !== "shopify" && (!uuid.test(value.connectionId) || !uuid.test(value.credentialId) || !id(value.connectionVersion)
    || !text(value.accountId, 256) || (value.provider === "klaviyo" ? value.selectionEpoch !== null : !id(value.selectionEpoch)))) fail("OWNER_INVALID");
  return freeze(structuredClone(value));
}

function binding(owner, attemptId, ordinal, page) {
  return canonicalSourceJson({purpose: "adstable-source-evidence-v1", owner, attemptId, ordinal,
    family: page.family, pageOrdinal: page.ordinal, origin: page.origin, payloadHash: page.payloadHash,
    schemaVersion: page.schemaVersion, sanitizerVersion: page.sanitizerVersion,
    captureLayer: page.captureLayer, numericFidelity: page.numericFidelity, fieldCoverage: page.fieldCoverage,
    keyVersion: page.keyVersion, plainBytes: page.plainBytes});
}

// Explicit injected key material only. No environment access, key provisioning or token-cipher reuse.
export function createSourceEvidenceCipher({keys, activeVersion, forbiddenKeys}) {
  if (!(keys instanceof Map) || !Number.isInteger(activeVersion) || activeVersion < 1 || activeVersion > 32767
    || !Array.isArray(forbiddenKeys) || !keys.has(activeVersion)) fail("KEYRING_INVALID");
  const local = new Map(), fingerprints = new Set();
  for (const [version, key] of keys) {
    if (!Number.isInteger(version) || version < 1 || version > 32767 || !Buffer.isBuffer(key) || key.length !== 32) fail("KEYRING_INVALID");
    const fingerprint = key.toString("hex");
    if (fingerprints.has(fingerprint) || forbiddenKeys.some(v => Buffer.isBuffer(v) && v.length === 32 && timingSafeEqual(v, key))) fail("KEY_REUSE");
    fingerprints.add(fingerprint); local.set(version, Buffer.from(key));
  }
  return Object.freeze({
    seal({owner, attemptId, ordinal, page, payload}) {
      const bytes = Buffer.from(canonicalSourceJson(payload));
      if (bytes.length > 8388608) {bytes.fill(0); fail("JSON_BOUNDS");}
      const metadata = {...page, keyVersion: activeVersion, plainBytes: bytes.length,
        payloadHash: createHash("sha256").update(bytes).digest("hex")};
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", local.get(activeVersion), nonce);
      cipher.setAAD(Buffer.from(binding(owner, attemptId, ordinal, metadata)));
      try {
        return {...metadata, ciphertext: Buffer.concat([cipher.update(bytes), cipher.final()]).toString("hex"),
          nonce: nonce.toString("hex"), authTag: cipher.getAuthTag().toString("hex")};
      } finally {bytes.fill(0);}
    },
    open({owner, attemptId, ordinal, page}) {
      if (!page || !local.has(page.keyVersion) || !hash.test(page.payloadHash)
        || !/^[a-f0-9]+$/.test(page.ciphertext ?? "") || page.ciphertext.length % 2
        || page.ciphertext.length > 16777216 || !/^[a-f0-9]{24}$/.test(page.nonce ?? "") || !/^[a-f0-9]{32}$/.test(page.authTag ?? "")) fail("ENVELOPE_INVALID");
      let bytes;
      try {
        const decipher = createDecipheriv("aes-256-gcm", local.get(page.keyVersion), Buffer.from(page.nonce, "hex"));
        decipher.setAAD(Buffer.from(binding(owner, attemptId, ordinal, page)));
        decipher.setAuthTag(Buffer.from(page.authTag, "hex"));
        bytes = Buffer.concat([decipher.update(Buffer.from(page.ciphertext, "hex")), decipher.final()]);
        if (bytes.length !== page.plainBytes || createHash("sha256").update(bytes).digest("hex") !== page.payloadHash) fail("ENVELOPE_INVALID");
        const payload = JSON.parse(bytes.toString("utf8"));
        if (canonicalSourceJson(payload) !== bytes.toString("utf8")) fail("ENVELOPE_INVALID");
        return freeze(payload);
      } catch {fail("ENVELOPE_INVALID");} finally {bytes?.fill(0);}
    },
  });
}

const schemas = {
  references: ["key", "page", "locatorKind", "locator", "nativeType", "nativeId", "state"],
  rules: ["key", "ruleKey", "version", "kind", "context", "parserVersion", "state", "basis", "applicability"],
  mappings: ["key", "rule", "identity", "revision", "nativeId", "context", "productId", "variantId", "state", "verifiedAt", "applicability"],
  orders: ["key", "reference", "orderId", "updatedAt", "data"],
  lines: ["key", "reference", "order", "lineId", "data"],
  journeys: ["key", "order", "kind", "ordinal", "state", "ready", "complete", "data"],
  claims: ["key", "reference", "provider", "accountId", "claimKey", "nativeId", "nativeOrderId", "order", "linkState", "data"],
  links: ["reference", "targetType", "target", "role"],
};
function exact(value, keys) {
  if (!object(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) fail("SHAPE_INVALID");
}
function pointer(payload, path) {
  if (!/^\/(?:[a-zA-Z0-9_-]+)(?:\/[a-zA-Z0-9_-]+)*$/.test(path)) fail("REFERENCE_INVALID");
  let v = payload;
  for (const key of path.slice(1).split("/")) {
    if (v === null || typeof v !== "object" || !Object.hasOwn(v, key)) fail("REFERENCE_INVALID");
    v = v[key];
  }
  return v;
}

// This is storage validation, never a native verification or authorization receipt.
// Only trusted internal producers may supply sanitized source projections; no route is wired here.
export function prepareSourceWrite({owner, attemptId, ordinal, sourceState, policy, pages, records, cipher, limits, now}) {
  const bound = sourceStoreOwner(owner);
  exact(limits, ["maxBytes", "maxRows"]);
  if (!uuid.test(attemptId) || !Number.isSafeInteger(ordinal) || ordinal < 0 || !["complete", "partial", "failed"].includes(sourceState)
    || !instant(now) || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1 || limits.maxBytes > 16777216
    || !Number.isSafeInteger(limits.maxRows) || limits.maxRows < 1 || limits.maxRows > 1000
    || typeof cipher?.seal !== "function" || !Array.isArray(pages) || pages.length > limits.maxRows) fail("INPUT_INVALID");
  exact(policy, classes);
  for (const kind of classes) {
    exact(policy[kind], ["version", "until"]);
    if (!text(policy[kind].version, 128) || !instant(policy[kind].until) || Date.parse(policy[kind].until) <= Date.parse(now)
      || Date.parse(policy[kind].until) > Date.parse(policy.metadata.until)) fail("POLICY_INVALID");
  }
  exact(records, groups.filter(k => k !== "pages"));
  const payloads = new Map(), body = {sourceState, policy: structuredClone(policy), pages: []};
  let preparedBytes = 0, preparedRows = pages.length;
  const charge = value => {preparedBytes += Buffer.byteLength(canonicalSourceJson(value)); if (preparedBytes > limits.maxBytes) fail("BOUNDS");};
  for (const page of pages) {
    exact(page, ["key", "family", "ordinal", "origin", "captureLayer", "numericFidelity", "fieldCoverage", "schemaVersion", "sanitizerVersion", "payload"]);
    if (!text(page.key, 128) || payloads.has(page.key) || !/^[a-z][a-z0-9_:.-]{0,127}$/.test(page.family)
      || !Number.isSafeInteger(page.ordinal) || page.ordinal < 0 || !["shopify", "google_ads", "meta", "klaviyo"].includes(page.origin)
      || !["native_response_projection", "collector_projection"].includes(page.captureLayer)
      || !["exact_source_string", "lossless_token", "decoded_only"].includes(page.numericFidelity)
      || !Array.isArray(page.fieldCoverage) || !page.fieldCoverage.every(v => text(v, 128))
      || !text(page.schemaVersion, 128) || !text(page.sanitizerVersion, 128)) fail("PAGE_INVALID");
    const {payload, ...metadata} = page;
    payloads.set(page.key, structuredClone(payload));
    const sealed = cipher.seal({owner: bound, attemptId, ordinal, page: metadata, payload});
    charge(sealed); body.pages.push(sealed);
  }
  const keys = new Map();
  for (const group of groups.filter(k => k !== "pages")) {
    const rows = records[group];
    if (!Array.isArray(rows) || rows.length > limits.maxRows) fail("BOUNDS");
    preparedRows += rows.length;
    if (preparedRows > limits.maxRows) fail("BOUNDS");
    keys.set(group, new Set());
    body[group] = rows.map(row => {
      exact(row, schemas[group]);
      if (group !== "links" && (!text(row.key, 128) || keys.get(group).has(row.key))) fail("KEY_DUPLICATE");
      if (group !== "links") keys.get(group).add(row.key);
      charge(row);
      const copy = structuredClone(row);
      if (group === "references") {
        if (!payloads.has(row.page) || !text(row.nativeType, 128) || (row.nativeId !== null && !text(row.nativeId, 1024))) fail("REFERENCE_INVALID");
        const native = pointer(payloads.get(row.page), row.locator);
        if (object(native) && Object.hasOwn(native, "id") && native.id !== row.nativeId) fail("NATIVE_REFERENCE_CONFLICT");
        copy.hash = sourcePayloadHash(native);
      }
      if (group === "orders" && (!/^gid:\/\/shopify\/Order\/[1-9][0-9]*$/.test(row.orderId) || !instant(row.updatedAt))) fail("ORDER_INVALID");
      if ((group === "rules" && row.state === "reviewed") || (group === "mappings" && row.state === "verified") || (group === "claims" && row.linkState === "verified")) fail("NATIVE_RECEIPT_REQUIRED");
      if (group === "claims" && (row.provider !== bound.provider || row.accountId !== bound.accountId)) fail("CLAIM_OWNER");
      return copy;
    });
  }
  const referenceHashes = new Map(body.references.map(r => [r.key, r.hash]));
  for (const group of ["orders", "lines", "claims"]) for (const row of body[group]) {
    if (sourcePayloadHash(row.data) !== referenceHashes.get(row.reference)) fail("CONTENT_REFERENCE_CONFLICT");
    if (group === "orders" && (row.data.id !== row.orderId || row.data.updatedAt !== row.updatedAt)) fail("ORDER_INVALID");
    if (group === "lines" && row.data.id !== row.lineId) fail("LINE_INVALID");
  }
  const targets = {rule: "rules", mapping: "mappings", order: "orders", line: "lines", journey: "journeys", claim: "claims"};
  for (const group of ["orders", "lines", "claims"]) for (const row of body[group]) if (!keys.get("references").has(row.reference)) fail("REFERENCE_INVALID");
  for (const group of ["lines", "journeys"]) for (const row of body[group]) if (!keys.get("orders").has(row.order)) fail("ORDER_INVALID");
  for (const link of body.links) if (!keys.get(targets[link.targetType])?.has(link.target) || !keys.get("references").has(link.reference) || !text(link.role, 128)) fail("LINK_INVALID");
  for (const [kind, group] of [["rule", "rules"], ["mapping", "mappings"], ["journey", "journeys"]]) for (const row of body[group]) {
    if (!body.links.some(link => link.targetType === kind && link.target === row.key)) fail("EVIDENCE_LINK_REQUIRED");
  }
  const encoded = canonicalSourceJson(body);
  if (Buffer.byteLength(encoded) > limits.maxBytes) fail("BOUNDS");
  const result = freeze({owner: bound, attemptId, ordinal, body: JSON.parse(encoded)});
  prepared.set(result, {used: false});
  return result;
}

export function createSourceEvidenceRepository(database) {
  if (typeof database?.query !== "function") fail("DATABASE_REQUIRED");
  function single(result) {
    if (result?.rows?.length !== 1 || !object(result.rows[0].result)) fail("RESULT_INVALID");
    return result.rows[0].result;
  }
  return Object.freeze({
    async commit(write) {
      const state = prepared.get(write);
      if (!state || state.used) fail("WRITE_CAPABILITY_REQUIRED");
      state.used = true;
      try {
        const receipt = single(await database.query("select evidence.commit_source_batch($1::jsonb,$2::uuid,$3::integer,$4::jsonb) as result",
          [JSON.stringify(write.owner), write.attemptId, write.ordinal, JSON.stringify(write.body)]));
        if (receipt.status !== "committed" || !id(receipt.batchId) || !uuid.test(receipt.commitId) || !hash.test(receipt.digest)
          || receipt.sourceState !== write.body.sourceState
          || groups.some(k => receipt.manifest?.counts?.[k] !== write.body[k].length)) fail("RESULT_INVALID");
        return freeze(receipt);
      } catch {fail("WRITE_UNCONFIRMED");}
    },
    async inspect({owner, attemptId, ordinal}) {
      const bound = sourceStoreOwner(owner);
      if (!uuid.test(attemptId) || !Number.isSafeInteger(ordinal) || ordinal < 0) fail("INPUT_INVALID");
      try {return freeze(single(await database.query("select evidence.read_source_receipt($1::jsonb,$2::uuid,$3::integer) as result",
        [JSON.stringify(bound), attemptId, ordinal])));} catch {fail("READ_FAILED");}
    },
    async readPages({owner, attemptId, ordinal, after = "0", limit}) {
      const bound = sourceStoreOwner(owner);
      if (!uuid.test(attemptId) || !Number.isSafeInteger(ordinal) || ordinal < 0 || !(after === "0" || id(after))
        || !Number.isInteger(limit) || limit < 1 || limit > 100) fail("INPUT_INVALID");
      try {
        const result = await database.query("select evidence.read_source_pages($1::jsonb,$2::uuid,$3::integer,$4::bigint,$5::integer) as result",
          [JSON.stringify(bound), attemptId, ordinal, after, limit]);
        if (result?.rows?.length !== 1 || !Array.isArray(result.rows[0].result) || result.rows[0].result.length > limit) fail("RESULT_INVALID");
        return freeze(result.rows[0].result);
      } catch {fail("READ_FAILED");}
    },
  });
}
