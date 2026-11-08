import {readStoredDatasetSources} from "./dataset-source-reader.server.js";
import {projectStoredGoogleDataset} from "../providers/stored-dataset-projection.server.js";
import {projectStoredMetaDataset} from "../providers/stored-meta-dataset.server.js";
import {projectStoredKlaviyoDataset} from "../providers/stored-klaviyo-dataset.server.js";
import {prepareDatasetWrite, createDatasetStorageRepository} from "./dataset-storage.server.js";
import {canonicalSourceJson} from "./source-evidence-store.server.js";
import {reportRetentionPolicy, readReportRetentionPolicy, resolveReportRetentionPolicy} from "./report-retention-policy.server.js";
import {randomUUID} from "node:crypto";
import {applyStoredDatasetFx} from "./dataset-fx-resolver.server.js";

const projectors = Object.freeze({google_ads: projectStoredGoogleDataset, meta: projectStoredMetaDataset, klaviyo: projectStoredKlaviyoDataset});

/** Private source-store -> physical native projection -> durable storage binding.
 * No caller projection/canonical row, native request, OAuth mutation, FX source,
 * scheduler, consumed marker or report checkpoint is accepted here.
 */
export async function bindStoredDatasetSources({database, cipher, owner, batches, limits, policy = reportRetentionPolicy(), fxResolver, signal, now = Date.now}) {
  batches = structuredClone(batches); limits = structuredClone(limits); policy = structuredClone(policy);
  readReportRetentionPolicy(policy);
  const source = await readStoredDatasetSources({database, cipher, owner, batches, limits, signal, now});
  const projection = projectors[source.owner.provider](source);
  // Klaviyo's separate configuration envelope participates in metric/account
  // interpretation. Keep that physically verified proof with every derived row.
  const configuration = source.datasets.filter(d => d.dataset === "configuration").flatMap(d => d.pages.map(p => p.ref));
  if (configuration.length) for (const {row} of projection.rows) {
    row.provenance.sources = [...new Map([...row.provenance.sources, ...configuration].map(ref => [ref.batch_id + ":" + ref.page_id, ref])).values()];
  }
  if (projection.rows.length > 200 || signal?.aborted || now() >= limits.deadlineAt) throw Error("DATASET_BINDING_LIMIT_OR_STOP");
  if (projection.rows.length && fxResolver !== undefined) {
    const fx = await applyStoredDatasetFx({resolver: fxResolver, database, source, rows: projection.rows, deadlineAt: limits.deadlineAt, signal});
    projection.holds.push(...fx.holds);
  }
  const boundary = {sourceVerified: true, consumerReceipt: false, publishable: false, authorizesActivation: false,
    holds: projection.holds, auxiliary: projection.auxiliary};
  if (!projection.rows.length) {
    if (projection.holds.length || source.datasets.some(d => d.receipt.sourceState !== "complete")) return Object.freeze({...boundary, status: "held", rowsStored: 0, empty: null, storageReceipt: null});
    const p = {version: "eo05b-empty-retention-v1", operationId: randomUUID(),
      policy: resolveReportRetentionPolicy({businessDate: source.scope.window.from, timeZone: source.datasets[0].source.timezone}),
      sourceContext: source.datasets[0].sourceContext, sources: source.datasets.flatMap(d => d.pages.map(page => page.ref))};
    if (signal?.aborted || now() >= limits.deadlineAt || Date.parse(p.policy.until) <= now()) throw Error("DATASET_BINDING_LIMIT_OR_STOP");
    let receipt;
    try {receipt = (await database.query("select analytics.commit_dataset_empty_retention($1::jsonb,$2::jsonb) as result", [JSON.stringify(source.owner), JSON.stringify(p)])).rows?.[0]?.result;
      if (receipt?.status !== "retained_empty" || receipt.operationId !== p.operationId || receipt.consumerReceipt !== false || receipt.until !== p.policy.until
        || !/^[a-f0-9]{64}$/.test(receipt.digest ?? "") || canonicalSourceJson(receipt.sources) !== canonicalSourceJson(p.sources)) throw Error();
    } catch {throw Error("DATASET_EMPTY_RETENTION_WRITE_UNCONFIRMED");}
    let readback;
    try {readback = (await database.query("select analytics.inspect_dataset_empty_retention($1::jsonb,$2::bigint,$3::uuid) as result", [JSON.stringify(source.owner), p.sources[0].batch_id, p.operationId])).rows?.[0]?.result;} catch {throw Error("DATASET_EMPTY_RETENTION_READ_UNCONFIRMED");}
    if (canonicalSourceJson(readback) !== canonicalSourceJson(receipt)) throw Error("DATASET_EMPTY_RETENTION_READ_UNCONFIRMED");
    return Object.freeze({...boundary, status: "empty", rowsStored: 0, empty: true, storageReceipt: null, retentionReceipt: Object.freeze(receipt)});
  }
  if (projection.rows.length > 200 || signal?.aborted || now() >= limits.deadlineAt) throw Error("DATASET_BINDING_LIMIT_OR_STOP");
  const write = prepareDatasetWrite({owner: source.owner, rows: projection.rows, policy, now: new Date(now()).toISOString()});
  const repository = createDatasetStorageRepository(database);
  // A lost write reply throws here. It never enters automatic readback/replay.
  const receipt = await repository.commit(write);
  const readback = await repository.inspect({owner: source.owner, sourceBatchId: write.body.rows[0].row.source_batch_id, operationId: write.body.operationId});
  if (canonicalSourceJson(readback) !== canonicalSourceJson(receipt)) throw Error("DATASET_BINDING_READBACK_UNCONFIRMED");
  return Object.freeze({...boundary, status: projection.holds.length ? "partially_stored" : "stored", rowsStored: receipt.rows.length,
    empty: false, storageReceipt: receipt});
}
