import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {planRefreshAdmissions} from "../app/lib/refresh/admission-policy.server.js";

// Synthetic local CI only. The supplied evidence is simulated, never a real provider assertion.
export async function refreshWorkStopsProbe(client,connection,environment=process.env) {
  assert.equal(environment.GITHUB_ACTIONS,"true");
  assert.ok(environment.RUNNER_TEMP);
  assert.equal(connection.host,"127.0.0.1");
  assert.equal(connection.port,54322);
  const other=new pg.Client(connection);
  const workspace=randomUUID();
  const vector=n=>({requests:n,dbWrites:n,connections:n,rows:n,bytes:n});
  const job=(id,accountId="held")=>({id,workspaceId:workspace,installGeneration:"1",provider:"meta",accountId,
    scheduledHour:0,queuedAt:0,workClass:"hourly_hot_window",cost:vector(1),
    authority:{installationVerified:true,entitled:true,connected:true,setupComplete:true,allowedWindow:true}});
  let installed=false;
  try {
    await other.connect();
    await client.query("set role adstable_owner");
    // Same table-owner test authority as the existing replay; no coordinator membership is provisioned.
    await other.query("set role adstable_owner");
    await client.query("insert into app.workspaces(id) values ($1)",[workspace]); installed=true;
    await client.query("insert into shopify.installations(shop_id,shop_domain,workspace_id) values ('gid://shopify/Shop/99999998','stops-synthetic.myshopify.com',$1)",[workspace]);
    const budget={global:vector(2),interactiveReserve:vector(0),providers:[{provider:"meta",limit:vector(2)}],
      workspaces:[{workspaceId:workspace,limit:vector(2)}],accounts:["held","other"].map(accountId=>({provider:"meta",accountId,limit:vector(2)}))};
    const bounds={maxCandidates:8,maxClaims:8,maxAdmissions:8,maxWorkspaces:8};
    await client.query("update operations.refresh_control set budget=$1::jsonb,bounds=$2::jsonb where singleton",[JSON.stringify(budget),JSON.stringify(bounds)]);
    const store=createRefreshWorkRepository(other);
    const snapshot=()=>store.readAdmissionSnapshot();
    const plan=(s,jobs)=>planRefreshAdmissions({state:s.state,budget:s.budget,bounds:s.bounds,candidates:jobs,now:3_600_000});
    const stop=async(j,reason)=>store.recordStop({job:j,reason,expectedRevision:(await snapshot()).state.revision});
    const admit=async(j)=>{const s=await snapshot();const p=plan(s,[j]);assert.equal(p.admitted.length,1);
      assert.equal(await store.compareAndSwap({expectedRevision:s.state.revision,nextState:p.nextState}),true);return p.admitted[0];};

    assert.equal(await store.readStop({job:job("waiting")}),null);
    const waiting=await stop(job("waiting"),"budget_full");
    assert.equal(waiting.state,"waiting");
    const firstRevision=(await snapshot()).state.revision;
    await stop(job("waiting"),"budget_full");
    assert.equal((await snapshot()).state.revision,firstRevision,"repeated waiting polls do not grow revision/log");
    assert.equal((await store.readStop({job:job("waiting")})).call_state,"not_sent");
    assert.equal((await snapshot()).state.claims.length,0,"waiting work never reserves capacity");
    const waitedClaim=await admit(job("waiting"));
    assert.equal((await store.readStop({job:waitedClaim})).state,"resolved","admission closes obsolete waiting observation");
    assert.equal(await store.finishClaim({claim:waitedClaim,outcome:"completed"}),true);

    for(const reason of ["reauthorization_required","connection_closed","authority_required"]) {
      const preflight=await stop(job(reason),reason);
      assert.equal(preflight.state,"blocked");
      assert.equal((await store.readStop({job:job(reason)})).call_state,"not_sent");
      assert.equal((await snapshot()).state.claims.length,0);
      assert.equal(await store.resolveStop({job:job(reason),expectedVersion:preflight.version}),true);
    }

    const blocked=await stop(job("blocked"),"configuration_missing");
    assert.equal(blocked.state,"blocked");
    const blockedRecord=await store.readStop({job:job("blocked")});
    assert.equal(blockedRecord.source,"system");
    assert.equal(blockedRecord.action,"check_configuration");
    const blockedSnapshot=await snapshot();
    const fair=plan(blockedSnapshot,[job("blocked"),job("unrelated","other")]);
    assert.deepEqual(fair.admitted.map(c=>c.id),["unrelated"]);
    assert.equal(fair.deferred[0].reason,"account_held");
    // Ignore the planner's hold intentionally: SQL still rejects the bypass.
    const forged=plan({...blockedSnapshot,state:{...blockedSnapshot.state,holds:[]}},[job("blocked")]);
    assert.equal(await store.compareAndSwap({expectedRevision:blockedSnapshot.state.revision,nextState:forged.nextState}),false);
    assert.equal(await store.resolveStop({job:job("blocked"),expectedVersion:blocked.version+1}),false);
    const resolves=await Promise.all([store.resolveStop({job:job("blocked"),expectedVersion:blocked.version}),
      createRefreshWorkRepository(client).resolveStop({job:job("blocked"),expectedVersion:blocked.version})]);
    assert.deepEqual(resolves.sort(),[false,true],"acknowledgement wins once and does not run a job");
    assert.equal((await snapshot()).state.claims.length,0);

    for (const reason of ["stopped_before_call","provider_permission_denied","provider_throttled","provider_unknown_error","worker_stopped"]) {
      const claim=await admit(job(reason));
      assert.equal(await store.isClaimCurrent({claim}),true);
      const paused=await stop(claim,reason);
      assert.equal(paused.state,"paused");
      const record=await store.readStop({job:claim});
      assert.equal(record.call_state,reason==="stopped_before_call"?"not_sent":"settled");
      assert.equal((await snapshot()).state.claims.length,0,"settled or unstarted request releases its reservation atomically");
      assert.equal(await store.isClaimCurrent({claim}),false);
      assert.equal(await store.finishClaim({claim,outcome:"completed"}),false);
      assert.equal(await store.resolveStop({job:claim,expectedVersion:paused.version}),true);
      assert.equal(await store.finishClaim({claim,outcome:"completed"}),false,"clearing hold cannot restore an old owner");
    }

    const lost=await admit(job("lost"));
    const s=await snapshot();
    const race=await Promise.all([store.recordStop({job:lost,reason:"worker_lost",expectedRevision:s.state.revision}),
      createRefreshWorkRepository(client).recordStop({job:lost,reason:"worker_lost",expectedRevision:s.state.revision})]);
    assert.equal(race.filter(r=>r.recorded).length,1);
    const uncertain=await store.readStop({job:lost});
    assert.equal(uncertain.state,"uncertain");
    assert.equal(uncertain.call_state,"unknown");
    assert.equal(await store.isClaimCurrent({claim:lost}),false,"lost owner's write eligibility is revoked");
    assert.equal(await store.finishClaim({claim:lost,outcome:"paused"}),false,"old owner cannot release uncertain request capacity");
    assert.equal(await store.resolveStop({job:lost,expectedVersion:Number(uncertain.version)}),false,"no timer/manual boolean clears uncertain external work");
    assert.equal((await stop(lost,"worker_stopped")).recorded,false,"late old-owner observation cannot clear uncertainty");
    assert.equal((await snapshot()).state.claims.length,1,"unknown external request keeps its reservation");
    const otherClaim=await admit(job("other-continues","other"));
    assert.equal(await store.finishClaim({claim:otherClaim,outcome:"completed"}),true,"unrelated account can use remaining capacity");
    assert.equal((await stop({...lost,fence:lost.fence+1},"worker_lost")).recorded,false);
    assert.equal((await store.readStop({job:{...lost,installGeneration:"2"}})),null);

    const functions=["record_refresh_work_stop(uuid,bigint,text,text,text,bigint,text,bigint)","read_refresh_work_stop(uuid,bigint,text,text,text)",
      "resolve_refresh_work_stop(uuid,bigint,text,text,text,bigint)","refresh_claim_is_current(uuid,bigint,text,text,text,bigint)"];
    for (const role of ["anon","authenticated","service_role","adstable_runtime"]) {
      for(const name of functions) assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,`operations.${name}`])).rows[0].allowed,false);
      assert.equal((await client.query("select has_table_privilege($1,'operations.refresh_work_stops','SELECT,INSERT,UPDATE,DELETE') as allowed",[role])).rows[0].allowed,false);
    }
    for(const name of functions) assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator',$1,'EXECUTE') as allowed",[`operations.${name}`])).rows[0].allowed,true);
    for(const name of ["commit_refresh_admissions_before_stops(bigint,jsonb)","finish_refresh_work_before_stops(uuid,bigint,text,text,text,bigint,text)","read_refresh_admission_snapshot_before_stops()"]) {
      assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator',$1,'EXECUTE') as allowed",[`operations.${name}`])).rows[0].allowed,false);
    }
    console.log("EO05_REFRESH_STOPS_PASS waiting=true preflight_block=true provider_attempt_recorded=true uncertain_capacity_retained=true stale_owner_denied=true no_retry=true synthetic_only=true production_mutation=false");
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
