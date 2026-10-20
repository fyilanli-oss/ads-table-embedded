import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkRefreshQueueFromAuthority} from "../app/lib/refresh/native-inventory.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";

test("native inventory entry accepts no merchant shop/account list and commits only the database-derived check",async()=>{
  let calls=0;
  const store={readQueueCheck:async()=>({configured:true,revision:7}),checkQueueFromAuthority:async args=>{
    calls++;assert.deepEqual(args,{expectedRevision:7});return {committed:true,checkedWorkspaces:4,assessedProviders:12};}};
  const r=await checkRefreshQueueFromAuthority({store,workspaces:["fake"],accounts:["fake"]});
  assert.equal(r.status,"checked");assert.equal(calls,1);
  store.checkQueueFromAuthority=async()=>{calls++;return {committed:false};};
  assert.deepEqual(await checkRefreshQueueFromAuthority({store}),{status:"conflict"});assert.equal(calls,2);
});
test("unconfigured, failed inventory or DB failure cannot report success, retry or fall back to an injected list",async()=>{
  let calls=0;
  const store={readQueueCheck:async()=>({configured:false}),checkQueueFromAuthority:async()=>{calls++;}};
  assert.deepEqual(await checkRefreshQueueFromAuthority({store}),{status:"not_configured"});assert.equal(calls,0);
  store.readQueueCheck=async()=>({configured:true,revision:1});store.checkQueueFromAuthority=async()=>{calls++;throw Error("sensitive detail");};
  assert.deepEqual(await checkRefreshQueueFromAuthority({store}),{status:"needs_attention"});assert.equal(calls,1);
});
test("native source adapter passes only a revision and never interpolates identities",async()=>{
  const queries=[];const store=createRefreshWorkRepository({query:async(sql,args)=>{queries.push({sql,args});return {rows:[{result:[]}]};}});
  await store.checkQueueFromAuthority({expectedRevision:2});await store.readInventoryStatus();
  assert.equal(queries[0].sql,"select operations.check_refresh_queue_from_authority($1::bigint) as result");assert.deepEqual(queries[0].args,[2]);
  assert.equal(queries[1].sql,"select operations.read_refresh_inventory_status() as result");
  await assert.rejects(store.checkQueueFromAuthority({expectedRevision:-1}),/REFRESH_WORK_INPUT_INVALID/);
});
test("native inventory contract keeps work needs distinct from admission, fresh billing and native performance evidence",()=>{
  const contract=JSON.parse(readFileSync(new URL("../contracts/eo-05a-refresh-native-inventory-v1.json",import.meta.url),"utf8"));
  assert.equal(contract.package_id,"A6-EO-05-A");assert.equal(contract.claim_admission,false);assert.equal(contract.Dataset_write,false);
  assert.equal(contract.native_provider_calls,false);assert.equal(contract.live_activation,false);
  assert.equal(contract.merchant_supplied_inventory,false);
});
