import assert from "node:assert/strict";
import test from "node:test";
import {assertReplayEnvironment, inventoryDifferences, replayConnection} from "../tools/f01-database-replay.mjs";

test("database replay refuses non-runner execution and fixes its target to loopback",()=>{
  assert.throws(()=>assertReplayEnvironment({}),/ephemeral GitHub runner/);
  assert.throws(()=>assertReplayEnvironment({GITHUB_ACTIONS:"true"}),/temporary directory/);
  assert.doesNotThrow(()=>assertReplayEnvironment({GITHUB_ACTIONS:"true",RUNNER_TEMP:"temporary"}));
  assert.equal(replayConnection.host,"127.0.0.1");
  assert.equal(replayConnection.port,54322);
});

test("schema comparator detects changed definitions, removed rows and extra grants",()=>{
  const reference={functions:[{name:"callback",hash:"original"}],relations:[{name:"history",acl:"owner_only"}]};
  assert.deepEqual(inventoryDifferences(reference,structuredClone(reference)),[]);
  assert.deepEqual(inventoryDifferences(reference,{functions:[{name:"callback",hash:"changed"}],relations:reference.relations}).map(x=>x.category),["functions"]);
  assert.deepEqual(inventoryDifferences(reference,{functions:[],relations:[{name:"history",acl:"public"}]}).map(x=>x.category),["functions","relations"]);
});
