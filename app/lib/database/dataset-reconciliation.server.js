import {randomUUID} from "node:crypto";
import {readStoredDatasetSources} from "./dataset-source-reader.server.js";
import {prepareDatasetWrite} from "./dataset-storage.server.js";
import {canonicalSourceJson, sourceStoreOwner, sourcePayloadHash} from "./source-evidence-store.server.js";
import {reportRetentionPolicy, resolveReportRetentionPolicy} from "./report-retention-policy.server.js";
import {projectStoredGoogleDataset} from "../providers/stored-dataset-projection.server.js";
import {projectStoredMetaDataset} from "../providers/stored-meta-dataset.server.js";
import {projectStoredKlaviyoDataset} from "../providers/stored-klaviyo-dataset.server.js";
import {applyStoredDatasetFx} from "./dataset-fx-resolver.server.js";
import {bindGoogleDailyProductMappings} from "./google-daily-product-mapping.server.js";
import {GOOGLE_DAILY_PRODUCT_REPORT_PLAN} from "../providers/google-reporting.server.js";
import {maturityInstant, maturityDate, freezeMaturity} from "../refresh/maturity-policy.server.js";
import {SCHEDULED_DATASET_RECONCILE_SQL, SCHEDULED_DATASET_FINISH_SQL,
  GOOGLE_DAILY_STAGE_SQL, GOOGLE_DAILY_PUBLISH_SQL, GOOGLE_DAILY_INSPECT_SQL, GOOGLE_DAILY_FINISH_SQL,
  KLAVIYO_DAILY_STAGE_SQL, KLAVIYO_DAILY_PUBLISH_SQL, KLAVIYO_DAILY_INSPECT_SQL, KLAVIYO_DAILY_FINISH_SQL} from "./dataset-rpc.server.js";
export {SCHEDULED_DATASET_RECONCILE_SQL, SCHEDULED_DATASET_FINISH_SQL};

export const DATASET_RECONCILIATION_VERSION = "eo05d-reconciliation-v1";
export const DATASET_RECONCILE_SQL = "select analytics.commit_dataset_reconciliation($1::jsonb,$2::jsonb,$3::jsonb,$4::timestamptz) as result";
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

/** Prepare bounded requests for one daily reconciliation without publishing
 * rows. The existing single-request caller retains its original limits. */
export function prepareDailyDatasetPackages({owner,rows,policy,operationId,now,context,maxPackages=1}) {
  if (!Number.isSafeInteger(maxPackages) || maxPackages<1 || maxPackages>20) fail("PACKAGE_LIMIT");
  const prepare = chunk => {
    const write=chunk.length ? prepareDatasetWrite({owner,rows:chunk,policy,operationId,now}).body
      : {version:"eo05b-storage-v1",operationId,policy,rows:[]};
    if (Buffer.byteLength(canonicalSourceJson({write,context}))>1048576) fail("BYTE_LIMIT");
    return write;
  };
  if (maxPackages===1 || rows.length===0) return [prepare(rows)];
  if (!["klaviyo","google_ads"].includes(owner.provider) || rows.length>maxPackages*200) fail("PACKAGE_LIMIT");
  const packages=[],keys=new Set();
  for (let offset=0;offset<rows.length;) {
    if (packages.length===maxPackages) fail("PACKAGE_LIMIT");
    let size=Math.min(200,rows.length-offset),write;
    for (;;) {
      try {write=prepare(rows.slice(offset,offset+size));break;}
      catch (error) {
        if (size===1 || !["DATASET_WRITE_TOO_LARGE","DATASET_RECONCILIATION_BYTE_LIMIT"].includes(error?.message)) throw error;
        size=Math.floor(size/2);
      }
    }
    for (const {table,row} of write.rows) {
      const key=table+":"+row.native_key_hash;
      if (keys.has(key)) fail("DUPLICATE_NATIVE_KEY");
      keys.add(key);
    }
    packages.push(write);
    offset+=size;
  }
  return packages;
}

/** Fixed private projection of actual AEAD-verified source pages only. The SQL
 * transaction revalidates full coverage, CAS, read order, rows and exact hashes
 * before atomically issuing the real source-consumption/day checkpoint receipt.
 * The scheduled path completes its job only after the known write and readback. */
export async function reconcileStoredDatasetSources({database, cipher, owner, batches, limits, expectedRevision,
  operationId = randomUUID(), fxResolver, now = Date.now, signal, admittedScope, scheduled = false, googleDailyPackages = false}) {
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
  if(typeof googleDailyPackages!=="boolean"||googleDailyPackages && (!scheduled||bound.provider!=="google_ads")) fail("INPUT_INVALID");
  const googleDaily=googleDailyPackages;
  if(googleDaily && expectedRevision!==0) fail("GOOGLE_FIRST_DAY_REQUIRED");
  const dailyPackages = source.datasets.some(d => d.packageReceipts !== undefined);
  if(bound.provider==="google_ads"&&dailyPackages&&!googleDaily) return freezeMaturity({status:"held",holds:[{reason:"google_daily_handoff_required"}],sourceVerified:true,rowsStored:0,consumerReceipt:false,checkpointAdvanced:false,reportValuesChanged:false,publishable:false,authorizesActivation:false});
  if (dailyPackages && (!scheduled || typeof database.transaction !== "function")) return freezeMaturity({
    status: "held", holds: [{reason: "daily_package_handoff_required"}], sourceVerified: true, rowsStored: 0,
    consumerReceipt: false, checkpointAdvanced: false, reportValuesChanged: false, publishable: false, authorizesActivation: false,
  });
  const projection = projectors[bound.provider](source);
  for (const {row} of projection.rows) if (row.occurred_at !== null && row.occurred_at !== undefined) row.occurred_at = canonicalDatasetEventTime(row.occurred_at);
  const configuration = source.datasets.filter(d => d.dataset === "configuration").flatMap(d => d.pages.map(p => p.ref));
  if (configuration.length) for (const {row} of projection.rows) row.provenance.sources = [...new Map([...row.provenance.sources, ...configuration].map(r => [r.page_id, r])).values()];
  if (!dailyPackages && !googleDaily && projection.rows.length > 200) fail("ROW_LIMIT");
  if (projection.rows.length && fxResolver !== undefined) {
    const fx = await applyStoredDatasetFx({resolver: fxResolver, database, source, rows: projection.rows, deadlineAt: limits.deadlineAt, signal});
    projection.holds.push(...fx.holds);
  }
  if (projection.holds.length || source.datasets.some(d => d.receipt.sourceState !== "complete" && !d.packageReceipts)
    || dailyPackages && !googleDaily && projection.rows.length===0) return freezeMaturity({status: "held", holds: projection.holds,
    sourceVerified: true, rowsStored: 0, consumerReceipt: false, checkpointAdvanced: false, reportValuesChanged: false, publishable: false, authorizesActivation: false});
  const businessDate = maturityDate(source.scope.window.from), timeZone = source.datasets[0].source.timezone;
  if (source.datasets.some(d => d.source.timezone !== timeZone)) fail("TIMEZONE_MISMATCH");
  const clocks = source.datasets.map(d => ({started: maturityInstant(d.read.observedAt), completed: maturityInstant(d.read.completedAt)}));
  if (clocks.some(c => c.completed < c.started || Date.parse(c.completed) > now())) fail("CLOCK_INVALID");
  const context = {version: DATASET_RECONCILIATION_VERSION, expectedRevision, businessDate, timeZone,
    sourceContext: source.datasets[0].sourceContext, sources: source.datasets.flatMap(d => d.pages.map(p => p.ref)),
    batchIds: source.datasets.flatMap(d => (d.packageReceipts ?? [d.receipt]).map(receipt=>receipt.batchId)),
    startedAt: clocks.map(c => c.started).sort()[0], completedAt: clocks.map(c => c.completed).sort().at(-1)};
  const policy=projection.rows.length ? reportRetentionPolicy() : resolveReportRetentionPolicy({businessDate,timeZone});
  if (dailyPackages || googleDaily) {
    const prepareWrites=()=>prepareDailyDatasetPackages({owner:bound,rows:projection.rows,policy,operationId,
      now:new Date(now()).toISOString(),context,maxPackages:20});
    const commit={database,owner:bound,context,operationId,deadlineAt:limits.deadlineAt,admittedScope,stop};
    const bindMappings=googleDaily && source.datasets.some(dataset=>dataset.read.reportPlan===GOOGLE_DAILY_PRODUCT_REPORT_PLAN);
    const receipt=googleDaily
      ? await commitScheduledGoogleDailyReport({...commit,prepareWrites, writes:bindMappings?null:prepareWrites(),rows:projection.rows,cipher,now})
      : await commitScheduledKlaviyoDailyReport({...commit,writes:prepareWrites()});
    const result=freezeMaturity({...receipt,sourceVerified:true,rowsStored:receipt.rowCount,reportValuesChanged:true,
      jobCompleted:true,hourlyRefreshActivated:false,authorizesActivation:false,publishable:false});
    confirmed.set(result,bound);return result;
  }
  const [write]=prepareDailyDatasetPackages({owner:bound,rows:projection.rows,policy,operationId,now:new Date(now()).toISOString(),context});
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
  if (scheduled) {
    stop();
    if (typeof receipt.digest !== "string" || !/^[0-9a-f]{64}$/.test(receipt.digest)) fail("READBACK_UNCONFIRMED");
    let finished;
    try {
      finished = (await database.query(SCHEDULED_DATASET_FINISH_SQL, [JSON.stringify(bound), admittedScope.jobId,
        admittedScope.fence, operationId, receipt.digest])).rows?.[0]?.result;
    } catch {fail("FINISH_UNCONFIRMED");}
    if (finished !== true) fail("FINISH_UNCONFIRMED");
  }
  const result = freezeMaturity({...receipt, sourceVerified: true, rowsStored: receipt.rowCount, reportValuesChanged: receipt.changes?.length > 0,
    ...(scheduled ? {jobCompleted: true} : {}),
    hourlyRefreshActivated: false, authorizesActivation: false, publishable: false});
  confirmed.set(result, bound); return result;
}

async function commitScheduledKlaviyoDailyReport({database,owner,writes,context,operationId,deadlineAt,admittedScope,stop}) {
  const ownerJson=JSON.stringify(owner),contextJson=JSON.stringify(context),deadline=new Date(deadlineAt).toISOString();
  const packages=writes.map((write,ordinal)=>({ordinal,rowCount:write.rows.length,digest:sourcePayloadHash({write,context})}));
  const rowCount=packages.reduce((sum,part)=>sum+part.rowCount,0);
  const digests=packages.map(part=>part.digest);
  let receipt;
  try {
    stop();
    receipt=await database.transaction(async tx=>{
      for (const {ordinal,rowCount,digest} of packages) {
        stop();
        const staged=(await tx.query(KLAVIYO_DAILY_STAGE_SQL,[ownerJson,JSON.stringify(writes[ordinal]),
          contextJson,deadline,ordinal,packages.length])).rows?.[0]?.result;
        if (staged?.status!=="staged" || staged.operationId!==operationId || staged.ordinal!==ordinal
          || staged.packageCount!==packages.length || staged.rowCount!==rowCount || staged.digest!==digest) fail("RESULT_INVALID");
      }
      stop();
      const written=(await tx.query(KLAVIYO_DAILY_PUBLISH_SQL,[ownerJson,contextJson,deadline,operationId,
        JSON.stringify(writes[0].policy),JSON.stringify(digests)])).rows?.[0]?.result;
      if (written?.version!=="klaviyo-daily-receipt-v1" || written.status!=="consumed" || written.operationId!==operationId
        || written.consumerReceipt!==true || written.checkpointAdvanced!==true || written.comparison!=="matched"
        || written.rowCount!==rowCount || written.revision!==context.expectedRevision+1
        || written.jobId!==admittedScope.jobId || written.fence!==admittedScope.fence
        || written.businessDate!==context.businessDate || written.timeZone!==context.timeZone
        || !/^[0-9a-f]{64}$/.test(written.digest ?? "")
        || canonicalSourceJson(written.packages)!==canonicalSourceJson(packages)
        || canonicalSourceJson(written.batchIds)!==canonicalSourceJson(context.batchIds)) fail("RESULT_INVALID");
      return written;
    });
  } catch {fail("WRITE_UNCONFIRMED");}
  stop();
  const readback=(await database.query(KLAVIYO_DAILY_INSPECT_SQL,[ownerJson,operationId])).rows?.[0]?.result;
  if (canonicalSourceJson(readback??null)!==canonicalSourceJson(receipt)) fail("READBACK_UNCONFIRMED");
  stop();
  let finished;
  try {
    finished=(await database.query(KLAVIYO_DAILY_FINISH_SQL,[ownerJson,admittedScope.jobId,admittedScope.fence,operationId,receipt.digest])).rows?.[0]?.result;
  } catch {fail("FINISH_UNCONFIRMED");}
  if(finished!==true) fail("FINISH_UNCONFIRMED");
  return receipt;
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

async function commitScheduledGoogleDailyReport({database,owner,prepareWrites,writes,rows,cipher,now,context,operationId,deadlineAt,admittedScope,stop}) {
  const ownerJson=JSON.stringify(owner),contextJson=JSON.stringify(context),deadline=new Date(deadlineAt).toISOString();
  let receipt;
  try {
    stop();
    receipt=await database.transaction(async tx=>{
      if(writes===null) {
        const mappingContext=JSON.stringify({sourceContext:context.sourceContext,businessDate:context.businessDate});
        await bindGoogleDailyProductMappings({database:tx,ownerJson,contextJson:mappingContext,deadline,owner,rows,cipher,now,stop});
        writes=prepareWrites();
      }
      const packages=writes.map((write,ordinal)=>({ordinal,rowCount:write.rows.length,digest:sourcePayloadHash({write,context})}));
      const rowCount=packages.reduce((sum,part)=>sum+part.rowCount,0);
      const digests=packages.map(part=>part.digest);
      for (const {ordinal,rowCount,digest} of packages) {
        stop();
        const staged=(await tx.query(GOOGLE_DAILY_STAGE_SQL,[ownerJson,JSON.stringify(writes[ordinal]),
          contextJson,deadline,ordinal,packages.length])).rows?.[0]?.result;
        if (staged?.status!=="staged" || staged.operationId!==operationId || staged.ordinal!==ordinal
          || staged.packageCount!==packages.length || staged.rowCount!==rowCount || staged.digest!==digest) fail("RESULT_INVALID");
      }
      stop();
      const written=(await tx.query(GOOGLE_DAILY_PUBLISH_SQL,[ownerJson,contextJson,deadline,operationId,
        JSON.stringify(writes[0].policy),JSON.stringify(digests)])).rows?.[0]?.result;
      if (written?.version!=="google-daily-receipt-v1" || written.status!=="consumed" || written.operationId!==operationId
        || written.consumerReceipt!==true || written.checkpointAdvanced!==true || written.comparison!=="matched"
        || written.rowCount!==rowCount || written.revision!==context.expectedRevision+1
        || written.jobId!==admittedScope.jobId || written.fence!==admittedScope.fence
        || written.businessDate!==context.businessDate || written.timeZone!==context.timeZone
        || !/^[0-9a-f]{64}$/.test(written.digest ?? "")
        || canonicalSourceJson(written.packages)!==canonicalSourceJson(packages)
        || canonicalSourceJson(written.batchIds)!==canonicalSourceJson(context.batchIds)) fail("RESULT_INVALID");
      return written;
    });
  } catch {fail("WRITE_UNCONFIRMED");}
  stop();
  const readback=(await database.query(GOOGLE_DAILY_INSPECT_SQL,[ownerJson,operationId])).rows?.[0]?.result;
  if (canonicalSourceJson(readback??null)!==canonicalSourceJson(receipt)) fail("READBACK_UNCONFIRMED");
  stop();
  let finished;
  try {
    finished=(await database.query(GOOGLE_DAILY_FINISH_SQL,[ownerJson,admittedScope.jobId,admittedScope.fence,operationId,receipt.digest])).rows?.[0]?.result;
  } catch {fail("FINISH_UNCONFIRMED");}
  if(finished!==true) fail("FINISH_UNCONFIRMED");
  return receipt;
}
