import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import {renderToStaticMarkup} from "react-dom/server";
import {createCombinedSetupAccounts} from "../app/lib/oauth/combined-setup-accounts.server.js";
import {createPermissionSettings} from "../app/lib/shopify/permission-settings.server.js";

const accounts = [{id: "one", name: "First"}, {id: "two", name: "Second"}];
const selection = {connectionId: "connection", version: 7, reportingAccountId: null, accounts};
const owner = {workspaceId: "workspace", installGeneration: 2};
const verified = {context: {}, installationAuthority: owner};
const status = (feature, stage, extra = {}) => ({kind: "status", feature, stage, ...extra});

// Execute the production hook, including its fetcher correlation and afterhide
// handlers. Native rendering/animation remains an explicit owner acceptance gate.
function harness(feature = "meta", initial = {view: "combined"}) {
  const location = new URL("../app/components/use-permission-settings.tsx", import.meta.url);
  const require = createRequire(location);
  const compiled = ts.transpileModule(readFileSync(location, "utf8"), {compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  const h = {cells: [], effects: [], cursor: 0, dirty: false, requests: [], connections: [], disconnections: [],
    props: {availability: {google_ads: true, meta: true}, productOwner: "shop:workspace:2",
      initialProviders: {[feature]: initial}, onResume: () => assert.fail("must not refresh all providers"),
      onConnection: (...value) => h.connections.push(value),
      onDisconnected: feature => {
        h.disconnections.push(feature);
        h.props = {...h.props, initialProviders: {...h.props.initialProviders, [feature]: {view: "disconnected"}}};
      }},
    fetcher: {state: "idle", data: undefined, submit(value) {h.requests.push(value); h.fetcher.state = "submitting";}},
  };
  const hooks = {
    useRef(value) {return h.cells[h.cursor++] ??= {current: value};},
    useState(value) {
      const i = h.cursor++;
      if (!(i in h.cells)) h.cells[i] = typeof value === "function" ? value() : value;
      return [h.cells[i], next => {next = typeof next === "function" ? next(h.cells[i]) : next;
        if (!Object.is(next, h.cells[i])) {h.cells[i] = next; h.dirty = true;}}];
    },
    useCallback(fn, deps) {
      const i = h.cursor++, previous = h.cells[i];
      if (!previous || deps.some((d, j) => !Object.is(d, previous.deps[j]))) h.cells[i] = {fn, deps};
      return h.cells[i].fn;
    },
    useEffect(fn, deps) {
      const i = h.cursor++, previous = h.cells[i];
      if (!previous || deps.some((d, j) => !Object.is(d, previous.deps[j]))) {
        const next = {deps}; h.cells[i] = next;
        h.effects.push(() => {previous?.cleanup?.(); next.cleanup = fn();});
      }
    },
  };
  const exports = {};
  new Function("require", "exports", compiled)(id => {
    if (id === "react") return {...require(id), ...hooks};
    if (id === "react-router") return {useFetcher: () => h.fetcher};
    if (id.startsWith("./permission-")) return new Proxy({}, {get: (_, name) => name});
    return require(id);
  }, exports);
  h.render = () => {
    for (let i = 0; i < 20; i++) {
      h.cursor = 0; h.effects = []; h.dirty = false;
      h.result = exports.usePermissionSettings(h.props);
      for (const effect of h.effects) effect();
      if (!h.dirty) return;
    }
    assert.fail("hook did not settle");
  };
  h.flush = async () => {for (let i = 0; i < 5; i++) {await Promise.resolve(); h.render();}};
  h.reply = async value => {
    const request = h.requests.at(-1);
    h.fetcher.data = {...value, requestId: request.requestId}; h.fetcher.state = "idle";
    await h.flush();
  };
  h.disconnectModal = () => h.result.content.props.children.find(element => element?.type === "PermissionProviderDisconnect");
  h.modal = () => h.result.content.props.children.find(element => element?.type === "PermissionSetupSelection");
  h.render();
  return h;
}

for (const feature of ["google_ads", "meta"]) {
  test(`${feature}: Disconnect opens immediately with no read; Cancel and stale hide events do no I/O`, async () => {
    const initial = {view: "connected", connectionBinding: {connectionId: "connection", version: 7}};
    const h = harness(feature, initial);
    void h.result.manageProvider(feature, "disconnect");
    void h.result.manageProvider(feature, "disconnect");
    h.render();
    const modal = h.disconnectModal().props;
    assert.equal(h.requests.length, 0);
    assert.doesNotMatch(renderToStaticMarkup(h.result.providerContent(feature)) ?? "", /Verifying access/);
    assert.equal(h.result.busy, true);
    await modal.onAfterHide(); h.render();
    assert.equal(h.disconnectModal(), undefined); assert.equal(h.requests.length, 0);
    await h.result.manageProvider(feature, "disconnect"); h.render();
    const next = h.disconnectModal();
    await modal.onAfterHide(); h.render();
    assert.equal(h.disconnectModal().key, next.key);
    assert.equal(h.requests.length, 0); assert.deepEqual(h.disconnections, []);
  });

  test(`${feature}: confirmed Disconnect posts once after afterhide and immediately renders Not connected + Connect`, async () => {
    const h = harness(feature, {view: "connected", connectionBinding: {connectionId: "connection", version: 7}});
    await h.result.manageProvider(feature, "disconnect"); h.render();
    const modal = h.disconnectModal().props;
    let hides = 0;
    modal.onConfirm(() => hides++); modal.onConfirm(() => hides++);
    assert.equal(hides, 1); assert.equal(h.requests.length, 0);
    const saving = modal.onAfterHide(); void modal.onAfterHide(); h.render();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].intent, "permission_disconnect");
    assert.equal(h.requests[0].connectionId, "connection"); assert.equal(h.requests[0].version, "7");
    assert.match(renderToStaticMarkup(h.result.providerContent(feature)), /Disconnecting/);
    await h.reply(status(feature, "request_permissions")); await saving; h.render();
    const html = renderToStaticMarkup(h.result.providerContent(feature));
    assert.match(html, /Not connected/);
    assert.match(html, feature === "meta" ? /Connect Meta/ : /Connect Google Ads/);
    assert.doesNotMatch(html, /Resume setup|Disconnecting|Verifying access/);
    assert.deepEqual(h.disconnections, [feature]); assert.equal(h.requests.length, 1);
    assert.equal(h.result.busy, false);
  });

  test(`${feature}: unknown Disconnect stays unknown and cannot replay or claim success`, async () => {
    const h = harness(feature, {view: "connected", connectionBinding: {connectionId: "connection", version: 7}});
    await h.result.manageProvider(feature, "disconnect"); h.render();
    const modal = h.disconnectModal().props;
    modal.onConfirm(() => {});
    const saving = modal.onAfterHide();
    await h.reply({kind: "unknown", feature}); await saving; h.render();
    const html = renderToStaticMarkup(h.result.providerContent(feature));
    assert.match(html, /could not confirm|Resume setup/); assert.doesNotMatch(html, /Not connected/);
    assert.deepEqual(h.disconnections, []);
    await h.result.manageProvider(feature, "disconnect"); h.render();
    assert.equal(h.requests.length, 1); assert.equal(h.disconnectModal(), undefined);
    const reading = h.result.resumeProvider(feature);
    assert.equal(h.requests[1].intent, "permission_reconcile");
    await h.reply({kind: "unknown", feature}); await reading;
    assert.equal(h.requests.filter(request => request.intent === "permission_disconnect").length, 1);
  });

  test(`${feature}: changed installation cannot complete Disconnect with an old response`, async () => {
    const h = harness(feature, {view: "connected", connectionBinding: {connectionId: "connection", version: 7}});
    await h.result.manageProvider(feature, "disconnect"); h.render();
    const modal = h.disconnectModal().props;
    modal.onConfirm(() => {});
    const saving = modal.onAfterHide();
    h.props = {...h.props, productOwner: "shop:workspace:3"}; h.render();
    await h.reply(status(feature, "request_permissions")); await saving; h.render();
    assert.deepEqual(h.disconnections, []); assert.equal(h.disconnectModal(), undefined);
  });

  test(`${feature}: server rejects a stale connection version before any disconnect adapter`, async () => {
    let writes = 0;
    const runtime = {combinedSetup: {reconcile: async () => ({setupResumeAction: "reporting_selected",
      connectionId: "connection", connectionVersion: 8, reportingAccountId: "one", accounts})},
      disconnect: async () => {writes++; assert.fail("stale confirmed binding must not write");}};
    const settings = createPermissionSettings({availability: {[feature]: true}, providerRuntime: () => runtime});
    await assert.rejects(settings.manage({feature, verified, expected: {connectionId: "connection", version: 7}, operation: "disconnect"}), /BINDING_INVALID/);
    assert.equal(writes, 0);
  });

  test(`${feature}: Reporting Account management also waits for afterhide and updates only its card`, async () => {
    const h = harness(feature, {view: "connected"});
    const opening = h.result.manageProvider(feature, "reporting");
    await h.reply(status(feature, "reporting_selected", {connection: {...selection, reportingAccountId: "one"}})); await opening;
    const modal = h.modal().props;
    assert.equal(modal.model.stage, "change_reporting");
    modal.onConfirm(modal.model.key, {accountIds: ["two"]}, () => {});
    assert.equal(h.requests.length, 1);
    const saving = modal.onAfterHide(modal.model.key);
    assert.equal(h.requests.at(-1).intent, "permission_change_reporting");
    await h.reply(status(feature, "reporting_selected", {connection: {...selection, reportingAccountId: "two"}})); await saving;
    assert.equal(h.connections[0][1].reportingAccountId, "two");
  });

  test(`${feature}: confirmed browser return opens a server-bound selector once; reload/cancel does not reopen`, async () => {
    const storage = globalThis.sessionStorage;
    const values = new Map([["adstable-permission-return", JSON.stringify({feature, owner: "shop:workspace:2", until: Date.now() + 60000})]]);
    globalThis.sessionStorage = {getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key)};
    try {
      const initial = {view: "combined", permission: status(feature, "select_account", {selection})};
      const h = harness(feature, initial);
      assert.ok(h.modal()); assert.equal(h.requests.length, 0); assert.equal(values.size, 0);
      const modal = h.modal().props; await modal.onAfterHide(modal.model.key); h.render();
      assert.equal(h.modal(), undefined);
      assert.equal(harness(feature, initial).modal(), undefined);
    } finally {globalThis.sessionStorage = storage;}
  });

  test(`${feature}: Reporting Account readback accepts its actual independent SQL period without inventing a connection version bump`, async () => {
    let reportingAccountId = "one", writes = 0;
    const runtime = {combinedSetup: {reconcile: async () => ({setupResumeAction: "reporting_selected", connectionId: "connection",
      connectionVersion: 7, accounts, reportingAccountId})}, changeReporting: async input => {
      writes++; reportingAccountId = input.reportingAccountId; return {connectionId: "connection", reportingAccountId, changed: true};
    }};
    const settings = createPermissionSettings({availability: {[feature]: true}, providerRuntime: () => runtime});
    const result = await settings.manage({feature, verified, expected: selection, operation: "reporting", reportingAccountId: "two"});
    assert.equal(writes, 1); assert.equal(result.connection.version, 7); assert.equal(result.connection.reportingAccountId, "two");
    await assert.rejects(settings.manage({feature, verified, expected: {...selection, version: 6}, operation: "reporting", reportingAccountId: "one"}), /BINDING_INVALID/);
    assert.equal(writes, 1);
  });

  test(`${feature}: account save advances after afterhide without Resume, duplicate write or provider reload`, async () => {
    const h = harness(feature);
    const opening = h.result.resumeProvider(feature);
    await h.reply(status(feature, "select_account", {selection})); await opening;
    const first = h.modal().props;
    let hides = 0;
    first.onConfirm(first.model.key, {accountIds: ["one", "two"]}, () => hides++);
    first.onConfirm(first.model.key, {accountIds: ["one"]}, () => hides++);
    assert.equal(hides, 1); assert.equal(h.requests.length, 1);
    const saving = first.onAfterHide(first.model.key);
    first.onAfterHide(first.model.key);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].intent, "permission_select_accounts");
    await h.reply(status(feature, "select_reporting_account", {selection: {...selection, version: 8}})); await saving;
    assert.equal(h.modal().props.model.stage, "select_reporting_account");
    assert.equal(h.modal().props.model.selection.version, 8);
    const second = h.modal().props;
    second.onConfirm(second.model.key, {accountIds: ["two"]}, () => {});
    const finishing = second.onAfterHide(second.model.key);
    await h.reply(status(feature, "reporting_selected", {connection: {...selection, version: 9, reportingAccountId: "two"}})); await finishing;
    assert.equal(h.modal(), undefined); assert.equal(h.connections.length, 1);
    assert.equal(h.connections[0][0], feature); assert.equal(h.connections[0][1].reportingAccountId, "two");
    assert.equal(h.requests.length, 3);
  });

  test(`${feature}: cancel never saves/advances; one Resume and no legacy controls`, async () => {
    const h = harness(feature);
    const opening = h.result.resumeProvider(feature);
    await h.reply(status(feature, "select_account", {selection})); await opening;
    const first = h.modal().props;
    await first.onAfterHide(first.model.key); h.render();
    assert.equal(h.requests.length, 1); assert.equal(h.modal(), undefined);
    const html = renderToStaticMarkup(h.result.providerContent(feature));
    assert.equal((html.match(/<s-button/g) ?? []).length, 1);
    assert.match(html, /Resume setup/); assert.doesNotMatch(html, /Reconnect|Check status/);
  });

  test(`${feature}: lost save reply reconciles read-only and never replays selection`, async () => {
    const h = harness(feature);
    const opening = h.result.resumeProvider(feature);
    await h.reply(status(feature, "select_account", {selection})); await opening;
    const first = h.modal().props;
    first.onConfirm(first.model.key, {accountIds: ["one"]}, () => {});
    const saving = first.onAfterHide(first.model.key);
    await h.reply({kind: "unknown", feature}); await saving;
    assert.equal(h.result.canManage(feature), false);
    const recovering = h.result.resumeProvider(feature);
    assert.equal(h.requests.at(-1).intent, "permission_reconcile");
    await h.reply(status(feature, "reporting_selected", {connection: {...selection, version: 8, accounts: [accounts[0]], reportingAccountId: "one"}})); await recovering;
    assert.equal(h.requests.filter(value => value.intent === "permission_select_accounts").length, 1);
    assert.equal(h.connections.length, 1);
  });

  test(`${feature}: changed installation discards the old reply and its pending modal`, async () => {
    const h = harness(feature);
    const opening = h.result.resumeProvider(feature);
    h.props = {...h.props, productOwner: "shop:workspace:3"}; h.render();
    await h.reply(status(feature, "select_account", {selection})); await opening;
    assert.equal(h.modal(), undefined); assert.equal(h.connections.length, 0);
  });

  test(`${feature}: reconciliation uses only durable reads, including expired/missing token scenarios`, async () => {
    const current = {connectionId: "connection", version: 7, credentialId: "private", status: "connected"};
    let reads = 0;
    const forbidden = new Proxy({}, {get: () => assert.fail("no token/native/mutation access")});
    const combined = createCombinedSetupAccounts({provider: feature, enabled: true,
      lifecycle: {loadCurrent: async () => {reads++; return current;}}, runtime: forbidden, tokenVault: forbidden,
      accountAuthority: {load: async input => {assert.deepEqual(input, {...owner, provider: feature});
        return {...current, accounts, reportingAccountId: "two", access_token: "must-not-leave"};}}, selections: forbidden});
    const result = await combined.reconcile({installationAuthority: owner});
    assert.equal(result.setupResumeAction, "reporting_selected"); assert.equal(reads, 2);
    assert.doesNotMatch(JSON.stringify(result), /credentialId|private|access_token|must-not-leave/);
    const settings = createPermissionSettings({availability: {[feature]: true}, providerRuntime: () => ({combinedSetup: combined})});
    const projected = await settings.reconcile({feature, verified});
    assert.equal(projected.connection.reportingAccountId, "two");
  });

  test(`${feature}: reconciliation detects a concurrent version change before publishing Connected`, async () => {
    let version = 7;
    const combined = createCombinedSetupAccounts({provider: feature, enabled: true,
      lifecycle: {loadCurrent: async () => ({connectionId: "connection", credentialId: "credential", status: "connected", version: version++})},
      accountAuthority: {load: async () => ({connectionId: "connection", credentialId: "credential", accounts, reportingAccountId: "two"})}});
    await assert.rejects(combined.reconcile({installationAuthority: owner}), /CONNECTION_CHANGED/);
  });
}
