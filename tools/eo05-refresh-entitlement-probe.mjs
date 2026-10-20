import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {planRefreshAdmissions} from "../app/lib/refresh/admission-policy.server.js";
import {createRefreshEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";

export async function refreshEntitlementProbe(client,connection,environment=process.env) {
  assert.equal(environment.GITHUB_ACTIONS,"true");assert.ok(environment.RUNNER_TEMP);
  assert.equal(connection.host,"127.0.0.1");assert.equal(connection.port,54322);
  const workspace=randomUUID(),shopId="gid://shopify/Shop/99999996",shopDomain="billing-worker-synthetic.myshopify.com";
  const vector=n=>({requests:n,dbWrites:n,connections:n,rows:100,bytes:10000});
  try {
    await client.query("set role adstable_owner");
    await client.query("insert into app.workspaces(id) values($1)",[workspace]);
    await client.query("insert into shopify.installations(shop_id,shop_domain,workspace_id) values($1,$2,$3)",[shopId,shopDomain,workspace]);
    const budget={global:vector(1),interactiveReserve:{requests:0,dbWrites:0,connections:0,rows:0,bytes:0},providers:[{provider:"klaviyo",limit:vector(1)}],
      workspaces:[{workspaceId:workspace,limit:vector(1)}],accounts:[{provider:"klaviyo",accountId:"a",limit:vector(1)}]};
    const bounds={maxCandidates:4,maxClaims:4,maxAdmissions:4,maxWorkspaces:4};
    await client.query("update operations.refresh_control set budget=$1::jsonb,bounds=$2::jsonb where singleton",[JSON.stringify(budget),JSON.stringify(bounds)]);
    const store=createRefreshWorkRepository(client),state=await store.readAdmissionSnapshot();
    const job={id:"billing-check",workspaceId:workspace,installGeneration:"1",provider:"klaviyo",accountId:"a",queuedAt:0,scheduledHour:0,
      workClass:"hourly_hot_window",cost:{requests:1,dbWrites:1,connections:1,rows:5,bytes:1000},
      authority:{installationVerified:true,entitled:true,connected:true,setupComplete:true,allowedWindow:true}};
    const proposal=planRefreshAdmissions({...state,candidates:[job],now:3600000});
    assert.equal(await store.compareAndSwap({expectedRevision:state.state.revision,nextState:proposal.nextState}),true);
    const claim=proposal.admitted[0];let calls=0;
    const day=86400000;
    const payload={data:{activeSubscription:{shop:{id:shopId,myshopifyDomain:shopDomain},billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:true,
      trialEndsAt:null,currentBillingCycle:{startTime:new Date(Date.now()-day).toISOString(),endTime:new Date(Date.now()+10*day).toISOString()},
      items:[{handle:"monthly",price:{active:false}}],pendingUpdate:null}}};
    const verifier=createRefreshEntitlementVerifier({store,appId:"gid://shopify/App/456",now:Date.now,
      limits:{requestTimeoutMs:1000,finishReserveMs:10,deadlineAt:Date.now()+30000},authorizeRead:async()=>true,
      partnerApi:{appId:"gid://shopify/App/456",activeSubscription:async()=>{calls++;return payload;}}});
    const verified=await verifier.verify({claim});assert.equal(verified.status,"verified");assert.equal(calls,1);
    await assert.rejects(store.applyEntitlementSnapshot({claim:{...claim,fence:claim.fence+1},snapshot:{}}));
    assert.equal(await store.loadRefreshInstallation({claim:{...claim,installGeneration:"2"}}),null);
    assert.equal(await verifier.isCurrent({claim,receipt:verified.receipt}),true);
    assert.equal(await verifier.isCurrent({claim:{...claim,fence:claim.fence+1},receipt:verified.receipt}),false);
    const saved=JSON.stringify((await client.query("select source_hash,entitlement_status from billing.workspace_entitlements where workspace_id=$1",[workspace])).rows);
    payload.data.activeSubscription.currentBillingCycle.endTime=new Date(Date.now()-1000).toISOString();
    assert.equal((await verifier.verify({claim})).status,"unavailable","already ended billing cycle cannot authorize work");
    assert.equal(JSON.stringify((await client.query("select source_hash,entitlement_status from billing.workspace_entitlements where workspace_id=$1",[workspace])).rows),saved);
    payload.data.activeSubscription=null;
    assert.equal((await verifier.verify({claim})).status,"denied");
    assert.equal(await verifier.isCurrent({claim,receipt:verified.receipt}),false,"new denial invalidates previous active receipt");
    assert.equal((await client.query("select entitlement_status from billing.workspace_entitlements where workspace_id=$1",[workspace])).rows[0].entitlement_status,"subscription_required");
    const before=calls;assert.equal(await store.finishClaim({claim,outcome:"paused"}),true);
    assert.equal((await verifier.verify({claim})).status,"not_current");assert.equal(calls,before,"stale owner cannot query Shopify");
    for(const role of ["anon","authenticated","service_role","adstable_runtime"])
      for(const fn of ["operations.load_refresh_entitlement_installation(uuid,bigint,text,text,text,bigint)",
        "operations.refresh_entitlement_is_current(uuid,bigint,text,text,text,bigint,timestamptz)",
        "operations.apply_refresh_entitlement_snapshot(uuid,bigint,text,text,text,bigint,jsonb)"])
        assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,fn])).rows[0].allowed,false);
    assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator','billing.apply_shopify_app_pricing_snapshot(text,text,bigint,boolean,text,text,boolean,timestamptz,timestamptz,timestamptz,text[],text[],timestamptz,text)','EXECUTE') as allowed")).rows[0].allowed,false);
    console.log("EO05_REFRESH_ENTITLEMENT_PASS fresh_Shopify_read=true fenced_projection=true expired_cycle_denied=true newer_denial_invalidates=true stale_owner_no_request=true synthetic_only=true actual_Shopify_calls=0 actual_ad_provider_calls=0 live_changes=false");
  } finally {
    try {
      await client.query("delete from billing.trial_ledger where workspace_id=$1",[workspace]);
      await client.query("delete from billing.workspace_entitlements where workspace_id=$1",[workspace]);
      await client.query("delete from billing.workspace_subscriptions where workspace_id=$1",[workspace]);
      await client.query("delete from shopify.installations where workspace_id=$1",[workspace]);
      await client.query("delete from app.workspaces where id=$1",[workspace]);
      await client.query("update operations.refresh_control set budget=null,bounds=null where singleton");
      await client.query("reset role");
    } finally { /* isolated CI client is owned and closed by the replay runner */ }
  }
}
