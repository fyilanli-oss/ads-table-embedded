import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import test from "node:test";
import ts from "typescript";
import {KLAVIYO_SPEND_ERROR, klaviyoSetupAccount, klaviyoSpendError} from "../app/lib/ui/klaviyo-setup-state.js";
import {normalizeKlaviyoEstimatedSpend} from "../app/lib/oauth/klaviyo-oauth-runtime.server.js";

const account = {id: "synthetic-account", name: "Test account", currency: "USD", timezone: "UTC"};
const location = new URL("../app/routes/_admin.settings.tsx", import.meta.url);
const require = createRequire(location);
const compiled = ts.transpileModule(readFileSync(location, "utf8"), {compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}}).outputText;

function nodes(element) {
  if (!element || typeof element !== "object") return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  return [element, ...nodes(element.props?.children)];
}
const text = element => Array.isArray(element) ? element.map(text).join("")
  : element && typeof element === "object" ? text(element.props?.children)
  : element == null || typeof element === "boolean" ? "" : String(element);

// Execute the actual Settings component and handlers with deterministic hooks.
// This is a logic test, not a native custom-element or visual acceptance test.
function harness({accounts = [account], providerRuntime = () => assert.fail("unexpected runtime")} = {}) {
  const h = {cells: [], dirty: false, pendingEffects: [], navigation: {state: "idle"},
    revalidator: {state: "idle", revalidate() { this.state = "loading"; h.dirty = true; }},
    fetcher: {state: "idle", data: undefined, submit(form) {
      h.submissions.push(Object.fromEntries(form)); this.state = "submitting"; h.dirty = true;
    }}, submissions: [],
    state: {view: "connected", accounts: [account], reportingAccountId: account.id,
      meta: {view: "connected", accounts: [account], reportingAccountId: account.id},
      klaviyo: {view: "pending", accounts}, permissionAvailability: {}},
  };
  let cursor = 0;
  const hooks = {
    useRef(value) { const i = cursor++; return h.cells[i] ??= {current: value}; },
    useState(value) {
      const i = cursor++;
      if (!(i in h.cells)) h.cells[i] = typeof value === "function" ? value() : value;
      return [h.cells[i], next => {
        next = typeof next === "function" ? next(h.cells[i]) : next;
        if (!Object.is(next, h.cells[i])) { h.cells[i] = next; h.dirty = true; }
      }];
    },
    useEffect(effect, deps) {
      const i = cursor++, previous = h.cells[i];
      if (!previous || deps.some((d,j) => !Object.is(d,previous.deps[j]))) {
        const next = {deps, cleanup: null}; h.cells[i] = next;
        h.pendingEffects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  const verified = {installationAuthority: {workspaceId: "synthetic", installGeneration: 1},
    context: {redirect: path => new Response(null, {status: 302, headers: {Location: path}})}};
  const imported = id => {
    if (id === "react") return {...require(id), ...hooks};
    if (id === "react-router") return {useLoaderData: () => h.state, useActionData: () => undefined,
      useNavigation: () => h.navigation, useRevalidator: () => h.revalidator, useFetcher: () => h.fetcher,
      useSubmit: () => () => assert.fail("unexpected navigation submission")};
    if (id === "../components/use-permission-settings") return {usePermissionSettings: props => {h.permissionProps = props; return {busy: false, checkingProduct: false, content: null};}};
    if (id === "../components/product-access-removal") return {ProductAccessRemoval: "ProductAccessRemoval"};
    if (id === "../shopify.server") return {authenticate: {admin: async () => verified}, database: {}, providerTokenVault: {}};
    if (id.endsWith("/shopify-route-authority.server.js")) return {resolveShopifyRouteAuthority: async () => verified};
    if (id.endsWith("/klaviyo-oauth-runtime.server.js")) return {createKlaviyoOAuthRuntime: providerRuntime, normalizeKlaviyoEstimatedSpend};
    return require(id);
  };
  const exports = {};
  new Function("require", "exports", compiled)(imported, exports);
  h.action = fields => exports.action({request: new Request("https://example.test/settings", {
    method: "POST", body: new URLSearchParams(fields),
  })});
  h.render = () => {
    const savedLocation = globalThis.location, savedHistory = globalThis.history;
    globalThis.location = {href: "https://example.test/settings"};
    globalThis.history = {replaceState() {}};
    try {
      for (let run = 0; run < 12; run++) {
        cursor = 0; h.dirty = false; h.pendingEffects = [];
        h.tree = exports.default();
        for (const element of nodes(h.tree)) {
          if (element.ref && typeof element.ref === "object") {
            element.ref.current ??= {value: "", visible: false, handlers: {},
              showOverlay() { this.visible = true; }, hideOverlay() { this.hideRequested = true; },
              addEventListener(name, fn) { this.handlers[name] = fn; },
              removeEventListener(name, fn) { if (this.handlers[name] === fn) delete this.handlers[name]; },
              emitHidden() { this.visible = false; this.handlers.afterhide?.({target: this}); },
            };
            if (element.props?.value !== undefined) element.ref.current.value = element.props.value;
          }
        }
        for (const effect of h.pendingEffects) effect();
        if (!h.dirty) return h.tree;
      }
      assert.fail("component did not settle");
    } finally { globalThis.location = savedLocation; globalThis.history = savedHistory; }
  };
  h.find = (tag, label) => nodes(h.tree).find(e => e.type === tag && (label === undefined || text(e) === label));
  h.accountModal = () => nodes(h.tree).find(e => e.props?.id === "klaviyo-setup-modal");
  h.modal = () => nodes(h.tree).find(e => e.props?.id === "klaviyo-initial-spend-modal");
  h.field = () => nodes(h.modal()).find(e => e.type === "s-number-field");
  h.input = value => { h.field().props.onInput({currentTarget: {value}}); h.render(); };
  h.chooseAccount = (id = account.id) => {
    nodes(h.accountModal()).find(e=>e.type === "s-choice-list").ref.current.values = [id];
    nodes(h.accountModal()).find(e=>e.type === "s-button" && text(e)==="Continue").props.onClick();
    h.render();
    assert.equal(h.modal().ref.current.visible, false);
    h.accountModal().ref.current.emitHidden(); h.render();
  };
  h.render(); return h;
}

test("spend feedback agrees with the unchanged server for zero, limits and malformed amounts", () => {
  for (const value of ["", " ", "-1", "01", "1e3", "NaN", "Infinity", "1.001", "100000000", null, undefined,
    "0", "0.00", "32", "32.1", "99999999.99"]) {
    let valid = true;
    try { normalizeKlaviyoEstimatedSpend(value); } catch { valid = false; }
    assert.equal(klaviyoSpendError(value) === "", valid, String(value));
  }
});

test("one or multiple Klaviyo accounts always require explicit selection before the separate spend modal", () => {
  assert.equal(klaviyoSetupAccount([], account.id), null);
  assert.equal(klaviyoSetupAccount([account], null), null);
  const other = {...account, id: "other"};
  assert.equal(klaviyoSetupAccount([account,other], "stale"), null);
  assert.equal(klaviyoSetupAccount([account,other], other.id), other);
  const h = harness();
  assert.match(text(h.tree), /Account selection required/);
  assert.equal(h.accountModal().props.heading, "Select Klaviyo account");
  assert.equal(h.modal().ref.current.visible, false);
  assert.equal(nodes(h.accountModal()).some(e=>e.type === "s-number-field"), false);
  h.chooseAccount();
  assert.equal(h.accountModal().ref.current.visible, false);
  assert.equal(h.modal().ref.current.visible, true);
  assert.equal(nodes(h.modal()).some(e=>e.type === "s-choice-list"), false);
  const multiple = harness({accounts: [account,other]});
  assert.match(text(multiple.tree), /Account selection required/);
  assert.equal(multiple.accountModal().props.heading, "Select Klaviyo account");
  multiple.state.klaviyo.accounts = [];
  multiple.render();
  assert.equal(multiple.field(), undefined);
  assert.equal(multiple.submissions.length, 0);
});

test("blank initial spend stays in the modal; zero submits once without hiding other providers", () => {
  const h = harness();
  h.chooseAccount();
  h.find("s-button", "Save and connect").props.onClick(); h.render();
  assert.equal(h.field().props.error, KLAVIYO_SPEND_ERROR);
  assert.equal(h.modal().props.heading, "Add estimated email spend");
  assert.equal(h.submissions.length, 0);
  h.input("0");
  const save = h.find("s-button", "Save and connect");
  save.props.onClick(); save.props.onClick(); h.render();
  assert.deepEqual(h.submissions, [{intent: "complete_klaviyo", provider: "klaviyo", accountId: account.id, estimatedSpend: "0"}]);
  assert.equal(h.find("s-button", "Save and connect").props.loading, true);
  assert.ok(h.modal());
  assert.equal(nodes(h.tree).filter(e=>e.type === "s-badge" && text(e) === "Working").length, 0);
  assert.equal(nodes(h.tree).filter(e=>e.type === "s-badge" && text(e) === "Connected").length, 2);
});

test("account Cancel or missing/foreign selection never advances, writes, or opens spend", () => {
  const h = harness();
  h.accountModal().ref.current.emitHidden(); h.render();
  assert.equal(h.modal().ref.current.visible, false);
  h.find("s-button", "Resume setup").props.onClick(); h.render();
  h.revalidator.state = "idle"; h.render();
  for (const values of [[], ["foreign"], [account.id, "foreign"]]) {
    nodes(h.accountModal()).find(e=>e.type === "s-choice-list").ref.current.values = values;
    h.find("s-button", "Continue").props.onClick(); h.render();
    assert.equal(h.modal().ref.current.visible, false);
    assert.match(nodes(h.accountModal()).find(e=>e.type === "s-choice-list").props.error, /Select one/);
  }
  assert.equal(h.submissions.length, 0);
});

test("account hide transition is one-shot and stale account selection cannot authorize spend", () => {
  const h = harness();
  h.chooseAccount();
  h.accountModal().ref.current.emitHidden(); h.render();
  assert.equal(h.modal().ref.current.visible, true);
  h.state.klaviyo = {view: "pending", accounts: [{...account, id: "replacement"}]}; h.render();
  assert.equal(h.field(), undefined);
  const save = h.find("s-button", "Save and connect");
  assert.equal(save.props.disabled, true); save.props.onClick();
  assert.equal(h.submissions.length, 0);
});

test("server field errors preserve the entered value; unknown failures require a status check", () => {
  const h = harness(); h.chooseAccount(); h.input("12.50"); h.find("s-button", "Save and connect").props.onClick(); h.render();
  h.fetcher.state = "idle";
  h.fetcher.data = {ok: false, provider: "klaviyo", fieldError: KLAVIYO_SPEND_ERROR}; h.render();
  assert.equal(h.field().props.value, "12.50");
  assert.equal(h.field().props.error, KLAVIYO_SPEND_ERROR);
  h.input("15"); h.find("s-button", "Save and connect").props.onClick(); h.render();
  h.fetcher.state = "idle"; h.fetcher.data = {ok: false, provider: "klaviyo", code: "UNKNOWN"}; h.render();
  assert.match(text(h.modal()), /The save could not be confirmed/);
  h.input("18");
  const save = h.find("s-button", "Save and connect");
  assert.equal(save.props.disabled, true);
  save.props.onClick(); assert.equal(h.submissions.length, 2);
  nodes(h.modal()).find(e=>e.type === "s-button" && text(e) === "Check status").props.onClick(); h.render();
  assert.equal(nodes(h.tree).filter(e=>e.type === "s-badge" && text(e) === "Working").length, 1);
  assert.equal(nodes(h.tree).filter(e=>e.type === "s-badge" && text(e) === "Connected").length, 2);
  h.revalidator.state = "idle"; h.render();
  assert.equal(h.find("s-button", "Save and connect").props.disabled, false);
  assert.equal(h.submissions.length, 2);
});

test("direct invalid submissions are rejected before completing setup; zero reaches the unchanged runtime", async () => {
  let writes = 0, runtimes = 0;
  const h = harness({providerRuntime: () => { runtimes++; return {complete: async input => {
    writes++; assert.equal(input.estimatedSpend, "0");
  }}; }});
  const base = {intent: "complete_klaviyo", provider: "klaviyo", accountId: account.id};
  const invalid = await h.action({...base, estimatedSpend: ""});
  assert.equal(invalid.fieldError, KLAVIYO_SPEND_ERROR);
  assert.equal(writes, 0);
  assert.equal(runtimes, 0);
  const success = await h.action({...base, estimatedSpend: "0"});
  assert.equal(success.status, 302);
  assert.equal(writes, 1);
});

test("navigation and unrelated reloads never mark all three providers Working", () => {
  for (const provider of ["google_ads", "meta", "klaviyo"]) {
    const h = harness();
    h.navigation.state = "submitting";
    h.navigation.formData = new FormData();
    h.navigation.formData.set("provider", provider);
    h.render();
    const working = nodes(h.tree).filter(e=>e.type === "s-section"
      && nodes(e).some(n=>n.type === "s-badge" && text(n) === "Working"));
    assert.deepEqual(working.map(e=>e.props.heading), [provider === "google_ads" ? "Google Ads" : provider === "meta" ? "Meta" : "Klaviyo"]);
    h.navigation.state = "idle"; h.revalidator.state = "loading"; h.render();
    assert.equal(nodes(h.tree).filter(e=>e.type === "s-badge" && text(e) === "Working").length, 0);
  }
});

test("successful setup replaces the pending modal only after server state becomes Connected", () => {
  const h = harness(); h.chooseAccount(); h.input("32"); h.find("s-button", "Save and connect").props.onClick(); h.render();
  assert.ok(h.modal());
  h.state.klaviyo = {view: "connected", account, current: {id: "period", amount: "32", currency: "USD", effectiveFrom: "2026-10-31", correctionVersion: 0}, periods: []};
  h.fetcher.state = "idle"; h.fetcher.data = undefined; h.render();
  assert.equal(h.modal(), undefined);
  assert.equal(nodes(h.tree).filter(e=>e.type === "s-badge" && text(e) === "Connected").length, 3);
});

test("Products card shows fresh verified access without Connect or technical activation copy", () => {
  const h = harness(); h.state.shopifyProductAccess = "ready"; h.render();
  assert.ok(nodes(h.tree).some(e => e.type === "s-badge" && text(e) === "Ürün erişimi onaylandı"));
  assert.ok(nodes(h.tree).some(e => e.type === "ProductAccessRemoval" && e.props.ready === true));
  assert.equal(nodes(h.tree).some(e => e.type === "s-button" && text(e) === "Connect Shopify products"), false);
  assert.equal(text(h.tree).includes("awaiting activation"), false);
});

test("Products missing and unknown remain distinct; unknown offers readback instead of a repeat grant", () => {
  const h = harness(); h.state.shopifyProductAccess = "missing"; h.render();
  assert.ok(nodes(h.tree).some(e => e.type === "s-button" && text(e) === "Connect Shopify products"));
  h.state = {...h.state, shopifyProductAccess: "unknown"}; h.render();
  assert.equal(nodes(h.tree).some(e => e.type === "s-button" && text(e) === "Connect Shopify products"), false);
  assert.ok(nodes(h.tree).some(e => e.type === "s-button" && text(e) === "Durumu kontrol et"));
});

test("Products status reply updates its card immediately and a new loader cannot retain stale ready state", () => {
  const h = harness(); h.state.shopifyProductAccess = "missing"; h.render();
  h.permissionProps.onProductStatus("ready"); h.render();
  assert.ok(nodes(h.tree).some(e => e.type === "s-badge" && text(e) === "Ürün erişimi onaylandı"));
  h.state = {...h.state, shopifyProductAccess: "missing"}; h.render();
  assert.equal(nodes(h.tree).some(e => e.type === "s-badge" && text(e) === "Ürün erişimi onaylandı"), false);
});
