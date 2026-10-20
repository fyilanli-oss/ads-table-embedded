// Internal, verified coordinator observations only; never accepts raw provider payloads.
export const REFRESH_STOP_REASONS = Object.freeze([
  "not_due", "account_busy", "budget_full", "dispatch_limit",
  "configuration_missing", "authority_required", "reauthorization_required",
  "connection_closed", "entitlement_required", "budget_unknown", "workload_unknown",
  "provider_permission_denied", "provider_throttled", "provider_rejected", "provider_unknown_error",
  "stopped_before_call", "worker_stopped", "worker_lost", "request_outcome_unknown",
]);

export function refreshWorkIdentity(value, {claimRequired = false} = {}) {
  for (const field of ["workspaceId", "installGeneration", "provider", "accountId", "id"]) {
    if (typeof value?.[field] !== "string" || !value[field].length || value[field].length > 256
      || value[field] !== value[field].trim()) throw new Error("REFRESH_WORK_INPUT_INVALID");
  }
  if (!/^[1-9][0-9]*$/.test(value.installGeneration)
    || !["meta", "google_ads", "klaviyo"].includes(value.provider)
    || (value.fence != null && (!Number.isSafeInteger(value.fence) || value.fence < 1))
    || (claimRequired && value.fence == null)) throw new Error("REFRESH_WORK_INPUT_INVALID");
  return [value.workspaceId, value.installGeneration, value.provider, value.accountId, value.id, value.fence ?? null];
}

export function refreshStopInput({job, reason, expectedRevision}) {
  if (!REFRESH_STOP_REASONS.includes(reason) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("REFRESH_WORK_INPUT_INVALID");
  }
  const identity = refreshWorkIdentity(job);
  if ((reason.startsWith("provider_") || ["stopped_before_call", "worker_stopped", "worker_lost", "request_outcome_unknown"].includes(reason))
    && job.fence == null) throw new Error("REFRESH_WORK_INPUT_INVALID");
  return [...identity, reason, expectedRevision];
}
