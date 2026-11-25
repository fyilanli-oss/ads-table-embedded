import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";
import {createConfiguredSourceEvidenceCipher} from "../app/lib/database/source-evidence-config.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {DATASET_RECONCILE_READ_SQL,SCHEDULED_DATASET_FINISH_SQL} from "../app/lib/database/dataset-reconciliation.server.js";
import {META_PACKAGED_REPORT_SQL} from "../app/lib/database/dataset-rpc.server.js";
import {GOOGLE_ACCEPTANCE_COORDINATOR_ROLE_CHECK_SQL,GOOGLE_ACCEPTANCE_COORDINATOR_RPC} from "../app/lib/database/google-acceptance-coordinator-postgres.server.js";
import {createTokenVault} from "../app/lib/oauth/token-vault.server.js";
import {createTokenEnvelopeCipher,readProviderTokenKeyring} from "../app/lib/oauth/token-envelope.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {createAuthorityQuotaEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";
import {loadMetaBackgroundOwner} from "../app/lib/refresh/meta-background-owner.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";
import {createGoogleTimingLedger,prepareGoogleTimingLocalRoles} from "./eo05-google-daily-timing-probe.mjs";
import {metaFirstDayRehearsalEnvironment} from "./eo05-meta-first-day-probe.mjs";
import {seedShopifyMappingTimingFixture} from "./eo05-shopify-mapping-timing-fixture.mjs";
import {loadMappedScheduledRefresh} from "./eo05-single-report-close-probe.mjs";

const sourceRole="adstable_meta_source_runner", datasetRole="adstable_refresh_dataset_runner";
const coordinatorRole="adstable_refresh_coordinator", digest=()=>randomBytes(32).toString("hex");

async function loadMeasuredReader(ledger) {
  const file=new URL("../app/lib/refresh/meta-raw-datasets.server.js",import.meta.url), key=`metaRawTiming:${randomUUID()}`;
  const url=file.href+"?"+key;
  let source=readFileSync(file,"utf8");
  for(const [anchor,active] of [["    const receipt=await storeMetaRawDataset",true],["    await guard();checkPermission();datasets[dataset]=",false]]) {
    assert.equal(source.split(anchor).length,2);
    source=source.replace(anchor,`    globalThis[Symbol.for(${JSON.stringify(key)})](${active});\n${anchor}`);
  }
  const hooks=registerHooks({load(href,context,next){
    return href===url?{format:"module",source,shortCircuit:true}:next(href,context);
  }});
  globalThis[Symbol.for(key)]=active=>ledger.raw(active);
  try {
    const {createMetaRawDatasetReader}=await import(url);
    return {createMetaRawDatasetReader,close(){delete globalThis[Symbol.for(key)];}};
  } catch(error) {
    delete globalThis[Symbol.for(key)];
    throw error;
  } finally {hooks.deregister();}
}

async function seedQuota(client,owner,{provider,apiVersion,organizationId=null,families}) {
  const meta=provider==="meta", accountId=meta?owner.accountId:null;
  const scope={provider,clientScopeKey:digest(),connectionScopeKey:digest(),connectionEpoch:1,accountId,organizationId,apiVersion};
  await client.query(`insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,connection_id,connection_version,
    account_id,client_scope_key,connection_scope_key,connection_epoch,organization_id,api_version,enabled)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,true)`,[owner.workspaceId,owner.generation,provider,owner.installationId,
    meta?owner.connectionId:null,meta?owner.connectionVersion:null,accountId,scope.clientScopeKey,scope.connectionScopeKey,organizationId,apiVersion]);
  const policy=randomUUID();
  await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,$2)",[scope.connectionScopeKey,provider]);
  await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,$2,60000,100,1,5000,1)",[policy,provider]);
  for(const family of families){
    const {routeKey}=quotaRouteIdentity(scope,{provider,family,accountId:family==="token_debug"?null:accountId,organizationId,version:apiVersion,includes:[]});
    await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled,route_required) values($1,$2,true,true)",[routeKey,provider]);
    await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[routeKey,policy]);
    await client.query("insert into operations.api_quota_failure_bindings values($1,$2)",[routeKey,scope.connectionScopeKey]);
    await client.query("insert into operations.api_quota_route_profiles values($1,$2,operations.shared_api_quota_fingerprint($1),true)",[routeKey,scope.connectionScopeKey]);
    await client.query("insert into operations.api_quota_routes values($1,$1,true)",[routeKey]);
  }
  return policy;
}

export async function metaShopifyRefreshProbe(client,owner,{sharedRefresh}={}) {
  await prepareGoogleTimingLocalRoles(client);
  const roleSql=readFileSync(new URL("./sql/eo05-meta-source-role-install.sql",import.meta.url),"utf8");
  await client.query("set local role postgres");
  await client.query(roleSql.trim().replace(/^begin;/,"").replace(/commit;$/, ""));
  await client.query("set local role postgres");
  await client.query(`grant ${sourceRole} to adstable_owner with inherit false,set true,admin false`);
  await client.query("set local role adstable_owner");

  const now=Date.now, issued=now(), day=sharedRefresh?.day??new Date(issued-86400000).toISOString().slice(0,10), window={from:day,to:day};
  const connectedAt=new Date(issued-3*86400000).toISOString();
  const generation=sharedRefresh?.generation??randomUUID(), environment=metaFirstDayRehearsalEnvironment();
  environment.ADSTABLE_REFRESH_DATASET_DATABASE_URL=environment.ADSTABLE_RUNTIME_DATABASE_URL.replace("adstable_runtime",datasetRole);
  environment.ADSTABLE_REFRESH_DATASET_DB_TIMEOUT_MS="30000";
  for(const {v} of (await client.query("select distinct key_version v from integrations.provider_credential_envelopes union select distinct key_version v from integrations.oauth_pkce_envelopes")).rows)
    if(Number(v)!==1)environment[`ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V${v}`]=randomBytes(32).toString("base64url");
  const scopes=oauthPermissionScopes("meta","identity_v1"), expires=issued+3600000;
  const sealed=createTokenEnvelopeCipher({keyring:readProviderTokenKeyring(environment)}).seal({
    identity:{recordId:owner.credentialId,workspaceId:owner.workspaceId,installGeneration:Number(owner.generation),provider:owner.provider,purpose:"provider_token_set"},
    secret:JSON.stringify({access_token:"SYNTHETIC-ACCESS",permission_profile:"identity_v1",scopes,
      scope_verified_at:new Date(issued).toISOString(),expires_at:new Date(expires).toISOString()})});
  await client.query("update integrations.provider_credential_envelopes set payload_ciphertext=$2,nonce=$3,auth_tag=$4,key_version=$5 where id=$1",
    [owner.credentialId,sealed.ciphertext,sealed.nonce,sealed.authTag,sealed.keyVersion]);
  await client.query("update integrations.provider_connections set granted_scopes=$2,connected_at=$3 where id=$1",[owner.connectionId,scopes,connectedAt]);
  await client.query("update integrations.reporting_account_bindings set effective_from=$2 where connection_id=$1",[owner.connectionId,connectedAt]);
  const metaPolicy=await seedQuota(client,owner,{provider:"meta",apiVersion:"v26.0",families:["token_debug","insights","product_insights"]});
  const partnerPolicy=await seedQuota(client,owner,{provider:"shopify_partner",apiVersion:"2026-07",organizationId:"10",families:["partner_graphql"]});
  if(sharedRefresh)sharedRefresh.setPartnerEnvironment(environment);
  const cost={requests:16,dbWrites:8000,connections:6,rows:1000,bytes:4194304};
  if(!sharedRefresh){
  await client.query("update operations.refresh_control set budget=$1,bounds=$2 where singleton",[
    {global:cost,interactiveReserve:{requests:0,dbWrites:0,connections:0,rows:0,bytes:0},providers:[{provider:"meta",limit:cost}],
      workspaces:[{workspaceId:owner.workspaceId,limit:cost}],accounts:[{provider:"meta",accountId:owner.accountId,limit:cost}]},
    {maxWorkspaces:8,maxCandidates:8,maxClaims:1,maxAdmissions:1}]);
  await client.query("update operations.refresh_tick_control set enabled=true,generation=$1,last_minute=null,last_checked_at_ms=null,queue_revision=null where singleton",[generation]);
  await client.query("update operations.refresh_queue_control set max_workspaces=8,max_accounts=8,max_snapshot_bytes=100000,max_snapshot_age_ms=60000 where singleton");
  }

  const cipher=createConfiguredSourceEvidenceCipher(environment), ledger=createGoogleTimingLedger();
  const mapping=await seedShopifyMappingTimingFixture(client,{owner,cipher,window});
  const captureAttempts=new Map(), calls={meta:0,partner:0};
  let serial=0,failure,publicationArgs;
  const query=(sql,args=[],kind)=>ledger.sql(()=>client.query(sql,args),kind);
  const asRole=async(role,sql,args,kind)=>{
    await query(`set local role ${role}`,[],kind);
    try {
      const result=await query(sql,args,kind);
      if(result.rows[0]?.profile_ready===false)failure??=Error(`${role}: profile not ready`);
      return result;
    } catch(error) {
      failure??=error;
      console.error("EO05_META_1000_SQL_STOP",JSON.stringify({phase:ledger.phase,code:error.code??"unknown",
        operation:sql.match(/(?:analytics|evidence|operations|integrations)\.[a-z_]+/)?.[0]??"role_check"}));
      throw error;
    }
  };
  const roleQuery=async(role,sql,args)=>{
    try {return await asRole(role,sql,args);} finally {
      if(!failure)await client.query("set local role adstable_owner");
    }
  };
  const coordinator={async query(sql,args){
    const {rows:[identity]}=await roleQuery(coordinatorRole,GOOGLE_ACCEPTANCE_COORDINATOR_ROLE_CHECK_SQL,
      [GOOGLE_ACCEPTANCE_COORDINATOR_RPC.map(([,signature])=>signature)]);
    assert.equal(identity.profile_ready,true);
    return roleQuery(coordinatorRole,sql,args);
  }};
  let store=createRefreshWorkRepository({query:(sql,args)=>/operations\.(check_refresh_queue_on_tick|review_refresh_interrupted_work)\(/.test(sql)
    ?roleQuery("adstable_refresh_queue_runner",sql,args):coordinator.query(sql,args)});
  const runtime={query:(sql,args)=>roleQuery("adstable_runtime",sql,args)};
  const pool=role=>()=>({on(){},async end(){},async connect(){
    const name=`meta_refresh_rpc_${++serial}`, connected=performance.now(), kind=role===datasetRole?"dataset":null;
    let opened=false,write=false;
    return {release(){if(write&&ledger.phase==="reportWrite")ledger.phaseAt("reportPreparation");},async query(sql,args=[]){
      if(sql==="begin"){opened=true;return query(`savepoint ${name}`,[],kind);}
      if(sql==="commit"){
        await query("set local role adstable_owner",[],kind);
        opened=false;
        return query(`release savepoint ${name}`,[],kind);
      }
      if(sql==="rollback"){
        if(opened){await query(`rollback to savepoint ${name}`,[],kind);await query(`release savepoint ${name}`,[],kind);opened=false;}
        return {rows:[]};
      }
      if(sql.startsWith("select pg_catalog.set_config("))return query(sql,args,kind);
      if(sql===META_PACKAGED_REPORT_SQL){write=true;publicationArgs=args;ledger.phaseAt("reportWrite",connected);}
      if(sql===DATASET_RECONCILE_READ_SQL)ledger.phaseAt("receiptReadback",connected);
      if(sql===SCHEDULED_DATASET_FINISH_SQL)ledger.phaseAt("jobClose",connected);
      const result=await asRole(role,sql,args,kind);
      if(sql.startsWith("select evidence.commit_meta_dataset_source("))captureAttempts.set(result.rows[0].result.batchId,{attemptId:args[1],ordinal:args[2]});
      return result;
    }};
  }});

  const verified=await loadMetaBackgroundOwner({database:runtime,owner:{workspaceId:owner.workspaceId,installGeneration:Number(owner.generation),shopId:owner.shopId,shopDomain:owner.shopDomain}});
  const tokenVault=createTokenVault({database:runtime,environment});
  if(sharedRefresh)store=await sharedRefresh.beforeWork({owner,cost,store});
  const limits={deadlineAt:now()+115000,requestTimeoutMs:80000,finishReserveMs:2000,maxRows:1000,maxBytes:cost.bytes};
  const entitlementVerifier=createAuthorityQuotaEntitlementVerifier({store,quotaStore:createSharedQuotaRepository(coordinator),
    appId:environment.SHOPIFY_APP_GID,environment,now,limits,async fetchFn(endpoint){
      assert.equal(new URL(endpoint).hostname,"partners.shopify.com");
      calls.partner++;
      return Response.json({data:{activeSubscription:{shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},billingPeriod:"EVERY_30_DAYS",
        cancelAtEndOfCycle:false,trialEndsAt:null,currentBillingCycle:{startTime:new Date(issued-86400000).toISOString(),endTime:new Date(issued+86400000).toISOString()},
        items:[{handle:"monthly",price:{active:true}}],pendingUpdate:null}}});
    }});
  const runScheduled=await loadMappedScheduledRefresh(), observer=await loadMeasuredReader(ledger), batches=[];
  let result;
  try{
    ledger.start();
    if(!sharedRefresh)await store.checkQueueFromAuthority({expectedRevision:(await store.readQueueCheck()).revision});
    ledger.phaseAt("queueAndAdmission");
    result=await runScheduled({store,generation,environment,poolFactory:pool(datasetRole),work:{now,entitlementVerifier,
      buildWorkPlan:async candidate=>candidate.workspaceId===owner.workspaceId&&candidate.provider==="meta"
        ?{window,partitionId:`synthetic-meta-daily:${day}`,workClass:"deep_reconciliation",cost,limits}:null,
      async readPage({claim,entitlementReceipt,signal}){
        ledger.phaseAt("providerCollection");
        const reader=observer.createMetaRawDatasetReader({environment,verified,tokenVault,execution:{claim,window,entitlementReceipt},signal,now,
          configuration:{operationId:randomUUID(),limits:{maxElapsedMs:70000,maxBytes:1048576,maxRequests:12,maxPages:10,maxRows:1000},
            storageLimits:{maxRows:1000,maxBytes:1048576},sourcePolicy:sourceStoreFixture().input.policy},poolFactory:pool(sourceRole),
          async fetchFn(endpoint){
            const url=new URL(endpoint);
            assert.equal(url.hostname,"graph.facebook.com");
            calls.meta++;
            if(url.pathname.endsWith("debug_token"))return Response.json({data:{is_valid:true,app_id:"123",scopes,
              expires_at:Math.floor(expires/1000),data_access_expires_at:Math.floor(expires/1000)}});
            assert.ok(url.pathname.endsWith(`/${owner.accountId}/insights`));
            const base={account_id:owner.accountId.slice(4),campaign_id:"11",adset_id:"12",
              date_start:day,date_stop:day,spend:"1.23",impressions:"42",clicks:"2"};
            if(url.searchParams.get("breakdowns")!=="product_id")return Response.json({data:Array.from({length:20},(_,ad)=>({...base,ad_id:String(100+ad)}))});
            const page=calls.meta-3;
            assert.ok(page>=0&&page<10);
            assert.equal(url.searchParams.get("after"),page===0?null:`page-${page}`);
            const data=Array.from({length:98},(_,i)=>({...base,ad_id:String(100+page),
              product_id:page===0&&i===0?mapping.nativeId:page===0&&i===1?"901":String(20000+page*98+i)}));
            return Response.json({data,...page<9?{paging:{next:"https://graph.facebook.com/unused",cursors:{after:`page-${page+1}`}}}:{}});
          }});
        try {
          const capture=await reader.run();
          assert.equal(capture.status,"stored",JSON.stringify(capture));
          assert.equal(capture.contentVerified,true);
          assert.equal(capture.recordCount,1000);
          for(const dataset of Object.values(capture.datasets)){
            assert.equal(dataset.eligibility?.includesPreConnectionHours,false);
            const attempt=captureAttempts.get(dataset.batchId);
            assert.ok(attempt);
            batches.push(attempt);
          }
        } catch(error) {failure??=error;throw error;} finally {await reader.close();}
        ledger.phaseAt("handoff");
        return {kind:"complete",payload:{batchCount:batches.length}};
      },
      validatePage:({payload})=>({complete:payload.batchCount===2,rows:[]}),
      async loadDatasetInputs(){
        ledger.phaseAt("reportPreparation");
        await client.query("savepoint meta_daily_before_publication");
        return {owner,batches,cipher,expectedRevision:0,bindSyntheticMappings:mapping.bindSyntheticMappings};
      },
    }});
  } finally {observer.close();}
  const measured=ledger.stop();
  if(failure)throw failure;
  if(sharedRefresh)await sharedRefresh.afterClose(owner,result);
  assert.equal(result.work?.status,"completed",JSON.stringify({result,calls}));
  assert.equal(result.work.dataset.consumerReceipt,true);
  assert.equal(result.work.dataset.checkpointAdvanced,true);
  assert.equal(measured.rawDatasets,2);
  assert.deepEqual(calls,{meta:12,partner:1});
  const debitCounts=[];
  for(const [policy,expected] of [[metaPolicy,12],[partnerPolicy,sharedRefresh?3:1]]){
    const {rows:[count]}=await client.query("select count(*)::int reserved,count(*) filter(where settled)::int settled from operations.api_quota_debits where policy_id=$1",[policy]);
    assert.deepEqual(count,{reserved:expected,settled:expected});
    debitCounts.push(count);
  }
  const {rows:[facts]}=await client.query(`select
    (select count(*)::int from analytics.pd_facts where installation_id=$1 and platform='meta') account,
    (select count(*)::int from analytics.cpd_product_performance_facts where installation_id=$1 and platform='meta') performance,
    (select count(*)::int from analytics.cpd_product_sales_facts where installation_id=$1 and platform='meta') sales,
    (select count(*)::int from analytics.cpd_product_performance_facts where installation_id=$1 and product_mapping_id=$2) mapped,
    (select count(*)::int from analytics.cpd_product_performance_facts where installation_id=$1 and native_product_id='901' and product_mapping_id is null) unmapped,
    (select shopify_product_id from identity.product_identity_mappings where installation_id=$1 and id=$2) product`,[owner.installationId,mapping.mappingId]);
  assert.deepEqual(facts,{account:20,performance:980,sales:0,mapped:1,unmapped:1,product:mapping.productId});
  assert.equal(mapping.summary().reads,1);
  const {rows:receipts}=await client.query("select manifest->'datasetReconciliation' receipt from evidence.source_batches where authority=$1::jsonb and manifest ? 'datasetReconciliation'",[owner]);
  assert.equal(receipts.length,1);
  assert.equal(receipts[0].receipt.rowCount,1000);
  const packageSizes=receipts[0].receipt.packages.map(p=>p.rowCount);
  assert.deepEqual(packageSizes,[200,200,200,200,200]);
  assert.equal((await client.query("select status from operations.refresh_runs where workspace_id=$1 and job_id=$2",[owner.workspaceId,result.work.claim.id])).rows[0].status,"completed");
  console.log("EO05_META_1000_CLOSE_VERIFIED",JSON.stringify({totalMs:measured.totalMs,rows:receipts[0].receipt.rowCount,packageSizes}));
  const {rows:[retention]}=await client.query(`with floor as materialized (select analytics.report_retention_until($2::date,'UTC') target)
    select count(*)::int reference_count,
    count(*) filter(where b.retain_until>=e.target and p.retain_until>=e.target and r.retain_until>=e.target)::int retained
    from evidence.source_batches b join evidence.source_pages p on p.batch_id=b.id
    join evidence.source_references r on r.page_id=p.id
    cross join floor e
    where b.authority=$1::jsonb and b.handoff_state='consumed'`,[owner,day]);
  assert.deepEqual(retention,{reference_count:1000,retained:1000});

  // Separate negative controls after the measured successful close. Return to
  // the same real, admitted job and authenticated source for each rejection.
  await client.query("rollback to savepoint meta_daily_before_publication");
  const [ownerJson,packagesJson,context]=publicationArgs;
  const packages=JSON.parse(packagesJson), incomplete=structuredClone(packages);
  incomplete[4].rows.pop();
  for(const [invalid,reason] of [[packages.slice(0,4),/META_REPORT_PACKAGE_COUNT/],[incomplete,/META_REPORT_PACKAGE_INVALID/]]){
    await client.query("savepoint meta_daily_negative");
    try {
      await client.query(`set local role ${datasetRole}`);
      await assert.rejects(client.query(META_PACKAGED_REPORT_SQL,[ownerJson,JSON.stringify(invalid),context,...publicationArgs.slice(3)]),reason);
    } finally {
      await client.query("rollback to savepoint meta_daily_negative");
      await client.query("release savepoint meta_daily_negative");
    }
    const {rows:[after]}=await client.query(`select
      (select count(*)::int from analytics.pd_facts where installation_id=$1 and platform='meta') account,
      (select count(*)::int from analytics.cpd_product_performance_facts where installation_id=$1 and platform='meta') performance,
      (select count(*)::int from evidence.source_batches where authority=$2::jsonb and handoff_state='consumed') consumed,
      (select status from operations.refresh_runs where workspace_id=$3 and job_id=$4) status`,[owner.installationId,ownerJson,owner.workspaceId,result.work.claim.id]);
    assert.deepEqual(after,{account:0,performance:0,consumed:0,status:"running"});
  }
  await client.query("release savepoint meta_daily_before_publication");
  return {...measured,facts,calls,mapping:mapping.summary(),receipts:receipts.length,packageSizes,retention,incompletePackRejected:true,
    quotaDebits:debitCounts[0],partnerQuotaDebits:debitCounts[1]};
}
