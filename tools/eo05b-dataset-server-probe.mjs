import assert from "node:assert/strict";
import {randomBytes, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {storedBindingFixture} from "./eo05b-source-dataset-binding-probe.mjs";
import {createConfiguredSourceEvidenceCipher} from "../app/lib/database/source-evidence-config.server.js";
import {createDatasetServerExecution} from "../app/lib/refresh/dataset-server.server.js";
import {DATASET_STORAGE_RPC, DATASET_SOURCE_CONTEXT_SQL} from "../app/lib/database/dataset-rpc.server.js";
import {GOOGLE_DATASET_SOURCE_RPC} from "../app/lib/database/google-source-postgres.server.js";
import {META_SOURCE_RPC} from "../app/lib/database/meta-source-postgres.server.js";
import {KLAVIYO_SOURCE_RPC} from "../app/lib/database/klaviyo-source-postgres.server.js";

// Actual narrow-role SQL, AEAD and common server composition, only within the
// existing localhost F01 transaction. No provider/network or live grants.
export async function datasetServerProbe(client, {ownerFixture}) {
  await client.query("savepoint dataset_server_outer");
  try {
    const providers = [["google_ads", "google", GOOGLE_DATASET_SOURCE_RPC], ["meta", "meta", META_SOURCE_RPC], ["klaviyo", "klaviyo", KLAVIYO_SOURCE_RPC]];
    for (const [, short, rpc] of providers) {
      const role = "adstable_" + short + "_source_runner";
      await client.query("set local role postgres");
      if (!(await client.query("select exists(select 1 from pg_roles where rolname=$1) yes", [role])).rows[0].yes) await client.query("create role " + role + " nologin noinherit");
      await client.query("set local role adstable_owner");
      await client.query("grant usage on schema integrations,operations,evidence,identity to " + role);
      await client.query("grant execute on function " + [...new Set(rpc.map(x => x[1]))].join(",") + " to " + role);
    }
    const extension = readFileSync(new URL("./sql/eo05b-dataset-role-extension.sql", import.meta.url), "utf8").trim().replace(/^--[^\n]*\n/, "").replace(/^begin;/, " ").replace(/commit;$/, " ");
    await client.query(extension); await client.query("set local role adstable_owner");
    for (const [provider, short] of providers) {
      const role = "adstable_" + short + "_source_runner", prefix = short.toUpperCase(), key = () => randomBytes(32).toString("base64url");
      const environment = {ADSTABLE_SOURCE_EVIDENCE_ACTIVE_KEY_VERSION: "1", ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1: key(),
        ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION: "1", ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1: key(), ADSTABLE_SESSION_ENCRYPTION_KEY_V1: key(),
        ADSTABLE_DATASET_WRITE_ENABLED: "true", ["ADSTABLE_" + prefix + "_SOURCE_DATABASE_URL"]: "postgresql://" + role + ".podpwkrpmjiksskxhwsu:" + "x".repeat(32) + "@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require",
        ["ADSTABLE_" + prefix + "_SOURCE_DB_TIMEOUT_MS"]: "1000"};
      const owner = await ownerFixture(client, provider), input = await storedBindingFixture(client, owner, {cipher: createConfiguredSourceEvidenceCipher(environment)});
      const plan = {version: 1, operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString(), owner, batches: input.batches,
        limits: {maxPages: 100, maxRows: 1000, maxBytes: 1000000, maxElapsedMs: 60000}, useFx: false};
      environment.ADSTABLE_DATASET_WRITE_PLAN = JSON.stringify(plan);
      let ordinal = 0, native = 0;
      const poolFactory = () => ({on() {}, async end() {}, async connect() {
        const savepoint = "dataset_rpc_" + (++ordinal); let committed = false;
        return {release() {}, async query(sql, args) {
          if (sql === "begin") return client.query("savepoint " + savepoint);
          if (sql === "commit") {await client.query("set local role adstable_owner"); await client.query("release savepoint " + savepoint); committed = true; return {rows: []};}
          if (sql === "rollback") {if (!committed) {await client.query("rollback to savepoint " + savepoint); await client.query("release savepoint " + savepoint);} await client.query("set local role adstable_owner"); return {rows: []};}
          if (sql.startsWith("select pg_catalog.set_config")) return client.query(sql, args);
          await client.query("set local role " + role);
          let result;
          try {result = await client.query(sql, args);} catch (error) {
            console.error("EO05B_DATASET_SERVER_SQL_DIAGNOSTIC", JSON.stringify({provider, code: error.code, message: error.message, where: error.where})); throw error;
          }
          if (sql.includes("as profile_ready") && result.rows[0]?.profile_ready !== true) {
            const missing = await client.query("select s.signature from unnest($1::text[]) s(signature) where to_regprocedure(s.signature) is null or not coalesce(has_function_privilege(current_user,to_regprocedure(s.signature)::oid,'EXECUTE'),false)", args);
            console.error("EO05B_DATASET_PROFILE_DIAGNOSTIC", JSON.stringify({provider, profile: result.rows, missing: missing.rows}));
          }
          await client.query("set local role adstable_owner"); return result;
        }};
      }});
      const execution = createDatasetServerExecution({environment, operationId: plan.operationId, poolFactory, fetchFn: async () => {native++; throw Error("NATIVE_FORBIDDEN");}});
      const result = await execution.run(); await execution.close();
      assert.equal(result.rowsStored, provider === "google_ads" ? 3 : 2); assert.equal(result.consumerReceipt, false); assert.equal(native, 0);
      assert.equal(result.storageReceipt.operationId, plan.operationId);
      const repeated = createDatasetServerExecution({environment, operationId: plan.operationId, poolFactory, fetchFn: async () => {native++; throw Error("NATIVE_FORBIDDEN");}});
      await assert.rejects(repeated.run()); await repeated.close();
      assert.equal((await client.query("select count(*)::int n from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows[0].n, 1);
      // Exact current owner is checked before a historical context is returned.
      await client.query("savepoint dataset_context_denied");
      await assert.rejects(client.query(DATASET_SOURCE_CONTEXT_SQL, [JSON.stringify({...owner, generation: "999"}), "synthetic-binding-job", "1", "2026-11-01", "2026-11-01"]));
      await client.query("rollback to savepoint dataset_context_denied"); await client.query("release savepoint dataset_context_denied");
      assert.equal((await client.query("select count(*)::int n from evidence.source_batches where installation_id=$1 and handoff_state<>'pending'", [owner.installationId])).rows[0].n, 0);
      assert.equal((await client.query("select has_table_privilege($1,'evidence.source_pages','SELECT') yes", [role])).rows[0].yes, false);
      await client.query("savepoint dataset_column_privilege");
      await client.query("grant select(id) on evidence.source_pages to " + role);
      const unsafe = createDatasetServerExecution({environment, operationId: plan.operationId, poolFactory});
      await assert.rejects(unsafe.run()); await unsafe.close();
      await client.query("rollback to savepoint dataset_column_privilege"); await client.query("release savepoint dataset_column_privilege");
    }
    for (const role of ["anon", "authenticated", "service_role", "adstable_runtime", "adstable_refresh_coordinator"]) for (const [, signature] of DATASET_STORAGE_RPC) {
      assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') yes", [role, signature])).rows[0].yes, false);
    }
    console.log("EO05B_DATASET_SERVER_PASS three_provider=true actual_narrow_role_SQL=true actual_AEAD=true receipts_readback=true native_HTTP=0 live_mutation=false");
  } finally {await client.query("rollback to savepoint dataset_server_outer"); await client.query("release savepoint dataset_server_outer"); await client.query("set local role adstable_owner");}
}
