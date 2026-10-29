import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import test from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {createPermissionExplanationFlow, permissionResumeTarget} from "../app/lib/ui/permission-explanation-flow.js";
import {PERMISSION_EXPLANATIONS} from "../app/lib/ui/permission-explanation-copy.js";

for (const feature of Object.keys(PERMISSION_EXPLANATIONS)) {
  test(`${feature}: open and native cancellation perform no request`, async () => {
    let calls = 0;
    const flow = createPermissionExplanationFlow({request: () => { calls++; }, canRequest: () => true});
    const {session} = flow.open(feature);
    assert.equal(calls, 0);
    flow.hide(session);
    await flow.afterHide(session);
    assert.equal(calls, 0);
    assert.equal(flow.snapshot.phase, "idle");
    assert.equal(flow.snapshot.feature, null, "Cancel restores the previous view without a new status action");
  });

  test(`${feature}: Connect waits for native afterhide, duplicate events cannot dispatch twice`, async () => {
    const calls = [];
    let resolve;
    const flow = createPermissionExplanationFlow({canRequest: () => true,
      request: id => { calls.push(id); return new Promise(r => { resolve = r; }); }});
    const {session} = flow.open(feature);
    assert.equal(flow.connect(session, () => { flow.hide(session); }), true);
    assert.equal(flow.snapshot.phase, "hiding_for_connect");
    assert.equal(calls.length, 0);
    assert.equal(flow.connect(session, () => assert.fail()), false);
    const completion = flow.afterHide(session);
    assert.equal(flow.snapshot.phase, "starting");
    assert.equal(await flow.afterHide(session), false);
    assert.equal(flow.open("meta"), null);
    resolve({granted: true, secret: "must-not-be-retained"});
    await completion;
    assert.deepEqual(calls, [feature]);
    assert.equal(flow.snapshot.phase, "awaiting_status");
    assert.equal(JSON.stringify(flow.snapshot).includes("secret"), false);
    assert.equal(flow.connect(session, () => assert.fail()), false);
  });
}

test("default closed gate and gate drift do not call an adapter", async () => {
  const closed = createPermissionExplanationFlow({request: () => assert.fail()});
  const first = closed.open("google_ads");
  assert.equal(closed.connect(first.session, () => assert.fail()), false);
  assert.equal(closed.snapshot.phase, "unavailable");
  let available = true;
  const drift = createPermissionExplanationFlow({request: () => assert.fail(), canRequest: () => available});
  const next = drift.open("shopify_orders");
  drift.connect(next.session, () => {});
  available = false;
  await drift.afterHide(next.session);
  assert.equal(drift.snapshot.phase, "unavailable");
});

test("request failure and hide failure stay unknown without retry or a raw error", async () => {
  for (const failHide of [false, true]) {
    let calls = 0;
    const flow = createPermissionExplanationFlow({canRequest: () => true,
      request: () => { calls++; throw new Error("private provider response"); }});
    const {session} = flow.open("klaviyo");
    flow.connect(session, () => { if (failHide) throw new Error("private DOM failure"); });
    await flow.afterHide(session);
    await flow.afterHide(session);
    assert.equal(calls, failHide ? 0 : 1);
    assert.equal(flow.snapshot.phase, "unknown");
    assert.equal(flow.open("meta"), null);
    assert.equal(JSON.stringify(flow.snapshot).includes("private"), false);
  }
});

test("only one explanation can open and stale hide cannot cancel the next session", async () => {
  const flow = createPermissionExplanationFlow();
  assert.equal(flow.open("__proto__"), null);
  const first = flow.open("meta");
  assert.equal(flow.open("google_ads"), null);
  await flow.afterHide(first.session);
  const next = flow.open("shopify_products");
  assert.equal(flow.hide(first.session), false);
  assert.equal(await flow.afterHide(first.session), false);
  assert.equal(flow.snapshot.session, next.session);
  assert.equal(flow.snapshot.phase, "explaining");
});

test("account, asset, activation and zero-cost completion paths never request permissions", () => {
  assert.equal(permissionResumeTarget("request_permissions"), "explanation");
  for (const [stage, target] of Object.entries({select_account: "account", select_reporting_account: "reporting_account",
    verify_assets: "assets", review_setup: "activation_pending", klaviyo_cost_missing: "cost"})) {
    assert.equal(permissionResumeTarget(stage), target);
  }
  for (const stage of [null, undefined, "connected", "__proto__", "toString"]) {
    assert.equal(permissionResumeTarget(stage), "check_status");
  }
});

test("rendered copy source matches all five approved explanations without provider authority", () => {
  const design = JSON.parse(readFileSync(new URL("../contracts/eo-05-permission-explanation-design-v1.json", import.meta.url)));
  assert.equal(Object.keys(PERMISSION_EXPLANATIONS).length, 5);
  for (const expected of design.modals) {
    assert.deepEqual(PERMISSION_EXPLANATIONS[expected.id], {heading: expected.heading, paragraphs: expected.paragraphs});
    assert.ok(Object.isFrozen(PERMISSION_EXPLANATIONS[expected.id].paragraphs));
  }
  const component = readFileSync(new URL("../app/components/permission-explanation.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /<(?:button|input|select|form|dialog)\b|\bstyle=|<style\b|className=|<s-clickable\b/);
  assert.doesNotMatch(component, /fetch\(|oauthBoundary|permissionSetup\.request|authorizationUrl/);
});

test("actual React component renders one native modal and every approved paragraph; closed gates disable Connect", () => {
  const location = new URL("../app/components/permission-explanation.tsx", import.meta.url);
  const source = readFileSync(location, "utf8");
  const compiled = ts.transpileModule(source, {compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(createRequire(location), exports);
  for (const [feature, copy] of Object.entries(PERMISSION_EXPLANATIONS)) {
    const props = {snapshot: {phase: "explaining", feature, session: 1}, requestsAvailable: true,
      onConnect: () => assert.fail(), onHide: () => assert.fail(), onAfterHide: () => assert.fail()};
    const html = renderToStaticMarkup(createElement(exports.PermissionExplanation, props));
    assert.equal((html.match(/<s-modal\b/g) ?? []).length, 1);
    for (const paragraph of copy.paragraphs) assert.ok(html.includes(paragraph));
    assert.match(html, /slot="primary-action"/);
    assert.match(html, /slot="secondary-actions"/);
    assert.doesNotMatch(html, /<s-button[^>]+disabled/);
    const closed = renderToStaticMarkup(createElement(exports.PermissionExplanation, {...props, requestsAvailable: false}));
    assert.match(closed, /Connection setup is not available yet\./);
    assert.match(closed, /<s-button[^>]+disabled/);
    assert.doesNotMatch(closed, /<button|<dialog|<form|style=/);
  }
});
