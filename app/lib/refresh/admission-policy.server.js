import {createHash} from "node:crypto";

const HOUR_MS = 3_600_000;
const RESOURCES = ["requests", "dbWrites", "connections", "rows", "bytes"];
const PROVIDERS = new Set(["meta", "google_ads", "klaviyo"]);
const CLASSES = new Set(["bootstrap", "hourly_hot_window", "deep_reconciliation", "explicitly_eligible_recovery"]);

function requireValue(condition) {
  if (!condition) throw new Error("REFRESH_POLICY_INPUT_INVALID");
}

function identifier(value) {
  requireValue(typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value);
}

function integer(value) {
  requireValue(Number.isSafeInteger(value) && value >= 0);
}

function identity(job) {
  for (const value of [job.workspaceId, job.installGeneration, job.accountId]) identifier(value);
  requireValue(PROVIDERS.has(job.provider));
}

function amounts(value) {
  requireValue(value && typeof value === "object");
  for (const resource of RESOURCES) integer(value[resource]);
}

function key(values) {
  return JSON.stringify(values);
}

function accountKey(job) {
  return key([job.provider, job.accountId]);
}

function flightKey(job) {
  return key([job.workspaceId, job.installGeneration, job.provider, job.accountId]);
}

function scopes(job) {
  return ["global", key(["provider", job.provider]), key(["workspace", job.workspaceId]), key(["account", accountKey(job)])];
}

export function refreshHourlyOffset({workspaceId, provider, accountId}) {
  identifier(workspaceId);
  identifier(accountId);
  requireValue(PROVIDERS.has(provider));
  return createHash("sha256").update(key([workspaceId, provider, accountId])).digest().readUInt32BE(0) % HOUR_MS;
}

function budgetLimits(budget, bounds) {
  amounts(budget.global);
  amounts(budget.interactiveReserve);
  const global = {};
  for (const resource of RESOURCES) {
    requireValue(budget.interactiveReserve[resource] <= budget.global[resource]);
    global[resource] = budget.global[resource] - budget.interactiveReserve[resource];
  }
  const limits = new Map([["global", global]]);
  for (const [dimension, field, getId] of [
    ["provider", "providers", entry => { requireValue(PROVIDERS.has(entry.provider)); return entry.provider; }],
    ["workspace", "workspaces", entry => { identifier(entry.workspaceId); return entry.workspaceId; }],
    ["account", "accounts", entry => { identifier(entry.accountId); requireValue(PROVIDERS.has(entry.provider)); return accountKey(entry); }],
  ]) {
    requireValue(Array.isArray(budget[field]));
    requireValue(budget[field].length <= bounds.maxCandidates + bounds.maxClaims);
    for (const entry of budget[field]) {
      amounts(entry.limit);
      const scope = key([dimension, getId(entry)]);
      requireValue(!limits.has(scope));
      limits.set(scope, entry.limit);
    }
  }
  return limits;
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function authorityAllows(job) {
  return ["installationVerified", "entitled", "connected", "setupComplete", "allowedWindow"]
    .every(field => job.authority?.[field] === true);
}

// Pure proposal only. No returned claim authorizes execution before a global CAS succeeds.
export function planRefreshAdmissions({state, candidates, budget, now, bounds}) {
  integer(now);
  for (const field of ["maxCandidates", "maxClaims", "maxAdmissions", "maxWorkspaces"]) {
    integer(bounds?.[field]);
    requireValue(bounds[field] > 0);
  }
  requireValue(Array.isArray(candidates) && candidates.length <= bounds.maxCandidates);
  integer(state.revision);
  integer(state.nextFence);
  integer(state.nextTurn);
  requireValue(Array.isArray(state.claims) && state.claims.length <= bounds.maxClaims);
  requireValue(Array.isArray(state.lastServed) && state.lastServed.length <= bounds.maxWorkspaces);
  const heldAccounts = new Set();
  requireValue(state.holds === undefined || (Array.isArray(state.holds) && state.holds.length <= bounds.maxCandidates + bounds.maxClaims));
  for (const hold of state.holds ?? []) {
    identity(hold);
    heldAccounts.add(flightKey(hold));
  }
  const turns = new Map();
  for (const entry of state.lastServed) {
    identifier(entry.workspaceId);
    integer(entry.turn);
    requireValue(entry.turn < state.nextTurn && !turns.has(entry.workspaceId));
    turns.set(entry.workspaceId, entry.turn);
  }
  const jobIds = new Set();
  for (const job of candidates) {
    identity(job);
    identifier(job.id);
    requireValue(!jobIds.has(job.id) && CLASSES.has(job.workClass));
    jobIds.add(job.id);
    integer(job.queuedAt);
    integer(job.scheduledHour);
    requireValue(job.scheduledHour % HOUR_MS === 0);
  }
  requireValue(new Set([...turns.keys(), ...candidates.map(job => job.workspaceId)]).size <= bounds.maxWorkspaces);
  let limits;
  try {
    limits = budgetLimits(budget, bounds);
  } catch {
    return {status: "blocked", admitted: [], deferred: candidates.map(job => ({id: job.id, reason: "budget_unknown"})), nextState: null};
  }
  const nextState = structuredClone(state);
  const used = new Map();
  const flights = new Set();
  function reserve(claim) {
    identity(claim);
    amounts(claim.cost);
    for (const scope of scopes(claim)) {
      const usage = used.get(scope) ?? Object.fromEntries(RESOURCES.map(resource => [resource, 0]));
      for (const resource of RESOURCES) {
        usage[resource] += claim.cost[resource];
        integer(usage[resource]);
      }
      used.set(scope, usage);
    }
    requireValue(!flights.has(flightKey(claim)));
    flights.add(flightKey(claim));
  }
  for (const claim of state.claims) {
    identifier(claim.id);
    integer(claim.fence);
    requireValue(claim.fence < state.nextFence);
    reserve(claim);
  }
  const pending = [...candidates];
  const admitted = [];
  const deferred = [];
  while (pending.length > 0) {
    pending.sort((a, b) => compare(turns.get(a.workspaceId) ?? -1, turns.get(b.workspaceId) ?? -1)
      || compare(a.queuedAt, b.queuedAt) || compare(a.workspaceId, b.workspaceId) || compare(a.id, b.id));
    const job = pending.shift();
    let reason;
    if (!authorityAllows(job)) reason = "authority_required";
    else if (job.queuedAt > now || job.scheduledHour + refreshHourlyOffset(job) > now) reason = "not_due";
    else if (heldAccounts.has(flightKey(job))) reason = "account_held";
    else if (flights.has(flightKey(job))) reason = "account_busy";
    else if (admitted.length >= bounds.maxAdmissions || nextState.claims.length >= bounds.maxClaims) reason = "dispatch_limit";
    else {
      try { amounts(job.cost); } catch { reason = "workload_unknown"; }
      if (!reason && scopes(job).some(scope => !limits.has(scope))) reason = "budget_unknown";
      if (!reason && scopes(job).some(scope => RESOURCES.some(resource => job.cost[resource] > limits.get(scope)[resource] - (used.get(scope)?.[resource] ?? 0)))) reason = "budget_full";
    }
    if (reason) {
      deferred.push({id: job.id, reason});
      continue;
    }
    // Overflow fails closed instead of reusing an unsafe fencing/ordering value.
    integer(nextState.nextFence + 1);
    integer(nextState.nextTurn + 1);
    const claim = {
      id: job.id, workspaceId: job.workspaceId, installGeneration: job.installGeneration,
      provider: job.provider, accountId: job.accountId, fence: nextState.nextFence++,
      cost: Object.fromEntries(RESOURCES.map(resource => [resource, job.cost[resource]])),
    };
    reserve(claim);
    nextState.claims.push(claim);
    admitted.push(structuredClone(claim));
    turns.set(job.workspaceId, nextState.nextTurn++);
  }
  nextState.lastServed = [...turns].map(([workspaceId, turn]) => ({workspaceId, turn}));
  if (admitted.length > 0) {
    integer(nextState.revision + 1);
    nextState.revision++;
  }
  return {status: admitted.length ? "proposed" : "waiting", admitted, deferred, nextState};
}

// Store must atomically compare the global revision and replace reservations + claims.
// No production adapter or local-memory fallback is supplied by this module.
export async function commitRefreshAdmissions({store, ...input}) {
  requireValue(typeof store?.readState === "function" && typeof store?.compareAndSwap === "function");
  let state;
  try {
    if (typeof store.readAdmissionSnapshot === "function") {
      const snapshot = await store.readAdmissionSnapshot();
      state = snapshot.state;
      // Persisted limits and revision are read together; caller-supplied limits cannot override them.
      input = {...input, budget: snapshot.budget, bounds: snapshot.bounds};
    } else state = await store.readState();
  } catch { throw new Error("REFRESH_STORE_UNAVAILABLE"); }
  const proposal = planRefreshAdmissions({...input, state});
  if (proposal.status !== "proposed") return {...proposal, admitted: []};
  let committed;
  try {
    committed = await store.compareAndSwap({expectedRevision: state.revision, nextState: proposal.nextState});
  } catch { throw new Error("REFRESH_STORE_UNAVAILABLE"); }
  if (committed !== true) return {status: "conflict", admitted: [], deferred: input.candidates.map(job => ({id: job.id, reason: "state_changed"}))};
  return {status: "reserved", admitted: proposal.admitted, deferred: proposal.deferred};
}

// A matching identity + fencing value is required; no expiry or automatic retry is inferred.
export function releaseRefreshClaim({state, claim}) {
  integer(state.revision);
  requireValue(Array.isArray(state.claims));
  identity(claim);
  identifier(claim.id);
  integer(claim.fence);
  const index = state.claims.findIndex(current => current.id === claim.id && current.fence === claim.fence && flightKey(current) === flightKey(claim));
  if (index < 0) return {released: false, nextState: structuredClone(state)};
  const nextState = structuredClone(state);
  integer(nextState.revision + 1);
  nextState.revision++;
  nextState.claims.splice(index, 1);
  return {released: true, nextState};
}
