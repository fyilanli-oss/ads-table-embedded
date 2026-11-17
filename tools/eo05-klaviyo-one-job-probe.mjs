import assert from "node:assert/strict";
import {randomBytes, randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import pg from "pg";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {createSourceEvidenceCipher} from "../app/lib/database/source-evidence-store.server.js";
import {storeKlaviyoRawDataset} from "../app/lib/database/klaviyo-dataset-source-store.server.js";
import {SCHEDULED_DATASET_FINISH_SQL, SCHEDULED_DATASET_RECONCILE_SQL} from "../app/lib/database/dataset-rpc.server.js";
import {collectKlaviyoRawDatasets} from "../app/lib/refresh/klaviyo-raw-collection.server.js";
import {createRefreshEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";
import {runScheduledRefreshCheck} from "../app/lib/refresh/scheduled-queue-check.server.js";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";

function syntheticResponse(endpoint, owner, day) {
  const url = new URL(endpoint);
  assert.equal(url.origin, "https://a.klaviyo.com");
  if (url.pathname.includes("/accounts")) return Response.json({data: [
    {type: "account", id: owner.accountId, attributes: {timezone: "UTC", preferred_currency: "USD"}},
  ]});
  if (url.pathname.includes("/metrics")) return Response.json({
    data: ["Placed Order", "Added to Cart", "Checkout Started", "Ordered Product"].map((name, i) =>
      ({id: "metric-"+i, type: "metric", attributes: {name, integration: {name: "Shopify"}}})),
    links: {next: null},
  });
  if (url.pathname.includes("values-reports")) return Response.json({
    data: {type: (url.pathname.includes("campaign") ? "campaign" : "flow")+"-values-report", attributes: {results: []}},
    links: {next: null},
  });
  assert.equal(url.pathname, "/api/events");
  const offset = Number(url.searchParams.get("page[cursor]") ?? 0);
  assert.ok([0, 40, 80, 120, 160].includes(offset));
  return Response.json({
    data: Array.from({length: 40}, (_, i) => ({
      type: "event", id: "event-"+(offset+i),
      attributes: {datetime: day+"T12:00:00Z", event_properties: {OrderId: "order-"+(offset+i), ProductID: "product-"+(offset+i), Quantity: 1, $value: "19.99"}},
      relationships: {metric: {data: {type: "metric", id: "metric-3"}}},
    })),
    links: {next: offset < 160 ? "https://a.klaviyo.com/api/events?page%5Bcursor%5D="+(offset+40) : null},
  });
}

async function installReportTimers(client) {
  const signatures = [
    "analytics.commit_scheduled_dataset_reconciliation(jsonb,jsonb,jsonb,timestamptz)",
    "analytics._commit_dataset_reconciliation(jsonb,jsonb,jsonb,timestamptz)",
  ];
  const definitions = [];
  const restore = async () => {for (const sql of definitions) await client.query(sql);};
  function inject(sql, anchor, text) {
    assert.equal(sql.split(anchor).length, 2, "reconciliation timing anchor must be unique");
    return sql.replace(anchor, text+"\n"+anchor);
  }
  function elapsed(label) {
    return `bench_times:=bench_times || jsonb_build_object('${label}',1000*extract(epoch from (clock_timestamp()-bench_start)));
 bench_start:=clock_timestamp();`;
  }
  try {
    for (const signature of signatures) {
      const {rows: [{definition}]} = await client.query("select pg_get_functiondef($1::regprocedure) as definition", [signature]);
      definitions.push(definition);
      let sql = inject(definition, "begin\n", "bench_times jsonb:='{}'; bench_start timestamptz:=clock_timestamp();");
      if (signature === signatures[0]) {
        sql = inject(sql, "  receipt:=analytics.commit_dataset_reconciliation(o,p,c,d);", elapsed("scheduledLockAndAuthorityMs"));
        sql = inject(sql, "  if receipt->>'status'='consumed' then", "bench_start:=clock_timestamp();");
        sql = inject(sql, "  return receipt;", elapsed("scheduledReceiptLinkMs")+"\n raise notice 'EO05_JOB_REPORT_TIMING %', bench_times;");
      } else {
        sql = inject(sql, " if o->>'provider'='shopify'", elapsed("writerLockAndAuthorityMs"));
        sql = inject(sql, " read_key:=case", elapsed("packageValidationMs"));
        sql = inject(sql, " if (select count(*) from jsonb_array_elements(p->'rows'))<>", elapsed("sourceAndRetentionMs"));
        sql = inject(sql, " result:=jsonb_build_object('version','eo05d-reconciliation-v1'", elapsed("rowCheckAndWriteMs"));
        sql = inject(sql, " return result;", elapsed("receiptCreateMs")+"\n raise notice 'EO05_JOB_REPORT_TIMING %', bench_times;");
      }
      await client.query(sql);
    }
    return restore;
  } catch (error) {await restore(); throw error;}
}

/** Only called in the dedicated disposable F01 CI database rehearsal. */
export async function klaviyoOneJobProbe(client, {ownerFixture, connection}) {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.ok(process.env.RUNNER_TEMP);
  await client.query("set role adstable_owner");
  let restoreTimers, contender, inspector, competingWait;
  const sqlPhases = {};
  const onNotice = ({message}) => {
    const prefix = "EO05_JOB_REPORT_TIMING ";
    if (message.startsWith(prefix)) Object.assign(sqlPhases, JSON.parse(message.slice(prefix.length)));
  };
  try {
    const owner = await ownerFixture(client, "klaviyo");
    const store = createRefreshWorkRepository({async query(sql, args) {
      try {return await client.query(sql, args);}
      catch (error) {
        console.error("EO05_KLAVIYO_ONE_JOB_QUEUE_STOP "+JSON.stringify({
          function: sql.match(/^select ([a-z_]+\.[a-z_]+)/i)?.[1], code: error.code, message: error.message,
        }));
        throw error;
      }
    }});
    const now = Date.now;
    const day = new Date(now()-86_400_000).toISOString().slice(0, 10);
    const window = {from: day, to: day};
    const hash = () => randomBytes(32).toString("hex");
    const generation = randomUUID(), operationId = randomUUID();
    const cipher = createSourceEvidenceCipher({keys: new Map([[1, randomBytes(32)]]), activeVersion: 1, forbiddenKeys: []});
    const policy = sourceStoreFixture().input.policy;
    await client.query("update integrations.provider_connections set connected_at=clock_timestamp()-interval '3 days' where id=$1", [owner.connectionId]);
    await client.query(`insert into operations.refresh_quota_contexts
      (workspace_id, install_generation, provider, installation_id, connection_id, connection_version, account_id, client_scope_key, connection_scope_key, connection_epoch, api_version, enabled)
      values ($1,$2,'klaviyo',$3,$4,$5,$6,$7,$8,1,'2026-10-15',true)`,
    [owner.workspaceId, owner.generation, owner.installationId, owner.connectionId, owner.connectionVersion, owner.accountId, hash(), hash()]);
    const cost = {requests: 20, dbWrites: 2000, connections: 3, rows: 1000, bytes: 2_000_000};
    await client.query("update operations.refresh_control set budget=$1,bounds=$2 where singleton", [{
      global: cost, interactiveReserve: {requests: 0, dbWrites: 0, connections: 0, rows: 0, bytes: 0},
      providers: [{provider: "klaviyo", limit: cost}], workspaces: [{workspaceId: owner.workspaceId, limit: cost}],
      accounts: [{provider: "klaviyo", accountId: owner.accountId, limit: cost}],
    }, {maxWorkspaces: 8, maxCandidates: 8, maxClaims: 1, maxAdmissions: 1}]);
    await client.query("update operations.refresh_tick_control set enabled=true,generation=$1,last_minute=null,last_checked_at_ms=null,queue_revision=null where singleton", [generation]);
    await client.query("update operations.refresh_queue_control set max_workspaces=8,max_accounts=8,max_snapshot_bytes=100000,max_snapshot_age_ms=60000 where singleton");
    restoreTimers = await installReportTimers(client);
    client.on("notice", onNotice);
    contender = new pg.Client(connection);
    inspector = new pg.Client(connection);
    await contender.connect();
    await inspector.connect();
    await contender.query("set role adstable_owner; set statement_timeout='45s'");
    const {rows: [{pid: contenderPid}]} = await contender.query("select pg_backend_pid() as pid");
    const {rows: [{pid: writerPid}]} = await client.query("select pg_backend_pid() as pid");
    const start = performance.now();
    await store.checkQueueFromAuthority({expectedRevision: (await store.readQueueCheck()).revision});
    const queueEnqueueMs = performance.now()-start;
    const limits = {deadlineAt: now()+100_000, requestTimeoutMs: 25_000, finishReserveMs: 2_000, maxRows: 1000, maxBytes: 2_000_000};
    const appId = "gid://shopify/App/456";
    const entitlementVerifier = createRefreshEntitlementVerifier({store, appId, now, limits, authorizeRead: async () => true,
      partnerApi: {appId, activeSubscription: async () => ({data: {activeSubscription: {
        shop: {id: owner.shopId, myshopifyDomain: owner.shopDomain}, billingPeriod: "EVERY_30_DAYS",
        cancelAtEndOfCycle: false, trialEndsAt: null,
        currentBillingCycle: {startTime: new Date(now()-86_400_000).toISOString(), endTime: new Date(now()+86_400_000).toISOString()},
        items: [{handle: "monthly", price: {active: true}}],
      }}})},
    });
    const timing = {queueEnqueueMs, rawWriteMs: 0, rawDatabaseWriteMs: 0, rawDatabaseReadbackMs: 0, reportSourceReadMs: 0,
      reportWriteMs: 0, reportReadbackMs: 0, closeMs: 0};
    const batches = [];
    let requests = 0, admittedClaim, failure, reportStarted;
    const reportDatabase = {async query(sql, args) {
      const before = performance.now();
      if (sql === SCHEDULED_DATASET_RECONCILE_SQL) competingWait = delay(100).then(async () => {
        const beganWait = performance.now();
        let waitMs;
        const waiting = contender.query("select 1 from operations.refresh_control where singleton for update")
          .then(() => {waitMs = performance.now()-beganWait;}, error => ({error}));
        let writerConfirmed = false;
        for (let attempt = 0; attempt < 10 && !writerConfirmed && waitMs === undefined; attempt++) {
          const {rows: [{blocked}]} = await inspector.query("select $1::int=any(pg_blocking_pids($2::int)) as blocked", [writerPid, contenderPid]);
          writerConfirmed = blocked;
          if (!blocked) await delay(15);
        }
        const outcome = await waiting;
        if (outcome?.error) throw outcome.error;
        assert.equal(writerConfirmed, true);
        return waitMs;
      }).then(ms => ({ms}), error => ({error}));
      try {return await client.query(sql, args);}
      catch (error) {failure = error; throw error;}
      finally {
        const field = sql === SCHEDULED_DATASET_RECONCILE_SQL ? "reportWriteMs"
          : sql === SCHEDULED_DATASET_FINISH_SQL ? "closeMs"
          : sql.includes("inspect_dataset_reconciliation(") ? "reportReadbackMs" : "reportSourceReadMs";
        timing[field] += performance.now()-before;
      }
    }};
    const scheduled = await runScheduledRefreshCheck({store, generation, work: {
      now, entitlementVerifier,
      buildWorkPlan: async source => source.workspaceId === owner.workspaceId && source.provider === "klaviyo"
        ? {window, partitionId: "synthetic-one-job:"+day, workClass: "deep_reconciliation", cost, limits} : null,
      readPage: async ({claim, entitlementReceipt, signal}) => {
        admittedClaim = claim;
        try {
          const quotaContext = await store.loadQuotaContext({claim, window, provider: "klaviyo", entitlementReceipt});
          assert.ok(quotaContext);
          const beforeCollect = performance.now();
          timing.queueAndAdmissionMs = beforeCollect-start-queueEnqueueMs;
          await collectKlaviyoRawDatasets({accessToken: "synthetic-only", accountId: owner.accountId, source: {timezone: "UTC", currency: "USD"},
            window, limits: {...limits, maxPages: 5}, signal, now, pacerFactory: () => async () => {},
            guard: async () => assert.equal(await store.isClaimCurrent({claim}), true),
            transport: async endpoint => {requests++; return syntheticResponse(endpoint, owner, day);},
            onDataset: async ({dataset, pages, complete, coverage}) => {
              assert.equal(complete, true);
              const attemptId = randomUUID(), beforeStore = performance.now();
              const database = {async query(sql, args) {
                const before = performance.now();
                try {return await client.query(sql, args);}
                finally {timing[sql.includes("commit_klaviyo_dataset_source(") ? "rawDatabaseWriteMs" : "rawDatabaseReadbackMs"] += performance.now()-before;}
              }};
              const stamp = new Date(now()).toISOString();
              const receipt = await storeKlaviyoRawDataset({database, owner, attemptId, dataset, pages, complete, cipher, policy,
                limits: {maxRows: 1000, maxBytes: 1_048_576}, now: stamp,
                read: {jobId: claim.id, fence: String(claim.fence), window, operationId, quotaContext, observedAt: entitlementReceipt.observedAt,
                  completedAt: stamp, deadlineAt: new Date(limits.deadlineAt).toISOString(), coverage}});
              assert.equal(receipt.contentVerified, true);
              batches.push({attemptId, ordinal: 0});
              timing.rawWriteMs += performance.now()-beforeStore;
            }});
          timing.providerCollectionMs = performance.now()-beforeCollect-timing.rawWriteMs;
          return {kind: "complete", payload: {batchCount: batches.length}};
        } catch (error) {failure = error; throw error;}
      },
      validatePage: ({payload}) => ({complete: payload.batchCount === 3, rows: []}),
      loadDatasetInputs: async ({claim}) => {
        assert.equal(claim.id, admittedClaim.id);
        reportStarted = performance.now();
        timing.handoffMs = reportStarted-start-queueEnqueueMs-timing.queueAndAdmissionMs-timing.providerCollectionMs-timing.rawWriteMs;
        return {owner, batches, cipher, expectedRevision: 0, database: reportDatabase};
      },
    }});
    if (failure) throw failure;
    const ended = performance.now(), totalMs = ended-start;
    assert.equal(scheduled.work?.status, "completed", JSON.stringify(scheduled));
    assert.equal(scheduled.work.claim.id, admittedClaim.id);
    const verified = (await client.query(`
      select r.status, (select count(*)::int from analytics.cpd_product_sales_facts where installation_id=$2) as rows,
        (select count(*)::int from evidence.source_batches b
          join evidence.source_batches anchor on anchor.id=(b.manifest->'datasetConsumerReceipt'->>'anchorBatchId')::bigint
          where b.authority=$3::jsonb and anchor.authority=b.authority and b.handoff_state='consumed'
            and b.manifest->'klaviyoDatasetRead'->>'jobId'=$1 and anchor.manifest->'scheduledDatasetClaim'->>'job'=$1
            and b.handoff_receipt=anchor.manifest->'datasetReconciliation'->>'digest') as receipts
      from operations.refresh_runs r where r.job_id=$1 and r.workspace_id=$4`,
    [admittedClaim.id, owner.installationId, JSON.stringify(owner), owner.workspaceId])).rows[0];
    assert.deepEqual(verified, {status: "completed", rows: 200, receipts: 3});
    assert.equal(Object.keys(sqlPhases).length, 7);
    const lockWait = await competingWait;
    if (lockWait.error) throw lockWait.error;
    await restoreTimers();
    restoreTimers = undefined;
    console.log("EO05_KLAVIYO_ONE_JOB_PASS "+JSON.stringify({rows: verified.rows, completed: true, requests, liveRequests: 0,
      timings: {...timing, rawAdsTableMs: timing.rawWriteMs-timing.rawDatabaseWriteMs-timing.rawDatabaseReadbackMs,
        reportNonMeteredMs: ended-reportStarted-timing.reportSourceReadMs-timing.reportWriteMs-timing.reportReadbackMs-timing.closeMs,
        reportSqlPhases: sqlPhases, competingLockWaitMs: lockWait.ms, totalMs}}));
  } finally {
    client.off("notice", onNotice);
    try {await restoreTimers?.();}
    finally {
      await competingWait;
      await Promise.allSettled([contender?.end(), inspector?.end()]);
      await client.query("reset role");
    }
  }
}
