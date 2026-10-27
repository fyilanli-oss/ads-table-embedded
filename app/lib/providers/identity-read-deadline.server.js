export class IdentityReadDeadlineError extends Error {
  constructor(code) {super(code); this.name = "IdentityReadDeadlineError"; this.code = code;}
}

// One total wall timer per collection, not a fresh budget per page/request. Callbacks must
// propagate the child signal and check it around dependencies; this cannot kill blocking JS
// or roll back an external request that was already sent.
export async function runIdentityReadDeadline({signal, timeoutMs = 120000, run} = {}) {
  if (typeof run !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000
    || signal !== undefined && !(signal instanceof AbortSignal)) throw new IdentityReadDeadlineError("IDENTITY_READ_INPUT_INVALID");
  const controller = new AbortController();
  let finished = false, reason = null, rejectStop;
  const stopped = new Promise((resolve, reject) => {rejectStop = reject;});
  // A synchronous callback error or already-aborted input can precede the race attachment.
  stopped.catch(() => {});
  function stop(code) {
    if (finished || reason !== null) return;
    reason = new IdentityReadDeadlineError(code);
    controller.abort(reason); rejectStop(reason);
  }
  const onAbort = () => stop("IDENTITY_READ_ABORTED");
  signal?.addEventListener("abort", onAbort, {once: true});
  const timer = setTimeout(() => stop("IDENTITY_READ_DEADLINE_EXCEEDED"), timeoutMs);
  try {
    if (signal?.aborted) onAbort();
    if (reason !== null) throw reason;
    // Invoke synchronously so existing config/rule/Admin capture-before-first-await holds.
    const result = await Promise.race([run(controller.signal), stopped]);
    if (reason !== null) throw reason;
    return result;
  } finally {
    finished = true; clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
  }
}
