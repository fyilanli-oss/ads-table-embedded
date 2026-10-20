import {refreshHourlyOffset} from "./admission-policy.server.js";

const PROVIDERS = new Set(["meta", "google_ads", "klaviyo"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function requireInput(ok) { if (!ok) throw new Error("REFRESH_QUEUE_INPUT_INVALID"); }
function integer(value) { requireInput(Number.isSafeInteger(value) && value >= 0); }
function identifier(value) { requireInput(typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 256); }

// Only a trusted, complete internal inventory loader may supply these facts.
// Count equality detects truncation, not a dishonest or incorrectly scoped loader.
export function prepareRefreshInventory(inventory) {
  requireInput(inventory?.complete === true && Array.isArray(inventory.workspaces));
  integer(inventory.expectedWorkspaces); integer(inventory.expectedAccounts); integer(inventory.observedAtMs);
  requireInput(inventory.workspaces.length === inventory.expectedWorkspaces);
  const workspaces = new Set(), accounts = new Set(), rows = [];
  for (const workspace of inventory.workspaces) {
    requireInput(UUID.test(workspace.workspaceId) && !workspaces.has(workspace.workspaceId) && Array.isArray(workspace.accounts));
    workspaces.add(workspace.workspaceId);
    for (const account of workspace.accounts) {
      requireInput(PROVIDERS.has(account.provider)); identifier(account.accountId); identifier(account.connectionId);
      requireInput(/^[1-9][0-9]*$/.test(account.installGeneration)); integer(Number(account.installGeneration));
      integer(account.connectionVersion); requireInput(account.connectionVersion > 0);
      integer(account.eligibleFromMs); requireInput(typeof account.eligible === "boolean" && typeof account.connectionOpen === "boolean");
      requireInput(!account.eligible || account.connectionOpen);
      const row = {workspaceId: workspace.workspaceId, installGeneration: account.installGeneration,
        provider: account.provider, accountId: account.accountId, connectionId: account.connectionId,
        connectionVersion: account.connectionVersion, eligibleFromMs: account.eligibleFromMs, eligible: account.eligible, connectionOpen: account.connectionOpen};
      const key = JSON.stringify([row.workspaceId,row.installGeneration,row.provider,row.accountId]);
      requireInput(!accounts.has(key)); accounts.add(key);
      rows.push({...row, offsetMs: refreshHourlyOffset(row)});
    }
  }
  requireInput(rows.length === inventory.expectedAccounts);
  return {observedAtMs: inventory.observedAtMs, workspaces: [...workspaces], accounts: rows};
}

// No provider request, retry, Dataset write or execution claim is made here.
export async function runRefreshQueueCheck({store, loadInventory}) {
  requireInput(typeof store?.readQueueCheck === "function" && typeof store?.commitQueueCheck === "function" && typeof loadInventory === "function");
  try {
    const state = await store.readQueueCheck();
    if (!state?.configured) return {status: "not_configured"};
    const inventory = prepareRefreshInventory(await loadInventory());
    const result = await store.commitQueueCheck({expectedRevision: state.revision, inventory});
    return result?.committed === true ? {status: "checked", ...result} : {status: "conflict"};
  } catch { return {status: "needs_attention"}; }
}

// Pure decision for a FUTURE independent observer; not a running watchdog.
export function refreshQueueSilence({activatedAtMs, lastSuccessAtMs, nowMs}) {
  integer(nowMs);
  if (activatedAtMs === null) return {status: "inactive"};
  integer(activatedAtMs);
  if (lastSuccessAtMs !== null) integer(lastSuccessAtMs);
  const reference = lastSuccessAtMs ?? activatedAtMs;
  if (reference < activatedAtMs || reference > nowMs) return {status: "invalid_clock"};
  return {status: nowMs - reference > 120_000 ? "critical" : "within_window", elapsedMs: nowMs - reference};
}
