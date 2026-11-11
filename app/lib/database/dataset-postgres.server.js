import pg from "pg";
import {DATASET_STORAGE_RPC, DATASET_RECONCILIATION_RPC, SCHEDULED_DATASET_RPC} from "./dataset-rpc.server.js";
import {SUPABASE_ROOT_CA_2021} from "./supabase-root-ca-2021.server.js";
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
  const config = spec.config(environment), signatures = [...new Set([...spec.rpc, ...rpc].map(x => x[1]))];
  const profile = spec.check.replace(") as profile_ready", `and has_schema_privilege(current_user,'analytics','USAGE') and has_schema_privilege(current_user,'app','USAGE')
    and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')
      and c.relkind in ('r','p') and has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
    and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')
      and c.relkind='S' and has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE'))) as profile_ready`);
  return createBoundedDatasetClient({config, rpc, signatures, profile, role: spec.role, deadlineAt, signal, now, poolFactory});
}

const scheduledRole = "adstable_refresh_dataset_runner";
const privateSchemas = "('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')";
const scheduledProfile = `select current_user as role, (
  exists(select 1 from pg_roles r where r.rolname=current_user and not (r.rolsuper or r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls)
    and not exists(select 1 from pg_auth_members m where m.member=r.oid))
  and has_schema_privilege(current_user,'analytics','USAGE') and has_schema_privilege(current_user,'evidence','USAGE')
  and not exists(select 1 from unnest($1::text[]) s(signature) where not coalesce(has_function_privilege(current_user,to_regprocedure(s.signature)::oid,'EXECUTE'),false))
  and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ${privateSchemas}
    and has_function_privilege(current_user,p.oid,'EXECUTE')
    and not exists(select 1 from unnest($1::text[]) s(signature) where to_regprocedure(s.signature)::oid=p.oid))
  and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${privateSchemas}
    and ((c.relkind in ('r','p','v','m','f') and (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
      or (c.relkind='S' and has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE'))))
) as profile_ready`;

export function createScheduledDatasetPostgresClient({environment, deadlineAt, signal, now = Date.now, poolFactory = c => new pg.Pool(c)}) {
  let config;
  try {
    const url = new URL(environment.ADSTABLE_REFRESH_DATASET_DATABASE_URL);
    const timeout = environment.ADSTABLE_REFRESH_DATASET_DB_TIMEOUT_MS;
    if (!["postgres:", "postgresql:"].includes(url.protocol) || decodeURIComponent(url.username) !== scheduledRole + ".podpwkrpmjiksskxhwsu"
      || decodeURIComponent(url.password).length < 24 || !/^aws-[0-9]+-eu-central-1\.pooler\.supabase\.com$/.test(url.hostname)
      || url.port !== "6543" || url.pathname !== "/postgres" || url.hash || url.searchParams.size !== 1 || url.searchParams.get("sslmode") !== "require"
      || typeof timeout !== "string" || !/^\d{1,5}$/.test(timeout) || Number(timeout) < 1 || Number(timeout) > 30000) throw failure();
    url.search = "";
    config = {connectionString: url.toString(), timeoutMs: Number(timeout), ssl: {ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true}};
  } catch {throw failure();}
  return createBoundedDatasetClient({config, rpc: SCHEDULED_DATASET_RPC, signatures: SCHEDULED_DATASET_RPC.map(([, signature]) => signature),
    profile: scheduledProfile, role: scheduledRole, deadlineAt, signal, now, poolFactory});
}

function createBoundedDatasetClient({config, rpc, signatures, profile, role, deadlineAt, signal, now, poolFactory}) {
  if (typeof poolFactory !== "function" || typeof now !== "function" || !Number.isSafeInteger(deadlineAt) || deadlineAt <= now()) throw failure();
  const queries = new Map(rpc.map(([sql]) => [sql, Math.max(...[...sql.matchAll(/\$(\d+)/g)].map(x => Number(x[1])))]));
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
        if (identity?.length !== 1 || identity[0].role !== role || identity[0].profile_ready !== true) throw failure();
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
