import {createDatasetServerExecution, readDatasetWritePlan} from "./dataset-server.server.js";

// The existing provider-specific private gate supplies auth/origin/body limits.
// The body can name only the fixed server plan's operation, never owner/rows.
export async function handleDatasetWriteRequest(request, {environment, provider, path, readPrivateRequest, now = Date.now, createExecution = createDatasetServerExecution}) {
  const json = (status, body) => Response.json(body, {status, headers: {"cache-control": "no-store, max-age=0", "cdn-cache-control": "no-store", "x-content-type-options": "nosniff"}});
  const stop = (status, reason) => {
    const unknown = reason === "dataset_execution_unconfirmed";
    return json(status, {status: unknown ? "unconfirmed" : "stopped", reason, DatasetWritePerformed: unknown ? null : false,
      rowsStored: null, consumerReceipt: false, hourlyRefreshActivated: false});
  };
  const gate = await readPrivateRequest(request, {environment, path, enabled: environment.ADSTABLE_DATASET_WRITE_ENABLED === "true",
    readPlan: (env, time) => {const p = readDatasetWritePlan(env, time); if (p?.owner.provider !== provider) throw Error("DATASET_PROVIDER_MISMATCH"); return p;},
    operationId: p => p?.operationId, now});
  if (!gate.ok) return stop(gate.status, gate.reason);
  let execution, result;
  try {execution = createExecution({environment, operationId: gate.input.operationId, signal: request.signal, now}); result = await execution.run();}
  catch {return stop(503, "dataset_execution_unconfirmed");}
  finally {try {await execution?.close();} catch {result = null;}}
  if (!result || !["stored", "partially_stored", "empty", "held"].includes(result.status) || result.sourceVerified !== true
    || !Number.isInteger(result.rowsStored) || result.rowsStored < 0 || result.rowsStored > 200 || result.consumerReceipt !== false
    || result.publishable !== false || result.authorizesActivation !== false) return stop(503, "dataset_execution_unconfirmed");
  const held = result.status === "held", empty = result.status === "empty";
  return json(held || result.status === "partially_stored" ? 207 : 200, {status: result.status, rowsStored: result.rowsStored,
    sourceVerified: true, receiptVerified: !held, empty: empty ? true : held ? null : false,
    DatasetWritePerformed: result.rowsStored > 0, consumerReceipt: false, publishable: false, authorizesActivation: false, hourlyRefreshActivated: false});
}
