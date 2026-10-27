import test from "node:test";
import assert from "node:assert/strict";
import {runIdentityReadDeadline, IdentityReadDeadlineError} from "../app/lib/providers/identity-read-deadline.server.js";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test("never-resolving dependency rejects on total timer even if it ignores abort", async () => {
  let signal;
  await assert.rejects(runIdentityReadDeadline({timeoutMs: 20, run: child => {signal = child; return new Promise(() => {});}}),
    e => e instanceof IdentityReadDeadlineError && e.code === "IDENTITY_READ_DEADLINE_EXCEEDED");
  assert.equal(signal.aborted, true);
});
test("already-aborted caller never starts callback and does not expose external reason", async () => {
  const caller = new AbortController(); caller.abort("secret-user-reason"); let calls = 0;
  await assert.rejects(runIdentityReadDeadline({signal: caller.signal, run: () => {calls++;}}),
    e => e.code === "IDENTITY_READ_ABORTED" && !e.message.includes("secret")); assert.equal(calls, 0);
});
test("external cancellation immediately aborts child and returns without waiting on dependency", async () => {
  const caller = new AbortController(); let child;
  const pending = runIdentityReadDeadline({signal: caller.signal, run: s => {child = s; return new Promise(() => {});}});
  caller.abort(); await assert.rejects(pending, /IDENTITY_READ_ABORTED/); assert.equal(child.aborted, true);
});
test("total budget is not reset by sequential phases", async () => {
  let phases = 0;
  await assert.rejects(runIdentityReadDeadline({timeoutMs: 20, run: async signal => {
    phases++; await delay(12); if (signal.aborted) return;
    phases++; await delay(20); if (!signal.aborted) phases++;
  }}), /DEADLINE_EXCEEDED/);
  await delay(35); assert.ok(phases <= 2);
});
test("late dependency rejection after timeout is handled without successful result or unhandled rejection", async () => {
  let reject;
  await assert.rejects(runIdentityReadDeadline({timeoutMs: 10, run: () => new Promise((resolve, r) => {reject = r;})}), /DEADLINE_EXCEEDED/);
  reject(Error("late-provider-error")); await delay(0);
});
test("success clears timer and removes caller listener without later aborting child", async () => {
  const caller = new AbortController(); let child, adds = 0, removes = 0;
  const add = caller.signal.addEventListener.bind(caller.signal), remove = caller.signal.removeEventListener.bind(caller.signal);
  caller.signal.addEventListener = (...args) => {adds++; return add(...args);};
  caller.signal.removeEventListener = (...args) => {removes++; return remove(...args);};
  const object = {};
  assert.equal(await runIdentityReadDeadline({signal: caller.signal, timeoutMs: 20, run: s => {child = s; return object;}}), object);
  assert.equal(adds, 1); assert.equal(removes, 1); caller.abort(); await delay(30); assert.equal(child.aborted, false);
});
test("first callback error keeps exact identity and clears timer", async () => {
  const error = new Error("controlled"), caller = new AbortController(); let child;
  await assert.rejects(runIdentityReadDeadline({signal: caller.signal, timeoutMs: 10, run: s => {child = s; throw error;}}), e => e === error);
  caller.abort(); await delay(15); assert.equal(child.aborted, false);
});
test("concurrent collections have independent timers and cancellation", async () => {
  const caller = new AbortController(); let otherSignal;
  const first = runIdentityReadDeadline({signal: caller.signal, run: () => new Promise(() => {})});
  const second = runIdentityReadDeadline({timeoutMs: 200, run: async s => {otherSignal = s; await delay(10); return "ok";}});
  caller.abort(); await assert.rejects(first, /ABORTED/); assert.equal(await second, "ok"); assert.equal(otherSignal.aborted, false);
});
test("invalid callback, budget or fake signal fails before work starts", async () => {
  for (const input of [{run: null}, {timeoutMs: 0}, {timeoutMs: 600001}, {timeoutMs: NaN}, {timeoutMs: 1.5}, {signal: {aborted: false}}]) {
    let calls = 0; await assert.rejects(runIdentityReadDeadline({run: () => {calls++;}, ...input}), /INPUT_INVALID/); assert.equal(calls, 0);
  }
});
