import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {selectedMigrationNames,renewalMigrationNames} from "../tools/f01-identity-oauth-rollout.mjs";

test("scoped rollout cannot expand to all pending migrations",()=>{
  assert.deepEqual(selectedMigrationNames,["eo05a_identity_oauth_atomic_stage","eo05a_identity_oauth_reconnect"]);
  assert.equal(Object.isFrozen(selectedMigrationNames),true);
  assert.deepEqual(renewalMigrationNames,["eo05a_google_identity_renewal_receipt"]);
  assert.equal(Object.isFrozen(renewalMigrationNames),true);
});

test("scoped SQL probe refuses non-runner execution before opening a database connection",()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL("../tools/f01-identity-oauth-rollout.mjs",import.meta.url))],{
    encoding:"utf8",timeout:10000,env:{...process.env,GITHUB_ACTIONS:"false"},
  });
  assert.equal(result.error,undefined);assert.equal(result.status,1);
  assert.match(result.stderr,/F01-B runs only on an ephemeral GitHub runner/);
  assert.doesNotMatch(result.stderr,/ECONNREFUSED|password authentication|connect ETIMEDOUT/);
});
