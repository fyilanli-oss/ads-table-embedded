import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import {randomBytes, randomUUID} from "node:crypto";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";
import {datasetStorageFixture} from "../tests/fixtures/dataset-storage-fixture.js";
import {createSourceEvidenceRepository} from "../app/lib/database/source-evidence-store.server.js";
import {prepareDatasetWrite, prepareDatasetFx, createDatasetStorageRepository} from "../app/lib/database/dataset-storage.server.js";
import {sourceDatasetBindingProbe} from "./eo05b-source-dataset-binding-probe.mjs";
import {reportRetentionProbe} from "./eo05b-report-retention-probe.mjs";
import {fxReportingCurrencyProbe} from "./eo05b-fx-reporting-currency-probe.mjs";
import {datasetServerProbe} from "./eo05b-dataset-server-probe.mjs";
import {maturityProbe} from "./eo05c-maturity-probe.mjs";
import {reconciliationProbe} from "./eo05d-reconciliation-probe.mjs";
import {klaviyoDailyTimingProbe,klaviyoHistoricalRereadProbe} from "./eo05-klaviyo-daily-timing-probe.mjs";
import {observabilityProbe} from "./eo05e-observability-probe.mjs";
import {googleDailyPackagesProbe} from "./eo05-google-daily-packages-probe.mjs";
import {googleDailyTimingProbe,prepareGoogleTimingLocalRoles,installGoogleCombinedCandidate,installGoogleWriterPreparationCandidate,installGooglePackageReuseCandidate,proveGoogleReportCanonicalParity} from "./eo05-google-daily-timing-probe.mjs";
import {metaShopifyRefreshProbe} from "./eo05-meta-shopify-refresh-probe.mjs";
import {metaPackagedCorrectionProbe} from "./eo05-meta-daily-report-probe.mjs";
import {createSharedRefreshProbe} from "./eo05-shared-refresh-probe.mjs";

async function rejected(client, action, pattern) {
  await client.query("savepoint dataset_expected_failure"); let error;
  try {await action();} catch (caught) {error = caught;}
  await client.query("rollback to savepoint dataset_expected_failure"); await client.query("release savepoint dataset_expected_failure");
  assert.ok(error, "invalid SQL operation must fail"); if (pattern) assert.match(error.message, pattern);
}

export async function ownerFixture(client, provider = "google_ads", sharedInstallation) {
  const shopId = sharedInstallation?.shopId ?? "gid://shopify/Shop/" + BigInt("0x" + randomBytes(6).toString("hex"));
  const shopDomain = sharedInstallation?.shopDomain ?? "dataset-" + randomBytes(6).toString("hex") + ".myshopify.com";
  const boot = sharedInstallation ? {workspace_id:sharedInstallation.workspaceId,install_generation:sharedInstallation.generation}
    : (await client.query("select * from shopify.bootstrap_installation($1,$2,$3,statement_timestamp())", [shopId, shopDomain, randomBytes(32)])).rows[0];
  const iid = sharedInstallation?.installationId ?? (await client.query("select id::text from shopify.installations where workspace_id=$1", [boot.workspace_id])).rows[0].id;
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

async function sourceFixture(client, owner, sourceState = "complete") {
  const x = sourceStoreFixture({owner, sourceState});
  for (const key of Object.keys(x.input.records)) x.input.records[key] = [];
  x.input.pages = [{key: "native", family: "synthetic_dataset", ordinal: 0, origin: owner.provider, captureLayer: "collector_projection", numericFidelity: "exact_source_string",
    fieldCoverage: ["records"], schemaVersion: "synthetic-v1", sanitizerVersion: "synthetic-v1", payload: {records: [{entity_id: "ad-1", spend: "9007199254740993.1234567890123456789"}]}}];
  const write = x.prepare(), repo = createSourceEvidenceRepository(client), receipt = await repo.commit(write), pages = await repo.readPages({...write, limit: 10});
  assert.deepEqual(x.input.cipher.open({owner, attemptId: write.attemptId, ordinal: 0, page: pages[0]}), x.input.pages[0].payload);
  return {batch_id: receipt.batchId, commit_id: receipt.commitId, request_digest: receipt.digest, page_id: pages[0].id, payload_hash: pages[0].payloadHash};
}

/** Real PostgreSQL, synthetic owner/native envelopes only, always rollback. */
export async function datasetStorageProbe(client, connection, environment = process.env, {finalSynthetic=false} = {}) {
  assert.equal(environment.GITHUB_ACTIONS, "true"); assert.ok(environment.RUNNER_TEMP);
  assert.equal(connection.host, "127.0.0.1"); assert.equal(connection.port, 54322);
  await client.query("begin");
  try {
    await client.query("set local role adstable_owner");
    const lineage=JSON.parse(readFileSync(new URL("../contracts/a6-tech-01-f01-migration-lineage-v1.json",import.meta.url),"utf8"));
    for (const entry of lineage.prepared_migrations) {
      const sql=readFileSync(new URL("../"+entry.file,import.meta.url),"utf8").trim().replace(/^begin;/," ").replace(/commit;$/," ");
      try {await client.query(sql);} catch (error) {
        const pos=Number(error.position??error.internalPosition??0);
        console.error("EO05B_DATASET_MIGRATION_FAILURE",JSON.stringify({name:entry.name,code:error.code,position:pos,line:pos?sql.slice(0,pos).split("\n").length:null,message:error.message,where:error.where}));
        throw error;
      }
    }
    await client.query("set local role adstable_owner");
    if(finalSynthetic) console.log("EO06D_KLAVIYO_HISTORICAL_REREAD_PASS",JSON.stringify(await klaviyoHistoricalRereadProbe(client,{ownerFixture})));
    // Keep complete-flow inventory independent of later fixture owners.
    await client.query("savepoint google_complete_flow");
    try{
      await prepareGoogleTimingLocalRoles(client);
      const proof=await googleDailyTimingProbe(client,{ownerFixture,collectionDiagnostics:true,quotaClaimComparison:true});
      const {roleProfile,quota,transactionControl,other}=proof.collectionBreakdown.groups;
      // Each of the 37 reader guards makes three source-role calls and
      // a separate runtime-vault read. Quota transport adds 18 x 6 source calls.
      assert.ok(roleProfile.sqlTimedCalls>=37*3+18*6);
      assert.ok(quota.sqlTimedCalls>=18*6);
      assert.ok(other.sqlTimedCalls>=37);
      assert.equal(transactionControl.calls,roleProfile.sqlTimedCalls*2);
      assert.ok(transactionControl.untimedWallMs>0);
      const {quotaContext,quotaRoute,quotaReserve,quotaSettle}=proof.collectionBreakdown.quotaDetails;
      assert.ok(quotaContext.sqlTimedCalls>=37+18*2);
      assert.equal(quotaRoute.sqlTimedCalls,18*2);
      assert.equal(quotaReserve.sqlTimedCalls,18);
      assert.equal(quotaSettle.sqlTimedCalls,18);
      assert.equal(quota.sqlTimedCalls,quotaContext.sqlTimedCalls+quotaRoute.sqlTimedCalls+quotaReserve.sqlTimedCalls+quotaSettle.sqlTimedCalls);
      console.log("EO05_GOOGLE_COLLECTION_DIAGNOSTICS_PASS",JSON.stringify(Object.fromEntries(
        Object.entries({...proof.collectionBreakdown.groups,...proof.collectionBreakdown.quotaDetails})
          .map(([kind,value])=>[kind,{calls:value.calls,sqlTimedCalls:value.sqlTimedCalls}]))));
      console.log("EO05_GOOGLE_COMPLETE_FLOW_PASS",JSON.stringify({rows:proof.reportRows,nativeRows:proof.nativeRows,packages:proof.reportPackages,requests:proof.requests,receipts:proof.receipts,completed:proof.completed,realRoleChecks:proof.roleChecks>0,correctnessOnly:true}));
    }finally{await client.query("rollback to savepoint google_complete_flow");await client.query("release savepoint google_complete_flow");}
    await client.query("savepoint google_combined_flow");
    try{
      await prepareGoogleTimingLocalRoles(client);
      await client.query("savepoint google_combined_candidate_flow");
      let candidate;
      try{candidate=await googleDailyTimingProbe(client,{ownerFixture,combinedCandidate:true,reportBreakdown:true,publishTrace:true,factTriggerTrace:true});}
      finally{await client.query("rollback to savepoint google_combined_candidate_flow");await client.query("release savepoint google_combined_candidate_flow");}
      await installGoogleCombinedCandidate(client);
      const canonical=await proveGoogleReportCanonicalParity(client);
      await installGoogleWriterPreparationCandidate(client);
      const reportCases=await googleDailyPackagesProbe(client,{ownerFixture,verifyWriterPreparation:true});
      console.log("EO05_GOOGLE_REPORT_BREAKDOWN_PASS",JSON.stringify({rows:candidate.reportRows,packages:candidate.reportPackages,receipts:candidate.receipts,completed:candidate.completed,
        reportWriteBreakdown:candidate.reportWriteBreakdown,publishTrace:candidate.publishTrace,factTriggerTrace:candidate.factTriggerTrace,canonical,reportCases,isolatedEnvironment:true}));
    }finally{await client.query("rollback to savepoint google_combined_flow");await client.query("release savepoint google_combined_flow");}
    const matched=[];
    for(const kind of ["google","quota","authority","googleWriter"]){
      await client.query("savepoint matched_provider_flow");
      try{
        if(kind==="google"||kind==="googleWriter"){
          await prepareGoogleTimingLocalRoles(client);
          matched.push(await googleDailyTimingProbe(client,{
            ownerFixture,combinedCandidate:true,reportBreakdown:true,writerPreparationCandidate:kind==="googleWriter",
          }));
        }else{
          matched.push(await klaviyoDailyTimingProbe(client,{
            ownerFixture,connection,environment,mode:"retention-boundary",retentionVariant:"cached",
            combinedVerification:true,reduceReportRepeats:true,reportWriteCleanup:true,
            phaseCandidate:"ordered-json",reuseStagedCanonical:true,reuseCanonicalRows:true,
            endToEnd:true,sharedDaySources:true,matchedTransport:kind,
          }));
        }
      }finally{
        await client.query("rollback to savepoint matched_provider_flow");
        await client.query("release savepoint matched_provider_flow");
      }
    }
    for(const {durationsMs,totalMs,reportRows,reportPackages,receipts} of matched){
      assert.deepEqual([reportRows,reportPackages,receipts],[1000,5,1]);
      assert.ok(Object.values(durationsMs).every(ms=>Number.isFinite(ms)&&ms>=0));
      assert.ok(Math.abs(Object.values(durationsMs).reduce((a,b)=>a+b,0)-totalMs)<0.01);
    }
    console.log("EO05_MATCHED_AUTHORITY_AND_WRITER_PASS",JSON.stringify(matched.map(({
      provider,matchedTransport,quotaDebits,authorityChecks,reportRows,reportPackages,requests,receipts,durationsMs,totalMs,
    },index)=>({variant:["google","klaviyoQuota","klaviyoAuthority","googleWriter"][index],
      provider,matchedTransport,quotaDebits,authorityChecks,reportRows,reportPackages,requests,receipts,durationsMs,totalMs}))));
    const [reference,,klaviyoAuthority,writer]=matched;
    const reportOnly=[reference,writer].map(({reportRows,reportPackages,receipts,completed,reportWriteBreakdown})=>({
      reportRows,reportPackages,receipts,completed,...reportWriteBreakdown,
    }));
    assert.ok(reportOnly.every(result=>result.completed&&result.stageCalls===5&&result.publishCalls===1));
    console.log("EO05_GOOGLE_REPORT_ONLY_COMPARISON_PASS",JSON.stringify({reference:reportOnly[0],writer:reportOnly[1]}));
    const packageReuseComparison=[];
    let googlePackageFlow;
    for(const writerPreparationCandidate of [false,true]){
      await client.query("savepoint google_package_reuse_comparison");
      try{
        await prepareGoogleTimingLocalRoles(client);
        const result=await googleDailyTimingProbe(client,{
          ownerFixture,combinedCandidate:true,reportBreakdown:true,packageReuseCandidate:true,writerPreparationCandidate,
        });
        assert.deepEqual([result.reportRows,result.reportPackages,result.receipts,result.completed],[1000,5,1,true]);
        packageReuseComparison.push(result.reportWriteBreakdown);
        if(!writerPreparationCandidate)googlePackageFlow=result;
      }finally{await client.query("rollback to savepoint google_package_reuse_comparison");await client.query("release savepoint google_package_reuse_comparison");}
    }
    const [reused,combinedWriter]=packageReuseComparison;
    assert.equal(googlePackageFlow.sqlInnerTimers,false);
    assert.equal(googlePackageFlow.durationsMs.reportWrite,reused.reportWriteMs);
    assert.equal(klaviyoAuthority.matchedTransport,"authority");
    assert.ok(klaviyoAuthority.authorityChecks>=2*klaviyoAuthority.requests);
    assert.deepEqual(klaviyoAuthority.quotaDebits,{reserved:klaviyoAuthority.requests,settled:klaviyoAuthority.requests});
    const queueToClose=[googlePackageFlow,klaviyoAuthority].map(result=>{
      const {provider,reportRows,reportPackages,requests,receipts,durationsMs,totalMs}=result;
      assert.deepEqual(Object.keys(durationsMs),Object.keys(reference.durationsMs));
      assert.ok(Object.values(durationsMs).every(ms=>Number.isFinite(ms)&&ms>=0));
      assert.ok(Math.abs(Object.values(durationsMs).reduce((a,b)=>a+b,0)-totalMs)<0.01);
      return {provider,reportRows,reportPackages,requests,receipts,durationsMs,totalMs,completed:true};
    });
    console.log("EO05_GOOGLE_PACKAGE_KLAVIYO_AUTHORITY_QUEUE_TO_CLOSE_PASS",JSON.stringify({
      google:queueToClose[0],klaviyo:queueToClose[1],klaviyoAuthorityChecks:klaviyoAuthority.authorityChecks,
      klaviyoQuotaDebits:klaviyoAuthority.quotaDebits,
    }));
    const sharedDiagnostics={};
    for(const provider of ["google","klaviyo"]){
      await client.query("savepoint eo05_four_phase_diagnostics");
      try{
        if(provider==="google")await prepareGoogleTimingLocalRoles(client);
        const options={ownerFixture,fourPhaseDiagnostics:true};
        const measured=provider==="google"
          ?await googleDailyTimingProbe(client,{...options,combinedCandidate:true,reportBreakdown:true,packageReuseCandidate:true})
          :await klaviyoDailyTimingProbe(client,{...options,connection,environment,mode:"retention-boundary",retentionVariant:"cached",
            combinedVerification:true,reduceReportRepeats:true,reportWriteCleanup:true,phaseCandidate:"ordered-json",
            reuseStagedCanonical:true,reuseCanonicalRows:true,endToEnd:true,sharedDaySources:true,matchedTransport:"authority"});
        assert.deepEqual([measured.reportRows,measured.reportPackages,measured.receipts],[1000,5,1]);
        assert.ok(Math.abs(Object.values(measured.durationsMs).reduce((a,b)=>a+b,0)-measured.totalMs)<0.01);
        sharedDiagnostics[provider]={
          durationsMs:measured.durationsMs,totalMs:measured.totalMs,requests:measured.requests,
          ...measured.fourPhaseDiagnostics,
        };
      }finally{await client.query("rollback to savepoint eo05_four_phase_diagnostics");await client.query("release savepoint eo05_four_phase_diagnostics");}
    }
    console.log("EO05_FOUR_PHASE_COMPARISON_PASS",JSON.stringify(sharedDiagnostics));
    if(finalSynthetic){
      await client.query("savepoint shared_shopify_mapping_installation");
      try {
        console.log("EO05_THREE_PROVIDER_REFRESH_START");
        await prepareGoogleTimingLocalRoles(client);
        const installation=await ownerFixture(client,"google_ads");
        const sharedRefresh=createSharedRefreshProbe(client);
        const options={sharedRefresh,ownerFixture:(db,provider)=>provider==="google_ads"
          ?Promise.resolve(installation):ownerFixture(db,provider,installation),singleReportClose:true,finalSynthetic:true,shopifyMapping:true};
        const combined=await sharedRefresh.run({
          google_ads:()=>googleDailyTimingProbe(client,{...options,combinedCandidate:true,reportBreakdown:true,packageReuseCandidate:true}),
          klaviyo:()=>klaviyoDailyTimingProbe(client,{...options,connection,environment,mode:"retention-boundary",retentionVariant:"cached",
            combinedVerification:true,reduceReportRepeats:true,reportWriteCleanup:true,phaseCandidate:"ordered-json",
            reuseStagedCanonical:true,reuseCanonicalRows:true,endToEnd:true,matchedTransport:"authority"}),
          meta:async()=>metaShopifyRefreshProbe(client,await ownerFixture(client,"meta",installation),{sharedRefresh}),
        });
        console.log("EO05_THREE_PROVIDER_REFRESH_PASS",JSON.stringify(combined));
      } finally {
        await client.query("rollback to savepoint shared_shopify_mapping_installation");
        await client.query("release savepoint shared_shopify_mapping_installation");
      }
    } else {
    const singleReportCloseComparison={};
    for(const [i,provider] of ["google","klaviyo"].entries()){
      await client.query("savepoint eo05_single_close_comparison");
      try{
        if(provider==="google")await prepareGoogleTimingLocalRoles(client);
        const options={ownerFixture,singleReportClose:true};
        const candidate=provider==="google"
          ?await googleDailyTimingProbe(client,{...options,combinedCandidate:true,reportBreakdown:true,packageReuseCandidate:true})
          :await klaviyoDailyTimingProbe(client,{...options,connection,environment,mode:"retention-boundary",retentionVariant:"cached",
            combinedVerification:true,reduceReportRepeats:true,reportWriteCleanup:true,phaseCandidate:"ordered-json",
            reuseStagedCanonical:true,reuseCanonicalRows:true,endToEnd:true,
            sharedDaySources:true,matchedTransport:"authority"});
        const {reportRows,reportPackages,requests,receipts,durationsMs,totalMs}=candidate;
        assert.deepEqual([reportRows,reportPackages,requests,receipts],[1000,5,queueToClose[i].requests,1]);
        assert.deepEqual(Object.keys(durationsMs),Object.keys(queueToClose[i].durationsMs));
        assert.ok(Object.values(durationsMs).every(ms=>Number.isFinite(ms)&&ms>=0));
        assert.ok(Math.abs(Object.values(durationsMs).reduce((a,b)=>a+b,0)-totalMs)<0.01);
        singleReportCloseComparison[provider]={control:queueToClose[i],candidate:{reportRows,reportPackages,requests,receipts,durationsMs,totalMs}};
      }finally{
        await client.query("rollback to savepoint eo05_single_close_comparison");
        await client.query("release savepoint eo05_single_close_comparison");
      }
    }
    console.log("EO05_SINGLE_REPORT_CLOSE_COMPARISON_PASS",JSON.stringify(singleReportCloseComparison));
    }
    await client.query("savepoint google_package_reuse_correctness");
    try{
      await installGoogleCombinedCandidate(client);
      await installGoogleWriterPreparationCandidate(client);
      await installGooglePackageReuseCandidate(client);
      const cases=await googleDailyPackagesProbe(client,{ownerFixture,verifyPackageReuse:true,verifyWriterPreparation:true});
      console.log("EO05_GOOGLE_PACKAGE_REUSE_COMPARISON_PASS",JSON.stringify({
        reference:reference.reportWriteBreakdown,reused,cases,
      }));
      console.log("EO05_GOOGLE_COMBINED_WRITER_COMPARISON_PASS",JSON.stringify({reused,combinedWriter,cases}));
    }finally{await client.query("rollback to savepoint google_package_reuse_correctness");await client.query("release savepoint google_package_reuse_correctness");}
    await client.query("savepoint google_combined_trigger_comparison");
    try{
      await prepareGoogleTimingLocalRoles(client);
      const result=await googleDailyTimingProbe(client,{
        ownerFixture,combinedCandidate:true,reportBreakdown:true,
        packageReuseCandidate:true,writerPreparationCandidate:true,publishTrace:true,factTriggerTrace:true,
      });
      assert.deepEqual([result.reportRows,result.reportPackages,result.receipts,result.completed],[1000,5,1,true]);
      console.log("EO05_GOOGLE_COMBINED_TRIGGER_TRACE_PASS",JSON.stringify({
        reference:combinedWriter,result:result.reportWriteBreakdown,write:result.publishTrace,factTrigger:result.factTriggerTrace,
      }));
    }finally{await client.query("rollback to savepoint google_combined_trigger_comparison");await client.query("release savepoint google_combined_trigger_comparison");}
    const deepReport={};
    for(const provider of ["google","klaviyo"]){
      await client.query("savepoint matched_report_comparison");
      try{
        if(provider==="google")await prepareGoogleTimingLocalRoles(client);
        const options={ownerFixture,comparableReport:true};
        const result=provider==="google"
          ?await googleDailyTimingProbe(client,{...options,combinedCandidate:true,reportBreakdown:true})
          :await klaviyoDailyTimingProbe(client,{...options,connection,environment,mode:"retention-boundary",retentionVariant:"cached",
            combinedVerification:true,reduceReportRepeats:true,reportWriteCleanup:true,phaseCandidate:"ordered-json",
            reuseStagedCanonical:true,reuseCanonicalRows:true,endToEnd:true,sharedDaySources:true,matchedTransport:"quota"});
        assert.deepEqual([result.reportRows,result.reportPackages,result.receipts],[1000,5,1]);
        deepReport[provider]=result.reportComparison;
      }finally{
        await client.query("rollback to savepoint matched_report_comparison");
        await client.query("release savepoint matched_report_comparison");
      }
    }
    console.log("EO05_STANDARD_REPORT_COMPARISON_PASS",JSON.stringify(deepReport));
    const verificationComparison=[];
    for(const variant of [{}, {combinedVerification:true}, {combinedVerification:true,reduceReportRepeats:true}]) {
      await client.query("savepoint klaviyo_daily_timing");
      try {
        verificationComparison.push(await klaviyoDailyTimingProbe(client,{
          ownerFixture,connection,environment,mode:"retention-boundary",retentionVariant:"cached",...variant,
        }));
      } finally {
        await client.query("rollback to savepoint klaviyo_daily_timing");
        await client.query("release savepoint klaviyo_daily_timing");
      }
    }
    console.log("EO05_KLAVIYO_FACT_VERIFICATION_COMPARISON_PASS "+JSON.stringify(verificationComparison));
    await sourceDatasetBindingProbe(client, {ownerFixture});
    await reportRetentionProbe(client, {ownerFixture, sourceFixture});
    await fxReportingCurrencyProbe(client, {ownerFixture});
    await datasetServerProbe(client, {ownerFixture});
    await maturityProbe(client, {ownerFixture});
    await reconciliationProbe(client, {ownerFixture});
    console.log("EO05_GOOGLE_DAILY_PACKAGES_PASS",JSON.stringify(await googleDailyPackagesProbe(client,{ownerFixture})));
    console.log("EO06D_META_PACKAGED_CORRECTION_PASS",JSON.stringify(await metaPackagedCorrectionProbe(client,{ownerFixture})));
    await observabilityProbe(client, {ownerFixture});
    for (const provider of ["google_ads", "meta", "klaviyo"]) {
      const owner = await ownerFixture(client, provider), source = await sourceFixture(client, owner);
      const input = datasetStorageFixture({owner, source}); input.rows[0].row.spend_value = "9007199254740993.1234567890123456789";
      // Only this rollback-only probe prints bounded SQL diagnostics. Production
      // repository errors remain opaque and never log a native payload/secret.
      const database = {async query(sql, args) {try {return await client.query(sql, args);} catch (error) {
        console.error("EO05B_DATASET_SQL_FAILURE", JSON.stringify({code: error.code, message: error.message, where: error.where, position: error.position})); throw error;
      }}};
      const repository = createDatasetStorageRepository(database), prepared = prepareDatasetWrite(input), receipt = await repository.commit(prepared);
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
      } else {
        const event = datasetStorageFixture({owner, source, table: "cpd_product_sales_facts"}), row = event.rows[0].row;
        row.provider_event_id = "ordered-product-1"; row.occurred_at = "2026-11-01T12:34:56Z"; row.business_date = null;
        row.source_identity = {kind: "event", namespace: "ordered_product", native: {event_id: row.provider_event_id}};
        row.sales_quantity = "0.125";
        const saved = await repository.commit(prepareDatasetWrite(event));
        assert.equal((await client.query("select business_date from analytics.cpd_product_sales_facts where id=$1", [saved.rows[0].id])).rows[0].business_date, null);
        row.business_date = "2026-11-01";
        await rejected(client, () => repository.commit(prepareDatasetWrite(event)), /WRITE_UNCONFIRMED/);
        assert.equal((await client.query("select count(*)::int n from analytics.cpd_product_sales_facts where installation_id=$1", [owner.installationId])).rows[0].n, 1, "later day resolution must not duplicate an event");
      }
      // A complete primary batch cannot hide a partial contributing batch.
      const secondary = await sourceFixture(client, owner, "partial"), mixed = datasetStorageFixture({owner, source});
      mixed.rows[0].row.entity_id = "mixed-ad"; mixed.rows[0].row.source_identity.native.entity_id = "mixed-ad";
      mixed.rows[0].row.provenance.sources.push(secondary);
      await rejected(client, () => repository.commit(prepareDatasetWrite(mixed)), /WRITE_UNCONFIRMED/);
      mixed.rows[0].row.source_completeness = "partial";
      const mixedReceipt = await repository.commit(prepareDatasetWrite(mixed));
      assert.equal((await client.query("select source_completeness from analytics.pd_facts where id=$1", [mixedReceipt.rows[0].id])).rows[0].source_completeness, "partial");
      await rejected(client, () => client.query("update evidence.source_pages set purged_at=statement_timestamp() where id=$1", [secondary.page_id]), /EVIDENCE_PINNED/);
      // Lost acknowledgement after actual SQL write: explicit inspection recovers it.
      const lost = datasetStorageFixture({owner, source}); lost.rows[0].row.source_identity.native.entity_id = "lost-ad"; lost.rows[0].row.entity_id = "lost-ad";
      const w = prepareDatasetWrite(lost), uncertain = createDatasetStorageRepository({async query(sql, args) {await client.query(sql, args); throw Error("synthetic lost acknowledgement");}});
      await assert.rejects(uncertain.commit(w), /WRITE_UNCONFIRMED/);
      assert.equal((await repository.inspect({owner, sourceBatchId: source.batch_id, operationId: w.body.operationId})).status, "stored");
      const erased = (await client.query("select evidence.delete_installation_sources($1) result", [owner.installationId])).rows[0].result;
      assert.equal(erased["analytics.pd_facts"], 3);
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
    const fxOwner = await ownerFixture(client), fxSource = await sourceFixture(client, fxOwner), converted = datasetStorageFixture({owner: fxOwner, source: fxSource});
    Object.assign(converted.rows[0].row, {target_currency: "EUR", fx_rate_id: rate.id, fx_state: "verified", fx_engine_version: "synthetic-v1"});
    await fxRepo.commit(prepareDatasetWrite(converted));
    converted.rows[0].row.business_date = "2026-11-02";
    await rejected(client, () => fxRepo.commit(prepareDatasetWrite(converted)), /WRITE_UNCONFIRMED/);
    await rejected(client, () => client.query("delete from analytics.fx_rates where id=$1", [rate.id]));
    const foreign = await ownerFixture(client), foreignSource = await sourceFixture(client, foreign);
    await fxRepo.commit(prepareDatasetWrite(datasetStorageFixture({owner: foreign, source: foreignSource})));
    await client.query("select analytics.erase_dataset_batches($1,$2,$3,$4::bigint[])", [fxOwner.workspaceId, fxOwner.installationId, fxOwner.generation, [fxSource.batch_id]]);
    assert.equal((await client.query("select count(*)::int n from analytics.pd_facts where installation_id=$1", [foreign.installationId])).rows[0].n, 1, "scoped erasure must preserve another installation");
    await client.query("update evidence.source_batches set storage_state='invalidated',commit_id=null,committed_at=null where id=$1", [fxSource.batch_id]);
    await rejected(client, () => fxRepo.commit(prepareDatasetWrite(datasetStorageFixture({owner: fxOwner, source: fxSource}))), /WRITE_UNCONFIRMED/);
    for (const role of ["anon", "authenticated", "service_role", "adstable_runtime", "adstable_refresh_coordinator"]) {
      assert.equal((await client.query("select has_function_privilege($1,'analytics.commit_dataset_storage(jsonb,jsonb)','EXECUTE') yes", [role])).rows[0].yes, false);
      for (const table of ["pd_facts", "cpd_product_performance_facts", "cpd_product_sales_facts", "fx_rates"]) assert.equal((await client.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') yes", [role, "analytics." + table])).rows[0].yes, false);
    }
    await client.query("set constraints all immediate");
    console.log("EO05B_DATASET_STORAGE_PASS synthetic_only=true live_mutation=false consumer_receipt=false");
  } finally {await client.query("rollback");}
}
