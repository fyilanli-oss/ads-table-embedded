import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";
import {syntheticMappingReconciliationSource} from "../tests/fixtures/refresh-shopify-mapping-probe.js";

const providers = ["google", "klaviyo"];

function replaceOnce(source, search, replacement) {
  assert.equal(source.split(search).length, 2, search);
  return source.replace(search, () => replacement);
}

export function singleReportCloseSource(source) {
  for (const provider of providers) {
    const rpc = `${provider.toUpperCase()}_DAILY`;
    source = replaceOnce(source, `  const readback=(await database.query(${rpc}_INSPECT_SQL,[ownerJson,operationId])).rows?.[0]?.result;\n  if (canonicalSourceJson(readback??null)!==canonicalSourceJson(receipt)) fail("READBACK_UNCONFIRMED");\n  stop();\n`, "");
    source = replaceOnce(source, `${rpc}_FINISH_SQL,[ownerJson,admittedScope.jobId,admittedScope.fence,operationId,receipt.digest]`,
      `${rpc}_FINISH_SQL,[ownerJson,admittedScope.jobId,admittedScope.fence,operationId,JSON.stringify(receipt)]`);
  }
  return source;
}

export function singleReportCloseSql(definition) {
  // Keep the original locked readback and validate exact equality before completion.
  return replaceOnce(replaceOnce(definition, "h is null or h !~ '^[0-9a-f]{64}$'",
    "h is null or jsonb_typeof(h::jsonb) is distinct from 'object'"),
  "r->>'digest' is distinct from h", "r is distinct from h::jsonb");
}

export async function loadSingleReportCloseCandidate(client, provider, {shopifyMapping=false}={}) {
  assert.equal(client.connectionParameters.host, "127.0.0.1");
  assert.equal(Number(client.connectionParameters.port), 54322);
  assert.ok(providers.includes(provider));
  const signature = `analytics.finish_${provider}_daily_report_job(jsonb,text,bigint,uuid,text)`;
  const {rows: [{definition}]} = await client.query("select pg_get_functiondef($1::regprocedure) definition", [signature]);
  await client.query(singleReportCloseSql(definition));

  const variant = `?singleReportClose=${randomUUID()}`;
  const files = ["../app/lib/database/dataset-reconciliation.server.js", "../app/lib/refresh/preflight-bridge.server.js", "../app/lib/refresh/scheduled-queue-check.server.js"]
    .map(file => new URL(file, import.meta.url));
  const sources = new Map(files.map((url, index) => {
    let current = readFileSync(url, "utf8").replaceAll("\r\n", "\n");
    if (shopifyMapping && index === 0) current = syntheticMappingReconciliationSource(current);
    if (shopifyMapping && index === 1) {
      current = replaceOnce(current, "expectedRevision,fxResolver,googleDailyPackages=false}=inputs;", "expectedRevision,fxResolver,googleDailyPackages=false,bindSyntheticMappings}=inputs;");
      current = replaceOnce(current, "expectedRevision,fxResolver,googleDailyPackages,now,", "expectedRevision,fxResolver,googleDailyPackages,bindSyntheticMappings,now,");
    }
    if (shopifyMapping && index === 2) current = replaceOnce(current, "expectedRevision: inputs.expectedRevision,", "expectedRevision: inputs.expectedRevision, bindSyntheticMappings: inputs.bindSyntheticMappings,");
    const source = index === 0 ? singleReportCloseSource(current) : replaceOnce(current,
      index === 1 ? '"../database/dataset-reconciliation.server.js"' : '"./preflight-bridge.server.js"',
      JSON.stringify(files[index - 1].href + variant));
    return [url.href + variant, source];
  }));
  const hooks = registerHooks({load(url, context, next) {
    if (sources.has(url)) return {format: "module", source: sources.get(url), shortCircuit: true};
    return next(url, context);
  }});
  try {
    return await import(files.at(-1).href + variant);
  } finally {
    hooks.deregister();
  }
}

export async function verifySingleReportCloseRejections(client, provider, sql, args) {
  assert.ok(providers.includes(provider));
  const [ownerJson, jobId, fence, operationId, receiptJson] = args;
  const owner = JSON.parse(ownerJson);
  const receipt = JSON.parse(receiptJson);
  const finish = async (parameters) => (await client.query(sql, parameters)).rows[0].result;
  const checkOpen = async () => {
    const state = await client.query("select status from operations.refresh_runs where workspace_id=$1 and job_id=$2", [owner.workspaceId, jobId]);
    assert.equal(state.rowCount, 1);
    assert.notEqual(state.rows[0].status, "completed");
  };

  assert.equal(await finish([ownerJson, jobId, fence, operationId, JSON.stringify({...receipt, rowCount: receipt.rowCount + 1})]), false);
  await checkOpen();
  assert.equal(await finish([ownerJson, jobId, String(BigInt(fence) + 1n), operationId, receiptJson]), false);
  await checkOpen();

  await client.query("savepoint eo05_single_close_changed_fact");
  try {
    const removed = await client.query(`delete from analytics.cpd_product_sales_facts where ctid=(
      select ctid from analytics.cpd_product_sales_facts where installation_id=$1 limit 1)`, [owner.installationId]);
    assert.equal(removed.rowCount, 1);
    await assert.rejects(finish(args), /(?:GOOGLE|KLAVIYO)_REPORT_FACT_READBACK_MISMATCH/);
  } finally {
    await client.query("rollback to savepoint eo05_single_close_changed_fact");
    await client.query("release savepoint eo05_single_close_changed_fact");
  }
  await checkOpen();
}
