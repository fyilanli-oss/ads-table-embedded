import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import {build, loadConfigFromFile} from "vite";

test("production bundle preserves Shopify SDK handling of real Router responses and headers", async () => {
  const loaded = await loadConfigFromFile({command: "build", mode: "production"},
    fileURLToPath(new URL("../vite.config.ts", import.meta.url)));
  const fixture = `
    import {UNSAFE_ErrorResponseImpl, isRouteErrorResponse} from "react-router";
    import {boundary} from "@shopify/shopify-app-react-router/server";
    export function inspect() {
      const error = new UNSAFE_ErrorResponseImpl(401, "Unauthorized", null);
      let rendered, caught;
      try { rendered = boundary.error(error); } catch (value) { caught = value; }
      const unexpected = new Error("unrelated failure");
      let rethrown = false;
      try { boundary.error(unexpected); } catch (value) { rethrown = value === unexpected; }
      const signal = new Headers({"X-Shopify-API-Request-Failure-Reauthorize-Url":
        "https://example.myshopify.com/admin/oauth/install?optional_scopes=read_products"});
      const headers = boundary.headers({parentHeaders: new Headers(), loaderHeaders: new Headers(),
        actionHeaders: new Headers(), errorHeaders: signal});
      return {recognized: isRouteErrorResponse(error), handled: !caught && !!rendered,
        rethrown, headerPreserved: headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url") ===
          signal.get("X-Shopify-API-Request-Failure-Reauthorize-Url"), status: error.status};
    }
  `;
  const result = await build({configFile: false, logLevel: "silent", esbuild: loaded.config.esbuild,
    plugins: [{name: "isolated-boundary-probe", resolveId(id) {
      if (id === "virtual:boundary-probe") return id;
    }, load(id) { if (id === "virtual:boundary-probe") return fixture; }}],
    build: {write: false, minify: "esbuild", rollupOptions: {input: "virtual:boundary-probe", preserveEntrySignatures: "strict",
      output: {format: "iife", name: "BoundaryProbe", inlineDynamicImports: true}}}});
  const code = result.output.find(item => item.type === "chunk" && item.isEntry).code;
  const observed = vm.runInNewContext(code + "\nBoundaryProbe.inspect();", {
    AbortController, Request, Response, Headers, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout,
  }, {timeout: 10000});
  assert.equal(observed.recognized, true);
  assert.equal(observed.handled, true, "minification must not send the SDK response to the root error page");
  assert.equal(observed.headerPreserved, true);
  assert.equal(observed.rethrown, true, "unrelated errors must remain failures");
  assert.equal(observed.status, 401, "handling must not manufacture a grant or success response");
});
