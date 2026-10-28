import assert from "node:assert/strict";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {createRefreshEntitlementVerifier,createAuthorityQuotaEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {randomUUID,createHash} from "node:crypto";
import {dispatchRefreshPreflight} from "../app/lib/refresh/preflight-bridge.server.js";
import {runScheduledRefreshCheck} from "../app/lib/refresh/scheduled-queue-check.server.js";
import {planRefreshPreflightAdmissions} from "../app/lib/refresh/admission-policy.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {quotaAuthorityProbe} from "./eo05-quota-authority-probe.mjs";
import {refreshInterruptedWorkProbe} from "./eo05-refresh-interrupted-work-probe.mjs";
import {refreshQueueCronEntryProbe} from "./eo05-refresh-queue-cron-entry-probe.mjs";

// Runs within the canonical synthetic fixture. All changes roll back, including billing/queue/claims.
export async function refreshPreflightProbe(client,{workspace,connections,shopId,shopDomain}) {
  await client.query("begin");
  try {
    const initial=new Date(Date.now()-3*86400000).toISOString();
    await client.query("update integrations.provider_connections set connected_at=$1 where workspace_id=$2",[initial,workspace]);
    await client.query("update integrations.reporting_account_bindings set effective_from=$1 where workspace_id=$2 and effective_to is null",[initial,workspace]);
    const store=createRefreshWorkRepository(client);
    await store.checkQueueFromAuthority({expectedRevision:(await store.readQueueCheck()).revision});
    const vector={requests:20,dbWrites:20,connections:10,rows:100,bytes:10000};
    const accounts=[{provider:"meta",accountId:"act_101"},{provider:"google_ads",accountId:"111"},{provider:"klaviyo",accountId:"klaviyo-a"}];
    const budget={global:vector,interactiveReserve:{requests:0,dbWrites:0,connections:0,rows:0,bytes:0},providers:accounts.map(a=>({provider:a.provider,limit:vector})),
      workspaces:[{workspaceId:workspace,limit:vector}],accounts:accounts.map(a=>({...a,limit:vector}))};
    await client.query("update operations.refresh_control set budget=$1::jsonb,bounds=$2::jsonb where singleton",[JSON.stringify(budget),JSON.stringify({maxCandidates:8,maxClaims:8,maxAdmissions:8,maxWorkspaces:8})]);
    await refreshQueueCronEntryProbe(client);
    const day=new Date(Date.now()-86400000).toISOString().slice(0,10),window={from:day,to:day};
    const plan=()=>({partitionId:"synthetic-one-page",workClass:"hourly_hot_window",window,
      cost:{requests:2,dbWrites:5,connections:1,rows:5,bytes:1000},limits:{deadlineAt:Date.now()+30000,requestTimeoutMs:1000,finishReserveMs:10,maxRows:5,maxBytes:1000}});
    let billingCalls=0,adCalls=0;
    const payload={data:{activeSubscription:{shop:{id:shopId,myshopifyDomain:shopDomain},billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:false,
      trialEndsAt:null,currentBillingCycle:{startTime:initial,endTime:new Date(Date.now()+10*86400000).toISOString()},items:[{handle:"monthly",price:{active:true}}],pendingUpdate:null}}};
    const verifier=createRefreshEntitlementVerifier({store,appId:"gid://shopify/App/456",now:Date.now,
      limits:{deadlineAt:Date.now()+30000,requestTimeoutMs:1000,finishReserveMs:10},authorizeRead:async()=>true,
      partnerApi:{appId:"gid://shopify/App/456",activeSubscription:async()=>{billingCalls++;return payload;}}});
    const args={store,buildWorkPlan:async s=>s.provider==="google_ads"?plan():null,entitlementVerifier:verifier,now:Date.now,
      readPage:async()=>{adCalls++;return {kind:"complete",payload:{}};},validatePage:()=>({complete:true,rows:[{product:"synthetic-bracelet"}]})};
    assert.equal((await client.query("select count(*)::int n from billing.workspace_entitlements where workspace_id=$1",[workspace])).rows[0].n,0);
    // Wrong source/window and lost queue revision cannot reserve anything, and do not consume a turn.
    const snapshot=await store.readPreflightSnapshot(),source=snapshot.candidates.find(s=>s.provider==="google_ads");
    const candidate={...source,id:"manual-probe",workClass:"hourly_hot_window",cost:plan().cost,
      authority:{installationVerified:true,connected:true,setupComplete:true,allowedWindow:true}};
    const proposal=planRefreshPreflightAdmissions({...snapshot,candidates:[candidate],now:Date.now()});
    const commit={expectedRevision:snapshot.state.revision,queueRevision:snapshot.queueRevision,nextState:proposal.nextState,source,window,partitionId:"synthetic",deadlineAt:plan().limits.deadlineAt};
    assert.equal(await store.commitPreflight({...commit,source:{...source,selectionId:"999999"}}),false);
    assert.equal(await store.commitPreflight({...commit,queueRevision:snapshot.queueRevision+1}),false);
    assert.equal(await store.commitPreflight({...commit,window:{from:"2000-01-01",to:day}}),false,"cannot backfill before current connection period");
    assert.equal((await store.readAdmissionSnapshot()).state.revision,snapshot.state.revision);
    // Real SQL quota -> existing Partner HTTP -> private wait -> durable pause -> NEW fence.
    // Policy, token and HTTP response are synthetic; transaction rollback removes all fixture changes.
    const policy=randomUUID(),hash=v=>createHash("sha256").update(v).digest("hex");
    const scope={provider:"shopify_partner",clientScopeKey:hash(randomUUID()),connectionScopeKey:hash(randomUUID()),connectionEpoch:1,accountId:null,organizationId:"123",apiVersion:"2026-07"};
    const operation=quotaRouteIdentity(scope,{provider:"shopify_partner",family:"partner_graphql",accountId:null,organizationId:"123",version:"2026-07",includes:[]}).routeKey;
    const installation=(await client.query("select id from shopify.installations where workspace_id=$1 and install_generation=1",[workspace])).rows[0].id;
    await client.query("insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,client_scope_key,connection_scope_key,connection_epoch,organization_id,api_version,enabled) values($1,1,'shopify_partner',$2,$3,$4,1,'123','2026-07',true)",[workspace,installation,scope.clientScopeKey,scope.connectionScopeKey]);
    await client.query("insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,connection_id,connection_version,account_id,client_scope_key,connection_scope_key,connection_epoch,api_version,enabled) values($1,1,'google_ads',$2,$3,1,'111',$4,$5,1,'v24',true)",[workspace,installation,connections.google_ads,hash(randomUUID()),hash(randomUUID())]);
    await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'shopify_partner',60000,1,1,1000,8)",[policy]);
    await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled,route_required) values($1,'shopify_partner',true,true)",[operation]);
    await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[operation,policy]);
    await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,'shopify_partner')",[scope.connectionScopeKey]);
    await client.query("insert into operations.api_quota_failure_bindings values($1,$2)",[operation,scope.connectionScopeKey]);
    await client.query("insert into operations.api_quota_route_profiles select $1,$2,operations.shared_api_quota_fingerprint($1),true",[operation,scope.connectionScopeKey]);
    await client.query("insert into operations.api_quota_routes values($1,$1,true)",[operation]);
    const quotaStore=createSharedQuotaRepository(client);
    const environment={SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"SYNTHETIC-ONLY"};
    let authorityExecution=null;
    args.readPage=async execution=>{
      if(authorityExecution===null)authorityExecution=structuredClone({claim:execution.claim,window:execution.window,entitlementReceipt:execution.entitlementReceipt});
      adCalls++;return {kind:"complete",payload:{}};
    };
    const managedVerifier=()=>createAuthorityQuotaEntitlementVerifier({store,quotaStore,appId:"gid://shopify/App/456",now:Date.now,
      limits:plan().limits,environment,
      fetchFn:async()=>{billingCalls++;return new Response(JSON.stringify(payload),{headers:{"content-type":"application/json"}});}});
    args.entitlementVerifier=managedVerifier();
    const tickGeneration=randomUUID();
    await client.query("update operations.refresh_tick_control set enabled=true,generation=$1 where singleton",[tickGeneration]);
    const firstTick=await runScheduledRefreshCheck({store,generation:tickGeneration,work:args});
    assert.equal(firstTick.status,"queue_checked");
    const firstWait=firstTick.work;
    assert.equal(firstWait.status,"quota_waiting");assert.equal(billingCalls,0);assert.equal(adCalls,0);
    assert.equal((await store.readAdmissionSnapshot()).state.claims.length,0,"known not-sent wait releases worker capacity");
    assert.equal(await store.isClaimCurrent({claim:firstWait.claim}),false);
    const persistedWait=(await client.query("select * from operations.refresh_quota_waits where fence=$1",[firstWait.claim.fence])).rows[0];
    assert.equal(persistedWait.state,"waiting");assert.equal(persistedWait.boundary,"entitlement");
    assert.equal((await store.readQueueCheck()).accounts.find(a=>a.provider==="google_ads").firstQueuedAtMs,source.queuedAt);
    assert.equal(await store.advanceStage({claim:firstWait.claim,window,expectedStage:"request_intent",stage:"response_received"}),false);
    assert.equal(await store.finishClaim({claim:firstWait.claim,outcome:"completed"}),false);
    assert.equal((await client.query("select operations.defer_refresh_quota_wait($1,1,'google_ads','111',$2,$3,$4,$4,'entitlement') result",[workspace,firstWait.claim.id,firstWait.claim.fence,day])).rows[0].result,false);
    // A fresh wakeup may check quota again, but still cannot send while reserve is full.
    args.entitlementVerifier=managedVerifier();
    const repeatedWait=await dispatchRefreshPreflight(args);
    assert.equal(repeatedWait.status,"quota_waiting");assert.equal(repeatedWait.claim.id,firstWait.claim.id);
    assert.ok(repeatedWait.claim.fence>firstWait.claim.fence);assert.equal(billingCalls,0);assert.equal(adCalls,0);
    // Reject period/source widening even if a paused quota job exists.
    const waitingSnapshot=await store.readPreflightSnapshot();
    const resuming=planRefreshPreflightAdmissions({...waitingSnapshot,candidates:[{...candidate,id:firstWait.claim.id}],now:Date.now()});
    assert.equal(await store.commitPreflight({expectedRevision:waitingSnapshot.state.revision,queueRevision:waitingSnapshot.queueRevision,
      nextState:resuming.nextState,source:waitingSnapshot.candidates.find(s=>s.provider==="google_ads"),window,partitionId:"different-partition",deadlineAt:plan().limits.deadlineAt}),false);
    await client.query("update operations.api_quota_policies set interactive_reserve=0 where id=$1",[policy]);
    await client.query("update operations.api_quota_route_profiles set quota_fingerprint=operations.shared_api_quota_fingerprint(operation_key) where operation_key=$1",[operation]);
    args.entitlementVerifier=managedVerifier();
    // Only the owner fixture ages the receipt; production has no caller-supplied clock/minute.
    await client.query("update operations.refresh_tick_control set last_minute=last_minute-1 where singleton");
    const workerTick=await runScheduledRefreshCheck({store,generation:tickGeneration,work:args});
    assert.equal(workerTick.status,"queue_checked");
    const result=workerTick.work;
    assert.equal(result.status,"awaiting_dataset");assert.equal(billingCalls,1);assert.equal(adCalls,1);
    // SQL authority matrix is not native page latency. Use the same real claim and
    // billing receipt after the worker handoff, with a rollback-only stage fixture.
    // Keep the original one-second read timeout and handoff outcome unchanged.
    await client.query("savepoint quota_authority_stage");
    try{
      await client.query("update operations.refresh_work_progress set stage='request_intent',rows_observed=0,bytes_observed=0 where workspace_id=$1 and provider=$2 and account_id=$3 and job_id=$4 and fence=$5",
        [workspace,authorityExecution.claim.provider,authorityExecution.claim.accountId,authorityExecution.claim.id,authorityExecution.claim.fence]);
      await quotaAuthorityProbe(client,{store,quotaStore,execution:authorityExecution,connection:connections.google_ads,environment,payload});
    }finally{await client.query("rollback to savepoint quota_authority_stage");await client.query("release savepoint quota_authority_stage");}
    assert.equal((await client.query("select stage from operations.refresh_work_progress where workspace_id=$1 and provider=$2 and account_id=$3 and job_id=$4 and fence=$5",
      [workspace,result.claim.provider,result.claim.accountId,result.claim.id,result.claim.fence])).rows[0].stage,"ready_for_dataset");
    console.log("EO05_SCHEDULED_PREFLIGHT_PASS database_queue_to_fenced_worker=true fresh_billing=true quota_wait_no_HTTP=true synthetic_page=true dataset_write=false native_calls=0");
    assert.equal(result.claim.id,firstWait.claim.id);assert.ok(result.claim.fence>repeatedWait.claim.fence);
    assert.equal((await client.query("select count(*)::int n from operations.api_quota_debits where policy_id=$1",[policy])).rows[0].n,1,"no old authorizeRead double debit");
    assert.equal((await client.query("select count(*)::int n from operations.refresh_quota_waits where job_id=$1 and state='waiting'",[result.claim.id])).rows[0].n,0);
    assert.equal(await store.isClaimCurrent({claim:repeatedWait.claim}),false);
    assert.equal(await store.advanceStage({claim:repeatedWait.claim,window,expectedStage:"request_intent",stage:"response_received"}),false);
    assert.equal(await store.finishClaim({claim:repeatedWait.claim,outcome:"completed"}),false);
    args.entitlementVerifier=verifier;
    assert.equal(await store.isClaimCurrent({claim:result.claim}),true);
    await refreshInterruptedWorkProbe(client,{store,claim:result.claim,window});
    assert.equal(await store.isClaimCurrent({claim:{...result.claim,fence:result.claim.fence+1}}),false);
    assert.equal(await store.loadBoundAuthority({claim:result.claim,window:{from:"2000-01-01",to:day}}),null);
    assert.equal(await store.advanceStage({claim:result.claim,window:{from:"2000-01-01",to:day},expectedStage:null,stage:"checking_authority"}),false);
    assert.equal((await dispatchRefreshPreflight(args)).status,"waiting","running account is not admitted twice");assert.equal(adCalls,1);
    await client.query("select * from integrations.select_reporting_account($1,$2,1,'google_ads','222',clock_timestamp())",[connections.google_ads,workspace]);
    await client.query("select * from integrations.select_reporting_account($1,$2,1,'google_ads','111',clock_timestamp())",[connections.google_ads,workspace]);
    assert.equal(await store.isClaimCurrent({claim:result.claim}),false,"same account and OAuth version cannot revive old selection epoch");
    assert.equal(await store.loadBoundAuthority({claim:result.claim,window}),null);
    // An old negative cache still permits a fresh check for the next account; a fresh denial blocks data.
    payload.data.activeSubscription=null;
    args.buildWorkPlan=async s=>s.provider==="meta"?plan():null;
    const denied=await dispatchRefreshPreflight(args);assert.equal(denied.reason,"entitlement_required");assert.equal(adCalls,1);
    assert.equal((await client.query("select entitlement_status from billing.workspace_entitlements where workspace_id=$1",[workspace])).rows[0].entitlement_status,"subscription_required");
    args.buildWorkPlan=async s=>s.provider==="klaviyo"?plan():null;
    payload.data.activeSubscription={shop:{id:shopId,myshopifyDomain:shopDomain},billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:false,
      trialEndsAt:null,currentBillingCycle:{startTime:initial,endTime:new Date(Date.now()+10*86400000).toISOString()},items:[{handle:"monthly",price:{active:true}}],pendingUpdate:null};
    const recovered=await dispatchRefreshPreflight(args);assert.equal(recovered.status,"awaiting_dataset","cached denial does not require merchant UI");assert.equal(adCalls,2);
    await client.query("update integrations.provider_connections set lifecycle_status='reauthorization_required' where id=$1",[connections.klaviyo]);
    assert.equal(await store.isClaimCurrent({claim:recovered.claim}),false);
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
      assert.equal((await client.query("select has_table_privilege($1,'operations.refresh_work_bindings','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
      assert.equal((await client.query("select has_table_privilege($1,'operations.refresh_quota_waits','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
    assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator','operations.commit_refresh_admissions(bigint,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
    for(const role of ["anon","authenticated","service_role","adstable_runtime"])
      for(const fn of ["read_refresh_preflight_snapshot()","commit_refresh_preflight(bigint,bigint,jsonb,jsonb,jsonb,text)","load_refresh_bound_authority(uuid,bigint,text,text,text,bigint,date,date)","defer_refresh_quota_wait(uuid,bigint,text,text,text,bigint,date,date,text)"])
        assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,`operations.${fn}`])).rows[0].allowed,false);
    console.log("EO05_PREFLIGHT_BRIDGE_PASS native_queue_to_fenced_worker=true missing_and_negative_cache_fresh_check=true fresh_denial_blocks_data=true selection_away_back_invalidates=true connection_change_invalidates=true explicit_period_required=true no_Dataset_commit=true actual_provider_calls=0 live_changes=false");
    console.log("EO05_QUOTA_WORK_WAIT_PASS first_boundary_only=true durable_wait=true fresh_fence=true stale_worker_denied=true same_source_period=true queue_age_preserved=true no_double_debit=true real_SQL=true synthetic_HTTP_only=true actual_provider_calls=0");
  } finally {await client.query("rollback");}
}
