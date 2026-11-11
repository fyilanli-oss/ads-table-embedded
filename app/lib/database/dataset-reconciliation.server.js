import {randomUUID} from "node:crypto";
import {readStoredDatasetSources} from "./dataset-source-reader.server.js";
import {prepareDatasetWrite} from "./dataset-storage.server.js";
import {canonicalSourceJson, sourceStoreOwner, sourcePayloadHash} from "./source-evidence-store.server.js";
import {reportRetentionPolicy, resolveReportRetentionPolicy} from "./report-retention-policy.server.js";
import {projectStoredGoogleDataset} from "../providers/stored-dataset-projection.server.js";
import {projectStoredMetaDataset} from "../providers/stored-meta-dataset.server.js";
import {projectStoredKlaviyoDataset} from "../providers/stored-klaviyo-dataset.server.js";
import {applyStoredDatasetFx} from "./dataset-fx-resolver.server.js";
import {maturityInstant, maturityDate, freezeMaturity} from "../refresh/maturity-policy.server.js";

export const DATASET_RECONCILIATION_VERSION = "eo05d-reconciliation-v1";
export const DATASET_RECONCILE_SQL = "select analytics.commit_dataset_reconciliation($1::jsonb,$2::jsonb,$3::jsonb,$4::timestamptz) as result";
export const SCHEDULED_DATASET_RECONCILE_SQL = "select analytics.commit_scheduled_dataset_reconciliation($1::jsonb,$2::jsonb,$3::jsonb,$4::timestamptz) as result";
export const DATASET_RECONCILE_READ_SQL = "select analytics.inspect_dataset_reconciliation($1::jsonb,$2::uuid) as result";
const projectors = {google_ads: projectStoredGoogleDataset, meta: projectStoredMetaDataset, klaviyo: projectStoredKlaviyoDataset};
const confirmed = new WeakMap();
const uuid = x => typeof x === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const fail = code => {throw Error("DATASET_RECONCILIATION_" + code);};

/** Postgres timestamptz retains microseconds. Normalize timezone/zero-padding
 * without converting the fractional part through Date/Number or truncating it.
 * The original native timestamp stays in its immutable encrypted source page. */
export function canonicalDatasetEventTime(value) {
  if (typeof value !== "string") fail("EVENT_TIME_INVALID");
  const m = value.match(/^(\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/);
  if (!m) fail("EVENT_TIME_INVALID");
  maturityDate(value.slice(0, 10));
  const seconds = Date.parse(m[1] + m[3]);
  if (!Number.isFinite(seconds)) fail("EVENT_TIME_INVALID");
  return new Date(seconds).toISOString().slice(0, 19) + "." + (m[2] ?? "").padEnd(6, "0") + "Z";
}

/** Fixed private projection of actual AEAD-verified source pages only. The SQL
 * transaction revalidates full coverage, CAS, read order, rows and exact hashes
 * before atomically issuing the real source-consumption/day checkpoint receipt.
 * It neither dispatches native HTTP nor completes/releases a scheduler job. */
export async function reconcileStoredDatasetSources({database, cipher, owner, batches, limits, expectedRevision,
  operationId = randomUUID(), fxResolver, now = Date.now, signal, admittedScope, scheduled = false}) {
  batches = structuredClone(batches); limits = structuredClone(limits);
  admittedScope = structuredClone(admittedScope);
  const bound = sourceStoreOwner(owner);
  if (!uuid(operationId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > 999999999
    || typeof scheduled !== "boolean" || (scheduled && !admittedScope)) fail("INPUT_INVALID");
  const stop = () => {if (signal?.aborted || now() >= limits.deadlineAt) fail("STOPPED");};
  stop();
  const source = await readStoredDatasetSources({database, cipher, owner: bound, batches, limits, now, signal});
  if (admittedScope !== undefined && (source.scope.jobId !== admittedScope?.jobId
    || source.scope.fence !== admittedScope.fence || source.scope.window.from !== admittedScope.from
    || source.scope.window.to !== admittedScope.to)) fail("ADMITTED_SCOPE_MISMATCH");
  const projection = projectors[bound.provider](source);
  for (const {row} of projection.rows) if (row.occurred_at !== null && row.occurred_at !== undefined) row.occurred_at = canonicalDatasetEventTime(row.occurred_at);
  const configuration = source.datasets.filter(d => d.dataset === "configuration").flatMap(d => d.pages.map(p => p.ref));
  if (configuration.length) for (const {row} of projection.rows) row.provenance.sources = [...new Map([...row.provenance.sources, ...configuration].map(r => [r.page_id, r])).values()];
  if (projection.rows.length > 200) fail("ROW_LIMIT");
  if (projection.rows.length && fxResolver !== undefined) {
    const fx = await applyStoredDatasetFx({resolver: fxResolver, database, source, rows: projection.rows, deadlineAt: limits.deadlineAt, signal});
    projection.holds.push(...fx.holds);
  }
  if (projection.holds.length || source.datasets.some(d => d.receipt.sourceState !== "complete")) return freezeMaturity({status: "held", holds: projection.holds,
    sourceVerified: true, rowsStored: 0, consumerReceipt: false, checkpointAdvanced: false, reportValuesChanged: false, publishable: false, authorizesActivation: false});
  const businessDate = maturityDate(source.scope.window.from), timeZone = source.datasets[0].source.timezone;
  if (source.datasets.some(d => d.source.timezone !== timeZone)) fail("TIMEZONE_MISMATCH");
  const clocks = source.datasets.map(d => ({started: maturityInstant(d.read.observedAt), completed: maturityInstant(d.read.completedAt)}));
  if (clocks.some(c => c.completed < c.started || Date.parse(c.completed) > now())) fail("CLOCK_INVALID");
  const policy = resolveReportRetentionPolicy({businessDate, timeZone});
  const write = projection.rows.length ? prepareDatasetWrite({owner: bound, rows: projection.rows, policy: reportRetentionPolicy(), operationId, now: new Date(now()).toISOString()}).body
    : {version: "eo05b-storage-v1", operationId, policy, rows: []};
  const context = {version: DATASET_RECONCILIATION_VERSION, expectedRevision, businessDate, timeZone,
    sourceContext: source.datasets[0].sourceContext, sources: source.datasets.flatMap(d => d.pages.map(p => p.ref)),
    batchIds: source.datasets.map(d => d.receipt.batchId),
    startedAt: clocks.map(c => c.started).sort()[0], completedAt: clocks.map(c => c.completed).sort().at(-1)};
  if (Buffer.byteLength(canonicalSourceJson({write, context})) > 1048576) fail("BYTE_LIMIT");
  const requestDigest = sourcePayloadHash({write, context});
  stop(); let receipt;
  try {
    const sql = scheduled ? SCHEDULED_DATASET_RECONCILE_SQL : DATASET_RECONCILE_SQL;
    receipt = (await database.query(sql, [JSON.stringify(bound), JSON.stringify(write), JSON.stringify(context), new Date(limits.deadlineAt).toISOString()])).rows?.[0]?.result;
    if (receipt?.status === "mismatch" && receipt.operationId === operationId && receipt.requestDigest === requestDigest
      && receipt.comparison === "mismatch" && receipt.consumerReceipt === false && receipt.checkpointAdvanced === false) return freezeMaturity({...receipt, rowsStored: 0, sourceVerified: true, publishable: false, authorizesActivation: false});
    if (!receipt || receipt.status !== "consumed" || receipt.operationId !== operationId || receipt.requestDigest !== requestDigest
      || receipt.revision !== expectedRevision + 1 || receipt.consumerReceipt !== true || receipt.checkpointAdvanced !== true
      || receipt.rowCount !== write.rows.length || receipt.comparison !== "matched") fail("RESULT_INVALID");
  } catch {fail("WRITE_UNCONFIRMED");} // Never inspect/retry after a lost write reply.
  stop();
  const readback = await inspectDatasetReconciliation({database, owner: bound, operationId});
  if (canonicalSourceJson(readback) !== canonicalSourceJson(receipt)) fail("READBACK_UNCONFIRMED");
  const result = freezeMaturity({...receipt, sourceVerified: true, rowsStored: receipt.rowCount, reportValuesChanged: receipt.changes?.length > 0,
    hourlyRefreshActivated: false, authorizesActivation: false, publishable: false});
  confirmed.set(result, bound); return result;
}

/** Explicit historical inspection, also used after a KNOWN successful commit.
 * Superseded receipts remain audit records but cannot claim current-day progress. */
export async function inspectDatasetReconciliation({database, owner, operationId}) {
  const bound = sourceStoreOwner(owner); if (!uuid(operationId)) fail("INPUT_INVALID");
  try {
    const result = freezeMaturity((await database.query(DATASET_RECONCILE_READ_SQL, [JSON.stringify(bound), operationId])).rows?.[0]?.result ?? null);
    if (result?.status === "consumed" && result.operationId === operationId && result.consumerReceipt === true && result.checkpointAdvanced === true && result.comparison === "matched") confirmed.set(result, bound);
    return result;
  }
  catch {fail("READ_FAILED");}
}

export function datasetConsumptionMatches(receipt, owner, businessDate, timeZone) {
  const bound = confirmed.get(receipt);
  return !!bound && canonicalSourceJson(bound) === canonicalSourceJson(sourceStoreOwner(owner))
    && receipt.businessDate === businessDate && receipt.timeZone === timeZone;
}
