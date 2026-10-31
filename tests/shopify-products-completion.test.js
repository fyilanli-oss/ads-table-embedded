import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import {readProductPermissionStatus, readShopifyPermissionStatuses} from "../app/lib/shopify/product-permission-status.server.js";

const owner = "gid://shopify/Shop/123";
test("fresh Products status uses one native read and never requests access or activates data", async () => {
  const verified = {synthetic: true};
  for (const [value, expected] of [["permission_ready", "ready"], ["resume_setup", "missing"], ["unknown", "unknown"], [undefined, "unknown"]]) {
    let reads = 0;
    const result = await readProductPermissionStatus({verified, available: true, setup: {
      async afterReturn(args) {assert.equal(args.verified, verified); reads++; return {basePermissionState: value};},
      prepareProducts() {assert.fail("readback must never request consent");},
    }});
    assert.equal(result, expected); assert.equal(reads, 1);
  }
  assert.equal(await readProductPermissionStatus({available: false, setup: new Proxy({}, {get() {assert.fail();}})}), "unavailable");
  let failures = 0;
  assert.equal(await readProductPermissionStatus({available: true, setup: {afterReturn() {failures++; throw new Error("private detail");}}}), "unknown");
  assert.equal(failures, 1);
});

test("Google failure appears only in its provider feedback and stays stopped until explicit status read",async()=>{
  const h=permissionHarness();h.props.availability.google_ads=true;h.render();
  h.value.open("google_ads");h.render();
  const modal=h.modal();modal.onConnect(modal.snapshot.session,()=>{});h.render();
  const pending=h.modal().onAfterHide(modal.snapshot.session);h.render();
  assert.equal(h.submissions.length,1);
  h.fetcher.data={kind:"unknown",feature:"google_ads",requestId:h.submissions[0].requestId};
  h.render();await pending;h.render();
  assert.match(treeText(h.value.providerContent("google_ads")),/We could not confirm the result/);
  assert.equal(h.value.providerContent("meta"),null);assert.equal(h.value.providerContent("klaviyo"),null);
  assert.doesNotMatch(treeText(h.value.content),/We could not confirm/);
  h.value.open("google_ads");h.render();assert.notEqual(h.value.snapshot.phase,"explaining");
  assert.equal(h.submissions.length,1);
  assert.deepEqual(h.statuses,[]);assert.deepEqual(h.orderStatuses,[]);
  h.props.availability.meta=true;h.render();
  const reading=h.value.checkStatus("meta");h.render();
  h.fetcher.data={kind:"status",feature:"meta",stage:"reporting_selected",requestId:h.submissions[1].requestId};
  h.render();await reading;h.render();
  assert.match(treeText(h.value.providerContent("google_ads")),/We could not confirm the result/);
  assert.doesNotMatch(treeText(h.value.providerContent("meta")),/We could not confirm/);
  h.value.open("google_ads");h.render();assert.notEqual(h.value.snapshot.phase,"explaining");
  assert.equal(h.submissions.length,2);
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
  const cells = [], effects = [], cleanups = []; let cursor = 0;
  return {start() {cursor = 0;}, finish() {while (effects.length) {const cleanup=effects.shift()();if(typeof cleanup==="function")cleanups.push(cleanup);}}, unmount() {for(const cleanup of cleanups.splice(0))cleanup();},
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
const treeText = value => Array.isArray(value) ? value.map(treeText).join("")
  : value && typeof value === "object" ? [value.props?.heading ?? "", treeText(value.props?.children)].join("")
  : typeof value === "string" ? value : "";

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
  return {render, unmount:()=>h.unmount(), submissions, statuses, orderStatuses, fetcher, props, get value() {return value;}, modal() {return value.content.props.children.find(e => e?.props?.onConnect).props;}};
}
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

test("one native scope read supplies both independent cards without reading order data", async () => {
  for (const [basePermissionState, ordersScopeState, expected] of [["permission_ready", "permission_ready", {products:"ready",orders:"ready"}], ["resume_setup", "permission_ready", {products:"missing",orders:"ready"}], ["permission_ready", "not_connected", {products:"ready",orders:"missing"}]]) {
    let reads = 0;
    const result = await readShopifyPermissionStatuses({verified: {}, productsAvailable: true, ordersAvailable: true,
      setup: {afterReturn: async () => {reads++; return {basePermissionState, ordersScopeState};}, prepareOrders: () => assert.fail()}});
    assert.deepEqual(result, expected); assert.equal(reads, 1);
  }
  const failed = await readShopifyPermissionStatuses({productsAvailable: true, ordersAvailable: true, setup:{afterReturn:()=>{throw Error();}}});
  assert.deepEqual(failed, {products:"unknown",orders:"unknown"});
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


const binding={shopId:owner,appInstallationId:"gid://shopify/AppInstallation/9",installGeneration:2};
const scopePreparation=feature=>({kind:"scope_request",feature,scope:feature==="shopify_products"?"read_products":"read_orders",binding});
async function withBridge(bridge,fn){const descriptor=Object.getOwnPropertyDescriptor(globalThis,"shopify");Object.defineProperty(globalThis,"shopify",{value:bridge,configurable:true});try{return await fn();}finally{if(descriptor)Object.defineProperty(globalThis,"shopify",descriptor);else delete globalThis.shopify;}}
const ticks=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function begin(h,feature){h.value.open(feature);h.render();const {session}=h.value.snapshot;h.modal().onConnect(session,()=>h.modal().onHide(session));const done=h.modal().onAfterHide(session);h.render();return {session,done};}
function reply(h,value){h.fetcher.data={...h.submissions.at(-1),...value};h.render();}

for(const feature of ["shopify_products","shopify_orders"]){
  for(const result of ["granted-all","declined-all"]){
    test(`${feature} App Bridge ${result} stays in Settings and waits for bound server readback`,async()=>{
      let resolveWindow;const nativeCalls=[];const bridge={scopes:{request:scopes=>{nativeCalls.push(scopes);return new Promise(resolve=>{resolveWindow=resolve;});}}};
      await withBridge(bridge,async()=>{
        const h=permissionHarness();const {session,done}=begin(h,feature);
        assert.equal(nativeCalls.length,0);reply(h,scopePreparation(feature));await ticks();
        assert.deepEqual(nativeCalls,[[feature==="shopify_products"?"read_products":"read_orders"]]);
        await h.modal().onAfterHide(session);assert.equal(h.submissions.length,1);
        assert.deepEqual(h.statuses,[]);assert.deepEqual(h.orderStatuses,[]);
        resolveWindow({result});await ticks();assert.equal(h.submissions.length,2);
        assert.equal(h.submissions[1].intent,"permission_status");assert.deepEqual(JSON.parse(h.submissions[1].expectedScopeBinding),binding);
        assert.deepEqual(h.statuses,[]);assert.deepEqual(h.orderStatuses,[]);
        reply(h,{kind:"status",stage:result==="granted-all"?"review_setup":"request_permissions"});await done;h.render();
        assert.deepEqual(feature==="shopify_products"?h.statuses:h.orderStatuses,[result==="granted-all"?"ready":"missing"]);
        assert.equal(treeText(h.value.content).includes("awaiting activation"),false);
      });
    });
  }
}

for(const mode of ["missing","reject","malformed","wrong_scope","wrong_owner","unmounted"]){
  test(`App Bridge ${mode} never redirects, retries, grants or reads an unconfirmed result`,async()=>{
    let count=0,resolveWindow;
    const request=()=>{count++;if(mode==="reject")return Promise.reject(Error("SECRET"));if(mode==="malformed")return Promise.resolve({result:"unknown"});return new Promise(resolve=>{resolveWindow=resolve;});};
    await withBridge(mode==="missing"?{}:{scopes:{request}},async()=>{
      const h=permissionHarness();const {done}=begin(h,"shopify_products");
      reply(h,{...scopePreparation("shopify_products"),...(mode==="wrong_scope"?{scope:"read_orders"}:{})});await ticks();
      if(mode==="wrong_owner"||mode==="unmounted"){
        if(mode==="wrong_owner"){h.props.productOwner="gid://shopify/Shop/456";h.render();}else h.unmount();
        resolveWindow({result:"granted-all"});
      }
      await done;h.render();assert.equal(h.submissions.length,1);
      assert.deepEqual(h.statuses,["wrong_owner","unmounted"].includes(mode)?[]:["unknown"]);
      assert.equal(count,mode==="missing"||mode==="wrong_scope"?0:1);
    });
  });
}

test("explanation Cancel starts no preparation and an already-granted server reply opens no native window",async()=>{
  let native=0;await withBridge({scopes:{request:()=>{native++;assert.fail();}}},async()=>{
    const h=permissionHarness();h.value.open("shopify_products");h.render();const {session}=h.value.snapshot;
    h.modal().onHide(session);await h.modal().onAfterHide(session);h.render();assert.equal(h.submissions.length,0);
    const {done}=begin(h,"shopify_products");reply(h,{kind:"status",stage:"review_setup"});await done;h.render();
    assert.deepEqual(h.statuses,["ready"]);assert.equal(native,0);
  });
});

test("normal authenticated layout renders its Outlet in real SSR without a root return gate",()=>{
  const require=createRequire(import.meta.url),React=require("react"),{renderToString}=require("react-dom/server");let outlets=0;
  const Layout=load("app/routes/_admin.tsx",(id,local)=>{
    if(id==="react-router")return{useLoaderData:()=>({apiKey:"synthetic",polarisUrl:"synthetic"}),Outlet:()=>{outlets++;return "Normal page";}};
    if(id==="@shopify/shopify-app-react-router/react")return{AppProvider:({children})=>children};
    if(id==="../shopify.server"||id.endsWith(".server.js"))return{};return local(id);
  }).default;
  assert.equal(renderToString(React.createElement(Layout)),"Normal page");assert.equal(outlets,1);
  const source=readFileSync(new URL("../app/routes/_admin.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(source,/sessionStorage|useNavigate|RootDecision|consume.*Return|useEffect/);
});

test("a closed server gate remains unavailable without requesting a native window",async()=>{
  await withBridge({scopes:{request:()=>assert.fail()}},async()=>{
    const h=permissionHarness();const {done}=begin(h,"shopify_products");reply(h,{kind:"unavailable"});await done;h.render();
    assert.deepEqual(h.statuses,["unavailable"]);assert.equal(h.submissions.length,1);
  });
});
