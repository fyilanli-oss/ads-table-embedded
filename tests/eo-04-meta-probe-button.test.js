import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createMetaProbeButtonRunner, META_PROBE_BUTTON_INPUT,
} from "../app/lib/providers/meta-probe-button.js";

function complete(overrides = {}) {
  return {status: "complete", ...META_PROBE_BUTTON_INPUT,
    publishable_to_dataset_v2: false, channel: {row_count: 1}, product: {row_count: 2},
    ...overrides};
}
const response = (value, ok = true) => ({ok, redirected: false, async json() {return value;}});

test("Meta button sends the exact authorized body once, including concurrent clicks", async () => {
  const calls = [];
  let release;
  const delayed = new Promise(resolve => {release = resolve;});
  const runner = createMetaProbeButtonRunner({fetchFn: async (...args) => {
    calls.push(args); await delayed; return response(complete());
  }});
  assert.equal(runner.attempted, false);
  const first = runner.run();
  assert.equal(runner.attempted, true);
  assert.equal(await runner.run(), null);
  release();
  assert.deepEqual(await first, {status: "complete", channelRows: 1, productRows: 2});
  assert.equal(await runner.run(), null);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["/settings/provider-live-evidence", {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({provider: "meta", business_date: "2026-10-01", probe: "promoted_product_metrics"}),
  }]);
});

test("Meta button projects only counts, never raw rows, names, metrics, identifiers or hashes", async () => {
  const payload = complete({authority: {token: "private-token", account: "act_private"},
    product: {row_count: 2, rows: [{product_id: "private-product", value: "987.65"}],
      product_identity_sha256: ["private-hash"]}});
  const runner = createMetaProbeButtonRunner({fetchFn: async () => response(payload)});
  const result = await runner.run();
  assert.deepEqual(result, {status: "complete", channelRows: 1, productRows: 2});
  assert.doesNotMatch(JSON.stringify(result), /private|987[.]65|act_/);
});

test("empty product result remains an observed row count, not a sales zero or unsupported flag", async () => {
  const runner = createMetaProbeButtonRunner({fetchFn: async () => response(complete({product: {row_count: 0}}))});
  assert.deepEqual(await runner.run(), {status: "complete", channelRows: 1, productRows: 0});
});

test("HTTP, permission, auth, malformed JSON and network failures stop permanently without retry", async () => {
  for (const makeResponse of [
    () => response({status: "failed", code: "META_LIVE_EVIDENCE_FAILED"}, false),
    () => response({status: "failed", code: "buyer@example.com secret"}, false),
    () => ({ok: false, redirected: false, async json() {throw Error("private-json");}}),
    () => {throw Error("private-network");},
    () => ({ok: true, redirected: true, async json() {throw Error("must not read");}}),
  ]) {
    let calls = 0;
    const runner = createMetaProbeButtonRunner({fetchFn: async () => {calls++; return makeResponse();}});
    const result = await runner.run();
    assert.equal(result.status, "failed");
    assert.match(result.code, /^[A-Z0-9_]{1,100}$/);
    assert.doesNotMatch(JSON.stringify(result), /private|buyer|secret/);
    assert.equal(await runner.run(), null);
    assert.equal(runner.attempted, true);
    assert.equal(calls, 1);
  }
});

test("wrong provider/date/probe, unsafe counts or publishable envelope are not shown as success", async () => {
  for (const overrides of [
    {provider: "google_ads"}, {business_date: "2026-10-02"}, {probe: "other"},
    {publishable_to_dataset_v2: true}, {channel: null}, {product: {row_count: "2"}},
    {channel: {row_count: -1}}, {product: {row_count: Infinity}}, {status: "failed"},
  ]) {
    const runner = createMetaProbeButtonRunner({fetchFn: async () => response(complete(overrides))});
    assert.equal((await runner.run()).status, "failed");
    assert.equal(await runner.run(), null);
  }
});

test("temporary button contract keeps real UI acceptance open and transport free of server credentials", () => {
  const contract = JSON.parse(fs.readFileSync(new URL("../contracts/eo-04-provider-live-acceptance-v1.json", import.meta.url), "utf8"));
  const button = contract.promoted_product_probe_2026_10_22.temporary_button;
  assert.equal(button.component, "s-button");
  assert.equal(button.single_attempt_per_settings_mount, true);
  assert.equal(button.new_mount_authorizes_another_live_call, false);
  assert.equal(button.visual_acceptance, "pending_desktop_real_mobile_and_owner_acceptance");
  assert.equal(button.merge, "explicit_product_owner_approval_2026_10_22");
  assert.equal(button.visual_acceptance_timing_exception.scope, "PR164_temporary_fixed_meta_probe_button_only");
  assert.equal(button.visual_acceptance_timing_exception.review_timing, "immediately_after_deployment");
  assert.equal(button.visual_acceptance_timing_exception.desktop_and_real_mobile_acceptance_still_required, true);
  assert.equal(button.visual_acceptance_timing_exception.visual_pass_or_package_closure_granted, false);
  assert.equal(button.visual_acceptance_timing_exception.other_ui_gates_changed, false);
  const source = fs.readFileSync(new URL("../app/lib/providers/meta-probe-button.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console[.]|process[.]env|setTimeout|setInterval|graph[.]facebook|authorization:/i);
  assert.doesNotMatch(source, /import .*server/);
});
