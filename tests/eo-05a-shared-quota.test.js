import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {createSharedQuotaGuard,SHOPIFY_ADMIN_COST_UNIT} from "../app/lib/refresh/shared-quota.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";

function fixture() {
  let calls=0,reserves=0,stops=0,settles=0;
  const store={reserve:async x=>{reserves++;return {status:"reserved",...x,dispatchBeforeMs:100,dispatchBudgetMs:1000};},
    stop:async()=>{stops++;return true;},settle:async()=>{settles++;return true;}};
  const args={operationKey:"a".repeat(64),lane:"background",run:async()=>{calls++;return {outcome:"success",value:{synthetic:true}};}};
  return {store,args,guard:createSharedQuotaGuard({store,now:()=>0}),calls:()=>calls,reserves:()=>reserves,stops:()=>stops,settles:()=>settles};
}

test("Admin route repository passes only opaque route/domain keys and the Admin provider",async()=>{
  const calls=[],routeKey="a".repeat(64),connectionScopeKey="b".repeat(64);
  const store=createSharedQuotaRepository({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{result:routeKey}]};}});
  assert.equal(await store.resolveRoute({routeKey,connectionScopeKey,provider:"shopify_admin"}),routeKey);
  assert.deepEqual(calls,[{sql:"select operations.resolve_shared_api_quota_route($1::text,$2::text,$3::text) as result",args:[routeKey,connectionScopeKey,"shopify_admin"]}]);
  await assert.rejects(store.resolveRoute({routeKey,connectionScopeKey:"shop.myshopify.com",provider:"shopify_admin"}),/INPUT_INVALID/);
  assert.equal(calls.length,1);
});
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
  assert.match(sql,/p\.max_units-\(case when p_lane='background' then p\.interactive_reserve else 0 end\)/,"CASE expression must be parenthesized inside the PLpgSQL IF comparison");
});

function costFixture(budget={unit:SHOPIFY_ADMIN_COST_UNIT,reservedRequestedCost:10}) {
  const f=fixture();let permit,received,reserveInput;
  f.store.reserve=async x=>{reserveInput=x;permit={...x,status:"reserved",dispatchBeforeMs:100,dispatchBudgetMs:1000,costBudget:budget};return permit;};
  f.args.requiredCostUnit=SHOPIFY_ADMIN_COST_UNIT;
  f.args.run=async points=>{received=points;return {outcome:"success",value:"ok"};};
  return {...f,permit:()=>permit,received:()=>received,reserveInput:()=>reserveInput};
}
test("Admin budget: same reservation supplies a copied point ceiling without caller cost input",async()=>{
  const f=costFixture();assert.equal((await f.guard.execute(f.args)).status,"returned");assert.equal(f.received(),10);
  assert.deepEqual(Object.keys(f.reserveInput()).sort(),["attemptId","lane","operationKey"]);assert.equal(f.settles(),1);
});
for(const [name,budget] of [["missing",undefined],["null",null],["wrong unit",{unit:"requests",reservedRequestedCost:10}],
  ["zero",{unit:SHOPIFY_ADMIN_COST_UNIT,reservedRequestedCost:0}],["negative",{unit:SHOPIFY_ADMIN_COST_UNIT,reservedRequestedCost:-1}],
  ["string",{unit:SHOPIFY_ADMIN_COST_UNIT,reservedRequestedCost:"10"}],["fraction",{unit:SHOPIFY_ADMIN_COST_UNIT,reservedRequestedCost:1.5}],
  ["unsafe integer",{unit:SHOPIFY_ADMIN_COST_UNIT,reservedRequestedCost:Number.MAX_SAFE_INTEGER+1}],
  ["extra budget field",{unit:SHOPIFY_ADMIN_COST_UNIT,reservedRequestedCost:10,callerLimit:100}],
])test(`Admin budget: ${name} receipt settles without dispatch or provider stop`,async()=>{
  const f=costFixture(budget);if(budget===undefined)f.store.reserve=async x=>({...x,status:"reserved",dispatchBeforeMs:100,dispatchBudgetMs:1000});
  const r=await f.guard.execute(f.args);assert.equal(r.status,"not_sent");assert.equal(r.reason,"quota_cost_budget_invalid");
  assert.equal(f.received(),undefined);assert.equal(f.settles(),1);assert.equal(f.stops(),0);
});
test("Admin budget: later mutation of receipt cannot increase copied admitted ceiling",async()=>{
  const f=costFixture();f.args.beforeDispatch=async()=>{f.permit().costBudget.reservedRequestedCost=999;return true;};
  assert.equal((await f.guard.execute(f.args)).status,"returned");assert.equal(f.received(),10);
});
test("Admin budget: valid cost cannot rescue a foreign attempt or operation receipt",async()=>{
  for(const field of ["attemptId","operationKey"]){const f=costFixture();f.args.beforeDispatch=()=>{f.permit()[field]="foreign";return true;};
    assert.equal((await f.guard.execute(f.args)).status,"not_sent");assert.equal(f.received(),undefined);assert.equal(f.settles(),1);}
});
test("Admin budget: invalid receipt settlement failure remains needs-attention",async()=>{
  const f=costFixture(null);f.store.settle=async()=>false;
  assert.equal((await f.guard.execute(f.args)).status,"needs_attention");assert.equal(f.received(),undefined);
});
test("Admin budget: unknown required unit rejected before reserving",async()=>{
  const f=fixture();await assert.rejects(f.guard.execute({...f.args,requiredCostUnit:"requests"}),/INPUT_INVALID/);assert.equal(f.reserves(),0);
});
test("Admin budget: ordinary provider run keeps its original zero-argument interface",async()=>{
  const f=fixture();let args;f.args.run=async(...values)=>{args=values;return {outcome:"success"};};
  assert.equal((await f.guard.execute(f.args)).status,"returned");assert.deepEqual(args,[]);
});
test("Admin budget: known requested-cost excess has a distinct stop reason",async()=>{
  const f=costFixture();f.args.run=async()=>({outcome:"rejected",costBudgetExceeded:true});
  const r=await f.guard.execute(f.args);assert.equal(r.reason,"quota_cost_budget_exceeded");assert.equal(r.status,"stopped");assert.equal(f.stops(),1);
});
