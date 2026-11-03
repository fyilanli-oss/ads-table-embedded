import assert from "node:assert/strict";
import {sqlHash, validateMigrationLineage} from "./check-migration-lineage.mjs";

export const readinessEvidencePath = "docs/evidence/EO05_STEP15_MIGRATION_READINESS_2026-11-03.json";
const aliases = Object.freeze([
  ["20261031190928", "20261028164208", "eo05a_identity_oauth_atomic_stage"],
  ["20261031190941", "20261031181313", "eo05a_identity_oauth_reconnect"],
  ["20261101093615", "20261028175738", "eo05a_google_identity_renewal_receipt"],
]);
const shape = rows => rows.map(({version, name}) => ({version, name}));
const sorted = rows => [...rows].sort((a,b) => a.version.localeCompare(b.version));

// Offline reconciliation only. This does not repair history or authorize execution.
export function buildLiveReadinessPlan({manifest, files, evidence}) {
  assert.deepEqual(validateMigrationLineage({manifest, files}), [], "READINESS_SOURCE_LINEAGE_INVALID");
  assert.equal(evidence.checked_at, "2026-11-03", "READINESS_SNAPSHOT_DATE_INVALID");
  assert.equal(evidence.project?.id, "podpwkrpmjiksskxhwsu", "READINESS_PROJECT_INVALID");
  assert.equal(evidence.source_main, "0cb359e420cd6a505ae2b0faf4287e30ac755926", "READINESS_SOURCE_INVALID");
  assert.equal(evidence.live_apply_authorized, false, "READINESS_LIVE_AUTHORITY_FORBIDDEN");
  assert.equal(evidence.live_database_mutation, false, "READINESS_MUTATION_FORBIDDEN");
  assert.equal(evidence.live_schema_parity_verified, false, "READINESS_FALSE_LIVE_PARITY");
  const baseline = [...manifest.historical_migrations, ...manifest.forward_migrations];
  assert.equal(baseline.length, 40, "READINESS_BASELINE_INVALID");
  assert.equal(evidence.aliases.length, aliases.length, "READINESS_ALIAS_COUNT_INVALID");
  const resolved = aliases.map(([liveVersion, version, name], i) => {
    const row = evidence.aliases[i];
    assert.deepEqual([row.live_version,row.repository_version,row.name], [liveVersion,version,name], "READINESS_ALIAS_INVALID");
    const entry = manifest.pending_migrations.find(x => x.version === version && x.name === name);
    assert.ok(entry && entry.file === row.file, "READINESS_ALIAS_SOURCE_INVALID");
    assert.equal(row.exact_complete_sql_equal, true, "READINESS_ALIAS_BODY_NOT_VERIFIED");
    assert.equal(row.applied_sql_sha256, entry.repository_sql_sha256, "READINESS_ALIAS_HASH_INVALID");
    assert.equal(row.repository_sql_sha256, sqlHash(files[entry.file]), "READINESS_ALIAS_HASH_INVALID");
    return {...entry, live_version: liveVersion};
  });
  const expectedLedger = sorted([...shape(baseline), ...resolved.map(x=>({version:x.live_version,name:x.name}))]);
  assert.equal(evidence.baseline_count, 43, "READINESS_LEDGER_COUNT_INVALID");
  assert.deepEqual(shape(evidence.ledger), expectedLedger, "READINESS_LEDGER_MISMATCH");
  const excluded = new Set(resolved.map(x=>x.version));
  const remaining = manifest.pending_migrations.filter(x=>!excluded.has(x.version));
  assert.equal(remaining.length, 39, "READINESS_REMAINING_COUNT_INVALID");
  assert.equal(evidence.remaining_count, remaining.length, "READINESS_REMAINING_COUNT_INVALID");
  assert.deepEqual(evidence.remaining_migrations, remaining.map(({version,name,file,repository_sql_sha256})=>
    ({version,name,file,repository_sql_sha256})), "READINESS_REMAINING_ORDER_OR_HASH_INVALID");
  assert.deepEqual(remaining.map(x=>x.version), sorted(remaining).map(x=>x.version), "READINESS_ORDER_INVALID");
  return {baseline, aliases:resolved, remaining, ledger:expectedLedger,
    liveApplyAuthorized:false, historyRepairAuthorized:false};
}
