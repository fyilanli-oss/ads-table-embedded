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
  connectionVersion: 8, setupComplete: false, setupResumeAction: "verify_assets"});
const proof = feature => ({provider: feature, workspaceId: "workspace", installGeneration: 2,
  connectionId: expected.connectionId, connectionVersion: 7, reportingAccountId: "123", accessState: "verified",
  persisted: false, setupComplete: false, authorizesActivation: false, expiresAt: new Date(Date.now() + 60000).toISOString(),
  assetAccess: feature === "google_ads" ? {merchantId: "99", accountAccessVerified: true, productsEndpointReadable: true,
    relationship: "observed_direct_ads_merchant_link"} : {businessId: "88", catalogId: "77", advertiserAccessVerified: true,
    productsEndpointReadable: true, relationship: "selected_business_asset_access_only_not_ad_catalog_delivery"}});

for (const feature of ["google_ads", "meta"]) {
  test(`${feature}: selection uses only the combined methods with the displayed binding`, async () => {
    const calls = [];
    const settings = createPermissionSettings({availability, providerRuntime: () => ({
      select: () => assert.fail(), finishReporting: () => assert.fail(),
      combinedSetup: {
        select: async input => { calls.push(input); return receipt(feature); },
        finishReporting: async input => { calls.push(input); return receipt(feature); },
      },
    })});
    const result = await settings.select({feature, verified, expected, operation: "accounts", selectedAccountIds: ["123"]});
    assert.deepEqual(result, {kind: "status", feature, stage: "verify_assets"});
    assert.deepEqual(calls[0], {installationAuthority: verified.installationAuthority,
      expectedConnection: {connectionId: "connection", version: 7}, selectedAccountIds: ["123"]});
    await settings.select({feature, verified, expected, operation: "reporting", reportingAccountId: "123"});
    assert.equal(calls.length, 2);
    assert.equal(calls[1].reportingAccountId, "123");
  });
  test(`${feature}: default closed selection and verification do no I/O`, async () => {
    const settings = createPermissionSettings({providerRuntime: () => assert.fail()});
    assert.deepEqual(await settings.select({feature, verified, expected, operation: "accounts", selectedAccountIds: ["123"]}), {kind: "unavailable", feature});
    assert.deepEqual(await settings.verifyAssets({feature, verified, expected}), {kind: "unavailable", feature});
  });
  test(`${feature}: asset candidates go to the native verifier and only matching temporary proof is shown`, async () => {
    let calls = 0;
    const observed = proof(feature);
    const targets = feature === "google_ads" ? {merchantId: "99"} : {businessId: "88", catalogId: "77"};
    const settings = createPermissionSettings({availability, providerRuntime: () => ({combinedSetup: {
      verifyAssets: async input => {
        calls++;
        assert.deepEqual(input, {installationAuthority: verified.installationAuthority, verified,
          expectedConnection: expected, ...targets});
        return observed;
      },
    }})});
    assert.deepEqual(await settings.verifyAssets({feature, verified, expected, ...targets}),
      {kind: "status", feature, stage: "review_setup", expiresAt: observed.expiresAt});
    assert.equal(calls, 1);
  });
  test(`${feature}: stale/wrong proof and an unconfirmed selection are never completed or retried`, async () => {
    for (const mutation of [{expiresAt: "2020-01-01"}, {connectionVersion: 8}, {workspaceId: "other"},
      {authorizesActivation: true}, {assetAccess: {}}, {persisted: true}]) {
      let calls = 0;
      const settings = createPermissionSettings({availability, providerRuntime: () => ({combinedSetup: {
        verifyAssets: async () => { calls++; return {...proof(feature), ...mutation}; },
      }})});
      await assert.rejects(settings.verifyAssets({feature, verified, expected, merchantId: "99", businessId: "88", catalogId: "77"}), /ASSET_UNCONFIRMED/);
      assert.equal(calls, 1);
    }
    let writes = 0;
    const settings = createPermissionSettings({availability, providerRuntime: () => ({combinedSetup: {
      select: async () => { writes++; return {...receipt(feature), connectionVersion: 9}; },
    }})});
    await assert.rejects(settings.select({feature, verified, expected, operation: "accounts", selectedAccountIds: ["123"]}), /SELECTION_UNCONFIRMED/);
    assert.equal(writes, 1);
  });
}

test("syntax-only asset candidates cannot call the native verifier, and scopes/profile are not selection fields", async () => {
  const settings = createPermissionSettings({availability, providerRuntime: () => assert.fail()});
  for (const merchantId of ["", "0", "-1", "1e5", "9223372036854775808"]) {
    await assert.rejects(settings.verifyAssets({feature: "google_ads", verified, expected, merchantId}), /ASSET_TARGET_INVALID/);
  }
});

test("transport rejects malformed inventories, duplicate accounts and expired access observations", () => {
  const pending = {requestId: "request", feature: "meta"};
  const selection = {...expected, accounts: [{id: "123", name: "Shop"}]};
  const reply = {kind: "status", stage: "select_account", ...pending, selection};
  assert.equal(permissionResponseMatches(reply, pending), true);
  for (const altered of [{...selection, version: 0}, {...selection, accounts: [...selection.accounts, ...selection.accounts]},
    {...selection, accounts: [{id: "123", name: {unsafe: true}}]}]) {
    assert.equal(permissionResponseMatches({...reply, selection: altered}, pending), false);
  }
  assert.equal(permissionResponseMatches({...reply, expiresAt: "2020-01-01"}, pending), false);
});

test("actual selection component renders native candidate choices without manual IDs and escapes account names", () => {
  const sourceLocation = new URL("../app/components/permission-setup-selection.tsx", import.meta.url);
  const source = readFileSync(sourceLocation, "utf8");
  const output = ts.transpileModule(source, {compilerOptions: {jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  new Function("require", "exports", output)(createRequire(sourceLocation), exports);
  for (const feature of ["google_ads", "meta"]) {
    for (const stage of ["select_account", "select_reporting_account", "verify_assets"]) {
      const model = {key: "view", feature, stage, selection: {...expected, accounts: [{id: "123", name: "<script>unsafe</script>"}],
        ...(stage === "verify_assets" ? {assetOptions: {candidateKind: feature === "meta" ? "catalogs" : "merchant_accounts",
          businessId: feature === "meta" ? "88" : null, candidates: [{id: "77", name: "Visible catalog"}],
          expiresAt: new Date(Date.now() + 60000).toISOString(), complete: true, accessVerified: false}} : {})}};
      const html = renderToStaticMarkup(createElement(exports.PermissionSetupSelection, {model, busy: false,
        onConfirm: () => assert.fail(), onAfterHide: () => assert.fail()}));
      assert.equal((html.match(/<s-modal\b/g) ?? []).length, 1);
      assert.doesNotMatch(html, /<script|<button|<input|<form|style=/);
      if (stage !== "verify_assets") {
        assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
        assert.match(html, /<s-choice-list/);
        assert.doesNotMatch(html, /<s-text-field/);
      } else {
        assert.match(html, /Access will be verified before setup can continue/);
        assert.match(html, /<s-choice-list/);
        assert.doesNotMatch(html, /<s-text-field/);
      }
    }
  }
});
