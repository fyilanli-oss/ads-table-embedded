import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {planRefreshAdmissions} from "../app/lib/refresh/admission-policy.server.js";
import {runRefreshChunk} from "../app/lib/refresh/chunk-worker.server.js";

export async function refreshWorkChunkProbe(client,connection,environment=process.env) {
  assert.equal(environment.GITHUB_ACTIONS,"true");assert.ok(environment.RUNNER_TEMP);
  assert.equal(connection.host,"127.0.0.1");assert.equal(connection.port,54322);
  const other=new pg.Client(connection);const workspace=randomUUID();let installed=false;
  const window={from:"2026-10-19",to:"2026-10-20"};
  const vector=n=>({requests:n,dbWrites:n,connections:n,rows:100,bytes:10000});
  const job=(id,accountId="a")=>({id,workspaceId:workspace,installGeneration:"1",provider:"klaviyo",accountId,queuedAt:0,scheduledHour:0,
    workClass:"hourly_hot_window",cost:{requests:1,dbWrites:1,connections:1,rows:5,bytes:1000},
    authority:{installationVerified:true,entitled:true,connected:true,setupComplete:true,allowedWindow:true}});
  try {
    await other.connect();await client.query("set role adstable_owner");await other.query("set role adstable_owner");
    await client.query("insert into app.workspaces(id) values ($1)",[workspace]);installed=true;
    await client.query("insert into shopify.installations(shop_id,shop_domain,workspace_id) values ('gid://shopify/Shop/99999997','chunk-synthetic.myshopify.com',$1)",[workspace]);
    const budget={global:vector(2),interactiveReserve:{requests:0,dbWrites:0,connections:0,rows:0,bytes:0},providers:[{provider:"klaviyo",limit:vector(2)}],
      workspaces:[{workspaceId:workspace,limit:vector(2)}],accounts:["a","b"].map(accountId=>({provider:"klaviyo",accountId,limit:vector(2)}))};
    const bounds={maxCandidates:8,maxClaims:8,maxAdmissions:8,maxWorkspaces:8};
    await client.query("update operations.refresh_control set budget=$1::jsonb,bounds=$2::jsonb where singleton",[JSON.stringify(budget),JSON.stringify(bounds)]);
    const store=createRefreshWorkRepository(client),second=createRefreshWorkRepository(other);
    const admit=async candidate=>{const s=await store.readAdmissionSnapshot();
      const p=planRefreshAdmissions({state:s.state,budget:s.budget,bounds:s.bounds,candidates:[candidate],now:3_600_000});
      assert.equal(p.admitted.length,1);assert.equal(await store.compareAndSwap({expectedRevision:s.state.revision,nextState:p.nextState}),true);return p.admitted[0];};
    const claim=await admit(job("race"));
    const args={claim,window,expectedStage:null,stage:"checking_authority"};
    const race=await Promise.all([store.advanceStage(args),second.advanceStage(args)]);
    assert.deepEqual(race.sort(),[false,true],"duplicate chunk entry cannot both run");
    await assert.rejects(client.query("select operations.advance_refresh_work_stage($1::uuid,1,'klaviyo','a','race',$2::bigint,null,'ready_for_dataset',0,0,$3::date,$4::date)",
      [workspace,claim.fence,window.from,window.to]),/REFRESH_STAGE_INVALID/);
    assert.equal((await store.readStage({claim})).stage,"checking_authority");
    assert.equal(await store.advanceStage({...args,expectedStage:"checking_authority",stage:"request_intent",window:{from:"2026-10-18",to:window.to}}),false);
    assert.equal(await store.advanceStage({...args,expectedStage:"checking_authority",stage:"request_intent"}),true);
    assert.equal(await store.finishClaim({claim,outcome:"paused"}),false,"unknown request intent cannot release capacity through generic finish");
    assert.equal(await store.finishClaim({claim,outcome:"completed"}),false);
    const s=await store.readAdmissionSnapshot();
    assert.equal((await store.recordStop({job:claim,reason:"request_outcome_unknown",expectedRevision:s.state.revision})).recorded,true);
    assert.equal(await store.advanceStage({...args,expectedStage:"request_intent",stage:"response_received"}),false,"late response cannot advance stopped work");
    assert.equal((await store.readAdmissionSnapshot()).state.claims.length,1);

    const clean=await admit(job("clean","b"));let requests=0;
    const authority={...clean,connectionId:"synthetic-connection",connectionVersion:1,installationVerified:true,entitled:true,connected:true,setupComplete:true,allowedWindow:true};
    const result=await runRefreshChunk({claim:clean,window,store,now:()=>0,
      limits:{deadlineAt:10000,requestTimeoutMs:500,finishReserveMs:10,maxRows:5,maxBytes:1000},
      loadAuthority:async()=>authority,readPage:async()=>{requests++;return {kind:"complete",payload:{synthetic:true}};},
      verifyEntitlement:async()=>({status:"verified",receipt:{observedAt:"2026-10-20T00:00:00Z"}}),isEntitlementCurrent:async()=>true,
      validatePage:()=>({complete:true,rows:[{product:"bracelet",quantity:3},{product:"necklace",quantity:2}]})});
    assert.equal(requests,1);assert.equal(result.status,"awaiting_dataset");
    const progress=await second.readStage({claim:clean});
    assert.equal(progress.stage,"ready_for_dataset");assert.equal(Number(progress.rows_observed),2);
    assert.equal(progress.from_date,window.from);assert.equal(progress.to_date,window.to);
    assert.equal(await second.finishClaim({claim:clean,outcome:"completed"}),false,"provider read is not a Dataset commit");
    assert.equal(await second.readStage({claim:{...clean,installGeneration:"2"}}),null);
    assert.equal(await store.finishClaim({claim:clean,outcome:"paused"}),true);
    const resumed=await admit(job("clean","b"));
    assert.ok(resumed.fence>clean.fence);
    assert.equal(await store.advanceStage({claim:clean,window,expectedStage:null,stage:"checking_authority"}),false);
    assert.equal(await store.advanceStage({claim:resumed,window,expectedStage:null,stage:"checking_authority"}),true);
    assert.equal(await store.finishClaim({claim:resumed,outcome:"completed"}),false);
    for(const role of ["anon","authenticated","service_role","adstable_runtime"]) {
      assert.equal((await client.query("select has_table_privilege($1,'operations.refresh_work_progress','SELECT,INSERT,UPDATE,DELETE') as allowed",[role])).rows[0].allowed,false);
      assert.equal((await client.query("select has_function_privilege($1,'operations.advance_refresh_work_stage(uuid,bigint,text,text,text,bigint,text,text,bigint,bigint,date,date)','EXECUTE') as allowed",[role])).rows[0].allowed,false);
    }
    assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator','operations.advance_refresh_work_stage(uuid,bigint,text,text,text,bigint,text,text,bigint,bigint,date,date)','EXECUTE') as allowed")).rows[0].allowed,true);
    console.log("EO05_REFRESH_CHUNK_PASS durable_stages=true one_entry_wins=true late_response_denied=true no_Dataset_success=true synthetic_provider_only=true actual_provider_calls=0 live_changes=false");
  } finally {
    try {
      if(installed) {
        await client.query("delete from shopify.installations where workspace_id=$1",[workspace]);
        await client.query("delete from app.workspaces where id=$1",[workspace]);
        await client.query("update operations.refresh_control set budget=null,bounds=null where singleton");
      }
      await client.query("reset role");
    } finally {await other.end();}
  }
}
