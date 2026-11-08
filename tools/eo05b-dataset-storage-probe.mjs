import assert from "node:assert/strict";
import {randomBytes, randomUUID} from "node:crypto";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";
import {datasetStorageFixture} from "../tests/fixtures/dataset-storage-fixture.js";
import {createSourceEvidenceRepository} from "../app/lib/database/source-evidence-store.server.js";
import {prepareDatasetWrite, prepareDatasetFx, createDatasetStorageRepository} from "../app/lib/database/dataset-storage.server.js";

async function rejected(client, action, pattern) {
  await client.query("savepoint dataset_expected_failure"); let error;
  try {await action();} catch (caught) {error = caught;}
  await client.query("rollback to savepoint dataset_expected_failure"); await client.query("release savepoint dataset_expected_failure");
  assert.ok(error, "invalid SQL operation must fail"); if (pattern) assert.match(error.message, pattern);
}

async function ownerFixture(client, provider = "google_ads") {
  const shopId = "gid://shopify/Shop/" + BigInt("0x" + randomBytes(6).toString("hex")), shopDomain = "dataset-" + randomBytes(6).toString("hex") + ".myshopify.com";
  const boot = (await client.query("select * from shopify.bootstrap_installation($1,$2,$3,statement_timestamp())", [shopId, shopDomain, randomBytes(32)])).rows[0];
  const iid = (await client.query("select id::text from shopify.installations where workspace_id=$1", [boot.workspace_id])).rows[0].id;
  const credential = randomUUID(), connection = randomUUID(), accountId = provider === "google_ads" ? "123" : provider === "meta" ? "act_123" : "account-123";
  await client.query("insert into integrations.provider_credential_envelopes(id,installation_id,workspace_id,install_generation,provider,purpose,payload_ciphertext,nonce,auth_tag,key_version) values($1,$2,$3,$4,$5,'provider_token_set',$6,$7,$8,1)",
    [credential, iid, boot.workspace_id, boot.install_generation, provider, randomBytes(32), randomBytes(12), randomBytes(16)]);
  const scopes = provider === "google_ads" ? ["https://www.googleapis.com/auth/adwords", "https://www.googleapis.com/auth/content"]
    : provider === "meta" ? ["ads_read", "catalog_management", "business_management", "pages_read_engagement", "pages_show_list"]
      : ["accounts:read", "campaigns:read", "flows:read", "events:read", "metrics:read"];
  await client.query("insert into integrations.provider_connections(id,installation_id,workspace_id,install_generation,provider,credential_id,granted_scopes,connected_at,last_verified_at) values($1,$2,$3,$4,$5,$6,$7,statement_timestamp(),statement_timestamp())",
    [connection, iid, boot.workspace_id, boot.install_generation, provider, credential, scopes]);
  const account = (await client.query("insert into integrations.provider_accounts(connection_id,workspace_id,install_generation,provider,provider_account_id,display_name,account_kind,reporting_eligible,provider_status,currency_code,timezone_name,verified_at) values($1,$2,$3,$4,$5,'Synthetic only',$6,true,'active','USD','UTC',statement_timestamp()) returning id",
    [connection, boot.workspace_id, boot.install_generation, provider, accountId, provider === "klaviyo" ? "account" : "advertiser"])).rows[0].id;
  if (provider !== "klaviyo") await client.query("insert into integrations.reporting_account_bindings(connection_id,account_id,workspace_id,install_generation,provider,effective_from,change_reason) values($1,$2,$3,$4,$5,statement_timestamp(),'initial_selection')", [connection, account, boot.workspace_id, boot.install_generation, provider]);
  const authority = (await client.query("select * from integrations.load_provider_identity_authority($1,$2,$3,$4,$5)", [boot.workspace_id, boot.install_generation, provider, shopId, shopDomain])).rows[0];
  assert.ok(authority, "synthetic current authority must exist");
  const owner = {workspaceId: boot.workspace_id, installationId: iid, generation: String(boot.install_generation), shopId, shopDomain, provider,
    connectionId: connection, connectionVersion: String(authority.connection_version), accountId, selectionEpoch: provider === "klaviyo" ? null : String(authority.reporting_selection_epoch), credentialId: credential};
  return owner;
}

async function sourceFixture(client, owner) {
  const x = sourceStoreFixture({owner});
  for (const key of Object.keys(x.input.records)) x.input.records[key] = [];
  x.input.pages = [{key: "native", family: "synthetic_dataset", ordinal: 0, origin: owner.provider, captureLayer: "collector_projection", numericFidelity: "exact_source_string",
    fieldCoverage: ["records"], schemaVersion: "synthetic-v1", sanitizerVersion: "synthetic-v1", payload: {records: [{entity_id: "ad-1", spend: "9007199254740993.1234567890123456789"}]}}];
  const write = x.prepare(), repo = createSourceEvidenceRepository(client), receipt = await repo.commit(write), pages = await repo.readPages({...write, limit: 10});
  assert.deepEqual(x.input.cipher.open({owner, attemptId: write.attemptId, ordinal: 0, page: pages[0]}), x.input.pages[0].payload);
  return {batch_id: receipt.batchId, commit_id: receipt.commitId, request_digest: receipt.digest, page_id: pages[0].id, payload_hash: pages[0].payloadHash};
}

/** Real PostgreSQL, synthetic owner/native envelopes only, always rollback. */
export async function datasetStorageProbe(client, connection, environment = process.env) {
  assert.equal(environment.GITHUB_ACTIONS, "true"); assert.ok(environment.RUNNER_TEMP);
  assert.equal(connection.host, "127.0.0.1"); assert.equal(connection.port, 54322);
  await client.query("begin");
  try {
    await client.query("set local role adstable_owner");
    for (const provider of ["google_ads", "meta", "klaviyo"]) {
      const owner = await ownerFixture(client, provider), source = await sourceFixture(client, owner);
      const input = datasetStorageFixture({owner, source}); input.rows[0].row.spend_value = "9007199254740993.1234567890123456789";
      const repository = createDatasetStorageRepository(client), prepared = prepareDatasetWrite(input), receipt = await repository.commit(prepared);
      assert.equal(receipt.consumerReceipt, false);
      const stored = (await client.query("select id::text,spend_value::text,impression::text,retain_until,revision::text from analytics.pd_facts where id=$1", [receipt.rows[0].id])).rows[0];
      assert.equal(stored.spend_value, input.rows[0].row.spend_value); assert.equal(stored.impression, "0"); assert.equal(stored.revision, "1");
      assert.equal((await client.query("select handoff_state from evidence.source_batches where id=$1", [source.batch_id])).rows[0].handoff_state, "pending");
      const inspected = await repository.inspect({owner, sourceBatchId: source.batch_id, operationId: prepared.body.operationId}); assert.deepEqual(inspected, receipt);
      const replay = (await client.query("select analytics.commit_dataset_storage($1::jsonb,$2::jsonb) result", [JSON.stringify(owner), JSON.stringify(prepared.body)])).rows[0].result;
      assert.deepEqual(replay, receipt);
      input.policy.until = new Date(Date.now() + 2 * 86400000).toISOString();
      const duplicate = await repository.commit(prepareDatasetWrite(input)); assert.equal(duplicate.rows[0].id, receipt.rows[0].id);
      assert.equal((await client.query("select retain_until from analytics.pd_facts where id=$1", [stored.id])).rows[0].retain_until.toISOString(), stored.retain_until.toISOString(), "replay must not extend retention");
      input.rows[0].row.spend_value = "3";
      await rejected(client, () => repository.commit(prepareDatasetWrite(input)), /WRITE_UNCONFIRMED/);
      assert.equal((await client.query("select spend_value::text from analytics.pd_facts where id=$1", [stored.id])).rows[0].spend_value, stored.spend_value);
      // A later invalid row must roll back earlier inserts and the receipt.
      const first = datasetStorageFixture({owner, source}), second = datasetStorageFixture({owner, source});
      first.rows[0].row.source_identity.native.entity_id = "new-ad"; first.rows[0].row.entity_id = "new-ad";
      second.rows[0].row.source_identity.native.entity_id = "bad-ad"; second.rows[0].row.entity_id = "bad-ad";
      second.rows[0].row.provenance.sources[0].payload_hash = "f".repeat(64);
      const batch = prepareDatasetWrite({...first, rows: [...first.rows, ...second.rows]});
      await rejected(client, () => repository.commit(batch), /WRITE_UNCONFIRMED/);
      assert.equal((await client.query("select count(*)::int n from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows[0].n, 1);
      assert.equal(await repository.inspect({owner, sourceBatchId: source.batch_id, operationId: batch.body.operationId}), null);
      await rejected(client, () => client.query("update evidence.source_pages set purged_at=statement_timestamp() where id=$1", [source.page_id]), /EVIDENCE_PINNED/);
      await rejected(client, () => client.query("delete from evidence.source_batches where id=$1", [source.batch_id]), /EVIDENCE_PINNED/);
      await rejected(client, () => client.query("update analytics.pd_facts set spend_value=4 where id=$1", [stored.id]), /REVISION_PROTOCOL/);
      const foreign = {...owner, workspaceId: randomUUID()};
      await rejected(client, () => repository.inspect({owner: foreign, sourceBatchId: source.batch_id, operationId: prepared.body.operationId}));
      // Revalidation is inside SQL, not a successful caller-side precheck.
      await client.query("savepoint dataset_stale");
      await client.query("update integrations.provider_connections set connection_version=connection_version+1 where id=$1", [owner.connectionId]);
      await rejected(client, () => repository.commit(prepareDatasetWrite(first)));
      await client.query("rollback to savepoint dataset_stale"); await client.query("release savepoint dataset_stale");
      if (provider !== "klaviyo") {
        for (const table of ["cpd_product_performance_facts", "cpd_product_sales_facts"]) {
          const x = datasetStorageFixture({owner, source, table});
          if (table === "cpd_product_sales_facts") {x.rows[0].row.sales_quantity = "0.125"; x.rows[0].row.sales_value = null; x.rows[0].row.observation_state.sales_value = "missing";}
          const result = await repository.commit(prepareDatasetWrite(x)); assert.ok(result.rows[0].id);
        }
      }
      // Lost acknowledgement after actual SQL write: explicit inspection recovers it.
      const lost = datasetStorageFixture({owner, source}); lost.rows[0].row.source_identity.native.entity_id = "lost-ad"; lost.rows[0].row.entity_id = "lost-ad";
      const w = prepareDatasetWrite(lost), uncertain = createDatasetStorageRepository({async query(sql, args) {await client.query(sql, args); throw Error("synthetic lost acknowledgement");}});
      await assert.rejects(uncertain.commit(w), /WRITE_UNCONFIRMED/);
      assert.equal((await repository.inspect({owner, sourceBatchId: source.batch_id, operationId: w.body.operationId})).status, "stored");
      const erased = (await client.query("select evidence.delete_installation_sources($1) result", [owner.installationId])).rows[0].result;
      assert.equal(erased["analytics.pd_facts"], 2);
      for (const table of ["pd_facts", "cpd_product_performance_facts", "cpd_product_sales_facts"]) assert.equal((await client.query("select count(*)::int n from analytics." + table + " where installation_id=$1", [owner.installationId])).rows[0].n, 0);
    }
    // FX stays immutable and referentially typed; no real provider is selected.
    const fxInput={source_currency:'USD',target_currency:'EUR',fx_rate_date:'2026-11-01',fx_rate:'0.9234567890123456789',fx_provider:'synthetic-only',rate_version:'test-v1',source_reference:{proof:'synthetic-only'},fetched_at:new Date().toISOString(),fx_schema_version:'test-v1'};
    const fxRepo=createDatasetStorageRepository(client),rate=await fxRepo.recordFx(prepareDatasetFx(fxInput));
    assert.equal((await fxRepo.recordFx(prepareDatasetFx(fxInput))).id,rate.id);
    await rejected(client,()=>fxRepo.recordFx(prepareDatasetFx({...fxInput,fx_rate:'0.9'})),/WRITE_UNCONFIRMED/);
    assert.equal(rate.fx_rate, "0.9234567890123456789");
    await rejected(client, () => client.query("update analytics.fx_rates set fx_rate=1 where id=$1", [rate.id]), /FX_IMMUTABLE/);
    await rejected(client, () => client.query("update analytics.fx_rates set fx_rate='NaN' where id=$1", [rate.id]));
    for (const role of ["anon", "authenticated", "service_role", "adstable_runtime", "adstable_refresh_coordinator"]) {
      assert.equal((await client.query("select has_function_privilege($1,'analytics.commit_dataset_storage(jsonb,jsonb)','EXECUTE') yes", [role])).rows[0].yes, false);
      for (const table of ["pd_facts", "cpd_product_performance_facts", "cpd_product_sales_facts", "fx_rates"]) assert.equal((await client.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') yes", [role, "analytics." + table])).rows[0].yes, false);
    }
    await client.query("set constraints all immediate");
    console.log("EO05B_DATASET_STORAGE_PASS synthetic_only=true live_mutation=false consumer_receipt=false");
  } finally {await client.query("rollback");}
}
