import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {runRefreshChunk} from "../app/lib/refresh/chunk-worker.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";

function setup(extra={}) {
  const stages=[];const stops=[];let calls=0;let loads=0;
  const claim={workspaceId:"w",installGeneration:"1",provider:"klaviyo",accountId:"a",id:"job",fence:1,cost:{requests:1,dbWrites:1,connections:1,rows:5,bytes:1000}};
  const authority={...claim,connectionId:"c",connectionVersion:1,installationVerified:true,entitled:true,connected:true,setupComplete:true,allowedWindow:true};
  const args={claim,window:{from:"2026-10-19",to:"2026-10-20"},limits:{deadlineAt:10000,requestTimeoutMs:100,finishReserveMs:10,maxRows:5,maxBytes:1000},
    now:()=>0,store:{advanceStage:async e=>{stages.push(e);return true;},isClaimCurrent:async()=>true,
      readAdmissionSnapshot:async()=>({state:{revision:1}}),recordStop:async e=>{stops.push(e);return {recorded:true};}},
    loadAuthority:async()=>{loads++;return authority;},readPage:async()=>{calls++;return {kind:"complete",payload:{}};},
    verifyEntitlement:async()=>({status:"verified",receipt:{observedAt:"2026-10-20T00:00:00Z"}}),isEntitlementCurrent:async()=>true,
    validatePage:()=>({complete:true,rows:[{product:"bracelet",quantity:3},{product:"necklace",quantity:2}]}),...extra};
  return {args,stages,stops,authority,calls:()=>calls,loads:()=>loads};
}

test("one chunk checks authority freshly and records every stage but never claims a Dataset commit",async()=>{
  const f=setup();const result=await runRefreshChunk(f.args);
  assert.equal(result.status,"awaiting_dataset");assert.equal(result.reservationRetained,true);
  assert.equal(f.calls(),1);assert.equal(f.loads(),3);
  assert.deepEqual(f.stages.map(s=>s.stage),["checking_authority","request_intent","response_received","ready_for_dataset"]);
  assert.equal(f.stages[3].rows,2);assert.equal(f.stages[3].bytes,Buffer.byteLength(JSON.stringify(result.rows)));
  assert.deepEqual(f.stops,[]);
  assert.equal(Object.hasOwn(result,"completed"),false);
});

test("fresh Shopify entitlement is mandatory; cached booleans cannot authorize or prevent a fresh decision",async()=>{
  const f=setup();f.authority.entitled=false;
  assert.equal((await runRefreshChunk(f.args)).status,"awaiting_dataset","fresh verification replaces an old negative cache");
  const denied=setup();denied.args.verifyEntitlement=async()=>({status:"denied"});
  assert.equal((await runRefreshChunk(denied.args)).reason,"entitlement_required");assert.equal(denied.calls(),0);
  const failed=setup();failed.args.verifyEntitlement=async()=>({status:"unavailable",externalOutcome:"unknown"});
  assert.equal((await runRefreshChunk(failed.args)).status,"uncertain");assert.equal(failed.calls(),0);
  const thrown=setup();thrown.args.verifyEntitlement=async()=>{throw Error("unknown check outcome");};
  assert.equal((await runRefreshChunk(thrown.args)).status,"uncertain");assert.equal(thrown.calls(),0);
  const changed=setup();changed.args.isEntitlementCurrent=async()=>false;
  assert.equal((await runRefreshChunk(changed.args)).reason,"entitlement_required");assert.equal(changed.calls(),0);
  const during=setup();let checks=0;during.args.isEntitlementCurrent=async()=>++checks===1;
  assert.equal((await runRefreshChunk(during.args)).reason,"authority_check_failed_after_request");assert.equal(during.calls(),1);
  const absent=setup();delete absent.args.verifyEntitlement;
  await assert.rejects(runRefreshChunk(absent.args),/REFRESH_CHUNK_INPUT_INVALID/);
});

test("missing authority, changed connection, no time and noncurrent ownership never reach a provider",async()=>{
  const f=setup();f.authority.connected=false;
  assert.equal((await runRefreshChunk(f.args)).reason,"authority_required");assert.equal(f.calls(),0);
  const g=setup();let reads=0;
  g.args.loadAuthority=async()=>({...g.authority,connectionVersion:++reads});
  assert.equal((await runRefreshChunk(g.args)).reason,"authority_required");assert.equal(g.calls(),0);
  const h=setup();h.args.limits.deadlineAt=100;
  assert.equal((await runRefreshChunk(h.args)).reason,"stopped_before_call");assert.equal(h.calls(),0);
  const i=setup();i.args.store.isClaimCurrent=async()=>false;
  assert.equal((await runRefreshChunk(i.args)).status,"not_current");assert.equal(i.calls(),0);
  const delayed=setup();let currentTime=0;delayed.args.now=()=>currentTime;
  delayed.args.store.isClaimCurrent=async()=>{currentTime=10000;return true;};
  assert.equal((await runRefreshChunk(delayed.args)).reason,"stopped_before_call");assert.equal(delayed.calls(),0);
});

test("provider errors are one attempted settled operation, not zero rows or automatic retries",async()=>{
  for(const reason of ["provider_permission_denied","provider_throttled","provider_rejected","RAW_SECRET_DETAIL"]) {
    const f=setup();let calls=0;f.args.readPage=async()=>{calls++;return {kind:"rejected",reason};};
    const result=await runRefreshChunk(f.args);
    assert.equal(result.status,"paused");assert.equal(result.externalOutcome,"settled");assert.equal(calls,1);
    assert.equal(result.reason,reason==="RAW_SECRET_DETAIL"?"provider_unknown_error":reason);
    assert.ok(!JSON.stringify(result).includes("RAW_SECRET_DETAIL"));
    assert.equal(f.stages.at(-1).stage,"response_received");
  }
});

test("timeout is uncertain even if cancellation is ignored; late success cannot advance stages",async()=>{
  const f=setup();f.args.limits.requestTimeoutMs=1;let resolveLate;let signal;
  f.args.readPage=async e=>{signal=e.signal;return new Promise(resolve=>{resolveLate=resolve;});};
  const result=await runRefreshChunk(f.args);
  assert.equal(result.status,"uncertain");assert.equal(result.reason,"request_outcome_unknown");assert.equal(signal.aborted,true);
  resolveLate({kind:"complete",payload:{}});await Promise.resolve();await Promise.resolve();
  assert.deepEqual(f.stages.map(s=>s.stage),["checking_authority","request_intent"]);
  const g=setup();g.args.readPage=async()=>{throw Error("PRIVATE_TRANSPORT_ERROR");};
  assert.equal((await runRefreshChunk(g.args)).status,"uncertain");
});

test("partial, malformed or excessive data stops; verified empty is not labelled as a successful refresh",async()=>{
  for(const validation of [{complete:false,rows:[]},{complete:true,rows:Array(6).fill({})},{complete:true,rows:["x".repeat(1001)]},Promise.resolve({complete:true,rows:[]})]) {
    const f=setup({validatePage:()=>validation});const result=await runRefreshChunk(f.args);
    assert.equal(result.reason,"validation_failed_after_request");assert.equal(result.externalOutcome,"settled");
  }
  const empty=setup({validatePage:()=>({complete:true,rows:[]})});
  assert.equal((await runRefreshChunk(empty.args)).status,"awaiting_dataset");
  const asyncFailure=setup({validatePage:async()=>{throw Error("PRIVATE_VALIDATOR_ERROR");}});
  assert.equal((await runRefreshChunk(asyncFailure.args)).reason,"validation_failed_after_request");
});

test("post-request authority loss and stage persistence failure never produce ready or release success",async()=>{
  const f=setup();let loads=0;f.args.loadAuthority=async()=>({...f.authority,connected:++loads<3});
  assert.equal((await runRefreshChunk(f.args)).reason,"authority_check_failed_after_request");
  assert.equal(f.stages.at(-1).stage,"response_received");
  const g=setup();g.args.store.advanceStage=async()=>{throw Error("PRIVATE_DB_ERROR");};
  const result=await runRefreshChunk(g.args);assert.equal(result.status,"needs_attention");assert.equal(g.calls(),0);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_DB_ERROR"));
  const h=setup();h.args.readPage=async()=>{throw Error();};h.args.store.recordStop=async()=>({recorded:false});
  const failed=await runRefreshChunk(h.args);assert.equal(failed.status,"needs_attention");assert.equal(failed.externalOutcome,"unknown");
});

test("invalid and over-reserved workload bounds fail before persistence or provider access",async()=>{
  for(const change of [{maxRows:6},{maxBytes:1001},{requestTimeoutMs:0},{requestTimeoutMs:2_147_483_648}]) {
    const f=setup();Object.assign(f.args.limits,change);await assert.rejects(runRefreshChunk(f.args),/REFRESH_CHUNK_INPUT_INVALID/);assert.equal(f.stages.length,0);
  }
  const f=setup();f.args.window.from="2026-02-30";
  await assert.rejects(runRefreshChunk(f.args),/REFRESH_CHUNK_INPUT_INVALID/);
});

test("stage repository binds identity and dates and refuses skipped steps without SQL",async()=>{
  const calls=[];const store=createRefreshWorkRepository({query:async(text,values)=>{calls.push({text,values});return {rows:[{result:true}]};}});
  const f=setup();await store.advanceStage({claim:f.args.claim,window:f.args.window,expectedStage:null,stage:"checking_authority"});
  assert.deepEqual(calls[0].values.slice(6),[null,"checking_authority",0,0,"2026-10-19","2026-10-20"]);
  await assert.rejects(store.advanceStage({claim:f.args.claim,window:f.args.window,expectedStage:null,stage:"ready_for_dataset"}),/REFRESH_WORK_INPUT_INVALID/);
  assert.equal(calls.length,1);
});

test("chunk module has no native provider, Dataset write, automatic dispatch or alert delivery wiring",()=>{
  const source=readFileSync(new URL("../app/lib/refresh/chunk-worker.server.js",import.meta.url),"utf8");
  assert.doesNotMatch(source,/fetch\(|finishClaim\(|setInterval\(|process\.env|console\.|\.\/providers\//);
  assert.match(source,/Promise\.race/);assert.match(source,/clearTimeout\(timer\)/);
});

test("progress schema stays private and pending, with SQL proof on both existing ephemeral replay paths",()=>{
  const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
  const file="supabase/migrations/20261020111425_eo05a_refresh_chunk_progress.sql";
  const sql=read(file);
  assert.match(sql,/force row level security/);assert.match(sql,/where singleton for update/);
  assert.match(sql,/previous is distinct from p_expected/);
  assert.match(sql,/p_outcome='completed' or stage='request_intent'/);
  assert.doesNotMatch(sql,/grant .* to adstable_runtime|grant adstable_refresh_coordinator to|cron\.schedule|pg_net/);
  const entry=JSON.parse(read("contracts/a6-tech-01-f01-migration-lineage-v1.json")).pending_migrations.find(e=>e.file===file);
  assert.equal(entry.applied,false);assert.equal(entry.live_apply_authorized,false);
  assert.match(read("tools/f01-database-replay.mjs"),/await refreshWorkChunkProbe\(client, replayConnection\)/);
  const contract=JSON.parse(read("contracts/eo-05a-refresh-chunk-worker-v1.json"));
  assert.equal(contract.runtime_activation_authorized,false);assert.equal(contract.Dataset_design_selected,false);
  assert.equal(contract.alarm_design_merge_authorized_by_this_delivery,false);
  assert.equal(contract.full_AL01_to_AL16_runtime_acceptance_claimed,false);
});
