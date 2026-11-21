import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {datasetSourceBindingFixture} from "./fixtures/dataset-source-binding-fixture.js";
import {datasetStorageFixture} from "./fixtures/dataset-storage-fixture.js";
import {sourcePayloadHash} from "../app/lib/database/source-evidence-store.server.js";
import {reconcileStoredDatasetSources, canonicalDatasetEventTime, prepareDailyDatasetPackages, DATASET_RECONCILE_SQL, DATASET_RECONCILE_READ_SQL, SCHEDULED_DATASET_RECONCILE_SQL, SCHEDULED_DATASET_FINISH_SQL} from "../app/lib/database/dataset-reconciliation.server.js";
import {readStoredDatasetSources} from "../app/lib/database/dataset-source-reader.server.js";
import {projectStoredKlaviyoDataset} from "../app/lib/providers/stored-klaviyo-dataset.server.js";
import {readDatasetWritePlan} from "../app/lib/refresh/dataset-server.server.js";
import {runScheduledRefreshWithDataset} from "../app/lib/refresh/scheduled-queue-check.server.js";
import {createScheduledDatasetPostgresClient} from "../app/lib/database/dataset-postgres.server.js";
import {GOOGLE_DAILY_STAGE_SQL,GOOGLE_DAILY_PUBLISH_SQL,GOOGLE_DAILY_INSPECT_SQL,GOOGLE_DAILY_FINISH_SQL} from "../app/lib/database/dataset-rpc.server.js";
import {verifyShopifyProductCandidate,shopifyProductVerificationEvidence} from "../app/lib/shopify/product-identity-verification.server.js";
import {verifiedMappingFixture} from "./fixtures/verified-mapping-fixture.js";
import {createSyntheticReportMapping,loadSyntheticMappingReconciliation} from "./fixtures/refresh-shopify-mapping-probe.js";

async function fixture(provider = "google_ads", options = {}) {
  const f = await datasetSourceBindingFixture(provider, options); const key = provider === "google_ads" ? "googleDatasetRead" : provider === "meta" ? "metaDatasetRead" : "klaviyoDatasetRead";
  for (const b of f.envelopes.values()) Object.assign(b.receipt.manifest[key], {observedAt: "2026-11-02T00:00:00.000Z", completedAt: "2026-11-02T00:01:00.000Z"});
  let receipt, request;
  f.hooks.query = (sql, args) => {
    if (sql === DATASET_RECONCILE_SQL || sql === SCHEDULED_DATASET_RECONCILE_SQL) {
      const write = JSON.parse(args[1]), context = JSON.parse(args[2]); request = {write, context};
      receipt = {status: "consumed", operationId: write.operationId, requestDigest: sourcePayloadHash(request), revision: context.expectedRevision + 1,
        rowCount: write.rows.length, consumerReceipt: true, checkpointAdvanced: true, comparison: "matched", businessDate: context.businessDate, timeZone: context.timeZone};
      if (sql === SCHEDULED_DATASET_RECONCILE_SQL) receipt.digest = sourcePayloadHash(receipt);
      return {rows: [{result: structuredClone(receipt)}]};
    }
    if (sql === DATASET_RECONCILE_READ_SQL) return {rows: [{result: structuredClone(receipt)}]};
    if (sql === SCHEDULED_DATASET_FINISH_SQL) return {rows: [{result: args[3] === receipt.operationId && args[4] === receipt.digest}]};
  };
  return {...f, expectedRevision: 0, request: () => request};
}
test("event-time canonicalization preserves exact microseconds and timezone without changing source bytes", () => {
  assert.equal(canonicalDatasetEventTime("2026-11-01T12:00:00Z"), "2026-11-01T12:00:00.000000Z");
  assert.equal(canonicalDatasetEventTime("2026-11-01T12:00:00.123Z"), "2026-11-01T12:00:00.123000Z");
  assert.equal(canonicalDatasetEventTime("2026-11-01T15:00:00.123456+03:00"), "2026-11-01T12:00:00.123456Z");
  for (const value of ["2026-11-01T12:00:00.1234567Z", "2026-02-30T12:00:00Z", "2026-11-01T24:00:00Z", null, "invalid"]) assert.throws(() => canonicalDatasetEventTime(value));
});

test("scheduled report transaction pins allowed calls to one connection and rolls back on a caught error", async () => {
  const role="adstable_refresh_dataset_runner";
  const environment={
    ADSTABLE_REFRESH_DATASET_DATABASE_URL:`postgresql://${role}.podpwkrpmjiksskxhwsu:${"x".repeat(32)}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require`,
    ADSTABLE_REFRESH_DATASET_DB_TIMEOUT_MS:"5000",
  };
  const params=["synthetic-owner",randomUUID()];
  for(const mode of ["success","caught_forbidden","lost_commit"]) {
    let connections=0,releases=[],escaped;
    const calls=[];
    const database=createScheduledDatasetPostgresClient({environment,deadlineAt:Date.now()+60000,
      poolFactory:()=>({on(){},async end(){},async connect(){
        connections++;
        return {release(broken){releases.push(broken);},async query(sql,args){
          calls.push(sql);
          if(sql.startsWith("select current_user as role")) return {rows:[{role,profile_ready:true}]};
          if(sql===DATASET_RECONCILE_READ_SQL) return {rows:[{result:args[1]}]};
          if(sql==="commit"&&mode==="lost_commit") throw Error("lost synthetic commit");
          return {rows:[]};
        }};
      }})});
    const result=database.transaction(async tx=>{
      escaped=tx;
      assert.equal((await tx.query(DATASET_RECONCILE_READ_SQL,params)).rows[0].result,params[1]);
      if(mode==="caught_forbidden") {
        await assert.rejects(tx.query("select * from analytics.pd_facts"),/DATABASE_UNCONFIRMED/);
      } else {
        await tx.query(DATASET_RECONCILE_READ_SQL,params);
      }
      return "verified";
    });
    if(mode==="success") {
      assert.equal(await result,"verified");
      assert.deepEqual(calls.slice(-3),[DATASET_RECONCILE_READ_SQL,DATASET_RECONCILE_READ_SQL,"commit"]);
    } else {
      await assert.rejects(result,/DATABASE_UNCONFIRMED/);
      assert.equal(calls.at(-1),"rollback");
      assert.equal(calls.includes("commit"),mode==="lost_commit");
    }
    assert.equal(connections,1);
    assert.deepEqual(releases,[mode!=="success"]);
    await assert.rejects(escaped.query(DATASET_RECONCILE_READ_SQL,params),/DATABASE_UNCONFIRMED/);
    await database.close();
  }
});
for (const provider of ["google_ads", "meta", "klaviyo"]) test("reconciliation projects actual source pages and confirms receipt: " + provider, async () => {
  const f = await fixture(provider, {nonempty: provider !== "meta"}), r = await reconcileStoredDatasetSources(f);
  assert.equal(r.consumerReceipt, true); assert.equal(r.checkpointAdvanced, true); assert.equal(r.publishable, false);
  assert.equal(f.request().context.sources.length, [...f.envelopes.values()].reduce((n, b) => n + b.pages.length, 0));
  assert.equal(f.request().write.rows.length, provider === "google_ads" ? 3 : provider === "meta" ? 0 : 2);
});

const sharedShopifyInstallation=datasetStorageFixture().owner;
for (const provider of ["google_ads", "klaviyo"]) test(`${provider} synthetic report binds a verified Shopify mapping at the Dataset write seam`, async () => {
  const reconcile=await loadSyntheticMappingReconciliation();
  const owner={...sharedShopifyInstallation,provider,connectionId:randomUUID(),credentialId:randomUUID(),
    accountId:provider==="google_ads"?"123":"account-1",selectionEpoch:provider==="google_ads"?"1":null};
  for (const mode of ["matched","wrong_shop","wrong_variant_parent","missing","missing_shopify_evidence",
    ...(provider==="google_ads"?["split_sale","ambiguous_link"]:[])]){
    const f=await fixture(provider,{owner,shopifyMapping:mode==="split_sale"?"split_sale":true});
    const mapping=verifiedMappingFixture(provider,{owner:f.owner,cipher:f.cipher,context:provider==="klaviyo"?{metric_id:"product"}:{}});
    const actualShop=mode==="wrong_shop"?{...f.owner,shopId:"gid://shopify/Shop/900",shopDomain:"foreign-fixture.myshopify.com"}:f.owner;
    const node=(type,id)=>({id:`gid://shopify/${type}/${id}`,legacyResourceId:id});
    let shopifyCalls=0,lookupCalls=0;
    const observed=await verifyShopifyProductCandidate({
      shop:{authority:"shopify_admin_verified",shopId:actualShop.shopId,myshopifyDomain:actualShop.shopDomain},
      installation:{authority:"shopify_installation_verified",status:"active",workspaceId:actualShop.workspaceId,installGeneration:Number(actualShop.generation)},
      productId:"123",variantId:"456",admin:{async graphql(){
        shopifyCalls++;
        return Response.json({data:{shop:{id:actualShop.shopId,myshopifyDomain:actualShop.shopDomain},product:node("Product","123"),
          productVariant:{...node("ProductVariant","456"),product:node("Product",mode==="wrong_variant_parent"?"999":"123")}}});
      }},
    });
    mapping.check.shopifyVerification=shopifyProductVerificationEvidence(observed);
    if(mode==="missing_shopify_evidence")mapping.entries.splice(mapping.entries.findIndex(entry=>entry.role==="candidate_check"),1);
    const snapshot=mapping.snapshot();
    Object.assign(snapshot.mapping,{state:"verified",revision:"2",productId:"gid://shopify/Product/123",variantId:"gid://shopify/ProductVariant/456"});
    const identity=JSON.parse(snapshot.mapping.identityKey);
    const [envelope]=f.envelopes.values();
    const read=envelope.receipt.manifest[provider==="google_ads"?"googleDatasetRead":"klaviyoDatasetRead"];
    const googleLinks=provider==="google_ads"&&mode!=="missing"?[{state:"reviewed_synthetic_report_link",owner:f.owner,
      nativeId:identity.nativeId,window:read.window,reportKey:{merchant_id:"99",feed_label:"US",content_language:"en"},merchantContext:identity.context}]:[];
    if(mode==="ambiguous_link")googleLinks.push({...googleLinks[0],merchantContext:{...identity.context,data_source:"accounts/99/dataSources/8"}});
    const original=f.hooks.query;
    f.hooks.query=(sql,args)=>{
      if(!sql.includes("identity.lookup_verified_mapping("))return original(sql,args);
      lookupCalls++;
      assert.deepEqual(JSON.parse(args[0]),f.owner);
      assert.deepEqual(JSON.parse(args[1]),identity);
      if(mode==="missing")throw Error("MAPPING_NOT_VERIFIED");
      return {rows:[{result:snapshot}]};
    };
    const input={...f,scheduled:true,admittedScope:{jobId:read.jobId,fence:read.fence,...read.window},
      bindSyntheticMappings:createSyntheticReportMapping({googleLinks,now:()=>mapping.now})};
    if(["wrong_shop","wrong_variant_parent","missing_shopify_evidence"].includes(mode)){
      await assert.rejects(reconcile(input),mode==="missing_shopify_evidence"?/MAPPING_STORE_NATIVE_EVIDENCE_REQUIRED/:/MAPPING_STORE_SHOPIFY_PROOF_REQUIRED/);
      assert.equal(f.request(),undefined);
    }else{
      assert.equal((await reconcile(input)).jobCompleted,true);
      const productRows=f.request().write.rows.filter(item=>item.table!=="pd_facts");
      assert.equal(productRows.length,provider==="google_ads"?2:1);
      for(const {table,row} of productRows){
        const keys=table==="cpd_product_performance_facts"?["product_mapping_id"]:provider==="google_ads"
          ?["sold_product_mapping_id","advertised_product_mapping_id"]:["sold_product_mapping_id"];
        for(const key of keys){
          const matched=mode==="matched" || mode==="split_sale"&&key!=="sold_product_mapping_id";
          assert.equal(row[key],matched?snapshot.mapping.id:null);
        }
        if(mode==="matched"||mode==="split_sale")assert.deepEqual(row.product_context,identity.context);
        if(mode==="split_sale"&&table==="cpd_product_sales_facts")assert.equal(row.native_sold_product_id,"shopify_US_124_457");
      }
    }
    assert.equal(shopifyCalls,1,"catalog verification runs during fixture preparation only");
    assert.equal(lookupCalls,provider==="google_ads"&&["missing","ambiguous_link"].includes(mode)?0:1,"one exact lookup per identity in the job");
  }
});

test("daily Klaviyo packages keep report rows ordered, bounded and unique across the day", async () => {
  const f=await fixture("klaviyo");
  const projection=projectStoredKlaviyoDataset(await readStoredDatasetSources(f));
  const sample=projection.rows.find(item=>item.table==="cpd_product_sales_facts");
  const pd=projection.rows.find(item=>item.table==="pd_facts");
  const rows=[pd,...Array.from({length:1000},(_,i)=>{
    const item=structuredClone(sample),eventId="synthetic-event-"+i;
    item.row.provider_event_id=eventId;
    item.row.source_identity.native.event_id=eventId;
    return item;
  })];
  const options={owner:f.owner,rows,policy:f.policy,operationId:randomUUID(),
    now:new Date().toISOString(),context:{businessDate:"2026-11-01",timeZone:"UTC"},maxPackages:20};
  const packages=prepareDailyDatasetPackages(options);
  assert.deepEqual(packages.map(write=>write.rows.length),[200,200,200,200,200,1]);
  assert.ok(packages.every(write=>write.operationId===options.operationId
    && Buffer.byteLength(JSON.stringify({write,context:options.context}))<=1048576));
  assert.deepEqual(packages.flatMap(write=>write.rows.map(item=>item.row.provider_event_id)),rows.map(item=>item.row.provider_event_id));
  const oversizedContext={proof:Array.from({length:17},()=>"x".repeat(64000))};
  assert.throws(()=>prepareDailyDatasetPackages({...options,rows:rows.slice(0,2),context:oversizedContext}),/BYTE_LIMIT/);
  const acrossBoundary=[...rows.slice(0,201),rows[1]];
  assert.throws(()=>prepareDailyDatasetPackages({...options,rows:acrossBoundary}),/DUPLICATE_NATIVE_KEY/);
});
test("Meta's existing nonempty sales evidence hold is preserved, never consumed", async () => {
  const f = await fixture("meta"); const r = await reconcileStoredDatasetSources(f);
  assert.equal(r.status, "held");assert.equal(r.consumerReceipt, false);assert.equal(f.request(), undefined);
});
test("verified empty submits no fake zero rows; missing metric never consumes", async () => {
  const e = await fixture("google_ads", {nonempty: false});
  assert.equal((await reconcileStoredDatasetSources(e)).rowCount, 0); assert.deepEqual(e.request().write.rows, []);
  const p = await fixture("klaviyo", {missingMetric: true});
  const r = await reconcileStoredDatasetSources(p); assert.equal(r.status, "held"); assert.equal(r.checkpointAdvanced, false); assert.equal(p.request(), undefined);
});
test("missing clocks, cancellation, limits and tampered ciphertext stop before writes", async () => {
  for (const mode of ["clock", "abort", "bytes", "cipher"]) {
    const f = await fixture();
    if (mode === "clock") delete f.envelopes.values().next().value.receipt.manifest.googleDatasetRead.observedAt;
    if (mode === "cipher") f.envelopes.values().next().value.pages[0].authTag = "0".repeat(32);
    await assert.rejects(reconcileStoredDatasetSources({...f, ...mode === "abort" ? {signal: AbortSignal.abort()} : {}, ...mode === "bytes" ? {limits: {...f.limits, maxBytes: 1}} : {}}));
    assert.equal(f.request(), undefined);
  }
});
test("unknown writes stop without any following readback or retry", async () => {
  const f = await fixture(); let lost = false, after = 0; const hook = f.hooks.query;
  f.hooks.query = (sql, args) => {if (lost) after++; if (sql === DATASET_RECONCILE_SQL) {lost = true; throw Error("lost");}return hook(sql, args);};
  await assert.rejects(reconcileStoredDatasetSources(f), /WRITE_UNCONFIRMED/); assert.equal(after, 0);
});
test("scheduled handoff consumes only its own admitted source and verifies readback", async () => {
  for (const mode of ["verified", "wrong_fence", "lost_write", "lost_finish", "wrong_role", "google_daily"]) {
    const input = await fixture("google_ads",mode==="google_daily"?{googleProducts:101}:{});
    const {owner} = input;
    const generation = randomUUID();
    const time = Date.parse("2026-11-02T00:02:00.000Z");
    const window = {from: "2026-11-01", to: "2026-11-01"};
    const source = {...input.source, connectionVersion: Number(owner.connectionVersion), queuedAt: time, scheduledHour: time - time % 3600000 - 3600000};
    const cost = {requests: 2, dbWrites: 5, connections: 1, rows: 1000, bytes: 1000000};
    const snapshot = {configured: true, queueRevision: 2, candidates: [source],
      state: {revision: 3, nextFence: 1, nextTurn: 1, claims: [], lastServed: []},
      bounds: {maxCandidates: 5, maxClaims: 5, maxAdmissions: 5, maxWorkspaces: 5},
      budget: {global: cost, interactiveReserve: {requests: 0, dbWrites: 0, connections: 0, rows: 0, bytes: 0},
        providers: [{provider: owner.provider, limit: cost}], workspaces: [{workspaceId: owner.workspaceId, limit: cost}],
        accounts: [{provider: owner.provider, accountId: owner.accountId, limit: cost}]}};
    const store = {checkScheduledQueue: async () => ({status: "checked", generation, sequence: 1, queueRevision: 2, checkedAtMs: time}),
      reviewInterruptedWork: async () => ({status: "reviewed", stopped: 0, uncertain: 0}), readPreflightSnapshot: async () => snapshot,
      commitPreflight: async () => true, loadBoundAuthority: async () => ({...source, installationVerified: true, connected: true, setupComplete: true, allowedWindow: true}),
      advanceStage: async () => true, isClaimCurrent: async () => true, readAdmissionSnapshot: async () => snapshot,
      recordStop: async () => ({recorded: true})};
    const hook = input.hooks.query;
    let dailyReceipt;
    const dailyPackages=[];
    input.hooks.query = (sql, args) => {
      if(mode==="google_daily"){
        if(sql===GOOGLE_DAILY_STAGE_SQL){const write=JSON.parse(args[1]),context=JSON.parse(args[2]);
          const part={ordinal:args[4],rowCount:write.rows.length,digest:sourcePayloadHash({write,context})};dailyPackages.push(part);
          return {rows:[{result:{status:"staged",operationId:write.operationId,packageCount:args[5],...part}}]};}
        if(sql===GOOGLE_DAILY_PUBLISH_SQL){const c=JSON.parse(args[1]);dailyReceipt={version:"google-daily-receipt-v1",status:"consumed",comparison:"matched",
          operationId:args[3],rowCount:dailyPackages.reduce((n,p)=>n+p.rowCount,0),packages:dailyPackages,batchIds:c.batchIds,
          consumerReceipt:true,checkpointAdvanced:true,revision:1,businessDate:c.businessDate,timeZone:c.timeZone,
          jobId:c.sourceContext.job_id,fence:c.sourceContext.fence,digest:"a".repeat(64)};return {rows:[{result:dailyReceipt}]};}
        if(sql===GOOGLE_DAILY_INSPECT_SQL)return {rows:[{result:structuredClone(dailyReceipt)}]};
        if(sql===GOOGLE_DAILY_FINISH_SQL)return {rows:[{result:args[3]===dailyReceipt.operationId&&args[4]===dailyReceipt.digest}]};
      }
      if (mode === "lost_write" && sql === SCHEDULED_DATASET_RECONCILE_SQL) throw Error("lost commit acknowledgement");
      if (mode === "lost_finish" && sql === SCHEDULED_DATASET_FINISH_SQL) throw Error("lost completion acknowledgement");
      return hook(sql, args);
    };
    const work = {buildWorkPlan: async () => ({partitionId: "synthetic-one-day", workClass: "hourly_hot_window", window, cost,
      limits: {deadlineAt: time + 60000, requestTimeoutMs: 1000, finishReserveMs: 100, maxRows: cost.rows, maxBytes: cost.bytes}}),
      now: () => time, entitlementVerifier: {verify: async () => ({status: "verified", receipt: {}}), isCurrent: async () => true},
      readPage: async () => ({kind: "complete", payload: {}}), validatePage: () => ({complete: true, rows: []}),
      loadDatasetInputs: async ({claim}) => {
        for (const envelope of input.envelopes.values()) {
          Object.assign(envelope.receipt.manifest.googleDatasetRead, {jobId: claim.id, fence: String(claim.fence + (mode === "wrong_fence" ? 1 : 0))});
        }
        return {...input,...(mode==="google_daily"?{googleDailyPackages:true}:{})};
      }};
    let opens = 0, closes = 0;
    const environment = {ADSTABLE_REFRESH_DATASET_DATABASE_URL: "postgresql://adstable_refresh_dataset_runner.podpwkrpmjiksskxhwsu:" + "x".repeat(32) + "@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require",
      ADSTABLE_REFRESH_DATASET_DB_TIMEOUT_MS: "1000"};
    const result = await runScheduledRefreshWithDataset({store, generation, work, environment, poolFactory: config => {
      opens++;
      assert.equal(config.ssl.rejectUnauthorized,true);
      return {on() {}, async end() {closes++;}, async connect() {return {release() {}, async query(sql, args) {
        if (sql.includes("as profile_ready")) return {rows: [{role: mode === "wrong_role" ? "adstable_owner" : "adstable_refresh_dataset_runner", profile_ready: true}]};
        if (["begin","commit","rollback"].includes(sql) || sql.startsWith("select pg_catalog.set_config")) return {rows: []};
        return input.database.query(sql, args);
      }};}};
    }});
    assert.deepEqual([opens,closes],[1,1]);
    assert.equal(result.status, "queue_checked");
    if(mode==="google_daily"){
      assert.equal(result.work.status,"completed");assert.equal(result.work.reservationRetained,false);
      assert.equal(input.queries.filter(sql=>sql===SCHEDULED_DATASET_RECONCILE_SQL).length,0);
      assert.deepEqual(dailyPackages.map(p=>p.rowCount),[200,3]);
      assert.equal(input.queries.filter(q=>q===GOOGLE_DAILY_STAGE_SQL).length,2);
      for(const sql of [GOOGLE_DAILY_PUBLISH_SQL,GOOGLE_DAILY_INSPECT_SQL,GOOGLE_DAILY_FINISH_SQL])
        assert.equal(input.queries.filter(q=>q===sql).length,1);
      continue;
    }
    assert.equal(result.work.status, mode === "verified" ? "completed" : "needs_attention");
    assert.equal(input.queries.filter(sql => sql === DATASET_RECONCILE_SQL).length, 0);
    assert.equal(input.queries.filter(sql => sql === SCHEDULED_DATASET_RECONCILE_SQL).length, ["wrong_fence","wrong_role"].includes(mode) ? 0 : 1);
    const reachesFinish = mode === "verified" || mode === "lost_finish";
    assert.equal(input.queries.filter(sql => sql === DATASET_RECONCILE_READ_SQL).length, reachesFinish ? 1 : 0);
    assert.equal(input.queries.filter(sql => sql === SCHEDULED_DATASET_FINISH_SQL).length, reachesFinish ? 1 : 0);
    if (mode === "verified") assert.equal(result.work.reservationRetained, false);
    if (mode === "lost_finish") assert.equal(result.work.reservationMayExist, true);
  }
});
test("physical mismatch result is held and cannot claim consumption or checkpoint", async () => {
  const f = await fixture(), hook = f.hooks.query;
  f.hooks.query = (sql, args) => {const r = hook(sql, args);if (sql === DATASET_RECONCILE_SQL) Object.assign(r.rows[0].result, {status: "mismatch", comparison: "mismatch", consumerReceipt: false, checkpointAdvanced: false});return r;};
  const r = await reconcileStoredDatasetSources(f);assert.equal(r.status, "mismatch");assert.equal(r.checkpointAdvanced, false);
  assert.equal(f.queries.filter(q => q === DATASET_RECONCILE_READ_SQL).length, 0);
});
test("plan v1 remains storage-only; v2 explicitly requires expected revision", async () => {
  const f = await fixture();const p = {version: 2, operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString(), owner: f.owner, batches: f.batches,
    limits: {maxPages: 100, maxRows: 1000, maxBytes: 1000000, maxElapsedMs: 60000}, useFx: false, expectedRevision: 0};
  const env = {ADSTABLE_DATASET_WRITE_ENABLED: "true", ADSTABLE_DATASET_WRITE_PLAN: JSON.stringify(p)};
  assert.equal(readDatasetWritePlan(env).version, 2);
  for (const expectedRevision of [undefined, -1, 1.2, 1000000000]) assert.throws(() => readDatasetWritePlan({...env, ADSTABLE_DATASET_WRITE_PLAN: JSON.stringify({...p, expectedRevision})}));
  delete p.expectedRevision;p.version = 1;assert.equal(readDatasetWritePlan({...env, ADSTABLE_DATASET_WRITE_PLAN: JSON.stringify(p)}).version, 1);
});
