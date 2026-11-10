import {randomUUID} from "node:crypto";
import {refreshPdMaturityObservation} from "../refresh/pd-source-reader.server.js";
import {deriveMaturityPolicy, evaluateMaturity, MATURITY_VERSION, freezeMaturity, maturityInstant} from "../refresh/maturity-policy.server.js";
import {prepareSourceWrite, sourceStoreOwner, createSourceEvidenceRepository, canonicalSourceJson} from "./source-evidence-store.server.js";
import {readStoredDatasetSources} from "./dataset-source-reader.server.js";
import {projectStoredGoogleDataset} from "../providers/stored-dataset-projection.server.js";
import {projectStoredMetaDataset} from "../providers/stored-meta-dataset.server.js";
import {projectStoredKlaviyoDataset} from "../providers/stored-klaviyo-dataset.server.js";

export const MATURITY_SCHEMA = "eo05c-native-configuration-v1";
const family = "maturity_configuration", sanitizer = "eo05c-attribution-fields-v1";
const capturedObservations = new WeakSet();
const fail = code => {throw Error("MATURITY_STORE_" + code);};
const id = v => typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v);
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).sort().join() === keys.slice().sort().join();
const equal = (a, b) => canonicalSourceJson(a) === canonicalSourceJson(b);
const scalar = v => ["string", "boolean"].includes(typeof v) || v === null ? v : Number.isSafeInteger(v) ? String(v) : null;
const projectors = {google_ads: projectStoredGoogleDataset, meta: projectStoredMetaDataset, klaviyo: projectStoredKlaviyoDataset};

function nativeSettings(observation, owner) {
  const prepared = observation.native_metadata, evidence = observation.evidence;
  if (owner.provider === "google_ads") {
    const actions = snapshot => (snapshot?.actions?.rows ?? []).map(r => {
      const a = r.conversionAction ?? {};
      return {resource: scalar(a.resourceName), status: scalar(a.status), category: scalar(a.category),
        model: scalar(a.attributionModelSettings?.attributionModel), counting: scalar(a.countingType),
        click_days: scalar(a.clickThroughLookbackWindowDays), view_days: scalar(a.viewThroughLookbackWindowDays)};
    }).sort((a, b) => String(a.resource).localeCompare(String(b.resource)));
    return {complete: prepared?.status === "prepared", before: actions(evidence.native_metadata?.before), after: actions(evidence.native_metadata?.after)};
  }
  if (owner.provider === "meta") return {complete: prepared?.status === "prepared",
    request: {action_report_time: scalar(evidence.channel?.evidence?.action_report_time), use_unified_attribution_setting: scalar(evidence.channel?.evidence?.use_unified_attribution_setting)},
    settings: (evidence.channel?.rows ?? [])
    .map(r => ({ad_id: scalar(r.ad_id), setting: scalar(r.attribution_setting)})).sort((a, b) => String(a.ad_id).localeCompare(String(b.ad_id)))};
  return {complete: false, reason: "account_attribution_not_observed"};
}

/** Existing quota/authority-bound reader observation only. No new HTTP or OAuth path. */
export async function storeMaturityConfiguration({database, cipher, owner, observation, policy, limits, attemptId = randomUUID(), now = Date.now, signal}) {
  policy = structuredClone(policy); limits = structuredClone(limits);
  const bound = sourceStoreOwner(owner), witness = refreshPdMaturityObservation(observation, bound);
  if (!witness || !uuid(attemptId) || !exact(limits, ["maxBytes", "maxRows", "deadlineAt", "maxObservationAgeMs"])
    || !Number.isSafeInteger(limits.maxObservationAgeMs) || limits.maxObservationAgeMs < 1 || limits.maxObservationAgeMs > 60000) fail("OBSERVATION_REQUIRED");
  const stop = () => {if (signal?.aborted || !Number.isSafeInteger(limits.deadlineAt) || now() >= limits.deadlineAt) fail("STOPPED");};
  stop(); maturityInstant(witness.observedAt);
  if (Date.parse(witness.observedAt) > now() || now() - Date.parse(witness.observedAt) > limits.maxObservationAgeMs) fail("OBSERVATION_STALE");
  if (capturedObservations.has(observation)) fail("OBSERVATION_ALREADY_USED");
  capturedObservations.add(observation); // Before the first await; unknown writes cannot reset this capability.
  const native = nativeSettings(observation, bound), timeZone = observation.source_context.source_timezone;
  const resolved = deriveMaturityPolicy({provider: bound.provider, timeZone, native});
  const payload = {version: MATURITY_VERSION, provider: bound.provider, timeZone, observedAt: witness.observedAt,
    basis: "current_native_read_not_historical_configuration_proof", native, policy: resolved};
  await database.query("select evidence.assert_source_owner($1::jsonb)", [JSON.stringify(bound)]); stop();
  const write = prepareSourceWrite({owner: bound, attemptId, ordinal: 0, sourceState: "complete", policy,
    pages: [{key: "configuration", family, ordinal: 0, origin: bound.provider, captureLayer: "collector_projection",
      numericFidelity: "decoded_only", fieldCoverage: ["native_attribution_settings", "current_account_binding"],
      schemaVersion: MATURITY_SCHEMA, sanitizerVersion: sanitizer, payload}],
    records: {references: [], rules: [], mappings: [], orders: [], lines: [], journeys: [], claims: [], links: []},
    cipher, limits: {maxBytes: limits.maxBytes, maxRows: limits.maxRows}, now: new Date(now()).toISOString()});
  const repository = createSourceEvidenceRepository(database);
  const receipt = await repository.commit(write); // Unknown commit: no readback or retry.
  stop();
  const read = await readMaturityConfiguration({database, cipher, owner: bound, attemptId, limits, now, signal, registered: false});
  if (!equal(read.payload, payload) || read.receipt.digest !== receipt.digest) fail("CONFIGURATION_READBACK_UNCONFIRMED");
  let result;
  try {
    stop(); result = (await database.query("select evidence.register_maturity_configuration($1::jsonb,$2::uuid,$3::jsonb,$4::timestamptz) as result",
      [JSON.stringify(bound), attemptId, JSON.stringify(payload), new Date(limits.deadlineAt).toISOString()])).rows?.[0]?.result;
    if (!result || result.batchId !== receipt.batchId || result.fingerprint !== resolved.fingerprint) fail("RESULT_INVALID");
  } catch {fail("CONFIGURATION_REGISTER_UNCONFIRMED");}
  stop();
  const confirmed = await readMaturityConfiguration({database, cipher, owner: bound, attemptId, limits, now, signal});
  if (!equal(confirmed.registration, result)) fail("CONFIGURATION_READBACK_UNCONFIRMED");
  return freezeMaturity({attemptId, ...result, policy: resolved, sourceVerified: true, providerTruth: bound.provider !== "klaviyo" && resolved.state === "known", authorizesActivation: false});
}

export async function readMaturityConfiguration({database, cipher, owner, attemptId, limits, now = Date.now, signal, registered = true}) {
  limits = structuredClone(limits);
  const bound = sourceStoreOwner(owner);
  if (!uuid(attemptId) || typeof database?.query !== "function" || typeof cipher?.open !== "function" || !Number.isSafeInteger(limits?.deadlineAt)
    || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1 || limits.maxBytes > 16777216) fail("INPUT_INVALID");
  const stop = () => {if (signal?.aborted || now() >= limits.deadlineAt) fail("STOPPED");};
  await database.query("select evidence.assert_source_owner($1::jsonb)", [JSON.stringify(bound)]); stop();
  const repository = createSourceEvidenceRepository(database), receipt = await repository.inspect({owner: bound, attemptId, ordinal: 0}); stop();
  if (receipt?.status !== "committed" || receipt.sourceState !== "complete" || receipt.manifest?.counts?.pages !== 1 || !id(receipt.batchId) || !hash(receipt.digest)) fail("CONFIGURATION_UNAVAILABLE");
  const pages = await repository.readPages({owner: bound, attemptId, ordinal: 0, limit: 2}); stop();
  const page = pages[0];
  if (pages.length !== 1 || !id(page.id) || page.family !== family || page.origin !== bound.provider || page.ordinal !== 0
    || page.schemaVersion !== MATURITY_SCHEMA || page.sanitizerVersion !== sanitizer || page.captureLayer !== "collector_projection"
    || page.numericFidelity !== "decoded_only" || page.available !== true || page.expired !== false || page.retentionPruned !== false
    || !Number.isSafeInteger(page.plainBytes) || page.plainBytes > limits.maxBytes) fail("CONFIGURATION_PAGE_INVALID");
  const payload = cipher.open({owner: bound, attemptId, ordinal: 0, page});
  const derived = deriveMaturityPolicy({provider: bound.provider, timeZone: payload.timeZone, native: payload.native});
  if (payload.version !== MATURITY_VERSION || payload.provider !== bound.provider || !equal(payload.policy, derived)) fail("CONFIGURATION_POLICY_INVALID");
  maturityInstant(payload.observedAt);
  const registration = receipt.manifest.maturityConfiguration;
  if (registered && (!registration || registration.fingerprint !== derived.fingerprint || registration.batchId !== receipt.batchId
    || registration.pageId !== page.id || registration.payloadHash !== page.payloadHash || !equal(registration.policy, derived))) fail("CONFIGURATION_REGISTRATION_REQUIRED");
  const confirm = await repository.inspect({owner: bound, attemptId, ordinal: 0}); stop();
  if (!equal(confirm, receipt)) fail("CONFIGURATION_CHANGED");
  return freezeMaturity({payload, receipt, registration: registration ?? null});
}

/** Source-verified decision; report-value replacement/consumption/checkpoint is EO05D. */
export async function recordMaturityDecision({database, cipher, owner, configurationAttemptId, anchorAttemptId, batches,
  reportOperationId = null, operationId = randomUUID(), expectedRevision, limits, now = Date.now, signal}) {
  limits = structuredClone(limits); batches = structuredClone(batches);
  const bound = sourceStoreOwner(owner);
  if (!uuid(anchorAttemptId) || !uuid(operationId) || reportOperationId !== null && !uuid(reportOperationId)
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail("INPUT_INVALID");
  const stop = () => {if (signal?.aborted || now() >= limits.deadlineAt) fail("STOPPED");};
  const configuration = await readMaturityConfiguration({database, cipher, owner: bound, attemptId: configurationAttemptId, limits, now, signal});
  const source = await readStoredDatasetSources({database, cipher, owner: bound, batches, limits, now, signal});
  if (Date.parse(configuration.payload.observedAt) > now() || now() - Date.parse(configuration.payload.observedAt) > 60000) fail("CONFIGURATION_STALE");
  const projection = projectors[bound.provider](source);
  let compatible = true;
  if (bound.provider === "meta") {
    // Existing raw captures record native defaults, whereas the opt-in PD reader
    // explicitly uses unified settings/impression date. Never equate those modes.
    const request = configuration.payload.native.request;
    compatible = request?.action_report_time === "impression" && request.use_unified_attribution_setting === true
      && source.datasets.every(d => d.pages.filter(p => p.family.endsWith("daily_insights")).every(p =>
        p.payload.request?.actionReportTime === "impression" && p.payload.request?.useUnifiedAttributionSetting === true));
  } else if (bound.provider === "google_ads") {
    const actions = new Set(configuration.payload.native.before.filter(a => a.status === "ENABLED").map(a => a.resource));
    compatible = source.datasets.every(d => d.pages.every(p => p.payload.records.every(r => (r.fields ?? [])
      .filter(f => f.field === "segments.conversion_action").every(f => actions.has(f.value)))));
  }
  const complete = compatible && projection.holds.length === 0 && source.datasets.every(d => d.receipt.sourceState === "complete");
  const timeZone = source.datasets[0].source.timezone, businessDate = source.scope.window.from;
  if (source.datasets.some(d => d.source.timezone !== timeZone) || configuration.payload.timeZone !== timeZone) fail("TIMEZONE_MISMATCH");
  const request = {version: MATURITY_VERSION, operationId, expectedRevision, configurationBatchId: configuration.receipt.batchId,
    anchorAttemptId, businessDate, timeZone, policyFingerprint: configuration.payload.policy.fingerprint,
    sources: source.datasets.flatMap(d => d.pages.map(p => p.ref)),
    reportBatchIds: source.datasets.map(d => d.receipt.batchId), reportOperationId, complete,
    startedAt: source.datasets.map(d => d.read.observedAt).sort()[0], completedAt: source.datasets.map(d => d.read.completedAt).sort().at(-1)};
  // This pure preview grants no finality; the private RPC independently rechecks
  // source receipts, report readback, newest configuration and the provider clock.
  evaluateMaturity({businessDate, policy: configuration.payload.policy, now: new Date(now()).toISOString()});
  let receipt;
  try {
    stop(); receipt = (await database.query("select evidence.commit_maturity_decision($1::jsonb,$2::jsonb,$3::timestamptz) as result",
      [JSON.stringify(bound), JSON.stringify(request), new Date(limits.deadlineAt).toISOString()])).rows?.[0]?.result;
    if (!receipt || receipt.operationId !== operationId || receipt.revision !== expectedRevision + 1 || !["unknown", "provisional", "final"].includes(receipt.state)) fail("RESULT_INVALID");
  } catch {fail("DECISION_WRITE_UNCONFIRMED");}
  stop();
  const readback = await inspectMaturityDecision({database, owner: bound, anchorAttemptId});
  if (!equal(receipt, readback)) fail("DECISION_READBACK_UNCONFIRMED");
  return freezeMaturity({...receipt, consumerReceipt: false, reportValuesChanged: false, publishable: false, authorizesActivation: false});
}

export async function inspectMaturityDecision({database, owner, anchorAttemptId}) {
  const bound = sourceStoreOwner(owner); if (!uuid(anchorAttemptId)) fail("INPUT_INVALID");
  try {return freezeMaturity((await database.query("select evidence.read_maturity_decision($1::jsonb,$2::uuid) as result",
    [JSON.stringify(bound), anchorAttemptId])).rows?.[0]?.result ?? null);}
  catch {fail("DECISION_READ_UNCONFIRMED");}
}
