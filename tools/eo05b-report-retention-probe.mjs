import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {storedBindingFixture} from "./eo05b-source-dataset-binding-probe.mjs";
import {bindStoredDatasetSources} from "../app/lib/database/dataset-source-binding.server.js";
import {resolveReportRetentionPolicy} from "../app/lib/database/report-retention-policy.server.js";
import {prepareDatasetRetentionSweep, createDatasetRetentionRepository} from "../app/lib/database/dataset-retention.server.js";
import {prepareDatasetWrite, createDatasetStorageRepository} from "../app/lib/database/dataset-storage.server.js";
import {datasetStorageFixture} from "../tests/fixtures/dataset-storage-fixture.js";
import {readFileSync} from "node:fs";

// Invoked in the existing verified-mapping probe's nested rollback case, with
// a genuinely accepted synthetic reviewed rule/mapping and admitted job context.
export async function reportMappingRetentionProbe(client, {owner, mappingId}) {
  const lineage = JSON.parse(readFileSync(new URL("../contracts/a6-tech-01-f01-migration-lineage-v1.json", import.meta.url), "utf8"));
  for (const entry of lineage.prepared_migrations) {
    await client.query(readFileSync(new URL("../" + entry.file, import.meta.url), "utf8").trim().replace(/^begin;/, " ").replace(/commit;$/, " "));
  }
  await client.query("set local role adstable_owner");
  const until = resolveReportRetentionPolicy({businessDate: "2026-11-01", timeZone: "UTC"}).until;
  const before = (await client.query("select id::text,request_digest,commit_id from evidence.source_batches where installation_id=$1 order by id", [owner.installationId])).rows;
  const snapshot = (await client.query("select identity.mapping_review_state($1::jsonb,$2::bigint,(select source_rule_version_id from identity.product_identity_mappings where id=$2),false) result", [JSON.stringify(owner), mappingId])).rows[0].result;
  await client.query("select analytics.hold_report_mapping($1::jsonb,$2::bigint,$3::timestamptz)", [JSON.stringify(owner), mappingId, until]);
  for (const [table, ids] of [["identity.product_identity_mappings", [mappingId]], ["identity.source_rule_versions", [snapshot.rule.id]],
    ["evidence.source_pages", snapshot.pages.map(p => p.id)], ["evidence.source_references", snapshot.references.map(r => r.id)]])
    assert.equal((await client.query(`select count(*)::int n from ${table} where installation_id=$1 and retain_until < $2::timestamptz and id=any($3::bigint[])`, [owner.installationId, until, ids])).rows[0].n, 0);
  assert.equal((await client.query("select count(*)::int n from evidence.source_reference_links where installation_id=$1 and (mapping_id=$3::bigint or source_rule_version_id=$4::bigint) and retain_until < $2::timestamptz", [owner.installationId, until, mappingId, snapshot.rule.id])).rows[0].n, 0);
  assert.deepEqual((await client.query("select id::text,request_digest,commit_id from evidence.source_batches where installation_id=$1 order by id", [owner.installationId])).rows, before);
  await rejected(client, () => client.query("update identity.product_identity_mappings set retain_until=clock_timestamp()+interval '1 second' where id=$1", [mappingId]), /REPORT_RETENTION_PINNED/);
  // Retaining a rule is not prolonging its applicability/review authority.
  await client.query("savepoint retained_but_stale_mapping");
  await client.query("update identity.source_rule_versions set applicability=jsonb_set(applicability,'{until}',to_jsonb((clock_timestamp()-interval '1 second')::text)) where id=(select source_rule_version_id from identity.product_identity_mappings where id=$1)", [mappingId]);
  await rejected(client, () => client.query("select analytics.hold_report_mapping($1::jsonb,$2::bigint,$3::timestamptz)", [JSON.stringify(owner), mappingId, until]), /MAPPING_RULE_NOT_CURRENT/);
  await client.query("rollback to savepoint retained_but_stale_mapping"); await client.query("release savepoint retained_but_stale_mapping");
  console.log("EO05B_MAPPING_RETENTION_PASS provider=" + owner.provider + " synthetic_rule_mapping=true source_refs_links_preserved=true stale_authority_rejected=true live_mutation=false");
}

async function rejected(client, action, pattern) {
  await client.query("savepoint retention_expected_failure");
  let error; try {await action();} catch (caught) {error = caught;}
  await client.query("rollback to savepoint retention_expected_failure"); await client.query("release savepoint retention_expected_failure");
  assert.ok(error); if (pattern) assert.match(error.message, pattern);
}
const sweep = (owner, extra = {}) => prepareDatasetRetentionSweep({workspaceId: owner.workspaceId, installationId: owner.installationId, generation: owner.generation,
  table: "pd_facts", after: "0", limit: 10, deadlineAt: new Date(Date.now() + 20000).toISOString(),
  auditPolicy: {version: "synthetic-audit", until: new Date(Date.now() + 60000).toISOString(), maxReceipts: 100}, ...extra});

/** Actual PostgreSQL on the existing F01 localhost transaction; all owners,
 * admission and bodies are synthetic. No clock/trigger bypass or live calls. */
export async function reportRetentionProbe(client, {ownerFixture, sourceFixture}) {
  for (const [businessDate, timeZone] of [["2024-02-29", "UTC"], ["2097-02-28", "UTC"], ["2026-11-01", "America/Los_Angeles"], ["2021-03-31", "Europe/Berlin"]]) {
    const result = (await client.query("select analytics.report_retention_until($1::date,$2::text) result", [businessDate, timeZone])).rows[0].result;
    assert.equal(result.toISOString(), resolveReportRetentionPolicy({businessDate, timeZone}).until);
  }
  await rejected(client, () => client.query("select analytics.report_retention_until('2024-01-01','Not/AZone')"));
  const retained = [];
  for (const provider of ["google_ads", "meta", "klaviyo"]) {
    const owner = await ownerFixture(client, provider), input = await storedBindingFixture(client, owner, {nonempty: false});
    const before = (await client.query("select id::text,request_digest,commit_id from evidence.source_batches where installation_id=$1 order by id", [owner.installationId])).rows;
    const result = await bindStoredDatasetSources(input);
    assert.equal(result.empty, true); assert.equal(result.rowsStored, 0); assert.equal(result.storageReceipt, null);
    assert.equal(result.retentionReceipt.status, "retained_empty"); assert.equal(result.consumerReceipt, false);
    const until = result.retentionReceipt.until;
    assert.equal((await client.query("select count(*)::int n from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows[0].n, 0);
    assert.equal((await client.query("select count(*)::int n from evidence.source_pages where installation_id=$1 and retain_until < $2::timestamptz", [owner.installationId, until])).rows[0].n, 0);
    assert.deepEqual((await client.query("select id::text,request_digest,commit_id from evidence.source_batches where installation_id=$1 order by id", [owner.installationId])).rows, before);
    assert.equal((await client.query("select count(*)::int n from evidence.source_batches where installation_id=$1 and handoff_state<>'pending'", [owner.installationId])).rows[0].n, 0);
    for (const table of ["evidence.source_batches", "evidence.source_pages"])
      await rejected(client, () => client.query(`update ${table} set retain_until=clock_timestamp()+interval '1 day' where installation_id=$1`, [owner.installationId]), /REPORT_RETENTION_PINNED/);
    retained.push(owner);
  }
  // Mandatory erasure bypasses normal TTL, not the owner boundary. The second
  // merchant's complete retained proof must survive another merchant's erase.
  await client.query("select evidence.delete_installation_sources($1::bigint)", [retained[0].installationId]);
  assert.equal((await client.query("select count(*)::int n from evidence.source_batches where installation_id=$1", [retained[0].installationId])).rows[0].n, 0);
  assert.ok((await client.query("select count(*)::int n from evidence.source_batches where installation_id=$1", [retained[1].installationId])).rows[0].n > 0);

  // Expiry cleanup uses an honestly short legacy synthetic policy and actual
  // elapsed time. Nothing rewrites an immutable report TTL or disables guards.
  const owner = await ownerFixture(client), source = await sourceFixture(client, owner);
  const input = datasetStorageFixture({owner, source}); input.policy.until = new Date(Date.now() + 1000).toISOString();
  const stored = await createDatasetStorageRepository(client).commit(prepareDatasetWrite(input));
  await client.query("select pg_sleep(1.1)");
  const repository = createDatasetRetentionRepository(client);
  const held = await repository.cleanup(sweep(owner)); assert.equal(held.held, 1); assert.equal(held.deleted, 0);
  // Synthetic downstream receipt only, matching the existing source-maintenance
  // probe. This does NOT implement or claim EO05C/D consumer acceptance.
  await client.query("update evidence.source_batches set handoff_state='consumed',handoff_receipt=repeat('a',64) where id=$1", [source.batch_id]);
  const plan = sweep(owner), done = await repository.cleanup(plan);
  assert.equal(done.deleted, 1); assert.equal(done.sourceDeleted, false); assert.equal(done.consumerReceipt, false);
  assert.equal((await client.query("select count(*)::int n from analytics.pd_facts where id=$1", [stored.rows[0].id])).rows[0].n, 0);
  assert.equal((await client.query("select count(*)::int n from evidence.source_batches where id=$1", [source.batch_id])).rows[0].n, 1);
  await rejected(client, () => client.query("select analytics.cleanup_dataset_retention($1,$2,$3,$4,'unknown',0,10,clock_timestamp()+interval '1 second',$5)",
    [owner.workspaceId, owner.installationId, owner.generation, randomUUID(), JSON.stringify(plan.auditPolicy)]), /DATASET_RETENTION_INPUT_INVALID/);
  for (const role of ["anon", "authenticated", "service_role", "adstable_runtime", "adstable_refresh_coordinator"])
    for (const signature of ["analytics.hold_report_source_batch(jsonb,bigint,timestamptz)", "analytics.commit_dataset_empty_retention(jsonb,jsonb)", "analytics.cleanup_dataset_retention(uuid,bigint,bigint,uuid,text,bigint,integer,timestamptz,jsonb)"])
      assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') ok", [role, signature])).rows[0].ok, false);
  console.log("EO05B_REPORT_RETENTION_PASS three_provider_synthetic=true calendar_SQL_JS_equal=true empty_proof=true early_cleanup_blocked=true mandatory_erase=true owner_isolation=true live_mutation=false");
}
