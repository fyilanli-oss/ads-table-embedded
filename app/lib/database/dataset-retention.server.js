import {randomUUID} from "node:crypto";
import {createSourceRetentionRepository} from "./source-retention.server.js";
const capabilities = new WeakMap();
const tables = ["pd_facts", "cpd_product_performance_facts", "cpd_product_sales_facts"];
const id = v => typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const instant = v => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const object = v => v && Object.getPrototypeOf(v) === Object.prototype;
const fail = code => {throw Error("DATASET_RETENTION_" + code);};

export function prepareDatasetRetentionSweep({workspaceId, installationId, generation, table, after, limit, deadlineAt, auditPolicy, ...extra} = {}) {
  if (Object.keys(extra).length || !uuid(workspaceId) || !id(installationId) || !id(generation) || !tables.includes(table)
    || !(after === "0" || id(after)) || !Number.isInteger(limit) || limit < 1 || limit > 200 || !instant(deadlineAt)
    || !object(auditPolicy) || Object.keys(auditPolicy).sort().join() !== "maxReceipts,until,version"
    || typeof auditPolicy.version !== "string" || !auditPolicy.version || auditPolicy.version.length > 128
    || !instant(auditPolicy.until) || Date.parse(auditPolicy.until) < Date.parse(deadlineAt)
    || !Number.isInteger(auditPolicy.maxReceipts) || auditPolicy.maxReceipts < 1 || auditPolicy.maxReceipts > 1000) fail("INPUT_INVALID");
  const plan = Object.freeze({workspaceId, installationId, generation, table, after, limit, deadlineAt, auditPolicy: Object.freeze({...auditPolicy}), operationId: randomUUID()});
  capabilities.set(plan, {used: false}); return plan;
}

export function createDatasetRetentionRepository(database) {
  if (typeof database?.query !== "function") fail("DATABASE_REQUIRED");
  return Object.freeze({
    async cleanup(plan) {
      const state = capabilities.get(plan); if (!state || state.used) fail("CAPABILITY_REQUIRED"); state.used = true;
      try {
        const result = await database.query("select analytics.cleanup_dataset_retention($1::uuid,$2::bigint,$3::bigint,$4::uuid,$5::text,$6::bigint,$7::integer,$8::timestamptz,$9::jsonb) as result",
          [plan.workspaceId, plan.installationId, plan.generation, plan.operationId, plan.table, plan.after, plan.limit, plan.deadlineAt, JSON.stringify(plan.auditPolicy)]);
        const r = result.rows?.length === 1 ? result.rows[0].result : null;
        if (!object(r) || r.status !== "completed" || r.scope !== "bounded_scan_only" || r.operationId !== plan.operationId || r.kind !== "dataset:" + plan.table
          || r.after !== plan.after || !(r.lastScannedId === "0" || id(r.lastScannedId)) || BigInt(r.lastScannedId) < BigInt(plan.after)
          || !["scanned", "held", "deleted"].every(k => Number.isInteger(r[k]) && r[k] >= 0) || r.scanned > plan.limit || r.held + r.deleted !== r.scanned
          || !/^[a-f0-9]{64}$/.test(r.digest ?? "") || !instant(r.completedAt) || r.expiresAt !== plan.auditPolicy.until || r.policyVersion !== plan.auditPolicy.version
          || r.consumerReceipt !== false || r.sourceDeleted !== false) fail("RESULT_INVALID");
        return Object.freeze(r);
      } catch {fail("WRITE_UNCONFIRMED");}
    },
    // Explicit recovery only; cleanup never calls inspect after an unknown write.
    inspect: createSourceRetentionRepository(database).inspect,
  });
}
