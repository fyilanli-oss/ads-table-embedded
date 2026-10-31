import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import {rememberProductPermissionReturn, consumeProductPermissionReturn} from "../app/lib/ui/product-permission-return.js";
import {readProductPermissionStatus} from "../app/lib/shopify/product-permission-status.server.js";

const owner = "gid://shopify/Shop/123";
function storage() {
  const rows = new Map();
  return {rows, setItem: (key, value) => rows.set(key, value), getItem: key => rows.get(key) ?? null,
    removeItem: key => rows.delete(key)};
}
test("Products return intent is same-store, expiring, one-use navigation only", () => {
  const s = storage();
  assert.equal(consumeProductPermissionReturn(s, owner, 1000), false);
  assert.equal(rememberProductPermissionReturn(s, owner, 1000), true);
  assert.equal(consumeProductPermissionReturn(s, owner, 2000), true);
  assert.equal(consumeProductPermissionReturn(s, owner, 2001), false);
  for (const [other, now] of [["gid://shopify/Shop/456", 2000], [owner, 601001], [owner, 999]]) {
    rememberProductPermissionReturn(s, owner, 1000);
    assert.equal(consumeProductPermissionReturn(s, other, now), false);
    assert.equal(s.rows.size, 0);
  }
  for (const raw of ["not json", "x".repeat(257), JSON.stringify({version: 1, owner, startedAt: 1000, redirect: "https://evil.example"})]) {
    s.rows.set("adstable.products-return.v1", raw);
    assert.equal(consumeProductPermissionReturn(s, owner, 2000), false);
  }
  assert.equal(rememberProductPermissionReturn(s, "invalid", 1000), false);
  assert.equal(rememberProductPermissionReturn({setItem() {throw new Error();}}, owner), false);
});

test("fresh Products status uses one native read and never requests access or activates data", async () => {
  const verified = {synthetic: true};
  for (const [value, expected] of [["permission_ready", "ready"], ["resume_setup", "missing"], ["unknown", "unknown"], [undefined, "unknown"]]) {
    let reads = 0;
    const result = await readProductPermissionStatus({verified, available: true, setup: {
      async afterReturn(args) {assert.equal(args.verified, verified); reads++; return {basePermissionState: value};},
      requestProducts() {assert.fail("readback must never request consent");},
    }});
    assert.equal(result, expected); assert.equal(reads, 1);
  }
  assert.equal(await readProductPermissionStatus({available: false, setup: new Proxy({}, {get() {assert.fail();}})}), "unavailable");
  let failures = 0;
  assert.equal(await readProductPermissionStatus({available: true, setup: {afterReturn() {failures++; throw new Error("private detail");}}}), "unknown");
  assert.equal(failures, 1);
});

function load(relative, overrides) {
  const location = new URL(`../${relative}`, import.meta.url), require = createRequire(location);
  const compiled = ts.transpileModule(readFileSync(location, "utf8"), {compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(id => overrides(id, require), exports);
  return exports;
}
function hooks() {
  const cells = [], effects = []; let cursor = 0;
  return {start() {cursor = 0;}, finish() {while (effects.length) effects.shift()();},
    useCallback(fn, deps) {const i = cursor++, previous = cells[i];
      if (!previous || deps.some((v, j) => !Object.is(v, previous.deps[j]))) cells[i] = {fn, deps};
      return cells[i].fn;},
    useRef(value) {return cells[cursor++] ??= {current: value};},
    useState(value) {const i = cursor++; if (!(i in cells)) cells[i] = typeof value === "function" ? value() : value;
      return [cells[i], next => {cells[i] = typeof next === "function" ? next(cells[i]) : next;}];},
    useEffect(fn, deps) {const i = cursor++, previous = cells[i];
      if (!previous || deps.some((v, j) => !Object.is(v, previous[j]))) {cells[i] = deps; effects.push(fn);}},
  };
}
async function withStorage(s, fn) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {value: s, configurable: true});
  try {return await fn();} finally {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous); else delete globalThis.sessionStorage;
  }
}
const treeText = value => Array.isArray(value) ? value.map(treeText).join("")
  : value && typeof value === "object" ? [value.props?.heading ?? "", treeText(value.props?.children)].join("")
  : typeof value === "string" ? value : "";

test("actual authenticated layout returns once to Settings and cannot redirect another store or loop", async () => {
  const s = storage(), h = hooks(), calls = []; let pathname = "/";
  const component = load("app/routes/_admin.tsx", (id, require) => {
    if (id === "react") return {...require(id), ...h};
    if (id === "react-router") return {...require(id), useLoaderData: () => ({permissionReturnOwner: owner}),
      useLocation: () => ({pathname}), useNavigate: () => navigate};
    if (id === "../shopify.server") return {};
    return require(id);
  }).default;
  function navigate(path, options) {calls.push({path, options}); return Promise.resolve();}
  const render = () => {h.start(); const tree = component(); h.finish(); return tree;};
  await withStorage(s, async () => {
    render(); assert.equal(calls.length, 0);
    rememberProductPermissionReturn(s, owner);
    // A fresh layout mounts after Shopify returns to the application root.
    pathname = "/settings"; render(); pathname = "/";
    rememberProductPermissionReturn(s, owner); render(); render();
    assert.deepEqual(calls, [{path: "/settings", options: {replace: true}}]);
    assert.equal(s.rows.size, 0);
    pathname = "/settings"; render(); assert.equal(treeText(render()).includes("Settings'e dönülüyor"), false);
    rememberProductPermissionReturn(s, "gid://shopify/Shop/456"); pathname = "/"; render();
    assert.equal(calls.length, 1);
  });
});

test("a failed Settings return exposes a native recovery link without retrying navigation", async () => {
  await withStorage(storage(), async () => {
    const h = hooks(); let attempts = 0;
    const navigate = () => {attempts++; return Promise.reject(new Error("navigation failed"));};
    const Layout = load("app/routes/_admin.tsx", (id, require) => {
      if (id === "react") return {...require(id), ...h};
      if (id === "react-router") return {useLoaderData: () => ({permissionReturnOwner: owner}), useLocation: () => ({pathname: "/"}), useNavigate: () => navigate, Outlet: () => null};
      if (id === "@shopify/shopify-app-react-router/react") return {AppProvider: ({children}) => children};
      if (id === "@shopify/shopify-app-react-router/server") return {boundary: {}};
      if (id === "../shopify.server" || id.endsWith(".server.js")) return {};
      return require(id);
    }).default;
    const render = () => {h.start(); const tree = Layout(); h.finish(); return tree;};
    rememberProductPermissionReturn(globalThis.sessionStorage, owner);
    render(); await Promise.resolve();
    const tree = render();
    assert.equal(treeText(tree).includes("Settings'e otomatik dönülemedi."), true);
    assert.equal(attempts, 1); render(); assert.equal(attempts, 1);
    const banner = tree.props.children.props.children;
    assert.equal(banner.props.children.props.href, "/settings");
  });
});

function permissionHarness() {
  const h = hooks(), submissions = [], statuses = [];
  const fetcher = {state: "idle", data: undefined, submit(fields) {submissions.push(fields);}};
  let value;
  const usePermissionSettings = load("app/components/use-permission-settings.tsx", (id, require) => {
    if (id === "react") return {...require(id), ...h};
    if (id === "react-router") return {useFetcher: () => fetcher};
    if (id === "./permission-explanation") return {PermissionExplanation: () => null};
    if (id === "./permission-setup-selection") return {PermissionSetupSelection: () => null};
    return require(id);
  }).usePermissionSettings;
  const props = {availability: {shopify_products: true}, productOwner: owner,
    onProductStatus: status => statuses.push(status), onResume: () => assert.fail()};
  const render = () => {h.start(); value = usePermissionSettings(props); h.finish(); return value;};
  render();
  return {render, submissions, statuses, fetcher, props, get value() {return value;}, modal() {return value.content.props.children.find(e => e?.props?.onConnect).props;}};
}
test("actual Products Connect stores intent after modal confirmation; status updates its card without activation copy", async () => {
  const s = storage();
  await withStorage(s, async () => {
    const h = permissionHarness(); h.value.open("shopify_products"); h.render();
    const {session} = h.value.snapshot;
    assert.equal(s.rows.size, 0);
    h.modal().onConnect(session, () => h.modal().onHide(session));
    const completion = h.modal().onAfterHide(session);
    assert.equal(s.rows.size, 1); assert.equal(h.submissions.length, 1);
    h.fetcher.data = {...h.submissions[0], kind: "status", stage: "review_setup"};
    h.render(); await completion; h.render();
    assert.deepEqual(h.statuses, ["ready"]);
    assert.equal(s.rows.size, 0);
    assert.equal(treeText(h.value.content).includes("awaiting activation"), false);
    assert.equal(treeText(h.value.content).includes("Check status"), false);
  });
});
test("Products modal cancel and unavailable storage never start a native permission action", async () => {
  await withStorage(storage(), async () => {
    const h = permissionHarness(); h.value.open("shopify_products"); h.render();
    const {session} = h.value.snapshot; h.modal().onHide(session); await h.modal().onAfterHide(session);
    assert.equal(h.submissions.length, 0);
  });
  await withStorage({setItem() {throw new Error("blocked");}}, async () => {
    const h = permissionHarness(); h.value.open("shopify_products"); h.render();
    const {session} = h.value.snapshot; h.modal().onConnect(session, () => h.modal().onHide(session));
    await h.modal().onAfterHide(session); h.render();
    assert.equal(h.submissions.length, 0); assert.deepEqual(h.statuses, ["unknown"]);
  });
});

test("a pending Products reply cannot verify another store after the view owner changes", async () => {
  await withStorage(storage(), async () => {
    const h = permissionHarness(); h.value.open("shopify_products"); h.render();
    const {session} = h.value.snapshot;
    h.modal().onConnect(session, () => h.modal().onHide(session));
    const completion = h.modal().onAfterHide(session);
    h.props.productOwner = "gid://shopify/Shop/456";
    h.fetcher.data = {...h.submissions[0], kind: "status", stage: "review_setup"};
    h.render(); await completion; h.render();
    assert.deepEqual(h.statuses, []);
  });
});
