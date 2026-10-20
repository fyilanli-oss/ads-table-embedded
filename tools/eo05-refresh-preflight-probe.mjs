import assert from "node:assert/strict";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {createRefreshEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";
import {dispatchRefreshPreflight} from "../app/lib/refresh/preflight-bridge.server.js";
import {planRefreshPreflightAdmissions} from "../app/lib/refresh/admission-policy.server.js";

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
    const commit={expectedRevision:snapshot.state.revision,queueRevision:snapshot.queueRevision,nextState:proposal.nextState,source,window,partitionId:"synthetic"};
    assert.equal(await store.commitPreflight({...commit,source:{...source,selectionId:"999999"}}),false);
    assert.equal(await store.commitPreflight({...commit,queueRevision:snapshot.queueRevision+1}),false);
    assert.equal(await store.commitPreflight({...commit,window:{from:"2000-01-01",to:day}}),false,"cannot backfill before current connection period");
    assert.equal((await store.readAdmissionSnapshot()).state.revision,snapshot.state.revision);
    const result=await dispatchRefreshPreflight(args);
    assert.equal(result.status,"awaiting_dataset");assert.equal(billingCalls,1);assert.equal(adCalls,1);
    assert.equal(await store.isClaimCurrent({claim:result.claim}),true);
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
    assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator','operations.commit_refresh_admissions(bigint,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
    for(const role of ["anon","authenticated","service_role","adstable_runtime"])
      for(const fn of ["read_refresh_preflight_snapshot()","commit_refresh_preflight(bigint,bigint,jsonb,jsonb,jsonb,text)","load_refresh_bound_authority(uuid,bigint,text,text,text,bigint,date,date)"])
        assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,`operations.${fn}`])).rows[0].allowed,false);
    console.log("EO05_PREFLIGHT_BRIDGE_PASS native_queue_to_fenced_worker=true missing_and_negative_cache_fresh_check=true fresh_denial_blocks_data=true selection_away_back_invalidates=true connection_change_invalidates=true explicit_period_required=true no_Dataset_commit=true actual_provider_calls=0 live_changes=false");
  } finally {await client.query("rollback");}
}
