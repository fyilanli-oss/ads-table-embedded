import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";

function fixture() {
  let calls=0,reserves=0,stops=0,settles=0;
  const store={reserve:async x=>{reserves++;return {status:"reserved",...x,dispatchBeforeMs:100,dispatchBudgetMs:1000};},
    stop:async()=>{stops++;return true;},settle:async()=>{settles++;return true;}};
  const args={operationKey:"a".repeat(64),lane:"background",run:async()=>{calls++;return {outcome:"success",value:{synthetic:true}};}};
  return {store,args,guard:createSharedQuotaGuard({store,now:()=>0}),calls:()=>calls,reserves:()=>reserves,stops:()=>stops,settles:()=>settles};
}
test("one shared reservation precedes one operation; a settled response does not refund its quota",async()=>{
  for(const lane of ["interactive","background"]) {
    const f=fixture();f.args.lane=lane;assert.equal((await f.guard.execute(f.args)).status,"returned");
    assert.equal(f.calls(),1);assert.equal(f.reserves(),1);assert.equal(f.settles(),1);assert.equal(f.stops(),0);
  }
});
test("ordinary waiting and missing configuration never become provider errors or calls",async()=>{
  for(const status of ["waiting","not_configured","stopped","clock_invalid","already_reserved"]) {
    const f=fixture();f.store.reserve=async()=>({status});assert.deepEqual(await f.guard.execute(f.args),{status});assert.equal(f.calls(),0);assert.equal(f.stops(),0);
  }
});
test("unknown/failed reservation, altered receipt or expired permit cannot authorize a request",async()=>{
  const f=fixture();f.store.reserve=async()=>{throw Error("TOKEN");};
  assert.equal((await f.guard.execute(f.args)).reason,"quota_store_unavailable");assert.equal(f.calls(),0);
  for(const change of [{operationKey:"b".repeat(64)},{attemptId:randomUUID()},{dispatchBeforeMs:0},{dispatchBeforeMs:null}]) {
    const g=fixture();g.store.reserve=async x=>({status:"reserved",...x,dispatchBeforeMs:100,dispatchBudgetMs:1000,...change});
    assert.equal((await g.guard.execute(g.args)).status,"not_sent");assert.equal(g.calls(),0);assert.equal(g.settles(),1);
  }
});
test("monotonic time rejects a delayed reservation even when the process wall clock is behind the database",async()=>{
  const f=fixture();let ticks=0;
  const guard=createSharedQuotaGuard({store:f.store,now:()=>0,elapsedNow:()=>ticks++?1000:0});
  assert.equal((await guard.execute(f.args)).status,"not_sent");assert.equal(f.calls(),0);
});
test("first rejected, malformed or unknown response stops once without retry, raw error or timer",async()=>{
  for(const outcome of ["rejected","unknown","invalid"]) {
    const f=fixture();let attempts=0;f.args.run=async()=>{attempts++;return {outcome,value:"SECRET"};};
    const r=await f.guard.execute(f.args);assert.equal(r.status,"stopped");assert.equal(attempts,1);assert.equal(f.stops(),1);assert.ok(!JSON.stringify(r).includes("SECRET"));
  }
  const f=fixture();f.args.run=async()=>{throw Error("SECRET");};f.store.stop=async()=>{throw Error("DB_SECRET");};
  const r=await f.guard.execute(f.args);assert.equal(r.status,"needs_attention");assert.equal(r.stopRecorded,false);assert.ok(!JSON.stringify(r).includes("SECRET"));
});
test("failed settlement is not successful publication and does not repeat the provider call",async()=>{
  const f=fixture();f.store.settle=async()=>false;const r=await f.guard.execute(f.args);
  assert.equal(r.reason,"quota_settlement_unavailable");assert.equal(f.calls(),1);
});
test("quota repository binds opaque keys; no caller limits, client time or dynamic SQL",async()=>{
  const queries=[],store=createSharedQuotaRepository({query:async(sql,args)=>{queries.push({sql,args});return {rows:[{result:true}]};}});
  const input={operationKey:"a".repeat(64),attemptId:randomUUID(),lane:"interactive"};
  await store.reserve(input);await store.stop(input);await store.settle(input);await store.cleanup({limit:7});
  assert.equal(queries[0].sql,"select operations.reserve_shared_api_quota($1::text,$2::uuid,$3::text) as result");assert.equal(queries[0].args.length,3);
  assert.equal(queries[3].args[0],7);await assert.rejects(store.cleanup({limit:1001}),/INPUT_INVALID/);
  await assert.rejects(store.reserve({...input,operationKey:"merchant account"}),/INPUT_INVALID/);
});
test("shared quota contract does not decide Dataset, product grain, dates or native limits",()=>{
  const c=JSON.parse(readFileSync(new URL("../contracts/eo-05a-shared-api-quota-v1.json",import.meta.url),"utf8"));
  assert.equal(c.production_policies_inserted,false);assert.equal(c.live_activation,false);assert.equal(c.native_calls,false);assert.equal(c.Dataset_or_product_design,false);
  const sql=readFileSync(new URL(`../${c.migration}`,import.meta.url),"utf8");
  assert.match(sql,/order by q.id for update of q/);assert.match(sql,/and settled/);
  assert.match(sql,/interactive_reserve/);assert.match(sql,/max_outstanding/);
});
