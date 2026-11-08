import {readStoredDatasetSources} from "./dataset-source-reader.server.js";
import {projectStoredGoogleDataset} from "../providers/stored-dataset-projection.server.js";
import {projectStoredMetaDataset} from "../providers/stored-meta-dataset.server.js";
import {projectStoredKlaviyoDataset} from "../providers/stored-klaviyo-dataset.server.js";
import {prepareDatasetWrite, createDatasetStorageRepository} from "./dataset-storage.server.js";
import {canonicalSourceJson} from "./source-evidence-store.server.js";

const projectors = Object.freeze({google_ads: projectStoredGoogleDataset, meta: projectStoredMetaDataset, klaviyo: projectStoredKlaviyoDataset});

/** Private source-store -> physical native projection -> durable storage binding.
 * No caller projection/canonical row, native request, OAuth mutation, FX source,
 * scheduler, consumed marker or report checkpoint is accepted here.
 */
export async function bindStoredDatasetSources({database, cipher, owner, batches, limits, policy, signal, now = Date.now}) {
  batches = structuredClone(batches); limits = structuredClone(limits); policy = structuredClone(policy);
  const source = await readStoredDatasetSources({database, cipher, owner, batches, limits, signal, now});
  const projection = projectors[source.owner.provider](source);
  const boundary = {sourceVerified: true, consumerReceipt: false, publishable: false, authorizesActivation: false,
    holds: projection.holds, auxiliary: projection.auxiliary};
  if (!projection.rows.length) return Object.freeze({...boundary, status: projection.holds.length ? "held" : "empty",
    rowsStored: 0, empty: projection.holds.length ? null : true, storageReceipt: null});
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
