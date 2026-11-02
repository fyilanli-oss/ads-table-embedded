import assert from "node:assert/strict";
import {randomBytes, randomUUID} from "node:crypto";
import pg from "pg";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";
import {createSourceEvidenceRepository} from "../app/lib/database/source-evidence-store.server.js";

const schemaNames = ["evidence", "identity", "source"];
const tables = ["evidence.source_batches", "evidence.source_pages", "evidence.source_references",
  "identity.source_rule_versions", "identity.product_identity_mappings", "source.shopify_order_versions",
  "source.shopify_line_versions", "source.shopify_journey_versions", "source.provider_claim_versions", "evidence.source_reference_links"];

async function fixture(client) {
  const shopId = "gid://shopify/Shop/" + BigInt("0x" + randomBytes(6).toString("hex"));
  const shopDomain = "source-" + randomBytes(6).toString("hex") + ".myshopify.com", identity = randomBytes(32);
  const result = (await client.query("select * from shopify.bootstrap_installation($1,$2,$3,statement_timestamp())", [shopId, shopDomain, identity])).rows[0];
  const iid = (await client.query("select id::text from shopify.installations where workspace_id=$1", [result.workspace_id])).rows[0].id;
  return {owner: {workspaceId: result.workspace_id, installationId: iid, generation: String(result.install_generation), shopId, shopDomain, provider: "shopify"}, identity};
}
async function rejected(client, action, code) {
  await client.query("savepoint source_expected_failure");
  let error;
  try {await action();} catch (caught) {error = caught;}
  await client.query("rollback to savepoint source_expected_failure");
  await client.query("release savepoint source_expected_failure");
  assert.ok(error, "SQL must reject the invalid operation");
  if (code) assert.match(error.message, code);
}

export async function sourceEvidenceProbe(client, connection, environment = process.env) {
  assert.equal(environment.GITHUB_ACTIONS, "true"); assert.ok(environment.RUNNER_TEMP);
  assert.equal(connection.host, "127.0.0.1"); assert.equal(connection.port, 54322);
  await client.query("begin");
  try {
    await client.query("set local role adstable_owner");
    const {owner, identity} = await fixture(client), foreign = await fixture(client);
    const {input, prepare} = sourceStoreFixture({owner});
    input.records.rules.push({key: "rule", ruleKey: "synthetic-only-rule", version: "1", kind: "test",
      context: {}, parserVersion: "test-v1", state: "conflicting", basis: {type: "synthetic"}, applicability: {state: "unknown"}});
    input.records.mappings.push({key: "mapping", rule: "rule", identity: {provider: "shopify", accountId: null, nativeId: "native-1", context: {}},
      revision: "1", nativeId: "native-1", context: {}, productId: null, variantId: null, state: "unresolved", verifiedAt: null, applicability: {state: "unknown"}});
    input.records.journeys.push({key: "journey", order: "order", kind: "summary", ordinal: 0, state: "ready", ready: true,
      complete: true, data: {firstVisit: null, lastVisit: null, moments: []}});
    for (const [targetType, target] of [["rule", "rule"], ["mapping", "mapping"], ["journey", "journey"]]) {
      input.records.links.push({reference: "order-ref", targetType, target, role: "synthetic-proof"});
    }
    const repository = createSourceEvidenceRepository(client), write = prepare();
    const receipt = await repository.commit(write);
    assert.equal(receipt.status, "committed");
    const same = (await client.query("select evidence.commit_source_batch($1::jsonb,$2,$3,$4::jsonb) as result",
      [JSON.stringify(owner), write.attemptId, 0, JSON.stringify(write.body)])).rows[0].result;
    assert.equal(same.commitId, receipt.commitId, "same operation returns its recorded receipt");
    const replay = sourceStoreFixture({owner, cipher: input.cipher, policy: input.policy});
    const replayReceipt = await repository.commit(replay.prepare());
    assert.equal(replayReceipt.manifest.ids["order:order"], receipt.manifest.ids["order:order"]);
    assert.equal((await client.query("select count(*)::int n from source.shopify_order_versions where installation_id=$1", [owner.installationId])).rows[0].n, 1);
    assert.equal((await client.query("select count(*)::int n from source.shopify_line_versions where installation_id=$1", [owner.installationId])).rows[0].n, 1);
    const pages = await repository.readPages({...write, limit: 10});
    assert.deepEqual(input.cipher.open({owner, attemptId: write.attemptId, ordinal: 0, page: pages[0]}), input.pages[0].payload);
    assert.equal((await repository.readPages({...write, owner: foreign.owner, limit: 10})).length, 0);
    assert.deepEqual(await repository.inspect({...write, owner: foreign.owner}), {status: "not_observed", rollbackProven: false});

    const batchCount = (await client.query("select count(*)::int n from evidence.source_batches")).rows[0].n;
    const conflict = structuredClone(write.body); conflict.sourceState = "partial";
    await rejected(client, () => client.query("select evidence.commit_source_batch($1::jsonb,$2,$3,$4::jsonb)",
      [JSON.stringify(owner), write.attemptId, 0, JSON.stringify(conflict)]), /SOURCE_OPERATION_CONFLICT/);
    const broken = structuredClone(write.body); broken.lines[0].reference = "not-in-this-bundle";
    await rejected(client, () => client.query("select evidence.commit_source_batch($1::jsonb,$2,0,$3::jsonb)",
      [JSON.stringify(owner), randomUUID(), JSON.stringify(broken)]));
    assert.equal((await client.query("select count(*)::int n from evidence.source_batches")).rows[0].n, batchCount, "late failure rolls back pages, batch, and structured writes");
    const badVersion = structuredClone(write.body); badVersion.orders[0].data.amount = "999.99";
    await rejected(client, () => client.query("select evidence.commit_source_batch($1::jsonb,$2,0,$3::jsonb)",
      [JSON.stringify(owner), randomUUID(), JSON.stringify(badVersion)]), /SOURCE_ORDER_VERSION_CONFLICT/);
    await rejected(client, () => client.query("select evidence.commit_source_batch($1::jsonb,$2,0,$3::jsonb)",
      [JSON.stringify({...owner, generation: "999"}), randomUUID(), JSON.stringify(write.body)]), /SOURCE_OWNER_CHANGED/);
    const ref = (await client.query("select id::text from evidence.source_references where installation_id=$1 order by id limit 1", [owner.installationId])).rows[0].id;
    await rejected(client, async () => {
      await client.query(`insert into evidence.source_reference_links(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,source_reference_id,role,order_version_id)
        values($1,$2,$3,$4,'metadata',statement_timestamp()+interval '1 day',$5,'foreign',$6)`,
      [foreign.owner.workspaceId, foreign.owner.installationId, foreign.owner.generation, foreign.owner.shopId, ref, receipt.manifest.ids["order:order"]]);
      await client.query("set constraints all immediate");
    });
    for (const role of ["anon", "authenticated", "service_role", "adstable_runtime", "adstable_refresh_coordinator"]) {
      for (const table of tables) assert.equal((await client.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed", [role, table])).rows[0].allowed, false);
      assert.equal((await client.query("select has_function_privilege($1,'evidence.commit_source_batch(jsonb,uuid,integer,jsonb)','EXECUTE') allowed", [role])).rows[0].allowed, false);
    }
    const rls = await client.query("select c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1) and c.relkind='r'", [schemaNames]);
    assert.equal(rls.rows.length, 10); assert.ok(rls.rows.every(r => r.relrowsecurity && r.relforcerowsecurity));
    await client.query("update evidence.source_pages set retain_until=statement_timestamp()-interval '1 day' where installation_id=$1", [owner.installationId]);
    let purge = (await client.query("select evidence.purge_expired_source_pages($1,0,100) as result", [owner.workspaceId])).rows[0].result;
    assert.equal(purge.purged, 0, "pending downstream handoff holds even expired raw pages");
    await client.query("update evidence.source_batches set handoff_state='consumed',handoff_receipt=$2 where installation_id=$1", [owner.installationId, "a".repeat(64)]);
    purge = (await client.query("select evidence.purge_expired_source_pages($1,0,100) as result", [owner.workspaceId])).rows[0].result;
    assert.equal(purge.purged, 0, "longer-lived order/rule/mapping dependencies hold the raw evidence");
    for (const table of tables.filter(t => !["evidence.source_pages", "evidence.source_batches"].includes(t))) {
      await client.query(`update ${table} set retain_until=statement_timestamp()-interval '1 hour' where installation_id=$1`, [owner.installationId]);
    }
    purge = (await client.query("select evidence.purge_expired_source_pages($1,0,100) as result", [owner.workspaceId])).rows[0].result;
    assert.ok(purge.purged > 0);
    const expired = await repository.readPages({...write, limit: 10}); assert.equal(expired[0].available, false);
    assert.equal(expired[0].ciphertext, null);
    await client.query("select privacy.request_workspace_deletion($1,$2,$3,$4,$5,statement_timestamp())",
      ["source-test-" + randomUUID(), owner.shopId, owner.shopDomain, owner.generation, identity]);
    const deletion = (await client.query("select id from privacy.deletion_runs where workspace_id=$1 and kind='merchant_delete_my_data'", [owner.workspaceId])).rows[0].id;
    assert.equal((await client.query("select * from privacy.execute_deletion_run($1)", [deletion])).rows[0].deletion_status, "completed");
    for (const table of tables) assert.equal((await client.query(`select count(*)::int n from ${table} where installation_id=$1`, [owner.installationId])).rows[0].n, 0);
    const manifest = (await client.query("select row_counts from privacy.deletion_manifests where deletion_run_id=$1", [deletion])).rows[0].row_counts;
    assert.ok(manifest["evidence.source_batches"] > 0, "existing privacy manifest records the deleted source families");
  } finally {await client.query("rollback");}
  console.log("SOURCE_EVIDENCE_SQL_PASS atomic-replay-owner-fk-crypto-retention-privacy");
}
