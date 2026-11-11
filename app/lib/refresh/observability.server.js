import {createHash} from "node:crypto";
import {cpuUsage, memoryUsage, hrtime} from "node:process";

// Restricted server composition only. No logger, sender, timer, provider or recovery action.
const bad = () => {throw Error("OBSERVABILITY_INPUT_INVALID");};
const integer = n => Number.isSafeInteger(n) && n >= 0;
const uuid = s => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
const exact = (o, keys) => o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join() === keys.slice().sort().join();
const stages = ["checking_authority","request_intent","response_received","ready_for_dataset"];
const frozen = o => Object.freeze(o);
export const OBSERVABILITY_VERSION = "eo05e-observability-v1";
export const OBSERVABILITY_SQL = "select operations.read_refresh_observation($1::jsonb,$2::date,$3::text) as result";
export const QUEUE_WITNESS_SQL = "select operations.read_refresh_queue_witness() as result";

export async function readQueueWitness({database, environment}) {
  if (typeof database?.query !== "function" || !["production","preview","test"].includes(environment)) bad();
  const rows = (await database.query(QUEUE_WITNESS_SQL)).rows;
  if (rows?.length !== 1) bad();
  const receipt = rows[0].result;
  if (receipt === null) return undefined;
  if (!exact(receipt,["generation","sequence","queueRevision","checkedAtMs"])) bad();
  return frozen({...receipt,environment});
}

// The adapter performs ONE read. Failure never dispatches work, retries, settles an
// ambiguous write, advances a checkpoint, or frees an account/reservation.
export async function readRefreshObservation({database, owner, businessDate, timeZone}) {
  if (typeof database?.query !== "function" || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || typeof timeZone !== "string" || timeZone.length > 64) bad();
  try {
    const result = (await database.query(OBSERVABILITY_SQL, [JSON.stringify(owner), businessDate, timeZone])).rows?.[0]?.result;
    if (result?.version !== OBSERVABILITY_VERSION || !integer(result.observedAtMs)) throw Error();
    return frozen({status: "observed", snapshot: result});
  } catch {return frozen({status: "unavailable", reason: "durable_tracking_unavailable"});}
}

// CPU/RSS belong to the SHARED process during this interval, never to one tenant.
// Explicit counters describe only instrumented calls, not all platform activity.
export function createResourceMeter({clock = () => hrtime.bigint(), cpu = cpuUsage, memory = memoryUsage} = {}) {
  const start = clock(), initial = cpu(); let finished = false;
  const counts = {databaseQueries: 0, providerRequests: 0, rows: 0, bytes: 0};
  return frozen({
    count(kind, value = 1) {
      if (finished || !Object.hasOwn(counts, kind) || !integer(value) || !integer(counts[kind] + value)) bad();
      counts[kind] += value;
    },
    finish(outcome) {
      if (finished || !["verified", "held", "unknown", "failed"].includes(outcome)) bad(); finished = true;
      const end = clock(), used = cpu(), rss = memory().rss;
      if (typeof start !== "bigint" || typeof end !== "bigint" || end < start || !integer(rss)
        || !integer(used.user - initial.user) || !integer(used.system - initial.system)) bad();
      return frozen({version: OBSERVABILITY_VERSION, outcome, elapsedNanoseconds: (end - start).toString(),
        processCpuUserMicroseconds: used.user - initial.user, processCpuSystemMicroseconds: used.system - initial.system,
        processRssBytesAtEnd: rss, processScope: "shared_process_interval_not_job_attribution", counters: frozen({...counts}),
        counterCoverage: "instrumented_calls_only", cloudCost: "unknown", diskIOPS: "unknown", poolerConnections: "unknown"});
    },
  });
}

// Decimal monetary arithmetic is deliberately left to EO06. This supplies exact
// measured units; neither reserved budgets nor overlapping shared CPU are bills.
export function costMeasurementInputs(samples, activeWorkspaces) {
  if (!Array.isArray(samples) || samples.length > 10000 || !integer(activeWorkspaces)) bad();
  const totals = {databaseQueries: 0n, providerRequests: 0n, rows: 0n, bytes: 0n, elapsedNanoseconds: 0n};
  const seen = new Set();
  for (const sample of samples) {
    if (!exact(sample, ["measurementId", "workClass", "measurement"]) || !uuid(sample.measurementId)
      || seen.has(sample.measurementId) || !["today_yesterday_hourly", "older_nonfinal_daily", "bootstrap"].includes(sample.workClass)) bad();
    seen.add(sample.measurementId); const m = sample.measurement;
    if (m?.version !== OBSERVABILITY_VERSION || m.counterCoverage !== "instrumented_calls_only" || !/^\d{1,30}$/.test(m.elapsedNanoseconds)) bad();
    for (const k of Object.keys(totals)) {const v = k === "elapsedNanoseconds" ? m[k] : m.counters?.[k]; if (k !== "elapsedNanoseconds" && !integer(v)) bad(); totals[k] += BigInt(v);}
  }
  return frozen({status: "measurement_inputs_only", activeWorkspaces, totals: Object.fromEntries(Object.entries(totals).map(([k,v]) => [k,v.toString()])),
    costPerActiveWorkspace: "unknown_requires_approved_rates_and_complete_coverage", capacityCertified: false});
}

// State must be loaded/saved by an INDEPENDENT durable adapter before any send.
// In-memory calls/tests are not a production witness or an activation certificate.
export function observeQueueWitness({state, receipt, nowMs}) {
  if (!exact(state, ["environment", "generation", "activatedAtMs", "sequence", "checkedAtMs", "queueRevision", "lastObserverAtMs"])
    || !["production", "preview", "test"].includes(state.environment) || !uuid(state.generation)
    || !integer(state.activatedAtMs) || !integer(state.sequence) || !integer(state.queueRevision)
    || !integer(nowMs) || !integer(state.lastObserverAtMs) || state.lastObserverAtMs < state.activatedAtMs || nowMs < state.lastObserverAtMs
    || (state.checkedAtMs === null) !== (state.sequence === 0) || (state.sequence === 0) !== (state.queueRevision === 0)
    || state.checkedAtMs !== null && (!integer(state.checkedAtMs) || state.checkedAtMs < state.activatedAtMs || state.checkedAtMs > state.lastObserverAtMs)) bad();
  let accepted = false, next = {...state, lastObserverAtMs: nowMs};
  if (receipt !== undefined && exact(receipt, ["environment", "generation", "sequence", "queueRevision", "checkedAtMs"])
    && receipt.environment === state.environment && receipt.generation === state.generation
    && integer(receipt.sequence) && receipt.sequence > state.sequence && integer(receipt.queueRevision) && receipt.queueRevision > state.queueRevision
    && integer(receipt.checkedAtMs) && receipt.checkedAtMs >= state.activatedAtMs && receipt.checkedAtMs <= nowMs
    && receipt.checkedAtMs > (state.checkedAtMs ?? state.activatedAtMs - 1)) {
    next = {...next, sequence: receipt.sequence, queueRevision: receipt.queueRevision, checkedAtMs: receipt.checkedAtMs}; accepted = true;
  }
  const reference = next.checkedAtMs ?? next.activatedAtMs, elapsedMs = nowMs - reference;
  return frozen({state: frozen(next), accepted, elapsedMs, deadlineAtMs: reference + 120000,
    status: elapsedMs > 120000 ? "critical" : "within_window", durableWitness: false, datasetFreshness: "not_proven"});
}

// Adapter contract: read independent durable state, read a verified primary queue
// receipt, then compare-and-swap the independent state ONCE. Never initialize or
// reset activation here. Adapter selection/independence/canary remain live gates.
export async function runIndependentObservation({store, readReceipt, nowMs, now = () => nowMs}) {
  if (typeof store?.read !== "function" || typeof store?.commit !== "function" || typeof readReceipt !== "function") bad();
  let saved, observed, primaryAvailable = true;
  try {
    saved = await store.read();
    if (!exact(saved, ["revision", "state"]) || !integer(saved.revision)) throw Error();
    let receipt; try {receipt = await readReceipt();} catch {primaryAvailable = false;}
    observed = observeQueueWitness({state:saved.state,receipt,nowMs:now()});
    const ack = await store.commit({expectedRevision:saved.revision,state:observed.state});
    if (!exact(ack, ["committed", "revision"]) || ack.committed !== true || ack.revision !== saved.revision + 1) throw Error();
  } catch {return frozen({status:"unavailable",rule:"AL15",durableWitness:false});}
  return frozen({...observed,durableWitness:true,primaryAvailable,rules:[...observed.status === "critical" ? ["AL01"] : [],...primaryAvailable ? [] : ["AL10"]]});
}

const rules = Object.freeze({
  AL01: ["queue_check", "critical"], AL02: ["selection", "critical"], AL03: ["claim", "critical"], AL04: ["authority", "critical"],
  AL05: ["provider_request", "action_required"], AL06: ["execution", "critical"], AL07: ["provider_response", "action_required"],
  AL08: ["expected_no_work", "informational"], AL09: ["normalization", "critical"], AL10: ["durable_tracking", "critical"],
  AL11: ["Dataset_commit", "critical"], AL12: ["checkpoint", "critical"], AL13: ["freshness", "critical"],
  AL14: ["alarm_delivery", "critical"], AL15: ["watchdog", "critical"], AL16: ["telemetry_security", "critical"],
});
export function alarmSignal({rule, environment, generation, scopeRef, nowMs}) {
  if (!Object.hasOwn(rules, rule) || !["production", "preview", "test"].includes(environment) || !uuid(generation) || !uuid(scopeRef) || !integer(nowMs)) bad();
  const [stage, severity] = rules[rule];
  return frozen({fingerprint: createHash("sha256").update(JSON.stringify([environment,generation,scopeRef,rule,stage])).digest("hex"),
    rule, environment, generation, scopeRef, stage, severity, observedAtMs: nowMs});
}

// Manifest completeness is supplied by the authorized coordinator. A healthy
// partition never masks an omitted one. No inferred fixed provider horizon.
export function evaluateRefreshHealth({nowMs, expected, observations, limits}) {
  if (!integer(nowMs) || !Array.isArray(expected) || expected.length > 10000 || !Array.isArray(observations)
    || observations.length > 10000 || !exact(limits, ["waitMs", "stageMs", "freshnessMs", "reconciliationMs"])
    || !exact(limits.stageMs,stages) || Object.values(limits.stageMs).some(v => !integer(v) || v < 1)
    || [limits.waitMs,limits.freshnessMs,limits.reconciliationMs].some(v => !integer(v) || v < 1)) bad();
  const expectedSet = new Set(expected), seen = new Map();
  if (expectedSet.size !== expected.length || expected.some(x => !uuid(x))) bad();
  for (const o of observations) {
    if (!exact(o, ["scopeRef", "eligible", "dueAtMs", "stage", "stageAtMs", "datasetVerifiedAtMs", "oldestNonfinalAtMs", "condition"])
      || !expectedSet.has(o.scopeRef) || seen.has(o.scopeRef) || typeof o.eligible !== "boolean"
      || o.stage !== null && !stages.includes(o.stage) || (o.stage === null) !== (o.stageAtMs === null)
      || ![null,"provider_error","partial_response","authority_lost","unknown_outcome","integrity_mismatch","checkpoint_invalid","valid_empty","budget_wait","disconnected"].includes(o.condition)
      || [o.dueAtMs,o.stageAtMs,o.datasetVerifiedAtMs,o.oldestNonfinalAtMs].some(t => t !== null && (!integer(t) || t > nowMs))) bad();
    seen.set(o.scopeRef,o);
  }
  return expected.map(scopeRef => {
    const o = seen.get(scopeRef), rules = [];
    if (!o) return frozen({scopeRef, rules: ["AL02"], freshness: "unknown"});
    const mapped = {provider_error:"AL05",partial_response:"AL07",authority_lost:"AL04",unknown_outcome:"AL06",integrity_mismatch:"AL11",checkpoint_invalid:"AL12",valid_empty:"AL08",budget_wait:"AL08",disconnected:"AL08"};
    if (o.condition) rules.push(mapped[o.condition]);
    if (o.eligible && o.dueAtMs !== null && nowMs - o.dueAtMs > limits.waitMs) rules.push("AL02");
    if (o.eligible && o.stageAtMs !== null && nowMs - o.stageAtMs > limits.stageMs[o.stage]) rules.push("AL13");
    const age = o.datasetVerifiedAtMs === null ? null : nowMs - o.datasetVerifiedAtMs;
    if (o.eligible && (age === null || age > limits.freshnessMs)) rules.push("AL13");
    const reconciliationAgeMs = o.oldestNonfinalAtMs === null ? null : nowMs - o.oldestNonfinalAtMs;
    if (o.eligible && reconciliationAgeMs !== null && reconciliationAgeMs > limits.reconciliationMs) rules.push("AL13");
    return frozen({scopeRef, rules: [...new Set(rules)], freshness: age === null ? "unknown" : age > limits.freshnessMs ? "stale" : "verified", ageMs: age, reconciliationAgeMs});
  });
}

// Pure bounded incident reducer. An external adapter must CAS this result and
// apply approved expiry/deletion rules; the reducer itself sends/stores nothing.
export function recordAlarm(previous, signal, {expiresAtMs}) {
  const trusted = alarmSignal({rule:signal?.rule,environment:signal?.environment,generation:signal?.generation,scopeRef:signal?.scopeRef,nowMs:signal?.observedAtMs});
  if (JSON.stringify(trusted) !== JSON.stringify(signal) || !integer(expiresAtMs) || expiresAtMs <= signal.observedAtMs) bad();
  if (previous === null) return frozen({...signal, firstAtMs: signal.observedAtMs, lastAtMs: signal.observedAtMs, count: 1, expiresAtMs, state: "detected", acknowledged: false});
  validateIncident(previous);
  if (previous.fingerprint !== signal.fingerprint || previous.state === "resolved" || signal.observedAtMs < previous.lastAtMs
    || previous.expiresAtMs <= signal.observedAtMs || !integer(previous.count + 1)) bad();
  // Repeated ticks don't renew retention or revert notification state.
  return frozen({...previous, lastAtMs:signal.observedAtMs,count:previous.count+1});
}
function validateIncident(incident) {
  if (!exact(incident, ["fingerprint","rule","environment","generation","scopeRef","stage","severity","observedAtMs","firstAtMs","lastAtMs","count","expiresAtMs","state","acknowledged",...Object.hasOwn(incident ?? {},"delivery") ? ["delivery"] : []])) bad();
  const signal = alarmSignal({rule:incident.rule,environment:incident.environment,generation:incident.generation,scopeRef:incident.scopeRef,nowMs:incident.observedAtMs});
  if (signal.fingerprint !== incident.fingerprint || signal.stage !== incident.stage || signal.severity !== incident.severity
    || !["detected","dispatch_pending","notification_accepted","delivery_verified_or_unknown","human_acknowledged","resolved"].includes(incident.state)
    || ![incident.firstAtMs,incident.lastAtMs,incident.count,incident.expiresAtMs].every(integer) || incident.count < 1
    || incident.firstAtMs !== incident.observedAtMs || incident.lastAtMs < incident.firstAtMs || incident.expiresAtMs <= incident.lastAtMs
    || typeof incident.acknowledged !== "boolean" || Object.hasOwn(incident,"delivery") && !["verified","unknown"].includes(incident.delivery)) bad();
}
export function transitionAlarm(incident, action, {verified = false, authorized = false} = {}) {
  validateIncident(incident);
  const next = {detected:"dispatch_pending",dispatch_pending:"notification_accepted",notification_accepted:"delivery_verified_or_unknown",delivery_verified_or_unknown:"human_acknowledged"};
  if (action === "resolve") {
    if (!verified || !authorized || incident.state === "resolved") bad();
    return frozen({...incident,state:"resolved"});
  }
  if (action !== next[incident.state] || action === "human_acknowledged" && (!verified || !authorized)) bad();
  return frozen({...incident,state:action,...action === "delivery_verified_or_unknown" ? {delivery: verified ? "verified" : "unknown"} : {},
    ...action === "human_acknowledged" ? {acknowledged:true} : {}});
}

async function boundedObserverCall(timeoutMs, operation) {
  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { reject(Error("OBSERVER_IO_TIMEOUT")); controller.abort(); }, timeoutMs);
    });
    return await Promise.race([timeout, Promise.resolve().then(() => operation(controller.signal))]);
  } finally { clearTimeout(timer); }
}

// Trusted observer entry. The deployment supplies a separately hosted store,
// durable queue reader and approved notification route. Store CAS must be atomic.
export async function runQueueSilenceAlarm({witnessStore, incidentStore, readReceipt, sendNotification, now, scopeRef, timeoutMs, retentionMs}) {
  if (![witnessStore?.read,witnessStore?.commit,incidentStore?.read,incidentStore?.commit,readReceipt,sendNotification,now].every(fn => typeof fn === "function")
    || !uuid(scopeRef) || !integer(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || !integer(retentionMs) || retentionMs < 1) bad();
  const bounded = operation => boundedObserverCall(timeoutMs, operation);
  const observation = await runIndependentObservation({now,
    store: {read: () => bounded(signal => witnessStore.read({signal})), commit: input => bounded(signal => witnessStore.commit({...input,signal}))},
    readReceipt: () => bounded(signal => readReceipt({signal}))});
  if (!observation.durableWitness) return observation;

  const observedAtMs = observation.state.lastObserverAtMs;
  const event = alarmSignal({rule:"AL01",environment:observation.state.environment,generation:observation.state.generation,scopeRef,nowMs:observedAtMs});
  const fingerprint = event.fingerprint;
  const commit = async (expectedRevision, incident) => {
    const ack = await bounded(signal => incidentStore.commit({fingerprint,expectedRevision,incident,signal}));
    if (!exact(ack,["committed","revision"]) || ack.committed !== true || ack.revision !== expectedRevision + 1) throw Error();
    return ack.revision;
  };
  try {
    const saved = await bounded(signal => incidentStore.read({fingerprint,signal}));
    if (!exact(saved,["revision","incident"]) || !integer(saved.revision)) throw Error();
    if (saved.incident !== null) {
      validateIncident(saved.incident);
      if (saved.incident.fingerprint !== fingerprint) throw Error();
    }
    if (observation.status !== "critical") return frozen({...observation,notification:"not_due",
      recoveryObserved: observation.accepted && saved.incident !== null && saved.incident.state !== "resolved" && observedAtMs < saved.incident.expiresAtMs});

    const previous = saved.incident;
    const incident = recordAlarm(previous?.state === "resolved" ? null : previous,event,{expiresAtMs:observedAtMs + retentionMs});
    if (incident.state !== "detected") {
      await commit(saved.revision,incident);
      return frozen({...observation,notification:"already_reserved"});
    }
    const pending = transitionAlarm(incident,"dispatch_pending");
    const revision = await commit(saved.revision,pending);
    // A crash or lost response after reserving leaves the incident pending for
    // manual review. A later tick cannot send the same incident again.
    const sent = await bounded(signal => sendNotification({event,signal}));
    if (!exact(sent,["accepted"]) || sent.accepted !== true) throw Error();
    const accepted = transitionAlarm(pending,"notification_accepted");
    await commit(revision,transitionAlarm(accepted,"delivery_verified_or_unknown"));
    return frozen({...observation,notification:"accepted",delivery:"unknown"});
  } catch {
    return frozen({...observation,notification:"unconfirmed",rules:[...observation.rules,"AL14"]});
  }
}
