import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {StaticRouter} from "react-router";
import {AppProvider} from "@shopify/shopify-app-react-router/react";
import {createShopifyAppRuntime} from "../app/lib/shopify/shopify-app-runtime.server.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ui = JSON.parse(read("contracts/shopify/shopify-embedded-ui-constitution-v1.json"));
const approved = ui.approved_runtime.polaris_script;

function assertPolarisParity(link, html) {
  const preloads = [...link.matchAll(/<([^>]+)>; rel="preload"; as="script"/g)]
    .map(match => match[1]).filter(url => url.includes("/polaris"));
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(preloads, [approved]);
  assert.deepEqual(scripts.filter(url => url.includes("/polaris")), [approved]);
  const bridgeIndex = scripts.findIndex(url => url.endsWith("/app-bridge.js"));
  assert.ok(bridgeIndex >= 0 && bridgeIndex < scripts.indexOf(approved));
}

test("real Shopify SDK preload and real AppProvider script use the same approved RC URL", async () => {
  const queries = [];
  const runtime = await createShopifyAppRuntime({
    environment: {
      SHOPIFY_API_KEY: "a".repeat(32),
      SHOPIFY_API_SECRET: "s".repeat(32),
      SHOPIFY_APP_URL: "https://embedded.adstable.app",
      SCOPES: "",
      ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION: "1",
      ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1: Buffer.alloc(32, 9).toString("base64url"),
    },
    database: {query: async sql => {
      queries.push(sql);
      assert.match(sql, /integrations\.token_vault_runtime_guard/);
      return {rows: [{contract_version: 1, used_key_versions: []}]};
    }},
    sessionStorage: {
      storeSession: async () => true,
      loadSession: async () => undefined,
      deleteSession: async () => true,
      deleteSessions: async () => true,
      findSessionsByShop: async () => [],
    },
  });
  const headers = new Headers();
  runtime.shopify.addDocumentResponseHeaders(
    new Request("https://embedded.adstable.app/?shop=f04-synthetic.myshopify.com"), headers);
  const html = renderToStaticMarkup(createElement(StaticRouter, {location: "/"},
    createElement(AppProvider, runtime.publicConfig)));
  assert.equal(runtime.publicConfig.polarisUrl, approved);
  assertPolarisParity(headers.get("Link"), html);
  assert.equal(queries.length, 1, "only the synthetic startup guard may query the stub");
  assert.ok(Object.isFrozen(runtime.publicConfig));
});

test("mismatched preloads, duplicate scripts and an unapproved version fail parity", () => {
  const validLink = `<${approved}>; rel="preload"; as="script"`;
  const validHtml = `<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script><script src="${approved}"></script>`;
  assert.doesNotThrow(() => assertPolarisParity(validLink, validHtml));
  assert.throws(() => assertPolarisParity(validLink.replace(approved, "https://cdn.shopify.com/shopifycloud/polaris.js"), validHtml));
  assert.throws(() => assertPolarisParity(validLink, validHtml + `<script src="${approved}"></script>`));
  assert.throws(() => assertPolarisParity(validLink, validHtml.replace(approved, "https://cdn.shopify.com/shopifycloud/polaris-2.0-rc.js")));
});
