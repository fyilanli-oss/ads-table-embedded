import {createHash} from "node:crypto";
import {readFileSync, readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const ownerContextMigrations = new Map([
  ["20261009145154", "eo03d_qualify_lifecycle_event_columns"],
  ["20261009150114", "eo03d_qualify_lifecycle_update_columns"],
  ["20261009150614", "eo03d_qualify_finalize_update_columns"],
  ["20261009151123", "eo03d_disambiguate_reconnect_conflict"],
]);

export function validExecutionContext(entry) {
  const requiresOwner = ownerContextMigrations.get(entry.version) === entry.name;
  if (!requiresOwner) return entry.execution_context === undefined
    && entry.applied_sql_difference !== "live_session_role_wrapper_only";
  const context = entry.execution_context;
  return entry.applied_sql_difference === "live_session_role_wrapper_only"
    && context?.role === "adstable_owner" && context.scope === "transaction_local"
    && Object.keys(context).length === 2;
}

export function sqlHash(sql) {
  return createHash("sha256").update(sql.replaceAll("\r\n", "\n").trim()).digest("hex");
}

export function validateMigrationLineage({manifest, files, liveLedger}) {
  const errors = [];
  const expected = [...manifest.historical_migrations, ...manifest.pending_migrations];
  for (const key of ["version", "name", "file"]) {
    if (new Set(expected.map((entry) => entry[key])).size !== expected.length) {
      errors.push(`DUPLICATE_${key.toUpperCase()}`);
    }
  }
  for (const entry of expected) {
    if (!validExecutionContext(entry)) errors.push(`INVALID_EXECUTION_CONTEXT:${entry.name}`);
    if (!/^\d{14}$/.test(entry.version)) errors.push(`INVALID_VERSION:${entry.name}`);
    if (!/^[a-z0-9_]+$/.test(entry.name)) errors.push("INVALID_MIGRATION_NAME");
    if (!/^[0-9a-f]{64}$/.test(entry.repository_sql_sha256 ?? "")) {
      errors.push(`SQL_HASH_REQUIRED:${entry.name}`);
    }
    if (entry.file !== `supabase/migrations/${entry.version}_${entry.name}.sql`) {
      errors.push(`PATH_VERSION_NAME_MISMATCH:${entry.name}`);
    }
    const source = files[entry.file];
    if (source === undefined) errors.push(`MISSING_FILE:${entry.file}`);
    else if (entry.repository_sql_sha256 && sqlHash(source) !== entry.repository_sql_sha256) {
      errors.push(`SQL_CONTENT_CHANGED:${entry.file}`);
    }
  }
  for (const file of Object.keys(files)) {
    if (!expected.some((entry) => entry.file === file)) errors.push(`UNREGISTERED_FILE:${file}`);
  }
  if (liveLedger) {
    const historical = manifest.historical_migrations;
    for (const entry of historical) {
      if (!/^[0-9a-f]{64}$/.test(entry.applied_sql_sha256 ?? "")) {
        errors.push(`APPLIED_SQL_HASH_REQUIRED:${entry.name}`);
      }
      const matches = liveLedger.filter((row) => row.version === entry.version);
      if (matches.length !== 1 || matches[0].name !== entry.name
          || matches[0].applied_sql_sha256 !== entry.applied_sql_sha256) {
        errors.push(`LIVE_LEDGER_MISMATCH:${entry.name}`);
      }
    }
    for (const row of liveLedger) {
      if (!historical.some((entry) => entry.version === row.version && entry.name === row.name)) {
        errors.push(`UNREGISTERED_LIVE_MIGRATION:${row.version}`);
      }
    }
  }
  return errors;
}

export function loadMigrationFiles(root) {
  return Object.fromEntries(readdirSync(path.join(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => [`supabase/migrations/${name}`, readFileSync(path.join(root, "supabase/migrations", name), "utf8")]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const manifest = JSON.parse(readFileSync(path.join(root, "contracts/a6-tech-01-f01-migration-lineage-v1.json"), "utf8"));
  const suppliedLedger = process.argv[2];
  const evidence = JSON.parse(readFileSync(suppliedLedger
    ? path.resolve(suppliedLedger)
    : path.join(root, "docs/evidence/A6_TECH_01_F01_MIGRATION_LEDGER_2026-10-18.json"), "utf8"));
  const errors = validateMigrationLineage({manifest, files: loadMigrationFiles(root), liveLedger: evidence.migrations});
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(`Migration lineage PASS: ${manifest.historical_migrations.length} historical, ${manifest.pending_migrations.length} pending. Ledger source: ${suppliedLedger ? "supplied snapshot" : "2026-10-18 snapshot"}. Live schema and replay are not verified by this check.`);
  }
}
