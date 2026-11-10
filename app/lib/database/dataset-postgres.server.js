import pg from "pg";
import {DATASET_STORAGE_RPC, DATASET_RECONCILIATION_RPC} from "./dataset-rpc.server.js";
import {GOOGLE_DATASET_SOURCE_RPC, GOOGLE_SOURCE_ROLE, GOOGLE_SOURCE_ROLE_CHECK_SQL, readGoogleSourceDatabaseConfig} from "./google-source-postgres.server.js";
import {META_SOURCE_RPC, META_SOURCE_ROLE, META_SOURCE_ROLE_CHECK_SQL, readMetaSourceDatabaseConfig} from "./meta-source-postgres.server.js";
import {KLAVIYO_SOURCE_RPC, KLAVIYO_SOURCE_ROLE, KLAVIYO_SOURCE_ROLE_CHECK_SQL, readKlaviyoSourceDatabaseConfig} from "./klaviyo-source-postgres.server.js";
const providers = Object.freeze({
  google_ads: {role: GOOGLE_SOURCE_ROLE, rpc: GOOGLE_DATASET_SOURCE_RPC, check: GOOGLE_SOURCE_ROLE_CHECK_SQL, config: readGoogleSourceDatabaseConfig},
  meta: {role: META_SOURCE_ROLE, rpc: META_SOURCE_RPC, check: META_SOURCE_ROLE_CHECK_SQL, config: readMetaSourceDatabaseConfig},
  klaviyo: {role: KLAVIYO_SOURCE_ROLE, rpc: KLAVIYO_SOURCE_RPC, check: KLAVIYO_SOURCE_ROLE_CHECK_SQL, config: readKlaviyoSourceDatabaseConfig},
});
const failure = () => Error("DATASET_DATABASE_UNCONFIRMED");

// Reuses each provider's existing TLS identity. No direct table access, owner
// login, role switch, new credentials or privileges are provisioned here.
export function createDatasetPostgresClient({environment, provider, deadlineAt, signal, reconciliation = false, now = Date.now, poolFactory = c => new pg.Pool(c)}) {
  const spec = providers[provider];
  if (!spec || typeof poolFactory !== "function" || typeof now !== "function" || !Number.isSafeInteger(deadlineAt) || deadlineAt <= now()) throw failure();
  if (typeof reconciliation !== "boolean") throw failure();
  const rpc = [...DATASET_STORAGE_RPC, ...reconciliation ? DATASET_RECONCILIATION_RPC : []];
  const queries = new Map(rpc.map(([sql]) => [sql, Math.max(...[...sql.matchAll(/\$(\d+)/g)].map(x => Number(x[1])))]));
  const config = spec.config(environment), signatures = [...new Set([...spec.rpc, ...rpc].map(x => x[1]))];
  const profile = spec.check.replace(") as profile_ready", `and has_schema_privilege(current_user,'analytics','USAGE') and has_schema_privilege(current_user,'app','USAGE')
    and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')
      and c.relkind in ('r','p') and has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
    and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')
      and c.relkind='S' and has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE'))) as profile_ready`);
  const pool = poolFactory({...config, max: 1, query_timeout: config.timeoutMs, connectionTimeoutMillis: Math.min(config.timeoutMs, deadlineAt - now()),
    idleTimeoutMillis: 10000, allowExitOnIdle: true, application_name: "adstable-dataset-storage"});
  let stopped = false, closed = false, busy = false;
  pool.on("error", () => {stopped = true;});
  const check = () => {if (stopped || closed || signal?.aborted || now() >= deadlineAt) throw failure();};
  return Object.freeze({
    async query(sql, parameters = []) {
      check();
      if (busy || !queries.has(sql) || !Array.isArray(parameters) || parameters.length !== queries.get(sql)) throw failure();
      const args = structuredClone(parameters); busy = true; let client, broken = false;
      try {
        client = await pool.connect(); check(); await client.query("begin");
        await client.query("select pg_catalog.set_config('statement_timeout',$1,true),pg_catalog.set_config('lock_timeout',$1,true)", [Math.max(1, Math.min(config.timeoutMs, deadlineAt - now())) + "ms"]);
        const identity = (await client.query(profile, [signatures])).rows; check();
        if (identity?.length !== 1 || identity[0].role !== spec.role || identity[0].profile_ready !== true) throw failure();
        const result = await client.query(sql, args); check(); await client.query("commit"); check(); return result;
      } catch {
        stopped = true; broken = true;
        if (client) {try {await client.query("rollback");} catch {}}
        throw failure();
      } finally {busy = false; client?.release(broken);}
    },
    async close() {if (closed) return; closed = true; try {await pool.end();} catch {throw failure();}},
  });
}
