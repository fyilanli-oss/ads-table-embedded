import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {prepareRefreshInventory,runRefreshQueueCheck,refreshQueueSilence} from "../app/lib/refresh/queue-check.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
const workspaceId="10000000-0000-0000-0000-000000000001";
const account={installGeneration:"1",provider:"klaviyo",accountId:"synthetic-account",connectionId:"synthetic-connection",connectionVersion:1,eligibleFromMs:0,eligible:true};
const fixture=()=>({complete:true,observedAtMs:100,expectedWorkspaces:1,expectedAccounts:1,workspaces:[{workspaceId,accounts:[{...account}]}]});

test("complete inventory includes empty shops and disabled accounts, and preserves stable hourly offsets",()=>{
  const input=fixture(); input.expectedWorkspaces=2;input.workspaces.push({workspaceId:"10000000-0000-0000-0000-000000000002",accounts:[]});
  input.workspaces[0].accounts[0].eligible=false;
  const prepared=prepareRefreshInventory(input);assert.equal(prepared.workspaces.length,2);assert.equal(prepared.accounts[0].eligible,false);
  assert.equal(prepared.accounts[0].offsetMs,prepareRefreshInventory(input).accounts[0].offsetMs);
  assert.ok(prepared.accounts[0].offsetMs>=0 && prepared.accounts[0].offsetMs<3600000);
  assert.equal(Object.hasOwn(prepared.accounts[0],"cost"),false);
});
test("partial, missing, duplicate or malformed inventory never becomes a complete check",()=>{
  for(const change of [x=>x.complete=false,x=>x.expectedWorkspaces++,x=>x.expectedAccounts++,x=>x.workspaces.push(x.workspaces[0]),
    x=>x.workspaces[0].accounts.push(account),x=>x.workspaces[0].accounts[0].eligible="true",
    x=>x.workspaces[0].accounts[0].installGeneration="0",x=>x.workspaces[0].accounts[0].connectionVersion=0]) {
    const input=fixture();change(input);assert.throws(()=>prepareRefreshInventory(input),/REFRESH_QUEUE_INPUT_INVALID/);
  }
});
test("queue check commits only after complete inventory and durable result; conflict/error is not success and never retries",async()=>{
  let loads=0,commits=0;
  const store={readQueueCheck:async()=>({configured:true,revision:3}),commitQueueCheck:async({expectedRevision,inventory})=>{
    commits++;assert.equal(expectedRevision,3);assert.equal(inventory.accounts.length,1);return {committed:true,checkedAccounts:1};}};
  const loadInventory=async()=>{loads++;return fixture();};
  assert.equal((await runRefreshQueueCheck({store,loadInventory})).status,"checked");
  assert.equal(commits,1);assert.equal(loads,1);
  store.commitQueueCheck=async()=>{commits++;return {committed:false};};
  assert.equal((await runRefreshQueueCheck({store,loadInventory})).status,"conflict");assert.equal(commits,2);
  store.commitQueueCheck=async()=>{commits++;throw Error("sensitive upstream detail");};
  assert.deepEqual(await runRefreshQueueCheck({store,loadInventory}),{status:"needs_attention"});assert.equal(commits,3);
  const partial=fixture();partial.complete=false;
  assert.equal((await runRefreshQueueCheck({store,loadInventory:async()=>partial})).status,"needs_attention");assert.equal(commits,3);
  store.readQueueCheck=async()=>({configured:false});
  assert.equal((await runRefreshQueueCheck({store,loadInventory})).status,"not_configured");assert.equal(loads,3);
});
test("independent silence decision uses successful durable check or explicit activation, strictly over two minutes",()=>{
  assert.equal(refreshQueueSilence({activatedAtMs:null,lastSuccessAtMs:null,nowMs:999999}).status,"inactive");
  assert.equal(refreshQueueSilence({activatedAtMs:0,lastSuccessAtMs:null,nowMs:120000}).status,"within_window");
  assert.equal(refreshQueueSilence({activatedAtMs:0,lastSuccessAtMs:null,nowMs:120001}).status,"critical");
  assert.equal(refreshQueueSilence({activatedAtMs:0,lastSuccessAtMs:50000,nowMs:170001}).status,"critical");
  assert.equal(refreshQueueSilence({activatedAtMs:100,lastSuccessAtMs:99,nowMs:200}).status,"invalid_clock");
  assert.equal(refreshQueueSilence({activatedAtMs:0,lastSuccessAtMs:201,nowMs:200}).status,"invalid_clock");
});
test("queue database adapter uses bound functions and sanitizes errors",async()=>{
  const queries=[];const store=createRefreshWorkRepository({query:async(sql,args)=>{queries.push({sql,args});return {rows:[{result:{committed:true}}]};}});
  await store.readQueueCheck();await store.commitQueueCheck({expectedRevision:2,inventory:prepareRefreshInventory(fixture())});
  assert.match(queries[1].sql,/\$1::bigint,\$2::jsonb/);assert.equal(queries[1].args[0],2);
  const broken=createRefreshWorkRepository({query:async()=>{throw Error("secret");}});
  await assert.rejects(broken.readQueueCheck(),/^Error: REFRESH_WORK_REPOSITORY_UNAVAILABLE$/);
});
test("contract keeps EO05B, native adapters, live heartbeat/watchdog and activation outside this slice",()=>{
  const contract=JSON.parse(readFileSync(new URL("../contracts/eo-05a-refresh-queue-check-v1.json",import.meta.url),"utf8"));
  assert.equal(contract.package_id,"A6-EO-05-A");assert.equal(contract.Dataset_write,false);assert.equal(contract.live_activation,false);
  assert.equal(contract.production_inventory_adapter_implemented,false);assert.equal(contract.independent_watchdog_running,false);
});
