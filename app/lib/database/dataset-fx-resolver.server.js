import {canonicalSourceJson, sourcePayloadHash} from "./source-evidence-store.server.js";
import {parseGoogleRawJson, googleRawScalar} from "../providers/google-raw-projection.server.js";
import {sourceDecimal} from "./dataset-source-values.server.js";
import {prepareDatasetFx, createDatasetStorageRepository} from "./dataset-storage.server.js";
import {createReportingCurrencyRepository, reportingCurrencyInstallation} from "./reporting-currency.server.js";
import {isStoredDatasetSource} from "./dataset-source-reader.server.js";
import {DATASET_FX_POLICY, DATASET_FX_PROVIDER, DATASET_FX_SCHEMA, REPORTING_CURRENCIES, datasetFxPublicationDate, datasetFxUrl} from "./dataset-fx-policy.server.js";
const resolvers = new WeakMap();
const fail = code => {throw Error("DATASET_FX_" + code);};
const same = (a, b) => canonicalSourceJson(a) === canonicalSourceJson(b);
function bounded(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(Error("DATASET_FX_STOPPED"));
    if (signal.aborted) {Promise.resolve(promise).catch(() => {}); abort(); return;}
    signal.addEventListener("abort", abort, {once: true});
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Fixed public-rate source; injected fetch is transport, not a query/provider
 * selector. One resolver is one execution. No live route, grant or scheduler. */
export function createDatasetFxResolver({database, fetchImpl = globalThis.fetch, now = Date.now} = {}) {
  if (typeof database?.query !== "function" || typeof fetchImpl !== "function" || typeof now !== "function") fail("CONFIG_INVALID");
  const value = Object.freeze({policy: DATASET_FX_POLICY}); resolvers.set(value, {database, fetchImpl, now, used: false}); return value;
}
function validateRate(row, source, target, day) {
  const proof = row?.source_reference, body = proof?.body;
  if (!row || !/^[1-9][0-9]{0,18}$/.test(row.id) || row.source_currency !== source || row.target_currency !== target || row.fx_rate_date !== day
    || row.fx_provider !== DATASET_FX_PROVIDER || row.fx_schema_version !== DATASET_FX_SCHEMA || !body
    || proof.version !== DATASET_FX_SCHEMA || proof.url !== datasetFxUrl(source, target, day) || proof.requestDate !== day
    || Object.keys(proof).sort().join() !== "body,digest,requestDate,url,version" || Object.keys(body).sort().join() !== "base,date,quote,rate"
    || body.date !== day || body.base !== source || body.quote !== target || body.rate !== row.fx_rate || !body.rate || body.rate === "0"
    || sourceDecimal(body.rate) !== body.rate || proof.digest !== sourcePayloadHash(body) || row.rate_version !== proof.digest) fail("PROOF_INVALID");
  return row;
}
async function lookup(database, source, target, day) {
  try {
    const result = await database.query("select analytics.lookup_dataset_fx($1::text,$2::text,$3::date) as result", [source, target, day]);
    if (result.rows?.length !== 1) fail("READ_INVALID");
    return result.rows[0].result === null ? null : validateRate(result.rows[0].result, source, target, day);
  } catch {fail("READ_UNCONFIRMED");}
}
async function fetchRate(state, source, target, day, deadlineAt, signal) {
  const controller = new AbortController(), stop = () => controller.abort();
  if (signal?.aborted || state.now() >= deadlineAt) fail("STOPPED");
  signal?.addEventListener("abort", stop, {once: true}); const timer = setTimeout(stop, Math.max(1, deadlineAt - state.now()));
  let reader;
  try {
    const url = datasetFxUrl(source, target, day), response = await bounded(state.fetchImpl(url, {method: "GET", redirect: "manual", headers: {Accept: "application/json"}, signal: controller.signal}), controller.signal);
    if (controller.signal.aborted || state.now() >= deadlineAt || response.status !== 200 || response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) fail("PROVIDER_UNAVAILABLE");
    reader = response.body?.getReader(); if (!reader) fail("RESPONSE_INVALID");
    const chunks = []; let bytes = 0;
    for (;;) {
      const part = await bounded(reader.read(), controller.signal); if (controller.signal.aborted || state.now() >= deadlineAt) fail("STOPPED");
      if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 16384) fail("RESPONSE_BOUNDS"); chunks.push(Buffer.from(part.value));
    }
    // Reuse only the existing bounded lossless JSON parser, never a reporting
    // projection or a Number conversion of the provider's rate.
    const raw = parseGoogleRawJson(Buffer.concat(chunks).toString("utf8"));
    if (!raw || Object.keys(raw).sort().join() !== "base,date,quote,rate" || raw.date !== day || raw.base !== source || raw.quote !== target
      || typeof raw.rate !== "object" || typeof googleRawScalar(raw.rate) !== "string") fail("RESPONSE_INVALID");
    const body = {date: raw.date, base: raw.base, quote: raw.quote, rate: sourceDecimal(googleRawScalar(raw.rate))};
    if (!body.rate || body.rate === "0") fail("RESPONSE_INVALID");
    const digest = sourcePayloadHash(body);
    return {source_currency: source, target_currency: target, fx_rate_date: day, fx_rate: body.rate, fx_provider: DATASET_FX_PROVIDER,
      rate_version: digest, source_reference: {version: DATASET_FX_SCHEMA, url, requestDate: day, body, digest}, fetched_at: new Date(state.now()).toISOString(), fx_schema_version: DATASET_FX_SCHEMA};
  } catch {fail("PROVIDER_UNCONFIRMED");}
  finally {clearTimeout(timer); signal?.removeEventListener("abort", stop); controller.abort(); void reader?.cancel().catch(() => {});}
}
export async function applyStoredDatasetFx({resolver, database, source, rows, deadlineAt, signal}) {
  const state = resolvers.get(resolver);
  if (!state || state.used || state.database !== database || !isStoredDatasetSource(source)) fail("CAPABILITY_REQUIRED");
  state.used = true;
  const check = () => {if (signal?.aborted || !Number.isFinite(deadlineAt) || state.now() >= deadlineAt) fail("STOPPED");};
  check();
  const configuration = await createReportingCurrencyRepository(database).read(reportingCurrencyInstallation(source.owner)); check();
  if (!configuration) return {holds: [{reason: "reporting_currency_required"}]};
  const from = source.datasets[0].source.currency, target = configuration.currency, businessDate = source.scope.window.from;
  if (!REPORTING_CURRENCIES.includes(from)) return {holds: [{reason: "source_currency_unsupported"}]};
  const day = datasetFxPublicationDate(businessDate); let rate = null;
  if (from !== target) {
    rate = await lookup(database, from, target, day); check();
    if (!rate) {
      const input = await fetchRate(state, from, target, day, deadlineAt, signal); check();
      const receipt = await createDatasetStorageRepository(database).recordFx(prepareDatasetFx(input)); check();
      // Unknown write throws before this known-success readback; no auto retry.
      rate = await lookup(database, from, target, day); check();
      if (!rate || rate.id !== receipt.id || !same(rate.source_reference, receipt.source_reference) || rate.rate_version !== receipt.rate_version || rate.fx_rate !== receipt.fx_rate) fail("READBACK_UNCONFIRMED");
    }
  }
  for (const {row} of rows) {
    if (row.source_currency !== from || row.business_date !== businessDate) fail("ROW_SCOPE_INVALID");
    row.target_currency = target; row.fx_state = from === target ? "identity" : "verified"; row.fx_rate_id = rate?.id ?? null; row.fx_engine_version = DATASET_FX_POLICY;
    row.provenance.reporting_currency = configuration;
    row.provenance.fx_policy = {version: DATASET_FX_POLICY, businessDate, rateDate: from === target ? businessDate : day};
  }
  return {holds: []};
}
