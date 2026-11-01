import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createPermissionSettings} from "../app/lib/shopify/permission-settings.server.js";
import {permissionResponseMatches} from "../app/lib/ui/permission-settings-response.js";

const verified = {context: {}, installationAuthority: {workspaceId: "workspace", installGeneration: 2}};
const availability = {google_ads: true, meta: true};
const expected = {connectionId: "connection", version: 7, reportingAccountId: "123"};
const receipt = feature => ({provider: feature, connectionId: expected.connectionId,
  connectionVersion: 8, setupComplete: false, setupResumeAction: "reporting_selected"});

for (const feature of ["google_ads", "meta"]) {
  test(`${feature}: selection uses only the combined methods with the displayed binding`, async () => {
    const calls = [];
    const settings = createPermissionSettings({availability, providerRuntime: () => ({
      select: () => assert.fail(), finishReporting: () => assert.fail(),
      combinedSetup: {
        reconcile: async () => ({...receipt(feature), reportingAccountId: "123", accounts: [{id: "123", name: "Shop"}]}),
        select: async input => { calls.push(input); return receipt(feature); },
        finishReporting: async input => { calls.push(input); return receipt(feature); },
      },
    })});
    const result = await settings.select({feature, verified, expected, operation: "accounts", selectedAccountIds: ["123"]});
    assert.deepEqual(result, {kind: "status", feature, stage: "reporting_selected", connection: {connectionId: "connection", version: 8, reportingAccountId: "123", accounts: [{id: "123", name: "Shop"}]}});
    assert.deepEqual(calls[0], {installationAuthority: verified.installationAuthority,
      expectedConnection: {connectionId: "connection", version: 7}, selectedAccountIds: ["123"]});
    await settings.select({feature, verified, expected, operation: "reporting", reportingAccountId: "123"});
    assert.equal(calls.length, 2);
    assert.equal(calls[1].reportingAccountId, "123");
  });
  test(`${feature}: default closed selection does no I/O`, async () => {
    const settings = createPermissionSettings({providerRuntime: () => assert.fail()});
    assert.deepEqual(await settings.select({feature, verified, expected, operation: "accounts", selectedAccountIds: ["123"]}), {kind: "unavailable", feature});
  });
  test(`${feature}: unconfirmed selection is never completed or retried`, async () => {
    let writes = 0;
    const settings = createPermissionSettings({availability, providerRuntime: () => ({combinedSetup: {
      select: async () => { writes++; return {...receipt(feature), connectionVersion: 9}; },
    }})});
    await assert.rejects(settings.select({feature, verified, expected, operation: "accounts", selectedAccountIds: ["123"]}), /SELECTION_UNCONFIRMED/);
    assert.equal(writes, 1);
  });
}

test("transport rejects malformed inventories, duplicate accounts and removed asset observations", () => {
  const pending = {requestId: "request", feature: "meta"};
  const selection = {...expected, accounts: [{id: "123", name: "Shop"}]};
  const reply = {kind: "status", stage: "select_account", ...pending, selection};
  assert.equal(permissionResponseMatches(reply, pending), true);
  for (const altered of [{...selection, version: 0}, {...selection, accounts: [...selection.accounts, ...selection.accounts]},
    {...selection, accounts: [{id: "123", name: {unsafe: true}}]}]) {
    assert.equal(permissionResponseMatches({...reply, selection: altered}, pending), false);
  }
  assert.equal(permissionResponseMatches({...reply, expiresAt: "2020-01-01"}, pending), false);
  assert.equal(permissionResponseMatches({...reply, selection: {...selection, assetOptions: {}}}, pending), false);
  assert.equal(permissionResponseMatches({...reply, stage: "verify_assets"}, pending), false);
});

test("actual selection component renders only account choices, preserves escaping and has no catalog controls", () => {
  const sourceLocation = new URL("../app/components/permission-setup-selection.tsx", import.meta.url);
  const source = readFileSync(sourceLocation, "utf8");
  const output = ts.transpileModule(source, {compilerOptions: {jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  new Function("require", "exports", output)(createRequire(sourceLocation), exports);
  for (const feature of ["google_ads", "meta"]) {
    for (const stage of ["select_account", "select_reporting_account"]) {
      const model = {key: "view", feature, stage, selection: {...expected, accounts: [{id: "123", name: "<script>unsafe</script>"}]}};
      const html = renderToStaticMarkup(createElement(exports.PermissionSetupSelection, {model, busy: false,
        onConfirm: () => assert.fail(), onAfterHide: () => assert.fail()}));
      assert.equal((html.match(/<s-modal\b/g) ?? []).length, 1);
      assert.doesNotMatch(html, /<script|<button|<input|<form|style=/);
      assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
      assert.match(html, /<s-choice-list/);
      assert.match(html, /Save selection/);
      assert.doesNotMatch(html, /<s-text-field|Merchant|[Cc]atalog|[Bb]usiness|Verify access/);
    }
  }
});
