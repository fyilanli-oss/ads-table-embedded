import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {storedBindingFixture} from "./eo05b-source-dataset-binding-probe.mjs";
import {datasetServerProbe} from "./eo05b-dataset-server-probe.mjs";
import {reconcileStoredDatasetSources, inspectDatasetReconciliation, canonicalDatasetEventTime, DATASET_RECONCILE_SQL, SCHEDULED_DATASET_FINISH_SQL} from "../app/lib/database/dataset-reconciliation.server.js";
import {storeMaturityConfiguration, recordMaturityDecision, inspectMaturityDecision} from "../app/lib/database/maturity-store.server.js";
import {maturityObservationFixture} from "../tests/fixtures/maturity-fixture.js";
import {createScheduledDatasetPostgresClient} from "../app/lib/database/dataset-postgres.server.js";
import {readStoredDatasetSources} from "../app/lib/database/dataset-source-reader.server.js";
import {projectStoredKlaviyoDataset} from "../app/lib/providers/stored-klaviyo-dataset.server.js";
import {prepareDatasetWrite} from "../app/lib/database/dataset-storage.server.js";
import {sourcePayloadHash} from "../app/lib/database/source-evidence-store.server.js";

async function rejected(client, action) {
  await client.query("savepoint reconciliation_expected_failure"); let error;
  try {await action();} catch (e) {error = e;}
  await client.query("rollback to savepoint reconciliation_expected_failure");await client.query("release savepoint reconciliation_expected_failure");
  assert.ok(error, "invalid reconciliation must fail");
  return error;
}

async function probeKlaviyoReportStage(client,owner,input,previous,{replace=false}={}) {
  let bundle=await readStoredDatasetSources(input);
  const operationId=randomUUID(),day=bundle.scope.window.from,job=bundle.scope.jobId;
  const deadline=new Date(input.limits.deadlineAt).toISOString();
  const stage="select analytics.stage_klaviyo_daily_report_package($1::jsonb,$2::jsonb,$3::jsonb,$4::timestamptz,$5::integer,$6::integer) result";
  await client.query("savepoint report_stage_case");
  try {
    const scope=[owner.workspaceId,owner.generation,owner.provider,owner.accountId,job];
    const fence=(await client.query("select (coalesce(max(fence),0)+1)::text n from operations.refresh_runs")).rows[0].n;
    await client.query("update integrations.provider_connections set connected_at=$2::date-interval '1 day' where id=$1",
      [owner.connectionId,day]);
    const bound=(await client.query(`update operations.refresh_work_bindings set fence=$6,deadline_at_ms=$7,
      source=operations.refresh_preflight_source($1,$2,$3,$4)
      where workspace_id=$1 and install_generation=$2 and provider=$3 and account_id=$4 and job_id=$5 returning source`,
      [...scope,fence,input.limits.deadlineAt])).rows[0];
    assert.ok(bound?.source,"expected an admitted Klaviyo test job");
    if(!previous||replace) {
      for(const batch of input.batches) {
        await client.query("update evidence.source_batches set manifest=jsonb_set(manifest,'{klaviyoDatasetRead,fence}',to_jsonb($3::text)) where authority=$1::jsonb and attempt_id=$2::uuid",
          [JSON.stringify(owner),batch.attemptId,fence]);
      }
      bundle=await readStoredDatasetSources(input);
    }
    const projection=projectStoredKlaviyoDataset(bundle);
    assert.equal(projection.rows.length,2);
    const configuration=bundle.datasets.find(d=>d.dataset==="configuration").pages.map(page=>page.ref);
    for(const {row} of projection.rows) {
      if(row.occurred_at!=null) row.occurred_at=canonicalDatasetEventTime(row.occurred_at);
      row.provenance.sources=[...new Map([...row.provenance.sources,...configuration].map(ref=>[ref.page_id,ref])).values()];
    }
    const writes=projection.rows.map(item=>prepareDatasetWrite({
      owner,operationId,rows:[item],policy:input.policy,now:new Date().toISOString(),
    }).body);
    const context={businessDate:day,expectedRevision:previous?.revision??0,startedAt:new Date().toISOString(),
      batchIds:bundle.datasets.map(dataset=>dataset.receipt.batchId),
      sources:bundle.datasets.flatMap(dataset=>dataset.pages.map(page=>page.ref)),
      sourceContext:{...bundle.datasets[0].sourceContext,fence,snapshot:bound.source}};
    await client.query(`insert into operations.refresh_runs(workspace_id,install_generation,provider,account_id,job_id,fence,cost,status)
      values ($1,$2,$3,$4,$5,$6,'{"requests":2,"rows":1000,"bytes":1000000,"connections":1,"dbWrites":5}','running')`,[...scope,fence]);
    await client.query(`insert into operations.refresh_work_progress(workspace_id,install_generation,provider,account_id,job_id,fence,stage,from_date,to_date)
      values ($1,$2,$3,$4,$5,$6,'ready_for_dataset',$7,$7)`,[...scope,fence,day]);
    assert.equal((await client.query("select operations.refresh_claim_is_current($1,$2,$3,$4,$5,$6) current",
      [...scope,fence])).rows[0].current,true);
    const send=(ordinal,ctx=context,write=writes[ordinal])=>client.query(stage,[
      JSON.stringify(owner),JSON.stringify(write),JSON.stringify(ctx),deadline,ordinal,2,
    ]);
    const verify=(digests)=>client.query(
      "select analytics.verify_klaviyo_daily_report_stage($1::jsonb,$2::jsonb,$3::timestamptz,$4::uuid,$5::jsonb,$6::jsonb) result",
      [JSON.stringify(owner),JSON.stringify(context),deadline,operationId,JSON.stringify(writes[0].policy),JSON.stringify(digests)]);
    const checkFacts=(digests)=>client.query(
      "select analytics.check_klaviyo_daily_report_facts($1::jsonb,$2::jsonb,$3::timestamptz,$4::uuid,$5::jsonb,$6::jsonb) result",
      [JSON.stringify(owner),JSON.stringify(context),deadline,operationId,JSON.stringify(writes[0].policy),JSON.stringify(digests)]);
    const digests=writes.map(write=>sourcePayloadHash({write,context}));
    assert.match((await rejected(client,()=>send(1))).message,/KLAVIYO_REPORT_STAGE_REQUIRED/);
    const prior=async()=>inspectDatasetReconciliation({database:client,owner,operationId:previous?.operationId??operationId});
    const staged=(await send(0)).rows[0].result;
    assert.deepEqual(staged,{status:"staged",operationId,ordinal:0,packageCount:2,rowCount:1,
      digest:sourcePayloadHash({write:writes[0],context})});
    assert.deepEqual(await prior(),previous);
    assert.match((await rejected(client,()=>verify(digests))).message,/KLAVIYO_REPORT_PACKAGE_VERIFICATION_FAILED/);
    assert.match((await rejected(client,()=>send(0))).message,/KLAVIYO_REPORT_PACKAGE_SEQUENCE/);
    assert.match((await rejected(client,()=>send(1,{...context,expectedRevision:context.expectedRevision+1}))).message,/KLAVIYO_REPORT_PACKAGE_SEQUENCE/);
    assert.match((await rejected(client,()=>send(1,context,{...writes[1],rows:Array(201).fill(writes[1].rows[0])}))).message,/KLAVIYO_REPORT_PACKAGE_LIMIT/);
    await client.query("savepoint report_stage_duplicate_row");
    try {
      const duplicate=(await send(1,context,writes[0])).rows[0].result;
      assert.match((await rejected(client,()=>verify([staged.digest,duplicate.digest]))).message,/KLAVIYO_REPORT_PACKAGE_ROW_IDENTITY_INVALID/);
    } finally {
      await client.query("rollback to savepoint report_stage_duplicate_row");
      await client.query("release savepoint report_stage_duplicate_row");
    }
    await client.query("savepoint report_stage_wrong_fact");
    try {
      const wrong=structuredClone(writes[1]);
      wrong.rows[0].row.payload_digest="a".repeat(64);
      const changed=(await send(1,context,wrong)).rows[0].result;
      assert.match((await rejected(client,()=>checkFacts([staged.digest,changed.digest]))).message,/KLAVIYO_REPORT_FACT_READBACK_MISMATCH/);
      assert.deepEqual(await prior(),previous);
    } finally {
      await client.query("rollback to savepoint report_stage_wrong_fact");
      await client.query("release savepoint report_stage_wrong_fact");
    }
    assert.equal((await send(1)).rows[0].result.ordinal,1);
    assert.match((await rejected(client,()=>verify([...digests].reverse()))).message,/KLAVIYO_REPORT_PACKAGE_VERIFICATION_FAILED/);
    const summary={status:"stage_verified",operationId,rowCount:2,packageCount:2,
      packages:digests.map((digest,ordinal)=>({ordinal,rowCount:1,digest})),
      consumerReceipt:false,checkpointAdvanced:false};
    assert.deepEqual((await verify(digests)).rows[0].result,{...summary,digest:sourcePayloadHash(summary)});
    const verified={...summary,status:"facts_verified",comparison:"matched"};
    const writeDay=()=>client.query(
      "select analytics.write_klaviyo_staged_first_report_day($1::jsonb,$2::jsonb,$3::timestamptz,$4::uuid,$5::jsonb,$6::jsonb) result",
      [JSON.stringify(owner),JSON.stringify(context),deadline,operationId,JSON.stringify(writes[0].policy),JSON.stringify(digests)]);
    const expected={...verified,digest:sourcePayloadHash(verified)};
    let dailyReceipt;
    if(previous) {
      if(!replace) assert.deepEqual((await checkFacts(digests)).rows[0].result,expected);
      assert.match((await rejected(client,writeDay)).message,/KLAVIYO_REPORT_FIRST_DAY_REQUIRED/);
      const plan={status:"replacement_planned",operationId,previousDigest:previous.digest,
        stageDigest:sourcePayloadHash(summary),replaced:2,removed:0,inserted:0};
      const result=await client.query(
        "select analytics.plan_klaviyo_staged_report_replacement($1::jsonb,$2::jsonb,$3::timestamptz,$4::uuid,$5::jsonb,$6::jsonb) result",
        [JSON.stringify(owner),JSON.stringify(context),deadline,operationId,JSON.stringify(writes[0].policy),JSON.stringify(digests)]);
      assert.deepEqual(result.rows[0].result,{...plan,digest:sourcePayloadHash(plan)});
      assert.deepEqual(await prior(),previous);
      if(replace) {
        const fact=async()=>(await client.query("select id::text,revision::text from analytics.pd_facts where installation_id=$1",
          [owner.installationId])).rows[0];
        const before=await fact();
        const changed=await client.query(
          "select analytics.replace_klaviyo_staged_report_day($1::jsonb,$2::jsonb,$3::timestamptz,$4::uuid,$5::jsonb,$6::jsonb) result",
          [JSON.stringify(owner),JSON.stringify(context),deadline,operationId,JSON.stringify(writes[0].policy),JSON.stringify(digests)]);
        assert.deepEqual(changed.rows[0].result,expected);
        assert.deepEqual(await fact(),{id:before.id,revision:String(BigInt(before.revision)+1n)});
      }
    } else {
      const result=await client.query(
        "select analytics.publish_klaviyo_staged_first_report_day($1::jsonb,$2::jsonb,$3::timestamptz,$4::uuid,$5::jsonb,$6::jsonb) result",
        [JSON.stringify(owner),JSON.stringify(context),deadline,operationId,JSON.stringify(writes[0].policy),JSON.stringify(digests)]);
      dailyReceipt=result.rows[0].result;
      assert.equal(dailyReceipt.rowCount,2);
      assert.deepEqual(dailyReceipt.packages,expected.packages);
      assert.equal(dailyReceipt.consumerReceipt,true);
      assert.equal(dailyReceipt.checkpointAdvanced,true);
    }
    await client.query("update operations.refresh_runs set status='paused',finished_at=clock_timestamp() where fence=$1 and workspace_id=$2",
      [fence,owner.workspaceId]);
    assert.match((await rejected(client,()=>checkFacts(digests))).message,/SCHEDULED_DATASET_CLAIM_REQUIRED/);
    if(!replace) assert.deepEqual(await prior(),previous);
    assert.equal((await client.query("select count(*)::int n from pg_temp.adstable_klaviyo_daily_report_stage")).rows[0].n,2);
    if(dailyReceipt) {
      await client.query("drop table pg_temp.adstable_klaviyo_daily_report_stage");
      const inspected=(await client.query("select analytics.inspect_klaviyo_daily_report($1::jsonb,$2::uuid) result",
        [JSON.stringify(owner),operationId])).rows[0].result;
      assert.deepEqual(inspected,dailyReceipt);
    }
  } finally {
    await client.query("rollback to savepoint report_stage_case");
    await client.query("release savepoint report_stage_case");
  }
  assert.equal((await client.query("select to_regclass('pg_temp.adstable_klaviyo_daily_report_stage') staging")).rows[0].staging,null);
  if(replace) assert.deepEqual(await inspectDatasetReconciliation({database:client,owner,operationId:previous.operationId}),previous);
  console.log("EO05_KLAVIYO_REPORT_STAGE_PROBE two_packages=true compact_summary=true claim_rechecked=true previous_receipt_preserved=true rollback_cleanup=true");
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
    if(provider==="klaviyo"){await probeKlaviyoReportStage(client,owner,first,null);scenarios++;}
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
    if(provider==="klaviyo") {
      const receipt=await inspectDatasetReconciliation({database,owner,operationId:initial.operationId});
      await probeKlaviyoReportStage(client,owner,second,receipt,{replace:true});scenarios++;
    }
    const corrected = await reconcileStoredDatasetSources({...second, expectedRevision: 1});
    assert.equal(corrected.revision, 2);assert.equal(corrected.comparison, "matched");scenarios++;
    if (provider === "klaviyo") {
      const receipt=await inspectDatasetReconciliation({database,owner,operationId:corrected.operationId});
      await probeKlaviyoReportStage(client,owner,second,receipt);scenarios++;
    }
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
    // The fixture connects through the owner session. Allow an explicit role
    // switch only inside this savepoint, without granting inherited access.
    await client.query("set local role postgres");
    await client.query("grant adstable_refresh_dataset_runner to adstable_owner with inherit false,set true,admin false");
    await client.query("set local role adstable_owner");
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
    let transportSequence = 0;
    const transport = createScheduledDatasetPostgresClient({deadlineAt: input.limits.deadlineAt,
      environment: {ADSTABLE_REFRESH_DATASET_DATABASE_URL: "postgresql://" + scheduledRole + ".podpwkrpmjiksskxhwsu:" + "x".repeat(32) + "@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require",
        ADSTABLE_REFRESH_DATASET_DB_TIMEOUT_MS: "5000"}, poolFactory: () => ({on() {}, async end() {}, async connect() {
        const savepoint = "scheduled_transport_" + (++transportSequence);
        return {release() {}, async query(sql, parameters) {
          if (sql === "begin") return client.query("savepoint " + savepoint);
          if (sql === "commit") return client.query("release savepoint " + savepoint);
          if (sql === "rollback") {
            await client.query("rollback to savepoint " + savepoint);
            return client.query("release savepoint " + savepoint);
          }
          if (sql.startsWith("select pg_catalog.set_config")) return client.query(sql, parameters);
          return asScheduledRunner(sql, parameters);
        }};
      }})});
    let finishArgs;
    const completingDatabase = {async query(sql, parameters) {
      if (sql === SCHEDULED_DATASET_FINISH_SQL) {
        finishArgs = parameters;
        assert.equal(await jobStatus(), "running");
        assert.equal((await asScheduledRunner(sql,[...parameters.slice(0,4),"f".repeat(64)])).rows[0].result,false);
        assert.equal(await jobStatus(), "running");
      }
      return transport.query(sql,parameters);
    }};
    let completed;
    try { completed = await reconcileStoredDatasetSources({...options,database:completingDatabase}); }
    finally { await transport.close(); }
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
  console.log("EO05_SCHEDULED_DATASET_PROBE current_claim=true ready_stage=true verified_completion=true invalid_receipt_rejected=true duplicate_finish_rejected=true narrow_role=true checked_transport=true manual_write_denied=true direct_table_denied=true rollback_only=true");
  console.log("EO05D_RECONCILIATION_PROBE", JSON.stringify({scenarios, rollbackOnly: true, synthetic: true, actualAEAD: true, physicalReadback: true,
    replacement3to5: true, emptyRemovesOldFacts: true, mismatchRollbackAndLedger: true, unknownStops: true, liveAcceptance: false}));
}
