import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import {rememberProductPermissionReturn, consumeProductPermissionReturn, rememberOrderPermissionReturn, consumeOrderPermissionReturn} from "../app/lib/ui/product-permission-return.js";
import {readProductPermissionStatus, readShopifyPermissionStatuses} from "../app/lib/shopify/product-permission-status.server.js";

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
    rememberProductPermissionReturn(s, owner); render();
    const transition = render();
    assert.equal(transition.props.children, null); // No Funnel, caption or transient banner.
    assert.deepEqual(calls, [{path: "/settings", options: {replace: true}}]);
    assert.equal(s.rows.size, 0);
    pathname = "/settings"; render(); assert.equal(treeText(render()).includes("Returning to Settings"), false);
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
    assert.equal(treeText(tree).includes("Could not return to Settings."), true);
    assert.equal(attempts, 1); render(); assert.equal(attempts, 1);
    const banner = tree.props.children.props.children;
    assert.equal(banner.props.children.props.href, "/settings");
  });
});

function permissionHarness() {
  const h = hooks(), submissions = [], statuses = [], orderStatuses = [];
  const fetcher = {state: "idle", data: undefined, submit(fields) {submissions.push(fields);}};
  let value;
  const usePermissionSettings = load("app/components/use-permission-settings.tsx", (id, require) => {
    if (id === "react") return {...require(id), ...h};
    if (id === "react-router") return {useFetcher: () => fetcher};
    if (id === "./permission-explanation") return {PermissionExplanation: () => null};
    if (id === "./permission-setup-selection") return {PermissionSetupSelection: () => null};
    return require(id);
  }).usePermissionSettings;
  const props = {availability: {shopify_products: true, shopify_orders: true}, productOwner: owner,
    onProductStatus: status => statuses.push(status), onOrderStatus: status => orderStatuses.push(status), onResume: () => assert.fail()};
  const render = () => {h.start(); value = usePermissionSettings(props); h.finish(); return value;};
  render();
  return {render, submissions, statuses, orderStatuses, fetcher, props, get value() {return value;}, modal() {return value.content.props.children.find(e => e?.props?.onConnect).props;}};
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

test("native removal modal cancel/close never revoke; confirm waits for afterhide and consumes once", () => {
  const h = hooks(), listeners = new Map(); let calls = 0, hides = 0;
  const element = {addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key), hideOverlay: () => hides++};
  const props = {owner, ready: true, busy: false, onConfirm: () => calls++, onUnknown: () => assert.fail()};
  const Component = load("app/components/product-access-removal.tsx", (id, require) => id === "react" ? {...require(id), ...h} : require(id)).ProductAccessRemoval;
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" ? [value, ...nodes(value.props?.children)] : [];
  let tree;
  const render = () => {h.start(); tree = Component(props); nodes(tree).find(n => n.type === "s-modal").ref.current = element; h.finish();};
  const button = label => nodes(tree).find(n => n.type === "s-button" && n.props.children === label);
  const closed = () => listeners.get("afterhide")({target: element});
  render(); closed(); assert.equal(calls, 0);
  button("Cancel").props.onClick(); closed(); assert.equal(calls, 0);
  button("Remove access").props.onClick(); button("Remove access").props.onClick();
  assert.equal(hides, 1); assert.equal(calls, 0);
  closed(); closed(); assert.equal(calls, 1);
  button("Remove access").props.onClick(); props.owner = "gid://shopify/Shop/456"; render();
  closed(); assert.equal(calls, 1);
});

test("Products removal sends one fixed action, verifies missing status and leaves reconnect available", async () => {
  const h = permissionHarness();
  const completed = h.value.removeProductAccess();
  await h.value.removeProductAccess();
  assert.equal(h.submissions.length, 1);
  assert.equal(h.submissions[0].intent, "permission_revoke_products");
  assert.equal(h.submissions[0].feature, "shopify_products");
  h.fetcher.data = {...h.submissions[0], kind: "status", stage: "request_permissions"};
  h.render(); await completed; h.render();
  assert.deepEqual(h.statuses, ["missing"]);
  assert.equal(h.value.productRemovalResult, "removed");
  assert.equal(h.value.busy, false);
  h.props.productOwner = "gid://shopify/Shop/456"; h.render();
  assert.equal(h.value.productRemovalResult, null);
});

test("unknown removal offers readback, never automatic mutation retry or false success", async () => {
  const h = permissionHarness();
  const completed = h.value.removeProductAccess();
  h.fetcher.data = {...h.submissions[0], kind: "unknown"};
  h.render(); await completed; h.render();
  assert.deepEqual(h.statuses, ["unknown"]);
  assert.equal(h.value.productRemovalResult, "unknown");
  assert.equal(h.submissions.length, 1);
  const checked = h.value.checkStatus("shopify_products");
  assert.equal(h.submissions[1].intent, "permission_status");
  h.fetcher.data = {...h.submissions[1], kind: "status", stage: "review_setup"};
  h.render(); await checked; h.render();
  assert.equal(h.value.productRemovalResult, null);
  assert.deepEqual(h.statuses, ["unknown", "ready"]);
});

test("late removal reply from another store cannot update the current Products card", async () => {
  const h = permissionHarness(); const completed = h.value.removeProductAccess();
  h.props.productOwner = "gid://shopify/Shop/456";
  h.fetcher.data = {...h.submissions[0], kind: "status", stage: "request_permissions"};
  h.render(); await completed; h.render();
  assert.deepEqual(h.statuses, []); assert.equal(h.value.productRemovalResult, null);
});

test("Orders return hint is isolated, same-owner, expiring and one-use", () => {
  const s = storage();
  rememberOrderPermissionReturn(s, owner, 1000);
  assert.equal(consumeProductPermissionReturn(s, owner, 1001), false);
  assert.equal(consumeOrderPermissionReturn(s, owner, 1001), true);
  assert.equal(consumeOrderPermissionReturn(s, owner, 1002), false);
  for (const [other, time] of [["gid://shopify/Shop/456", 1001], [owner, 601001]]) {
    rememberOrderPermissionReturn(s, owner, 1000);
    assert.equal(consumeOrderPermissionReturn(s, other, time), false);
  }
});

test("one native scope read supplies both independent cards without reading order data", async () => {
  for (const [basePermissionState, ordersScopeState, expected] of [["permission_ready", "permission_ready", {products:"ready",orders:"ready"}], ["resume_setup", "permission_ready", {products:"missing",orders:"ready"}], ["permission_ready", "not_connected", {products:"ready",orders:"missing"}]]) {
    let reads = 0;
    const result = await readShopifyPermissionStatuses({verified: {}, productsAvailable: true, ordersAvailable: true,
      setup: {afterReturn: async () => {reads++; return {basePermissionState, ordersScopeState};}, requestOrders: () => assert.fail()}});
    assert.deepEqual(result, expected); assert.equal(reads, 1);
  }
  const failed = await readShopifyPermissionStatuses({productsAvailable: true, ordersAvailable: true, setup:{afterReturn:()=>{throw Error();}}});
  assert.deepEqual(failed, {products:"unknown",orders:"unknown"});
});

test("Orders Connect sets its own return hint after confirmation; verified reply updates only Orders", async () => {
  await withStorage(storage(), async () => {
    const h = permissionHarness(); h.value.open("shopify_orders"); h.render();
    const {session} = h.value.snapshot;
    h.modal().onConnect(session, () => h.modal().onHide(session));
    const completed = h.modal().onAfterHide(session);
    assert.equal(consumeProductPermissionReturn(globalThis.sessionStorage, owner), false);
    assert.equal(consumeOrderPermissionReturn(globalThis.sessionStorage, owner), true);
    h.fetcher.data = {...h.submissions[0], kind:"status", stage:"review_setup"};
    h.render(); await completed; h.render();
    assert.deepEqual(h.statuses, []); assert.deepEqual(h.orderStatuses, ["ready"]);
    assert.equal(treeText(h.value.content).includes("awaiting activation"), false);
    assert.equal(treeText(h.value.content).includes("Check status"), false);
  });
});

test("Orders removal is single-shot, cannot revoke Products and updates only its card", async () => {
  const h = permissionHarness();
  const completed = h.value.removeOrderAccess();
  await h.value.removeOrderAccess(); await h.value.removeProductAccess();
  assert.equal(h.submissions.length, 1); assert.equal(h.submissions[0].intent, "permission_revoke_orders");
  h.render(); assert.equal(h.value.checkingProduct, false); assert.equal(h.value.checkingOrder, true);
  h.fetcher.data = {...h.submissions[0], kind:"status", stage:"request_permissions"};
  h.render(); await completed; h.render();
  assert.deepEqual(h.statuses, []); assert.deepEqual(h.orderStatuses, ["missing"]);
  assert.equal(h.value.orderRemovalResult, "removed");
});

test("unknown Orders removal requires an explicit readback and ignores a different store's late reply", async () => {
  for (const changeOwner of [false,true]) {
    const h = permissionHarness(); const completed = h.value.removeOrderAccess();
    if(changeOwner) h.props.productOwner="gid://shopify/Shop/456";
    h.fetcher.data={...h.submissions[0],kind:"unknown"}; h.render(); await completed; h.render();
    assert.deepEqual(h.orderStatuses, changeOwner ? [] : ["unknown"]);
    assert.equal(h.submissions.length,1);
    if(!changeOwner) {
      const checked=h.value.checkStatus("shopify_orders");
      assert.equal(h.submissions[1].intent,"permission_status");
      h.fetcher.data={...h.submissions[1],kind:"status",stage:"review_setup"}; h.render(); await checked; h.render();
      assert.deepEqual(h.orderStatuses,["unknown","ready"]);
    }
  }
});

test("Orders native removal modal cancel/close never revoke; confirm waits for afterhide and consumes once", () => {
  const h = hooks(), listeners = new Map(); let calls = 0, hides = 0;
  const element = {addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key), hideOverlay: () => hides++};
  const props = {owner, ready: true, busy: false, onConfirm: () => calls++, onUnknown: () => assert.fail()};
  const Component = load("app/components/order-access-removal.tsx", (id, require) => id === "react" ? {...require(id), ...h} : require(id)).OrderAccessRemoval;
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" ? [value, ...nodes(value.props?.children)] : [];
  let tree;
  const render = () => {h.start(); tree = Component(props); nodes(tree).find(n => n.type === "s-modal").ref.current = element; h.finish();};
  const button = label => nodes(tree).find(n => n.type === "s-button" && n.props.children === label);
  const closed = () => listeners.get("afterhide")({target: element});
  render(); closed(); assert.equal(calls, 0);
  button("Cancel").props.onClick(); closed(); assert.equal(calls, 0);
  button("Remove access").props.onClick(); button("Remove access").props.onClick();
  assert.equal(hides, 1); assert.equal(calls, 0);
  closed(); closed(); assert.equal(calls, 1);
  button("Remove access").props.onClick(); props.owner = "gid://shopify/Shop/456"; render();
  closed(); assert.equal(calls, 1);
});

test("Orders authenticated layout returns once to Settings and cannot redirect another store or loop", async () => {
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
    rememberOrderPermissionReturn(s, owner);
    // A fresh layout mounts after Shopify returns to the application root.
    pathname = "/settings"; render(); pathname = "/";
    rememberOrderPermissionReturn(s, owner); render();
    const transition = render();
    assert.equal(transition.props.children, null); // No Funnel, caption or transient banner.
    assert.deepEqual(calls, [{path: "/settings", options: {replace: true}}]);
    assert.equal(s.rows.size, 0);
    pathname = "/settings"; render(); assert.equal(treeText(render()).includes("Returning to Settings"), false);
    rememberOrderPermissionReturn(s, "gid://shopify/Shop/456"); pathname = "/"; render();
    assert.equal(calls.length, 1);
  });
});

test("real server rendering never paints the root Funnel before the client return decision", () => {
  const require = createRequire(import.meta.url);
  const React = require("react"), {renderToString} = require("react-dom/server");
  let pathname="/", outlets=0;
  const Layout=load("app/routes/_admin.tsx",(id,local)=>{
    if(id==="react-router") return {useLoaderData:()=>({permissionReturnOwner:owner}),useLocation:()=>({pathname,key:"root"}),useNavigate:()=>()=>assert.fail("SSR cannot navigate"),Outlet:()=>{outlets++;return "Funnel";}};
    if(id==="@shopify/shopify-app-react-router/react") return {AppProvider:({children})=>children};
    if(id==="../shopify.server"||id.endsWith(".server.js"))return {};
    return local(id);
  }).default;
  assert.equal(renderToString(React.createElement(Layout)), ""); assert.equal(outlets,0);
  pathname="/settings";assert.equal(renderToString(React.createElement(Layout)),"Funnel");assert.equal(outlets,1);
});

test("first client paint is withheld for both native returns; normal home is released without redirect", async()=>{
  for(const kind of ["none","products","orders"]){
    await withStorage(storage(),async()=>{
      if(kind==="products")rememberProductPermissionReturn(globalThis.sessionStorage,owner);
      if(kind==="orders")rememberOrderPermissionReturn(globalThis.sessionStorage,owner);
      const h=hooks(),calls=[];const Outlet=()=>null;let effect;
      const navigate=(...args)=>{calls.push(args);return Promise.resolve();};
      const Layout=load("app/routes/_admin.tsx",(id,local)=>{
        if(id==="react")return {...local(id),...h,useEffect:(fn,deps)=>{effect=fn;h.useEffect(fn,deps);}};
        if(id==="react-router")return {useLoaderData:()=>({permissionReturnOwner:owner}),useLocation:()=>({pathname:"/",key:"root"}),useNavigate:()=>navigate,Outlet};
        if(id==="../shopify.server"||id.endsWith(".server.js"))return {};
        return local(id);
      }).default;
      h.start();let tree=Layout();assert.equal(tree.props.children,null);h.finish();
      effect(); // Development effect replay must not expose home or navigate twice.
      h.start();tree=Layout();h.finish();
      if(kind==="none"){assert.equal(tree.props.children.type,Outlet);assert.equal(calls.length,0);}
      else{assert.equal(tree.props.children,null);assert.deepEqual(calls,[["/settings",{replace:true}]]);}
    });
  }
});
