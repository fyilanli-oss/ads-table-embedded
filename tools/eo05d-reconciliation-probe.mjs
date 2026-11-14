import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {performance} from "node:perf_hooks";
import {readFileSync} from "node:fs";
import {setTimeout as delay} from "node:timers/promises";
import pg from "pg";
import {storedBindingFixture} from "./eo05b-source-dataset-binding-probe.mjs";
import {datasetServerProbe} from "./eo05b-dataset-server-probe.mjs";
import {reconcileStoredDatasetSources, inspectDatasetReconciliation, DATASET_RECONCILE_SQL, DATASET_RECONCILE_READ_SQL, SCHEDULED_DATASET_RECONCILE_SQL, SCHEDULED_DATASET_FINISH_SQL} from "../app/lib/database/dataset-reconciliation.server.js";
import {durationSummary} from "./eo05-refresh-small-baseline.mjs";
import {storeMaturityConfiguration, recordMaturityDecision, inspectMaturityDecision} from "../app/lib/database/maturity-store.server.js";
import {maturityObservationFixture} from "../tests/fixtures/maturity-fixture.js";
import {createScheduledDatasetPostgresClient} from "../app/lib/database/dataset-postgres.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {createHourlyRefreshCoordinator, runScheduledRefreshCheck} from "../app/lib/refresh/scheduled-queue-check.server.js";

async function profileHourlyQueue(client, hour) {
  const legacy = readFileSync(new URL("../supabase/migrations/20261020131343_eo05a_refresh_preflight_bridge.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const body = legacy.match(/create function operations\.read_refresh_preflight_snapshot\(\)[^\n]*\n[^\n]*\$fn\$\n([\s\S]+?)\n\$fn\$;/)?.[1];
  assert.ok(body);
  const candidateStart = body.indexOf("    select q.*,operations.refresh_preflight_source");
  const candidateEnd = body.indexOf("\n  )", candidateStart);
  assert.ok(candidateStart >= 0 && candidateEnd > candidateStart);
  const candidates = body.slice(candidateStart, candidateEnd);
  const withoutAuthority = candidates.replace(/,operations\.refresh_preflight_source\([^\n]+?\) as source/, "");
  assert.notEqual(candidates, withoutAuthority);
  const selectCandidates = query => "with admission as materialized(select operations.read_refresh_admission_snapshot() as value) " + query;
  const phases = [
    ["candidateSelection", selectCandidates(withoutAuthority), []],
    ["candidatesWithAuthority", selectCandidates(candidates), []],
    ["legacyPreflightSnapshot", body, []],
    ["bulkPreflightSnapshot", "select operations.read_refresh_preflight_snapshot()", []],
    ["bulkHourlySnapshot", "select operations.read_hourly_refresh_snapshot($1::bigint)", [hour]],
  ];
  const parity = async () => {
    const {rows: [result]} = await client.query(`select
      (select old.snapshot from (${body}) old(snapshot))=operations.read_refresh_preflight_snapshot() as matched`);
    assert.equal(result.matched, true);
  };
  try {
    await parity();
    for (const jit of ["on", "off"]) {
      await client.query("set jit=" + jit);
      for (const [phase, sql, args] of phases) {
        const {rows} = await client.query("explain (analyze, buffers, timing off, format json) " + sql, args);
        const result = rows[0]["QUERY PLAN"][0];
        console.log("EO05_HOURLY_QUEUE_PROFILE", JSON.stringify({phase, jit, executionMs: result["Execution Time"],
          planningMs: result["Planning Time"], rows: result.Plan["Actual Rows"], buffers: result.Plan["Shared Hit Blocks"],
          jitFunctions: result.JIT?.Functions ?? 0}));
      }
    }
    await client.query("begin");
    try {
      const changed = await client.query(`update integrations.provider_connections set lifecycle_status='reauthorization_required'
        where id in (select distinct on (provider) id from integrations.provider_connections order by provider,id)`);
      assert.equal(changed.rowCount, 3);
      const {rows: [{count}]} = await client.query("select jsonb_array_length(operations.read_refresh_preflight_snapshot()->'candidates') as count");
      assert.equal(count, 1497);
      await parity();
    } finally {await client.query("rollback");}
    console.log("EO05_HOURLY_QUEUE_PARITY", JSON.stringify({activeAccounts: 1500, ineligibleExcluded: 3, fullSnapshotMatch: true}));
  } finally {await client.query("reset jit");}
}

export async function hourlyRefreshCapacityProbe(admin, {ownerFixture, connection}) {
  const storeCount = 500;
  const providers = ["google_ads", "meta", "klaviyo"];
  const concurrency = 8;
  const owners = new Map();
  await admin.query("set role adstable_owner");
  for (let index = 0; index < storeCount; index++) {
    const google = await ownerFixture(admin);
    for (const owner of [google, await ownerFixture(admin, "meta", google), await ownerFixture(admin, "klaviyo", google)]) {
      owners.set(owner.workspaceId + ":" + owner.provider, owner);
    }
  }
  await admin.query("update integrations.provider_connections set connected_at=clock_timestamp()-interval '3 days'");
  await admin.query("update integrations.reporting_account_bindings set effective_from=clock_timestamp()-interval '3 days'");
  const cost = {requests: 2, dbWrites: 5, connections: 1, rows: 2000, bytes: 4_000_000};
  const global = Object.fromEntries(Object.entries(cost).map(([key, value]) => [key, value * (storeCount + concurrency)]));
  const budget = {global, interactiveReserve: {requests: 0, dbWrites: 0, connections: 0, rows: 0, bytes: 0},
    providers: providers.map(provider => ({provider, limit: global})),
    workspaces: [...owners.values()].filter(o => o.provider === "google_ads").map(o => ({workspaceId: o.workspaceId, limit: global})),
    accounts: [...new Map([...owners.values()].map(o => [o.provider, {provider: o.provider, accountId: o.accountId, limit: global}])).values()]};
  const bounds = {maxCandidates: owners.size, maxClaims: storeCount + concurrency, maxAdmissions: 1, maxWorkspaces: storeCount};
  await admin.query("update operations.refresh_control set budget=$1,bounds=$2 where singleton", [budget, bounds]);
  await admin.query("update operations.refresh_queue_control set max_workspaces=$1,max_accounts=$2,max_snapshot_bytes=4000000,max_snapshot_age_ms=3600000 where singleton", [storeCount, owners.size]);
  const generation = randomUUID();
  await admin.query("update operations.refresh_tick_control set enabled=true,generation=$1 where singleton", [generation]);
  const store = createRefreshWorkRepository(admin);
  const fullHour = process.argv.includes("--full-hour");
  const expectedHour = Math.ceil(Date.now() / 3600000) * 3600000;
  if (fullHour) {
    console.log("EO05_HOURLY_CAPACITY_START", JSON.stringify({startAt: new Date(expectedHour).toISOString()}));
    await delay(Math.max(0, expectedHour - Date.now()));
  }
  const tick = await runScheduledRefreshCheck({store, generation});
  assert.equal(tick.status, "queue_checked", JSON.stringify(tick));
  const snapshot = await store.readQueueCheck();
  assert.equal(snapshot.checkedAccounts, owners.size);
  const hour = Math.floor(tick.queue.checkedAtMs / 3600000) * 3600000;
  if (fullHour) assert.equal(hour, expectedHour);
  // Supabase's disposable postgres login needs SET-only membership for these
  // synthetic connections. The earlier ACL checks run before this fixture.
  await admin.query("reset role");
  await admin.query("grant adstable_refresh_coordinator, adstable_refresh_dataset_runner to postgres with inherit false, set true, admin false");
  await admin.query("set role adstable_refresh_coordinator");
  try {
    const initial = await admin.query("select operations.read_hourly_refresh_snapshot($1::bigint) as result", [hour]);
    assert.equal(initial.rows[0].result.candidates.length, owners.size);
  } finally {
    await admin.query("set role adstable_owner");
  }
  if (process.argv.includes("--hourly-queue-profile")) {
    await profileHourlyQueue(admin, hour);
    return;
  }
  const start = performance.now();
  const profile = process.argv.includes("--short-hourly-profile");
  const budgetMs = profile ? 180_000 : 3_600_000;
  const stages = Object.fromEntries(["queueRead", "plan", "reservation", "workerChecks", "sourcePreparation", "datasetReads", "write", "readback", "finish"].map(name => [name, []]));
  const attempts = new Map();
  const conflicts = {finishObserved: 0, noFinishObserved: 0};
  let finishedWrites = 0;
  const outcomes = new Map();
  const dispatchHourlyRefresh = createHourlyRefreshCoordinator();
  let unexpected;
  async function worker() {
    const client = new pg.Client({...connection, statement_timeout: 120_000});
    await client.connect();
    try {
      let snapshotFinished, finishesAtRead;
      async function timed(stage, operation) {
        const started = performance.now();
        try {return await operation();}
        finally {if (profile) stages[stage].push(performance.now() - started);}
      }
      const coordinator = createRefreshWorkRepository({async query(sql, args) {
        await client.query("set role adstable_refresh_coordinator");
        try {
          if (sql.includes("read_hourly_refresh_snapshot")) {
            finishesAtRead = finishedWrites;
            const response = await timed("queueRead", () => client.query(sql, args));
            snapshotFinished = performance.now();
            return response;
          }
          if (sql.includes("commit_refresh_preflight_with_deadline")) {
            if (profile) stages.plan.push(performance.now() - snapshotFinished);
            const response = await timed("reservation", () => client.query(sql, args));
            if (profile && response.rows[0]?.result === false) {
              conflicts[finishedWrites > finishesAtRead ? "finishObserved" : "noFinishObserved"]++;
            }
            return response;
          }
          return await timed("workerChecks", () => client.query(sql, args));
        }
        catch (error) {
          console.error("EO05_HOURLY_COORDINATOR_ERROR", JSON.stringify({code: error.code, message: error.message, where: error.where}));
          throw error;
        }
        finally {await client.query("reset role");}
      }});
      while (!unexpected && performance.now() - start < budgetMs && Date.now() < hour + 3600000) {
        const result = await dispatchHourlyRefresh({store: coordinator, work: {
          now: Date.now,
          buildWorkPlan: async () => ({cost, limits: {deadlineAt: Date.now() + 115000,
            requestTimeoutMs: 1000, finishReserveMs: 100, maxRows: cost.rows, maxBytes: cost.bytes}}),
          entitlementVerifier: {verify: async () => ({status: "verified", receipt: {}}), isCurrent: async () => true},
          readPage: async () => ({kind: "complete", payload: {}}),
          validatePage: () => ({complete: true, rows: []}),
          async loadDatasetInputs({claim, window}) {
            const owner = owners.get(claim.workspaceId + ":" + claim.provider);
            await client.query("set role adstable_owner");
            let input;
            try {
              input = await timed("sourcePreparation", () => storedBindingFixture(client, owner, {claim, businessDate: window.from, googleProductCount: 500}));
              const key = {google_ads: "googleDatasetRead", meta: "metaDatasetRead", klaviyo: "klaviyoDatasetRead"}[claim.provider];
              await client.query("update evidence.source_batches set manifest=jsonb_set(jsonb_set(manifest,$3::text[],to_jsonb($5::text)),$4::text[],to_jsonb($5::text)) where authority=$1::jsonb and attempt_id=any($2::uuid[])",
                [JSON.stringify(owner), input.batches.map(b => b.attemptId), [key, "observedAt"], [key, "completedAt"], new Date().toISOString()]);
            } finally {await client.query("reset role");}
            return {...input, expectedRevision: 0, database: {async query(sql, args) {
              await client.query("set role adstable_refresh_dataset_runner");
              try {
                const stage = sql === SCHEDULED_DATASET_RECONCILE_SQL ? "write"
                  : sql === DATASET_RECONCILE_READ_SQL ? "readback"
                  : sql === SCHEDULED_DATASET_FINISH_SQL ? "finish" : "datasetReads";
                const response = await timed(stage, () => client.query(sql, args));
                if (stage === "finish" && response.rows[0]?.result === true) finishedWrites++;
                return response;
              }
              finally {await client.query("reset role");}
            }}};
          },
        }});
        attempts.set(result.status, (attempts.get(result.status) ?? 0) + 1);
        if (result.status === "waiting") break;
        if (result.status === "conflict") continue;
        if (result.status !== "completed" && result.dataset?.status !== "held") {
          unexpected = {status: result.status, reason: result.reason, provider: result.claim?.provider};
          break;
        }
        const provider = result.claim.provider;
        const key = provider + ":" + result.status;
        outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
      }
    } finally {await client.end();}
  }
  const workers = await Promise.allSettled(Array.from({length: concurrency}, worker));
  if (profile) console.log("EO05_HOURLY_STAGE_TIMING", JSON.stringify({budgetMs, conflicts, attempts: Object.fromEntries(attempts),
    stages: Object.fromEntries(Object.entries(stages).map(([name, values]) => [name, durationSummary(values)]))}));
  const cutoff = new Date(hour + 3600000);
  const rows = (await admin.query(`select provider,
    case when status='completed' and finished_at >= $1::timestamptz then 'completed_after_cutoff' else status end as status,
    count(*)::int n from operations.refresh_runs group by 1,2`, [cutoff])).rows;
  const fullyCompleted = (await admin.query(`select count(*)::int n from (
    select workspace_id from operations.refresh_runs where status='completed' and finished_at < $1::timestamptz
    group by workspace_id having count(*)=6) x`, [cutoff])).rows[0].n;
  const counts = Object.fromEntries(providers.map(provider => {
    const completed = rows.find(row => row.provider === provider && row.status === "completed")?.n ?? 0;
    const held = outcomes.get(provider + ":awaiting_dataset") ?? 0;
    const running = rows.find(row => row.provider === provider && row.status === "running")?.n ?? 0;
    const completedAfterCutoff = rows.find(row => row.provider === provider && row.status === "completed_after_cutoff")?.n ?? 0;
    return [provider, {completed, completedAfterCutoff, held, unconfirmed: running - held, notStarted: storeCount * 2 - rows.filter(row => row.provider === provider).reduce((sum, row) => sum + row.n, 0)}];
  }));
  console.log("EO05_HOURLY_CAPACITY_RESULT", JSON.stringify({storeCount, concurrency, fullyCompleted, counts, hourStart: new Date(hour), cutoff, elapsedMs: Math.round(performance.now() - start), unexpected,
    workerErrors: workers.filter(w => w.status === "rejected").map(w => w.reason.code ?? w.reason.message), syntheticProviderIO: true, hosted: false}));
  assert.ok(workers.every(w => w.status === "fulfilled"));
  assert.equal(unexpected, undefined);
}

async function rejected(client, action) {
  await client.query("savepoint reconciliation_expected_failure"); let error;
  try {await action();} catch (e) {error = e;}
  await client.query("rollback to savepoint reconciliation_expected_failure");await client.query("release savepoint reconciliation_expected_failure");
  assert.ok(error, "invalid reconciliation must fail");
  return error;
}

/** Existing F01 rollback transaction. Owners, native pages, clocks and keys below
 * are explicitly synthetic; SQL, AEAD, physical facts/CAS/ACL are actual. */
export async function reconciliationProbe(client, {ownerFixture, connection}) {
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
  const largeOwner = await ownerFixture(client, "google_ads");
  const largeDay = await source(largeOwner, {googleProductCount: 500});
  const durations = [];
  const timedDatabase = {async query(sql, args) {
    if (sql !== DATASET_RECONCILE_SQL) return database.query(sql, args);
    const start = performance.now();
    const result = await database.query(sql, args);
    durations.push(Math.round(performance.now() - start));
    return result;
  }};
  const largeReceipt = await reconcileStoredDatasetSources({...largeDay, database: timedDatabase});
  assert.equal(largeReceipt.rowCount, 502);
  assert.equal(largeReceipt.checkpointAdvanced, true);
  const persisted = await client.query(
    "select count(*)::int n from analytics.cpd_product_performance_facts where installation_id=$1",
    [largeOwner.installationId],
  );
  assert.equal(persisted.rows[0].n, 500);
  const invalidDay = await source(await ownerFixture(client), {googleProductCount: 3});
  let invalidSourceError;
  const invalidDatabase = {query(sql, args) {
    if (sql !== DATASET_RECONCILE_SQL) return client.query(sql, args);
    const write = JSON.parse(args[1]);
    const last = write.rows.at(-1).row;
    last.provenance.sources[0].payload_hash = "f".repeat(64);
    return client.query(sql, [args[0], JSON.stringify(write), ...args.slice(2)]).catch(error => {
      invalidSourceError = error.message;
      throw error;
    });
  }};
  await rejected(client, () => reconcileStoredDatasetSources({...invalidDay, database: invalidDatabase}));
  assert.match(invalidSourceError, /DATASET_RECONCILIATION_ROW_SCOPE/);
  assert.equal((await client.query("select count(*)::int n from analytics.cpd_product_performance_facts where installation_id=$1",
    [invalidDay.owner.installationId])).rows[0].n, 0);
  const otherOwner = await ownerFixture(client, "google_ads");
  const observer = new pg.Client(connection);
  await observer.connect();
  try {
    await observer.query("begin");
    const tryLock = async workspace => (await observer.query(
      "select pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('adstable-dataset:'||$1::uuid::text,0)) acquired",
      [workspace],
    )).rows[0].acquired;
    assert.equal(await tryLock(largeOwner.workspaceId), false);
    assert.equal(await tryLock(otherOwner.workspaceId), true);
    await observer.query("rollback");
  } finally {
    await observer.end();
  }
  const correctedLargeDay = await source(largeOwner, {googleProductCount: 500, googlePurchase: "5"});
  assert.equal((await reconcileStoredDatasetSources({...correctedLargeDay, database: timedDatabase, expectedRevision: 1})).rowCount, 502);
  const [insertMs, correctionMs] = durations;
  console.log("EO05D_CAPACITY_SCREEN", JSON.stringify({
    products: 500, measuredWorkspaceCount: 1, insertMs, correctionMs,
    modeledWorkspaces: 500, modeledDaysPerHour: 2, hourlyBudgetMs: 3_600_000,
    modeledGoogleOnlySerialCorrectionMs: correctionMs * 500 * 2,
    includesAttributionRechecks: false, includesHostedSupabase: false,
  }));
  scenarios += 2;

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
    for (const provider of ["google_ads", "meta", "klaviyo"]) {
      const scheduledOwner = await ownerFixture(client, provider);
      const manifestKey = {google_ads: "googleDatasetRead", meta: "metaDatasetRead", klaviyo: "klaviyoDatasetRead"}[provider];
      const args = [scheduledOwner.workspaceId, scheduledOwner.generation, scheduledOwner.provider, scheduledOwner.accountId];
      await client.query("update integrations.provider_connections set connected_at='2026-10-31' where id=$1", [scheduledOwner.connectionId]);
      await client.query("update integrations.reporting_account_bindings set effective_from='2026-10-31' where connection_id=$1", [scheduledOwner.connectionId]);
      for (const day of ["2026-11-01", "2026-11-02"]) {
        if (provider === "meta") await client.query("savepoint isolated_meta_day");
        const input = await source(scheduledOwner, {businessDate: day});
        const fence = (await client.query("select (coalesce(max(fence),0)+1)::text as n from operations.refresh_runs")).rows[0].n;
        const job = input.jobId;
        await client.query(`update operations.refresh_work_bindings set fence=$5,deadline_at_ms=$6,
          source=operations.refresh_preflight_source($1,$2,$3,$4)
          where workspace_id=$1 and install_generation=$2 and provider=$3 and account_id=$4 and job_id=$7`, [...args,fence,input.limits.deadlineAt,job]);
        for (const batch of input.batches) {
          await client.query("update evidence.source_batches set manifest=jsonb_set(manifest,$4::text[],to_jsonb($3::text)) where authority=$1::jsonb and attempt_id=$2::uuid",
            [JSON.stringify(scheduledOwner),batch.attemptId,fence,[manifestKey,"fence"]]);
        }
        await client.query(`insert into operations.refresh_runs(workspace_id,install_generation,provider,account_id,job_id,fence,cost,status)
          values ($1,$2,$3,$4,$5,$6,'{"requests":2,"rows":1000,"bytes":1000000,"connections":1,"dbWrites":5}','running')`, [...args,job,fence]);
        const options = {...input, scheduled: true, admittedScope: {jobId: job, fence, from: day, to: day}};
        if (provider !== "meta") await rejected(client, () => reconcileStoredDatasetSources({...options,database:{query:asScheduledRunner}}));
        await client.query(`insert into operations.refresh_work_progress(workspace_id,install_generation,provider,account_id,job_id,fence,stage,from_date,to_date)
          values ($1,$2,$3,$4,$5,$6,'ready_for_dataset',$7,$7)`, [...args,job,fence,day]);
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
        const revisionBeforeFinish = (await client.query("select revision from operations.refresh_control where singleton")).rows[0].revision;
        let completed;
        try { completed = await reconcileStoredDatasetSources({...options,database:completingDatabase}); }
        finally { await transport.close(); }
        if (provider === "meta") {
          assert.equal(completed.status, "held");
          assert.equal(completed.consumerReceipt, false);
          assert.equal(finishArgs, undefined);
          assert.equal(await jobStatus(), "running");
          // The account still holds its claim. Reset this independent fixture
          // before testing another day's response for the same account.
          await client.query("rollback to savepoint isolated_meta_day");
          await client.query("release savepoint isolated_meta_day");
          continue;
        }
        assert.equal(completed.consumerReceipt, true);
        assert.equal(completed.jobCompleted, true);
        assert.equal(await jobStatus(), "completed");
        const revisionAfterFinish = (await client.query("select revision from operations.refresh_control where singleton")).rows[0].revision;
        assert.equal(BigInt(revisionAfterFinish), BigInt(revisionBeforeFinish) + 1n);
        const staleAdmission = await createRefreshWorkRepository(client).commitPreflight({
          expectedRevision: Number(revisionBeforeFinish), queueRevision: (await createRefreshWorkRepository(client).readQueueCheck()).revision,
          nextState: {}, source: scheduledOwner, window: {from: day, to: day}, partitionId: "stale-finish-probe", deadlineAt: Date.now() + 5000,
        });
        assert.equal(staleAdmission, false);
        assert.equal((await asScheduledRunner(SCHEDULED_DATASET_FINISH_SQL,finishArgs)).rows[0].result,false);
        assert.equal((await rejected(client, () => asScheduledRunner("select * from analytics.pd_facts limit 1"))).code,"42501");
        assert.equal((await rejected(client, () => asScheduledRunner(DATASET_RECONCILE_SQL,[JSON.stringify(scheduledOwner),"{}","{}",new Date(input.limits.deadlineAt).toISOString()]))).code,"42501");
      }
    }
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

// Instrument a copy of the function in the disposable CI database only.
export async function installReconciliationTiming(client) {
  const sql = readFileSync(new URL("../supabase/migrations/20261113080017_eo05d_daily_write_capacity.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const definition = sql.match(/create or replace function analytics\._commit_dataset_reconciliation\([\s\S]+?end \$fn\$;/)?.[0];
  assert.ok(definition);
  let instrumented = definition.replace("declare item", `declare profile_start timestamptz := clock_timestamp();
    profile_mark timestamptz := profile_start; profile_now timestamptz;
    profile_ms double precision[] := array_fill(0::double precision, array[8]);
    item`);
  assert.notEqual(instrumented, definition);
  const markers = [
    " read_key:=case",
    " -- Bounded complete-day replacement.",
    " if p->'policy'->>'version'='report-source-3y-v1' then",
    " for item in select value from jsonb_array_elements(p->'rows') loop\n  name:=",
    "  if found_row is not null then",
    "  execute format('select to_jsonb(x) from analytics.%I x where id=$1'",
    " end loop;\n old_count:=0;",
    " return result;",
  ];
  for (const [index, marker] of markers.entries()) {
    const offset = instrumented.indexOf(marker);
    assert.ok(offset >= 0 && instrumented.indexOf(marker, offset + marker.length) < 0, marker);
    const bucket = index + 1;
    const mark = ` profile_now:=clock_timestamp();
 profile_ms[${bucket}]:=profile_ms[${bucket}]+extract(epoch from profile_now-profile_mark)*1000;
 profile_mark:=profile_now;
`;
    const report = index === 7 ? " raise notice 'EO05D_SQL_PROFILE %', array_to_json(profile_ms);\n" : "";
    instrumented = instrumented.slice(0, offset) + mark + report + instrumented.slice(offset);
  }
  await client.query("set role adstable_owner");
  await client.query(instrumented);
}

export async function reconciliationCapacityProbe(client, {ownerFixture, connection, timingOnly}) {
  const storeCount = timingOnly ? 24 : 500;
  const productsPerStore = 500;
  const dates = ["2026-11-01", "2026-11-02"];
  const concurrency = 8;
  const hourlyBudgetMs = 3_600_000;
  await client.query("set role adstable_owner");
  const owners = [];
  for (let index = 0; index < storeCount; index++) {
    owners.push(await ownerFixture(client));
  }

  let nextStore = 0;
  let confirmedDays = 0;
  let completedStores = 0;
  const errors = new Map();
  const timings = [];
  const sqlProfiles = [];
  const start = performance.now();
  async function worker() {
    const database = new pg.Client({...connection, statement_timeout: 120_000});
    if (timingOnly) database.on("notice", notice => {
      if (notice.message.startsWith("EO05D_SQL_PROFILE ")) sqlProfiles.push(JSON.parse(notice.message.slice("EO05D_SQL_PROFILE ".length)));
    });
    await database.connect();
    try {
      await database.query("set role adstable_owner");
      while (!errors.size && nextStore < owners.length && performance.now() - start < hourlyBudgetMs) {
        const storeNumber = ++nextStore;
        const owner = owners[storeNumber - 1];
        let confirmed = 0;
        for (const businessDate of dates) {
          if (performance.now() - start >= hourlyBudgetMs) break;
          try {
            const preparationStarted = performance.now();
            const input = await storedBindingFixture(database, owner, {googleProductCount: productsPerStore, businessDate});
            const stamp = new Date().toISOString();
            await database.query(
              "update evidence.source_batches set manifest=jsonb_set(jsonb_set(manifest,'{googleDatasetRead,observedAt}',to_jsonb($3::text)),'{googleDatasetRead,completedAt}',to_jsonb($3::text)) where authority=$1::jsonb and attempt_id=any($2::uuid[])",
              [JSON.stringify(owner), input.batches.map(batch => batch.attemptId), stamp],
            );
            const reconciliationStarted = performance.now();
            let writeStarted, writeFinished, readbackStarted, readbackFinished;
            const receipt = await reconcileStoredDatasetSources({
              ...input, database: {async query(sql, args) {
                if (sql === DATASET_RECONCILE_SQL) writeStarted = performance.now();
                if (sql === DATASET_RECONCILE_READ_SQL) readbackStarted = performance.now();
                try {return await database.query(sql, args);} catch (error) {
                  console.error("EO05D_CAPACITY_SQL_FAILURE", JSON.stringify({storeNumber, businessDate, code: error.code, message: error.message}));
                  throw error;
                } finally {
                  if (sql === DATASET_RECONCILE_SQL) writeFinished = performance.now();
                  if (sql === DATASET_RECONCILE_READ_SQL) readbackFinished = performance.now();
                }
              }}, expectedRevision: 0, limits: {...input.limits, deadlineAt: Date.now() + 115_000},
            });
            assert.equal(receipt.rowCount, productsPerStore + 2);
            assert.equal(receipt.checkpointAdvanced, true);
            timings.push({
              sourceFixtureMs: reconciliationStarted - preparationStarted,
              sourceReadAndProjectionMs: writeStarted - reconciliationStarted,
              sqlWriteMs: writeFinished - writeStarted,
              readbackSqlMs: readbackFinished - readbackStarted,
              receiptProcessingMs: readbackStarted - writeFinished + performance.now() - readbackFinished,
            });
            confirmed++;
            confirmedDays++;
          } catch (error) {
            const code = error.code ?? error.message;
            errors.set(code, (errors.get(code) ?? 0) + 1);
            break;
          }
        }
        if (confirmed === dates.length) completedStores++;
        if (storeNumber % 50 === 0) {
          console.log("EO05D_CAPACITY_PROGRESS", JSON.stringify({assignedStores: nextStore, completedStores, confirmedDays, elapsedMs: Math.round(performance.now() - start)}));
        }
      }
    } finally {
      await database.end();
    }
  }
  const workers = await Promise.allSettled(Array.from({length: concurrency}, worker));
  const elapsedMs = Math.round(performance.now() - start);
  const perStoreDay = (await client.query(
    "select workspace_id, business_date, count(*)::int rows from analytics.cpd_product_performance_facts group by workspace_id,business_date",
  )).rows;
  const malformedDays = perStoreDay.filter(day => day.rows !== productsPerStore).length;
  const verifiedProductRows = perStoreDay.reduce((count, day) => count + day.rows, 0);
  const withinHour = elapsedMs <= hourlyBudgetMs && completedStores === storeCount && confirmedDays === storeCount * dates.length;
  const summary = {provider: "google_ads", storeCount, productsPerStore, dates, concurrency, completedStores,
    confirmedDays, verifiedProductRows, malformedDays, elapsedMs, hourlyBudgetMs, withinHour, errors: Object.fromEntries(errors),
    workerFailures: workers.filter(result => result.status === "rejected").length,
    includesAttributionRechecks: false, includesHostedSupabase: false};
  console.log("EO05D_PARALLEL_CAPACITY_RESULT", JSON.stringify(summary));
  if (timingOnly && timings.length) {
    const stages = Object.fromEntries(Object.keys(timings[0]).map(stage => {
      const values = timings.map(sample => sample[stage]).sort((a, b) => a - b);
      assert.ok(values.every(value => Number.isFinite(value) && value >= 0));
      return [stage, {
        totalMs: Math.round(values.reduce((sum, value) => sum + value, 0)),
        medianMs: Math.round(values[Math.ceil(values.length / 2) - 1]),
        p95Ms: Math.round(values[Math.ceil(values.length * 0.95) - 1]),
      }];
    }));
    console.log("EO05D_STAGE_TIMING", JSON.stringify({samples: timings.length, stages}));
  }
  assert.equal(summary.workerFailures, 0);
  assert.equal(errors.size, 0);
  assert.equal(malformedDays, 0);
  assert.equal(perStoreDay.length, confirmedDays);
  assert.equal(verifiedProductRows, confirmedDays * productsPerStore);
  if (timingOnly) assert.equal(timings.length, storeCount * dates.length);
  if (timingOnly) {
    assert.equal(sqlProfiles.length, timings.length);
    const names = ["requestAndRevision", "sourceValidation", "existingRows", "rowSourceValidation",
      "rowShapeDigestAndLookup", "rowMutation", "transactionalRowReadback", "finalReceipt"];
    const totalMs = Object.fromEntries(names.map((name, index) => {
      const values = sqlProfiles.map(sample => sample[index]);
      assert.ok(values.every(value => Number.isFinite(value) && value >= 0));
      return [name, Math.round(values.reduce((sum, value) => sum + value, 0))];
    }));
    console.log("EO05D_SQL_STAGE_TIMING", JSON.stringify({samples: sqlProfiles.length, totalMs}));
  }
}
