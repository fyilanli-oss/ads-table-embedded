import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {storedBindingFixture} from "./eo05b-source-dataset-binding-probe.mjs";
import {datasetServerProbe} from "./eo05b-dataset-server-probe.mjs";
import {reconcileStoredDatasetSources, inspectDatasetReconciliation, DATASET_RECONCILE_SQL, SCHEDULED_DATASET_FINISH_SQL} from "../app/lib/database/dataset-reconciliation.server.js";
import {storeMaturityConfiguration, recordMaturityDecision, inspectMaturityDecision} from "../app/lib/database/maturity-store.server.js";
import {maturityObservationFixture} from "../tests/fixtures/maturity-fixture.js";

async function rejected(client, action) {
  await client.query("savepoint reconciliation_expected_failure"); let error;
  try {await action();} catch (e) {error = e;}
  await client.query("rollback to savepoint reconciliation_expected_failure");await client.query("release savepoint reconciliation_expected_failure");
  assert.ok(error, "invalid reconciliation must fail");
  return error;
}

/** Existing F01 rollback transaction. Owners, native pages, clocks and keys below
 * are explicitly synthetic; SQL, AEAD, physical facts/CAS/ACL are actual. */
export async function reconciliationProbe(client, {ownerFixture}) {
  assert.equal(process.env.GITHUB_ACTIONS, "true"); let scenarios = 0;
  const database = {async query(sql, args) {try {return await client.query(sql, args);} catch (e) {
    if (/dataset_reconciliation/.test(sql)) console.error("EO05D_SQL_DIAGNOSTIC", JSON.stringify({code: e.code, message: e.message, where: e.where}));throw e;
  }}};
  async function source(owner, options = {}, stale = false) {
    // A second synthetic read reuses the SAME immutable admitted day context.
    const adapter = {query(sql, args) {return client.query(sql.startsWith("insert into operations.refresh_work_bindings") ? sql + " on conflict do nothing" : sql, args);}};
    const f = await storedBindingFixture(adapter, owner, options), key = owner.provider === "google_ads" ? "googleDatasetRead" : owner.provider === "meta" ? "metaDatasetRead" : "klaviyoDatasetRead";
    const stamp = new Date(Date.now() - (stale ? 60000 : 1000)).toISOString();
    for (const b of f.batches) await client.query("update evidence.source_batches set manifest=jsonb_set(jsonb_set(manifest,$3::text[],to_jsonb($4::text)),$5::text[],to_jsonb($4::text)) where authority=$1::jsonb and attempt_id=$2::uuid",
      [JSON.stringify(owner), b.attemptId, [key, "observedAt"], stamp, [key, "completedAt"]]);
    return {...f, database, expectedRevision: 0, limits: {...f.limits, deadlineAt: Date.now() + 60000}};
  }
  for (const provider of ["google_ads", "meta", "klaviyo"]) {
    const owner = await ownerFixture(client, provider), nonempty = provider !== "meta";
    const first = await source(owner, {nonempty, googlePurchase: "3"});
    const admittedScope = {jobId: "synthetic-binding-job", fence: "1", from: "2026-11-01", to: "2026-11-01"};
    await assert.rejects(reconcileStoredDatasetSources({...first, admittedScope: {...admittedScope, fence: "2"}}), /ADMITTED_SCOPE_MISMATCH/);
    await rejected(client, () => reconcileStoredDatasetSources({...first, admittedScope, scheduled: true}));
    assert.equal((await client.query("select count(*)::int n from evidence.source_batches where authority=$1::jsonb and handoff_state='consumed'", [JSON.stringify(owner)])).rows[0].n, 0);
    const initial = await reconcileStoredDatasetSources({...first, admittedScope});
    assert.equal(initial.revision, 1);assert.equal(initial.consumerReceipt, true);scenarios++;
    assert.equal((await client.query("select count(*)::int n from evidence.source_batches where authority=$1::jsonb and handoff_state='consumed'", [JSON.stringify(owner)])).rows[0].n, first.batches.length);
    await rejected(client, () => reconcileStoredDatasetSources(first));scenarios++;
    const rowBefore = (await client.query("select id,purchase::text from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows[0];
    if (provider === "google_ads") assert.equal(rowBefore.purchase, "3");
    if (provider === "google_ads") {
      const observation = maturityObservationFixture(provider, {owner, clickDays: "0"});
      const cfg = await storeMaturityConfiguration({database, cipher: first.cipher, owner, observation: await observation.read(),
        policy: first.envelopes.values().next().value.sourceWrite.body.policy,
        limits: {maxBytes: 1000000, maxRows: 1000, maxObservationAgeMs: 60000, deadlineAt: Date.now() + 60000}});
      const maturity = await recordMaturityDecision({...first, configurationAttemptId: cfg.attemptId, anchorAttemptId: first.batches[0].attemptId,
        reportOperationId: initial.operationId, expectedRevision: 0});
      assert.equal(maturity.state, "final");assert.equal(maturity.reportVerified, true);scenarios++;
    }
    const second = await source(owner, {nonempty, googlePurchase: "5"});
    await rejected(client, () => reconcileStoredDatasetSources(second));scenarios++;
    const corrected = await reconcileStoredDatasetSources({...second, expectedRevision: 1});
    assert.equal(corrected.revision, 2);assert.equal(corrected.comparison, "matched");scenarios++;
    if (nonempty) {
      await rejected(client, () => client.query("update analytics.pd_facts set purchase=purchase+1,revision=revision+1 where installation_id=$1", [owner.installationId]));scenarios++;
    }
    const rowAfter = (await client.query("select id,purchase::text from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows[0];
    if (provider === "google_ads") {assert.equal(rowAfter.purchase, "5");assert.equal(rowAfter.id, rowBefore.id);}
    const old = await inspectDatasetReconciliation({database, owner, operationId: initial.operationId});
    assert.equal(old.status, "superseded");assert.equal(old.checkpointAdvanced, false);scenarios++;
    if (provider === "google_ads") {
      const previousFinal = await inspectMaturityDecision({database, owner, anchorAttemptId: first.batches[0].attemptId});
      assert.equal(previousFinal.state, "provisional");assert.equal(previousFinal.reason, "report_receipt_unavailable");scenarios++;
    }
    const stale = await source(owner, {nonempty}, true);
    await rejected(client, () => reconcileStoredDatasetSources({...stale, expectedRevision: 2}));scenarios++;
    const empty = await source(owner, {nonempty: false});
    const zero = await reconcileStoredDatasetSources({...empty, expectedRevision: 2});
    assert.equal(zero.rowCount, 0);assert.equal(zero.revision, 3);scenarios++;
    for (const t of ["pd_facts", "cpd_product_performance_facts", "cpd_product_sales_facts"]) assert.equal((await client.query("select count(*)::int n from analytics." + t + " where installation_id=$1", [owner.installationId])).rows[0].n, 0);
    // Native source bytes remain available even when the canonical day's rows disappear.
    assert.ok((await client.query("select count(*)::int n from evidence.source_pages where installation_id=$1 and ciphertext is not null", [owner.installationId])).rows[0].n > 0);
    const next = await source(owner, {nonempty: false});let lost = false, after = 0;
    const unknown = {async query(sql, args) {if (lost) after++; const r = await database.query(sql, args);if (sql === DATASET_RECONCILE_SQL) {lost = true;throw Error("SYNTHETIC_LOST_ACK");}return r;}};
    await assert.rejects(reconcileStoredDatasetSources({...next, expectedRevision: 3, database: unknown}), /WRITE_UNCONFIRMED/);
    assert.equal(after, 0);scenarios++;
    await rejected(client, () => inspectDatasetReconciliation({database, owner: {...owner, generation: "999"}, operationId: zero.operationId}));scenarios++;
  }
  // Deliberate corruption AFTER the normal validator proves that readback uses
  // physical values, and that facts/consumption/head rollback before mismatch audit.
  const owner = await ownerFixture(client, "google_ads"), first = await source(owner, {googlePurchase: "3"});
  await reconcileStoredDatasetSources(first);
  const changed = await source(owner, {googlePurchase: "5"});
  await client.query(`create function analytics.synthetic_reconciliation_corrupt() returns trigger language plpgsql set search_path='' as $f$ begin
    if new.workspace_id='${owner.workspaceId}'::uuid then new.purchase:=new.purchase+1;end if;return new;end $f$;
    create trigger zzz_synthetic_reconciliation_corrupt before insert or update on analytics.pd_facts for each row execute function analytics.synthetic_reconciliation_corrupt()`);
  const mismatch = await reconcileStoredDatasetSources({...changed, expectedRevision: 1});
  assert.equal(mismatch.status, "mismatch");assert.equal(mismatch.checkpointAdvanced, false);scenarios++;
  await client.query("drop trigger zzz_synthetic_reconciliation_corrupt on analytics.pd_facts; drop function analytics.synthetic_reconciliation_corrupt()");
  assert.equal((await client.query("select purchase::text from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows[0].purchase, "3");
  assert.equal((await client.query("select count(*)::int n from evidence.source_batches where authority=$1::jsonb and handoff_state='pending' and manifest ? 'datasetReconciliationMismatch'", [JSON.stringify(owner)])).rows[0].n, 1);
  assert.equal((await client.query("select count(*)::int n from evidence.source_batches where manifest ? 'datasetRevisionPermit'")).rows[0].n, 0);
  for (const role of ["anon", "authenticated", "service_role", "adstable_runtime", "adstable_refresh_coordinator"]) {
    assert.equal((await client.query("select has_function_privilege($1,'analytics.commit_dataset_reconciliation(jsonb,jsonb,jsonb,timestamptz)','EXECUTE') allowed", [role])).rows[0].allowed, false);scenarios++;
  }
  await datasetServerProbe(client, {ownerFixture, reconciliation: true});
  await client.query("savepoint scheduled_dataset_rehearsal");
  try {
    const scheduledRole = "adstable_refresh_dataset_runner";
    const flags = (await client.query(`select rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
      from pg_roles where rolname=$1`, [scheduledRole])).rows[0];
    assert.ok(flags && Object.values(flags).every(value => value === false));
    const asScheduledRunner = async (sql, parameters) => {
      await client.query("set local role " + scheduledRole);
      try {
        assert.equal((await client.query("select current_user as role")).rows[0].role, scheduledRole);
        return await database.query(sql, parameters);
      } finally {
        // A failed statement leaves this fixture's savepoint aborted. The caller
        // rolls it back before restoring the role in that case.
        try {await client.query("set local role adstable_owner");} catch {}
      }
    };
    const scheduledOwner = await ownerFixture(client, "google_ads");
    const args = [scheduledOwner.workspaceId, scheduledOwner.generation, scheduledOwner.provider, scheduledOwner.accountId];
    await client.query("update integrations.provider_connections set connected_at='2026-10-31' where id=$1", [scheduledOwner.connectionId]);
    await client.query("update integrations.reporting_account_bindings set effective_from='2026-10-31' where connection_id=$1", [scheduledOwner.connectionId]);
    const input = await source(scheduledOwner);
    const fence = (await client.query("select (coalesce(max(fence),0)+1)::text as n from operations.refresh_runs")).rows[0].n;
    const job = "synthetic-binding-job";
    await client.query(`update operations.refresh_work_bindings set fence=$5,deadline_at_ms=$6,
      source=operations.refresh_preflight_source($1,$2,$3,$4)
      where workspace_id=$1 and install_generation=$2 and provider=$3 and account_id=$4`, [...args,fence,input.limits.deadlineAt]);
    for (const batch of input.batches) {
      await client.query("update evidence.source_batches set manifest=jsonb_set(manifest,'{googleDatasetRead,fence}',to_jsonb($3::text)) where authority=$1::jsonb and attempt_id=$2::uuid",
        [JSON.stringify(scheduledOwner),batch.attemptId,fence]);
    }
    await client.query(`insert into operations.refresh_runs(workspace_id,install_generation,provider,account_id,job_id,fence,cost,status)
      values ($1,$2,$3,$4,$5,$6,'{"requests":2,"rows":1000,"bytes":1000000,"connections":1,"dbWrites":5}','running')`, [...args,job,fence]);
    const options = {...input, scheduled: true, admittedScope: {jobId: job, fence, from: "2026-11-01", to: "2026-11-01"}};
    await rejected(client, () => reconcileStoredDatasetSources({...options,database:{query:asScheduledRunner}}));
    await client.query(`insert into operations.refresh_work_progress(workspace_id,install_generation,provider,account_id,job_id,fence,stage,from_date,to_date)
      values ($1,$2,$3,$4,$5,$6,'ready_for_dataset','2026-11-01','2026-11-01')`, [...args,job,fence]);
    const jobStatus = async () => (await client.query("select status from operations.refresh_runs where fence=$1", [fence])).rows[0].status;
    let finishArgs;
    const completingDatabase = {async query(sql, parameters) {
      if (sql === SCHEDULED_DATASET_FINISH_SQL) {
        finishArgs = parameters;
        assert.equal(await jobStatus(), "running");
        assert.equal((await asScheduledRunner(sql,[...parameters.slice(0,4),"f".repeat(64)])).rows[0].result,false);
        assert.equal(await jobStatus(), "running");
      }
      return asScheduledRunner(sql,parameters);
    }};
    const completed = await reconcileStoredDatasetSources({...options,database:completingDatabase});
    assert.equal(completed.consumerReceipt, true);
    assert.equal(completed.jobCompleted, true);
    assert.equal(await jobStatus(), "completed");
    assert.equal((await asScheduledRunner(SCHEDULED_DATASET_FINISH_SQL,finishArgs)).rows[0].result,false);
    assert.equal((await rejected(client, () => asScheduledRunner("select * from analytics.pd_facts limit 1"))).code,"42501");
    assert.equal((await rejected(client, () => asScheduledRunner(DATASET_RECONCILE_SQL,[JSON.stringify(scheduledOwner),"{}","{}",new Date(input.limits.deadlineAt).toISOString()]))).code,"42501");
    const unsafe = (await client.query(`select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')
      and ((c.relkind in ('r','p','v','m','f') and (has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege($1,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
      or (c.relkind='S' and has_sequence_privilege($1,c.oid,'USAGE,SELECT,UPDATE')))) as allowed`, [scheduledRole])).rows[0].allowed;
    assert.equal(unsafe,false);
    for (const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"]) {
      assert.equal((await client.query("select has_function_privilege($1,'analytics.commit_scheduled_dataset_reconciliation(jsonb,jsonb,jsonb,timestamptz)','EXECUTE') as allowed", [role])).rows[0].allowed, false);
      assert.equal((await client.query("select has_function_privilege($1,'analytics.finish_scheduled_dataset_reconciliation(jsonb,text,bigint,uuid,text)','EXECUTE') as allowed", [role])).rows[0].allowed, false);
    }
  } finally {
    await client.query("rollback to savepoint scheduled_dataset_rehearsal");
    await client.query("release savepoint scheduled_dataset_rehearsal");
  }
  console.log("EO05_SCHEDULED_DATASET_PROBE current_claim=true ready_stage=true verified_completion=true invalid_receipt_rejected=true duplicate_finish_rejected=true narrow_role=true manual_write_denied=true direct_table_denied=true rollback_only=true");
  console.log("EO05D_RECONCILIATION_PROBE", JSON.stringify({scenarios, rollbackOnly: true, synthetic: true, actualAEAD: true, physicalReadback: true,
    replacement3to5: true, emptyRemovesOldFacts: true, mismatchRollbackAndLedger: true, unknownStops: true, liveAcceptance: false}));
}
