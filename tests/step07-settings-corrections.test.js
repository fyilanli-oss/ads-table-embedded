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

test("Settings places permission feedback inside its own provider section, never under Shopify",()=>{
  const h=harness();
  h.permissionResult={providerContent:feature=>require("react").createElement("s-banner",{heading:`feedback-${feature}`})};
  h.render();
  const sections=nodes(h.tree).filter(e=>e.type==="s-section");
  for(const [heading,feature] of [["Meta","meta"],["Google Ads","google_ads"],["Klaviyo","klaviyo"]]){
    const section=sections.find(e=>e.props.heading===heading);
    assert.ok(nodes(section).some(e=>e.props?.heading===`feedback-${feature}`));
    for(const other of sections.filter(e=>e!==section))assert.equal(nodes(other).some(e=>e.props?.heading===`feedback-${feature}`),false);
  }
});

// Execute the actual Settings component and handlers with deterministic hooks.
// This is a logic test, not a native custom-element or visual acceptance test.
function harness({accounts = [account], providerRuntime = () => assert.fail("unexpected runtime")} = {}) {
  const h = {cells: [], dirty: false, pendingEffects: [], navigation: {state: "idle"},
    revalidator: {state: "idle", revalidate() { this.state = "loading"; h.dirty = true; }},
    fetcher: {state: "idle", data: undefined, submit(form) {
      h.submissions.push(Object.fromEntries(form)); this.state = "submitting"; h.dirty = true;
    }}, submissions: [], modalHandles: new Map(),
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
    if (id === "../components/use-permission-settings") return {usePermissionSettings: props => {h.permissionProps = props; return {canManage: () => !props.externalBusy && !props.externalLock.current, busy: props.externalBusy || !!props.externalLock.current, checkingProduct: false, content: null, providerContent: () => null, ...h.permissionResult};}};
    if (id === "../components/product-access-removal") return {ProductAccessRemoval: "ProductAccessRemoval"};
    if (id === "../components/order-access-removal") return {OrderAccessRemoval: "OrderAccessRemoval"};
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
        const currentModals = [];
        for (const element of nodes(h.tree)) {
          let modal;
          if (element.type === "s-modal") {
            modal = h.modalHandles.get(element.props.id);
            if (!modal) {
              modal = {id: element.props.id, value: "", visible: false, handlers: new Map(),
                addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name,new Set()); this.handlers.get(name).add(fn); },
                removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn); },
                emit(name) { for (const fn of [...(this.handlers.get(name) ?? [])]) fn({target:this}); },
                showOverlay() {this.visible=true;this.emit("show");},
                hideOverlay() {this.hideRequested=true;},
                emitHidden() {this.visible=false;this.emit("afterhide");},
              };
              h.modalHandles.set(element.props.id,modal);
            }
            currentModals.push(modal);
          }
          if (element.ref && typeof element.ref === "object") {
            if (modal) element.ref.current = modal;
            else element.ref.current ??= {value: ""};
            if (element.type === "s-page") element.ref.current.querySelectorAll = () => currentModals;
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
  assert.match(text(h.tree), /Select your account to finish setup\./);
  assert.equal(h.accountModal().props.heading, "Select Klaviyo account");
  assert.equal(h.modal().ref.current.visible, false);
  assert.equal(nodes(h.accountModal()).some(e=>e.type === "s-number-field"), false);
  h.chooseAccount();
  assert.equal(h.accountModal().ref.current.visible, false);
  assert.equal(h.modal().ref.current.visible, true);
  assert.equal(nodes(h.modal()).some(e=>e.type === "s-choice-list"), false);
  const multiple = harness({accounts: [account,other]});
  assert.match(text(multiple.tree), /Select your account to finish setup\./);
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
  assert.equal(nodes(h.tree).filter(e=>e.type === "s-banner" && e.props.heading === "Verifying access…").length, 1);
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
      && nodes(e).some(n=>n.type === "s-banner" && n.props.heading === "Verifying access…"));
    assert.deepEqual(working.map(e=>e.props.heading), provider === "klaviyo" ? ["Klaviyo"] : []);
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
  assert.ok(nodes(h.tree).some(e => e.type === "s-paragraph" && text(e) === "Product access approved"));
  assert.ok(nodes(h.tree).some(e => e.type === "ProductAccessRemoval" && e.props.ready === true));
  assert.equal(nodes(h.tree).some(e => e.type === "s-button" && text(e) === "Connect products"), false);
  assert.equal(text(h.tree).includes("awaiting activation"), false);
});

test("Products missing and unknown remain distinct; unknown offers readback instead of a repeat grant", () => {
  const h = harness(); h.state.shopifyProductAccess = "missing"; h.render();
  assert.ok(nodes(h.tree).some(e => e.type === "s-button" && text(e) === "Connect products"));
  h.state = {...h.state, shopifyProductAccess: "unknown"}; h.render();
  assert.equal(nodes(h.tree).some(e => e.type === "s-button" && text(e) === "Connect products"), false);
  assert.ok(nodes(h.tree).some(e => e.type === "s-button" && text(e) === "Check status"));
});

test("Products status reply updates its card immediately and a new loader cannot retain stale ready state", () => {
  const h = harness(); h.state.shopifyProductAccess = "missing"; h.render();
  h.permissionProps.onProductStatus("ready"); h.render();
  assert.ok(nodes(h.tree).some(e => e.type === "s-paragraph" && text(e) === "Product access approved"));
  h.state = {...h.state, shopifyProductAccess: "missing"}; h.render();
  assert.equal(nodes(h.tree).some(e => e.type === "s-paragraph" && text(e) === "Product access approved"), false);
});

test("verified removal has one English result without the initial not-connected message", () => {
  const h = harness(); h.state.shopifyProductAccess = "missing";
  h.permissionResult = {productRemovalResult: "removed"}; h.render();
  assert.equal(nodes(h.tree).filter(e => e.type === "s-banner" && e.props.heading === "Product access removed.").length, 1);
  assert.equal(text(h.tree).includes("Product access is not connected."), false);
  assert.ok(nodes(h.tree).some(e => e.type === "s-button" && text(e) === "Connect products"));
});

test("Orders card independently reflects verified grant, removal, unknown and a new loader",()=>{
  const h=harness();h.state.shopifyProductAccess="ready";h.state.shopifyOrderAccess="ready";h.render();
  assert.ok(nodes(h.tree).some(e=>e.type==="s-paragraph"&&text(e)==="Order access approved"));
  assert.ok(nodes(h.tree).some(e=>e.type==="OrderAccessRemoval"&&e.props.ready===true));
  assert.equal(nodes(h.tree).some(e=>e.type==="s-button"&&text(e)==="Connect orders"),false);
  h.permissionProps.onOrderStatus("missing");h.permissionResult={orderRemovalResult:"removed"};h.render();
  assert.ok(nodes(h.tree).some(e=>e.type==="s-banner"&&e.props.heading==="Order access removed."));
  assert.equal(text(h.tree).includes("Order access is not connected."),false);
  assert.ok(nodes(h.tree).some(e=>e.type==="s-paragraph"&&text(e)==="Product access approved"));
  assert.ok(nodes(h.tree).some(e=>e.type==="s-button"&&text(e)==="Connect orders"));
  h.state={...h.state,shopifyOrderAccess:"unknown"};h.render();
  assert.equal(nodes(h.tree).some(e=>e.type==="s-button"&&text(e)==="Connect orders"),false);
});

test("Settings passes pure Shopify Shop GID separately from composite view ownership",()=>{
  const h=harness();h.state={...h.state,shopifyPermissionOwner:"gid://shopify/Shop/123",permissionViewOwner:"gid://shopify/Shop/123:workspace:2"};h.render();
  assert.equal(h.permissionProps.shopifyShopId,"gid://shopify/Shop/123");
  assert.equal(h.permissionProps.productOwner,"gid://shopify/Shop/123:workspace:2");
});

test("Klaviyo save completion removes its modal lock without requiring a fresh Settings view",()=>{
  const h=harness();h.chooseAccount();
  assert.equal(h.permissionProps.externalLock.current,"klaviyo-initial-spend-modal");
  assert.equal(h.permissionProps.externalBusy,true);
  h.input("49");h.find("s-button","Save and connect").props.onClick();h.render();
  assert.equal(nodes(h.tree).filter(e=>e.type==="s-banner"&&e.props.heading==="Saving estimated spend…").length,1);
  assert.equal(h.permissionProps.externalBusy,true);
  h.state={...h.state,klaviyo:{view:"connected",account,current:{id:"period",amount:"49",currency:"USD",effectiveFrom:"2026-11-01",correctionVersion:0},periods:[]}};
  h.fetcher.state="idle";h.fetcher.data=undefined;h.render();
  assert.equal(h.modal(),undefined);assert.equal(h.permissionProps.externalLock.current,null);
  assert.equal(h.permissionProps.externalBusy,false);
  assert.equal(h.find("s-button","Disconnect").props.disabled,undefined);
  assert.equal(h.find("s-button","Update spend").props.disabled,undefined);
  assert.equal(h.submissions.length,1);
  // A late native event from the removed modal cannot re-lock the page.
  h.modalHandles.get("klaviyo-initial-spend-modal").emitHidden();h.render();
  assert.equal(h.permissionProps.externalBusy,false);
});

test("Klaviyo modal cleanup releases only its own lock, and owner changes clear an old modal",()=>{
  const h=harness();h.chooseAccount();
  h.permissionProps.externalLock.current="another-provider-modal";
  h.state={...h.state,klaviyo:{view:"disconnected",notice:null}};h.render();
  assert.equal(h.permissionProps.externalLock.current,"another-provider-modal");
  const other=harness();other.chooseAccount();
  other.state={...other.state,permissionViewOwner:"shop:workspace:3"};other.render();
  assert.equal(other.permissionProps.externalLock.current,null);
  assert.equal(other.permissionProps.externalBusy,false);
  assert.equal(other.submissions.length,0);
});

test("Klaviyo disconnect uses one info progress banner and a verified success notice",()=>{
  const h=harness();h.state={...h.state,klaviyo:{view:"connected",account,current:{amount:"49",currency:"USD",effectiveFrom:"2026-11-01"},periods:[]}};h.render();
  h.navigation.state="submitting";h.navigation.formData=new FormData();h.navigation.formData.set("provider","klaviyo");h.navigation.formData.set("intent","disconnect");h.render();
  assert.equal(nodes(h.tree).filter(e=>e.type==="s-banner"&&e.props.tone==="info"&&e.props.heading==="Disconnecting…").length,1);
  assert.equal(nodes(h.tree).some(e=>e.type==="s-badge"&&text(e)==="Working"),false);
  assert.doesNotMatch(text(h.tree),/Klaviyo was disconnected/);
  h.navigation.state="idle";h.state={...h.state,klaviyo:{view:"disconnected",notice:"disconnected"}};h.render();
  assert.equal(nodes(h.tree).filter(e=>e.type==="s-banner"&&e.props.tone==="success"&&text(e)==="Klaviyo was disconnected.").length,1);
  assert.ok(h.find("s-button","Connect Klaviyo"));
  assert.equal(h.permissionProps.externalBusy,false);
});

test("Klaviyo management modal lock is rebound after a request removes and restores connected controls",()=>{
  const h=harness();h.state={...h.state,klaviyo:{view:"connected",account,current:{amount:"49",currency:"USD",effectiveFrom:"2026-11-01"},periods:[]}};h.render();
  const modal=h.modalHandles.get("klaviyo-disconnect-modal");modal.showOverlay();h.render();
  assert.equal(h.permissionProps.externalLock.current,"klaviyo-disconnect-modal");
  h.navigation.state="submitting";h.navigation.formData=new FormData();h.navigation.formData.set("provider","klaviyo");h.navigation.formData.set("intent","disconnect");h.render();
  assert.equal(h.permissionProps.externalLock.current,null);assert.equal(h.permissionProps.externalBusy,true);
  h.navigation.state="idle";h.render(); // An unconfirmed request must permit a later explicit dialog, without any auto retry.
  modal.showOverlay();h.render();assert.equal(h.permissionProps.externalLock.current,"klaviyo-disconnect-modal");
  modal.emitHidden();h.render();assert.equal(h.permissionProps.externalBusy,false);assert.equal(h.submissions.length,0);
});
