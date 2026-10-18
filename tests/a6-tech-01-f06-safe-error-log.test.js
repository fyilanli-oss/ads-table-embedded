import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import test from "node:test";
import {createElement} from "react";
import {renderToPipeableStream} from "react-dom/server";
import {createRequestHandler} from "react-router";
import {handleServerError, logServerFailure} from "../app/lib/server-error-log.server.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const secret = "F06_SYNTHETIC_TOKEN_SQL_EMAIL_BODY_STACK";
const request = (path = "/settings", method = "GET") => new Request(
  `https://synthetic.example${path}?access_token=${secret}&shop=${secret}`,
  {method, headers: {authorization: `Bearer ${secret}`, cookie: secret, "x-request-id": secret}},
);

async function capture(action) {
  const original = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);
  try { await action(); } finally { console.error = original; }
  for (const args of calls) {
    assert.equal(args.length, 1);
    assert.equal(typeof args[0], "string");
    assert.ok(args[0].length < 200);
    assert.ok(!args[0].includes(secret));
    assert.deepEqual(Object.keys(JSON.parse(args[0])), ["event", "code", "stage", "route", "method"]);
  }
  return calls.map(args => JSON.parse(args[0]));
}

test("error objects, tokens, SQL, stacks, bodies and request identities never enter logs", async () => {
  const error = Object.assign(new Error(secret, {cause: new Error(secret)}), {
    code: secret, detail: secret, query: secret, token: secret,
    response: {body: secret}, request_id: secret, email: secret,
    toJSON() { assert.fail("must never serialize the error"); },
  });
  error.stack = secret;
  const hostile = new Proxy({}, {get() { assert.fail("must never inspect the error"); }});
  const records = await capture(() => {
    for (const value of [error, hostile, secret, null, undefined, {stack: secret}]) {
      handleServerError(value, {request: request()});
    }
  });
  assert.equal(records.length, 6);
  for (const record of records) assert.deepEqual(record, {
    event: "adstable_server_error", code: "SERVER_REQUEST_FAILED", stage: "request", route: "/settings", method: "GET",
  });
});

test("route/method/stage context is bounded; abort and broken log sink are safe", async () => {
  const records = await capture(() => {
    for (const path of ["/", "/ad-analysis", "/settings", `/auth/${secret}`, `/${secret}`]) {
      logServerFailure("render", request(path));
    }
    logServerFailure(secret, {url: "invalid", method: secret});
    const controller = new AbortController();
    controller.abort(new Error(secret));
    handleServerError(new Error(secret), {request: new Request("https://synthetic.example/", {signal: controller.signal})});
  });
  assert.deepEqual(records.map(record => record.route), ["/", "/ad-analysis", "/settings", "other", "other", "other"]);
  assert.equal(records.at(-1).stage, "request");
  assert.equal(records.at(-1).method, "other");
  const original = console.error;
  console.error = () => { throw new Error(secret); };
  try { assert.doesNotThrow(() => logServerFailure("render", request())); }
  finally { console.error = original; }
});

function build(routeModule, entry = async (_request, status) => new Response("synthetic", {status})) {
  return {
    entry: {module: {default: entry, handleError: handleServerError}},
    routes: {root: {id: "root", path: "/", module: routeModule}},
    assets: {version: "synthetic", routes: {}, entry: {module: "synthetic", imports: []}},
    publicPath: "/", assetsBuildDirectory: "synthetic", basename: "/",
    future: {}, ssr: true, isSpaMode: false, prerender: [],
    routeDiscovery: {mode: "initial", manifestPath: "/__manifest"},
  };
}

test("real production Router uses the safe hook for loader, action, resource and shell errors", async () => {
  const fail = () => { throw Object.assign(new Error(secret), {query: secret, response: secret}); };
  const cases = [
    [build({default: () => null, loader: fail}), "GET"],
    [build({default: () => null, action: fail}), "POST"],
    [build({loader: fail}), "GET"],
    [build({default: () => null}, fail), "GET"],
  ];
  for (const [serverBuild, method] of cases) {
    const records = await capture(async () => {
      const response = await createRequestHandler(serverBuild, "production")(request("/", method));
      assert.equal(response.status, 500);
      assert.ok(!(await response.text()).includes(secret));
    });
    assert.ok(records.length >= 1);
    assert.ok(records.every(record => record.code === "SERVER_REQUEST_FAILED"));
  }
});

test("real React streaming reports safe render context while preserving shell rejection", async () => {
  const failure = new Error(secret);
  const records = await capture(() => new Promise((resolve, reject) => {
    renderToPipeableStream(createElement(() => { throw failure; }), {
      onError() { logServerFailure("render", request()); },
      onShellError(error) {
        try { assert.equal(error, failure); resolve(); } catch (assertion) { reject(assertion); }
      },
    });
  }));
  assert.equal(records.length, 1);
  assert.equal(records[0].code, "SERVER_RENDER_FAILED");
});

test("successful and redirect responses stay unchanged and do not create error logs", async () => {
  const records = await capture(async () => {
    const success = await createRequestHandler(build({default: () => null, loader: () => ({ok: true})}), "production")(request("/"));
    assert.equal(success.status, 200);
    const redirect = await createRequestHandler(build({loader: () => new Response(null, {status: 302, headers: {Location: "/settings"}})}), "production")(request("/"));
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("Location"), "/settings");
  });
  assert.equal(records.length, 0);
  const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
  const methodRecords = await capture(() => {
    for (const method of methods) logServerFailure("request", request("/", method));
  });
  assert.deepEqual(methodRecords.map(record => record.method), methods);
});

test("server entry wires both safe log paths without changing rendering or Shopify headers", () => {
  const entry = read("app/entry.server.tsx");
  assert.match(entry, /export const handleError: HandleErrorFunction = handleServerError/);
  assert.match(entry, /onError\(\)\s*\{\s*responseStatusCode = 500;\s*logServerFailure\("render", request\)/);
  assert.match(entry, /onShellError: reject/);
  assert.match(entry, /addDocumentResponseHeaders\(request, responseHeaders\)/);
  assert.match(entry, /setTimeout\(abort, STREAM_TIMEOUT_MS\)/);
  assert.doesNotMatch(entry, /console\.(error|warn)/);
});

test("application error/warning output stays inside the bounded server logger", () => {
  function scan(directory) {
    for (const item of readdirSync(new URL(`../${directory}`, import.meta.url), {withFileTypes: true})) {
      const path = `${directory}/${item.name}`;
      if (item.isDirectory()) scan(path);
      else if (/\.[jt]sx?$/.test(item.name) && !item.name.endsWith(".d.ts")) {
        const calls = read(path).match(/console\s*\.\s*(?:error|warn)\s*\(/g) ?? [];
        assert.equal(calls.length, path === "app/lib/server-error-log.server.js" ? 1 : 0, path);
      }
    }
  }
  scan("app");
});
