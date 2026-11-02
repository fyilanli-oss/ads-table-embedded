import {randomBytes, randomUUID} from "node:crypto";
import {createSourceEvidenceCipher, prepareSourceWrite} from "../../app/lib/database/source-evidence-store.server.js";

export function sourceStoreFixture(overrides = {}) {
  const now = new Date().toISOString();
  const owner = {workspaceId: randomUUID(), installationId: "1", generation: "1",
    shopId: "gid://shopify/Shop/1", shopDomain: "source-fixture.myshopify.com", provider: "shopify"};
  const policy = Object.fromEntries(["metadata", "raw", "identity", "order", "claim"].map((kind, i) =>
    [kind, {version: "synthetic-test-policy", until: new Date(Date.now() + (kind === "metadata" ? 90 : i + 1) * 86400000).toISOString()}]));
  const header = {id: "gid://shopify/Order/101", updatedAt: "2026-01-01T00:00:00.000Z", amount: "120.50", currencyCode: "USD"};
  const line = {id: "gid://shopify/LineItem/201", quantity: 2, currentQuantity: 2, productId: "gid://shopify/Product/301"};
  const input = {owner, now, policy, attemptId: randomUUID(), ordinal: 0, sourceState: "complete",
    cipher: createSourceEvidenceCipher({keys: new Map([[1, randomBytes(32)]]), activeVersion: 1, forbiddenKeys: []}),
    limits: {maxBytes: 100000, maxRows: 100},
    pages: [{key: "page", family: "shopify_orders", ordinal: 0, origin: "shopify", captureLayer: "collector_projection",
      numericFidelity: "exact_source_string", fieldCoverage: ["records"], schemaVersion: "fixture-v1", sanitizerVersion: "fixture-v1", payload: {records: [header, line]}}],
    records: {
      references: [
        {key: "order-ref", page: "page", locatorKind: "row", locator: "/records/0", nativeType: "Order", nativeId: header.id, state: "present"},
        {key: "line-ref", page: "page", locatorKind: "row", locator: "/records/1", nativeType: "LineItem", nativeId: line.id, state: "present"},
      ], rules: [], mappings: [],
      orders: [{key: "order", reference: "order-ref", orderId: header.id, updatedAt: header.updatedAt, data: header}],
      lines: [{key: "line", reference: "line-ref", order: "order", lineId: line.id, data: line}],
      journeys: [], claims: [], links: [],
    }, ...overrides};
  return {input, prepare: () => prepareSourceWrite(input)};
}
