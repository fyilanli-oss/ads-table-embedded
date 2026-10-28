import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {commitRefreshAdmissions, planRefreshAdmissions, refreshHourlyOffset, releaseRefreshClaim} from "../app/lib/refresh/admission-policy.server.js";

// All budgets and authorities below are synthetic inputs, not measured deployment limits.
const amounts = value => ({requests: value, dbWrites: value, connections: value, rows: value, bytes: value});
const bounds = {maxCandidates: 30, maxClaims: 30, maxAdmissions: 30, maxWorkspaces: 30};
const emptyState = () => ({revision: 0, nextFence: 1, nextTurn: 1, claims: [], lastServed: []});
const job = (id, workspaceId = id, extra = {}) => ({
  id, workspaceId, installGeneration: "generation-1", provider: "google_ads", accountId: `account-${id}`,
  scheduledHour: 0, queuedAt: 0, workClass: "hourly_hot_window", cost: amounts(1),
  authority: {installationVerified: true, entitled: true, connected: true, setupComplete: true, allowedWindow: true},
  ...extra,
});
function input(candidates, extra = {}) {
  return {
    state: emptyState(), candidates, now: 3_600_000, bounds,
    budget: {
      global: amounts(20), interactiveReserve: amounts(0),
      providers: [...new Set(candidates.map(j => j.provider))].map(provider => ({provider, limit: amounts(20)})),
      workspaces: [...new Set(candidates.map(j => j.workspaceId))].map(workspaceId => ({workspaceId, limit: amounts(20)})),
      accounts: [...new Map(candidates.map(j => [JSON.stringify([j.provider, j.accountId]), {provider: j.provider, accountId: j.accountId, limit: amounts(20)}])).values()],
    },
    ...extra,
  };
}
const ids = result => result.admitted.map(claim => claim.id);

test("installation-owned Order reservations consume global/workspace capacity without ad provider/account identity",()=>{
  const args=input([job("a")]);args.state.nextFence=2;
  args.state.externalClaims=[{source:"shopify_orders",id:"order-attempt",installationId:"42",workspaceId:"a",fence:1,cost:amounts(20)}];
  assert.equal(planRefreshAdmissions(args).deferred[0].reason,"budget_full");
  args.state.externalClaims[0].workspaceId="other";args.budget.global=amounts(40);
  assert.deepEqual(ids(planRefreshAdmissions(args)),["a"]);
  args.budget.global=amounts(20);assert.equal(planRefreshAdmissions(args).deferred[0].reason,"budget_full");
  args.budget.global=amounts(40);args.bounds={...bounds,maxClaims:1};assert.equal(planRefreshAdmissions(args).deferred[0].reason,"dispatch_limit");
});
test("external reservation metadata cannot invent a fourth reporting provider or invalid resource use",()=>{
  for(const extra of [{source:"shopify"},{provider:"meta"},{accountId:"fake"},{cost:amounts(-1)},{fence:2}]){
    const args=input([job("a")]);args.state.nextFence=2;args.state.externalClaims=[{source:"shopify_orders",id:"order-attempt",installationId:"42",workspaceId:"a",fence:1,cost:amounts(1),...extra}];
    assert.throws(()=>planRefreshAdmissions(args),/INPUT_INVALID/);
  }
  const args=input([job("a")]);args.state.externalClaims=null;assert.throws(()=>planRefreshAdmissions(args),/INPUT_INVALID/);
});

test("hour slots are deterministic, identity-scoped and spread rather than all at the hour boundary", () => {
  const offsets = Array.from({length: 24}, (_, i) => refreshHourlyOffset(job(`workspace-${i}`)));
  assert.ok(offsets.every(offset => offset >= 0 && offset < 3_600_000));
  assert.equal(new Set(offsets).size, 24);
  assert.equal(refreshHourlyOffset(job("a")), refreshHourlyOffset(job("a", "a", {installGeneration: "new"})));
  assert.notEqual(refreshHourlyOffset(job("a")), refreshHourlyOffset(job("a", "b")));
  assert.notEqual(refreshHourlyOffset(job("a")), refreshHourlyOffset(job("a", "a", {provider: "meta"})));
});

test("not-due work waits and missed-hour work is not silently discarded", () => {
  const candidate = job("a");
  const due = refreshHourlyOffset(candidate);
  assert.equal(planRefreshAdmissions(input([candidate], {now: due - 1})).deferred[0].reason, "not_due");
  assert.deepEqual(ids(planRefreshAdmissions(input([candidate], {now: due}))), ["a"]);
  assert.deepEqual(ids(planRefreshAdmissions(input([candidate], {now: 10 * 3_600_000}))), ["a"]);
});

test("one large workspace yields to a small workspace before taking another chunk", () => {
  const candidates = [job("a1", "large"), job("a2", "large"), job("a3", "large"), job("b", "small")];
  const args = input(candidates, {bounds: {...bounds, maxAdmissions: 2}});
  const result = planRefreshAdmissions(args);
  assert.deepEqual(ids(result), ["a1", "b"]);
  assert.equal(result.deferred.length, 2);
  assert.deepEqual(args.state, emptyState(), "planning must not mutate its input");
});

test("persisted service order gives the waiting workspace the next turn across dispatches", () => {
  const candidates = [job("a", "large"), job("b", "small")];
  const args = input(candidates, {bounds: {...bounds, maxAdmissions: 1}});
  const first = planRefreshAdmissions(args);
  const released = releaseRefreshClaim({state: first.nextState, claim: first.admitted[0]}).nextState;
  const second = planRefreshAdmissions({...args, state: released, candidates: [job("a2", "large"), candidates[1]]});
  assert.deepEqual(ids(second), ["b"]);
});

test("oldest waiting work is considered across work classes without fixed priority starvation", () => {
  const result = planRefreshAdmissions(input([
    job("new", "a", {queuedAt: 50, workClass: "bootstrap"}),
    job("old", "b", {workClass: "deep_reconciliation"}),
  ], {bounds: {...bounds, maxAdmissions: 1}}));
  assert.deepEqual(ids(result), ["old"]);
});

for (const scope of ["global", "providers", "workspaces", "accounts"]) {
  test(`${scope} budget exhaustion defers rather than drops or over-admits work`, () => {
    const args = input([job("a"), job("b", "b", scope === "providers" ? {provider: "meta"} : {})]);
    if (scope === "global") args.budget.global = amounts(1);
    else args.budget[scope][0].limit = amounts(0);
    const result = planRefreshAdmissions(args);
    assert.equal(result.admitted.length, 1);
    assert.equal(result.deferred.length, 1);
    assert.equal(result.deferred[0].reason, "budget_full");
    assert.equal(result.admitted.length + result.deferred.length, 2);
  });
}

test("existing claims from another workspace consume the same global budget", () => {
  const firstInput = input([job("a"), job("b")]);
  firstInput.budget.global = amounts(1);
  const first = planRefreshAdmissions(firstInput);
  const second = planRefreshAdmissions({...firstInput, state: first.nextState, candidates: [job("b")]});
  assert.equal(second.admitted.length, 0);
  assert.equal(second.deferred[0].reason, "budget_full");
});

test("interactive capacity remains reserved and a lower new budget cannot evict existing work", () => {
  const args = input([job("a"), job("b")]);
  args.budget.global = amounts(2);
  args.budget.interactiveReserve = amounts(1);
  const first = planRefreshAdmissions(args);
  assert.equal(first.admitted.length, 1);
  args.budget.global = amounts(1);
  const blocked = planRefreshAdmissions({...args, state: first.nextState, candidates: [job("b")]});
  assert.equal(blocked.admitted.length, 0);
  assert.equal(blocked.nextState.claims.length, 1);
});

test("all resource dimensions are charged, not only the number of HTTP requests", () => {
  for (const resource of ["dbWrites", "connections", "rows", "bytes"]) {
    const args = input([job("a")]);
    args.budget.global[resource] = 0;
    assert.equal(planRefreshAdmissions(args).deferred[0].reason, "budget_full", resource);
  }
});

test("unknown, partial, duplicate and malformed budgets fail closed without numeric defaults", () => {
  for (const broken of [undefined, {}, {global: amounts(1)}, {...input([]).budget, global: amounts(Number.NaN)}]) {
    const result = planRefreshAdmissions(input([job("a")], {budget: broken}));
    assert.equal(result.status, "blocked");
    assert.equal(result.nextState, null);
    assert.deepEqual(result.admitted, []);
  }
  const args = input([job("a")]);
  args.budget.providers.push(args.budget.providers[0]);
  assert.equal(planRefreshAdmissions(args).status, "blocked");
});

test("missing account budget and missing workload cannot be treated as zero cost", () => {
  const args = input([job("a")]);
  args.budget.accounts = [];
  assert.equal(planRefreshAdmissions(args).deferred[0].reason, "budget_unknown");
  assert.equal(planRefreshAdmissions(input([job("b", "b", {cost: undefined})])).deferred[0].reason, "workload_unknown");
});

test("active account cannot be bypassed by a different job purpose", () => {
  const initial = job("a");
  const first = planRefreshAdmissions(input([initial]));
  const duplicate = job("retry", "a", {accountId: initial.accountId, workClass: "deep_reconciliation"});
  const result = planRefreshAdmissions(input([duplicate], {state: first.nextState}));
  assert.deepEqual(result.admitted, []);
  assert.equal(result.deferred[0].reason, "account_busy");
});

test("authority and connection window are required for every work class", () => {
  for (const flag of ["installationVerified", "entitled", "connected", "setupComplete", "allowedWindow"]) {
    for (const workClass of ["bootstrap", "hourly_hot_window", "deep_reconciliation", "explicitly_eligible_recovery"]) {
      const candidate = job("a", "a", {workClass});
      candidate.authority[flag] = false;
      const result = planRefreshAdmissions(input([candidate]));
      assert.equal(result.deferred[0].reason, "authority_required", `${workClass}/${flag}`);
    }
  }
});

test("claim identity is generation scoped and stale owners cannot release a newer reservation", () => {
  const first = planRefreshAdmissions(input([job("a")]));
  const claim = first.admitted[0];
  for (const wrong of [{...claim, fence: claim.fence + 1}, {...claim, workspaceId: "other"}, {...claim, installGeneration: "other"}]) {
    assert.equal(releaseRefreshClaim({state: first.nextState, claim: wrong}).released, false);
  }
  const release = releaseRefreshClaim({state: first.nextState, claim});
  assert.equal(release.released, true);
  assert.equal(release.nextState.claims.length, 0);
  const next = planRefreshAdmissions(input([job("a")], {state: release.nextState}));
  assert.ok(next.admitted[0].fence > claim.fence);
  assert.equal(releaseRefreshClaim({state: next.nextState, claim}).released, false);
});

test("same account IDs from different tenants or providers do not collide accidentally", () => {
  const result = planRefreshAdmissions(input([
    job("a", "tenant-a", {accountId: "shared"}),
    job("b", "tenant-b", {accountId: "shared"}),
    job("c", "tenant-a", {accountId: "shared", provider: "meta"}),
  ]));
  assert.equal(result.admitted.length, 3);
});

test("bounded input, duplicate job identity and unsafe counters are rejected", () => {
  for (const args of [
    input([job("a"), job("a")]),
    input([job("a")], {bounds: {...bounds, maxCandidates: 0}}),
    input([job("a")], {bounds: {...bounds, maxAdmissions: undefined}}),
    input([job("a")], {state: {...emptyState(), nextFence: Number.MAX_SAFE_INTEGER}}),
    input([job("a")], {state: {...emptyState(), revision: Number.MAX_SAFE_INTEGER}}),
    input([job("a", "a", {scheduledHour: 1})]),
  ]) assert.throws(() => planRefreshAdmissions(args), /REFRESH_POLICY_INPUT_INVALID/);
});

test("two dispatchers racing through synthetic global CAS cannot both reserve the same budget/account", async () => {
  let current = emptyState();
  let reads = 0;
  let unlock;
  const barrier = new Promise(resolve => { unlock = resolve; });
  const store = {
    async readState() {
      const snapshot = structuredClone(current);
      if (++reads === 2) unlock();
      await barrier;
      return snapshot;
    },
    async compareAndSwap({expectedRevision, nextState}) {
      if (current.revision !== expectedRevision) return false;
      current = structuredClone(nextState);
      return true;
    },
  };
  const args = input([job("a")]);
  args.budget.global = amounts(1);
  const results = await Promise.all([commitRefreshAdmissions({...args, store}), commitRefreshAdmissions({...args, store})]);
  assert.deepEqual(results.map(r => r.status).sort(), ["conflict", "reserved"]);
  assert.equal(results.flatMap(r => r.admitted).length, 1);
  assert.equal(current.claims.length, 1);
  assert.equal(reads, 2, "no automatic conflict retry");
});

test("store errors fail closed, are sanitized and are never retried", async () => {
  let calls = 0;
  const store = {async readState() { calls++; throw new Error("secret-payload"); }, async compareAndSwap() { assert.fail(); }};
  await assert.rejects(commitRefreshAdmissions({...input([job("a")]), store}), /^Error: REFRESH_STORE_UNAVAILABLE$/);
  assert.equal(calls, 1);
  await assert.rejects(commitRefreshAdmissions({...input([job("a")]), store: undefined}), /REFRESH_POLICY_INPUT_INVALID/);
  let writes = 0;
  const failedWrite = {
    async readState() { return emptyState(); },
    async compareAndSwap() { writes++; throw new Error("credential-payload"); },
  };
  await assert.rejects(commitRefreshAdmissions({...input([job("a")]), store: failedWrite}), /^Error: REFRESH_STORE_UNAVAILABLE$/);
  assert.equal(writes, 1);
});

test("failed CAS publishes no provisional claim and carries no retry authority", async () => {
  for (const answer of [false, undefined, "true"]) {
    let writes = 0;
    const store = {
      async readState() { return emptyState(); },
      async compareAndSwap() { writes++; return answer; },
    };
    const result = await commitRefreshAdmissions({...input([job("a")]), store});
    assert.equal(result.status, "conflict");
    assert.deepEqual(result.admitted, []);
    assert.equal(writes, 1);
  }
});

test("busy claim limit and missing permissions never call the commit adapter", async () => {
  const args = input([job("a")]);
  args.candidates[0].authority.connected = false;
  const store = {async readState() { return emptyState(); }, async compareAndSwap() { assert.fail("blocked work must not commit"); }};
  assert.equal((await commitRefreshAdmissions({...args, store})).status, "waiting");
  const first = planRefreshAdmissions(input([job("a")]));
  const second = planRefreshAdmissions(input([job("b")], {state: first.nextState, bounds: {...bounds, maxClaims: 1}}));
  assert.equal(second.deferred[0].reason, "dispatch_limit");
});

test("this slice is not wired to routes, DB, timers, provider calls or a production in-memory store", () => {
  const source = readFileSync(new URL("../app/lib/refresh/admission-policy.server.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|setInterval\(|setTimeout\(|process\.env|from ["'].*(?:database|providers|pg)[/"']/);
  const contract = JSON.parse(readFileSync(new URL("../contracts/eo-05a-global-refresh-design-v1.json", import.meta.url), "utf8"));
  assert.equal(contract.repository_policy_slice.production_atomic_store_implemented, false);
  assert.equal(contract.repository_policy_slice.real_capacity_evidence, false);
  assert.equal(contract.repository_policy_implementation_authorized, true);
  assert.equal(contract.runtime_implementation_authorized, false);
  assert.equal(contract.repository_policy_slice.prerequisite_measurements_closed, false);
});
