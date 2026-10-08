import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import {normalizeShopDomain} from "./installation-authority.server.js";
import {shopIdentitySha256} from "./shop-identity.server.js";

const TOPICS = new Set([
  "app/uninstalled",
  "customers/data_request",
  "customers/redact",
  "shop/redact",
]);
const API_VERSION_PATTERN = /^[0-9]{4}-[0-9]{2}$/;

export class InvalidShopifyWebhookError extends Error {
  constructor(code) {
    super(code);
    this.name = "InvalidShopifyWebhookError";
  }
}

function requiredHeader(headers, name) {
  const value = headers.get(name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidShopifyWebhookError("SHOPIFY_WEBHOOK_HEADER_INVALID");
  }
  return value.trim();
}

function verifyDigest(rawBody, encodedDigest, secret) {
  let received;
  try {
    received = Buffer.from(encodedDigest, "base64");
  } catch {
    throw new InvalidShopifyWebhookError("SHOPIFY_WEBHOOK_HMAC_INVALID");
  }
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new InvalidShopifyWebhookError("SHOPIFY_WEBHOOK_HMAC_INVALID");
  }
}

function canonicalShopId(payload) {
  const value = payload?.shop_id ?? payload?.id;
  if (
    (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    && (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value))
  ) {
    throw new InvalidShopifyWebhookError("SHOPIFY_WEBHOOK_SHOP_ID_INVALID");
  }
  return "gid://shopify/Shop/" + String(value);
}

function optionalTimestamp(value) {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new InvalidShopifyWebhookError("SHOPIFY_WEBHOOK_TRIGGERED_AT_INVALID");
  }
  return date.toISOString();
}

export async function verifyShopifyWebhookRequest(
  request,
  {environment = process.env, receivedAt = new Date()} = {},
) {
  if (!(request instanceof Request) || request.method !== "POST") {
    throw new InvalidShopifyWebhookError("SHOPIFY_WEBHOOK_REQUEST_INVALID");
  }
  const secret = environment?.SHOPIFY_API_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("SHOPIFY_API_SECRET_INVALID");
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new InvalidShopifyWebhookError("SHOPIFY_WEBHOOK_CONTENT_TYPE_INVALID");
  }

  const rawBody = await request.text();
  verifyDigest(
    rawBody,
    requiredHeader(request.headers, "x-shopify-hmac-sha256"),
    secret,
  );

  const topic = requiredHeader(request.headers, "x-shopify-topic").toLowerCase();
  if (!TOPICS.has(topic)) {
    throw new InvalidShopifyWebhookError("SHOPIFY_WEBHOOK_TOPIC_INVALID");
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new InvalidShopifyWebhookError("SHOPIFY_WEBHOOK_JSON_INVALID");
  }

  const shopId = canonicalShopId(payload);
  const apiVersion = request.headers.get("x-shopify-api-version")?.trim() || null;
  if (apiVersion !== null && !API_VERSION_PATTERN.test(apiVersion)) {
    throw new InvalidShopifyWebhookError("SHOPIFY_WEBHOOK_API_VERSION_INVALID");
  }
  if (!(receivedAt instanceof Date) || Number.isNaN(receivedAt.valueOf())) {
    throw new TypeError("receivedAt must be a valid Date");
  }

  return Object.freeze({
    verified: true,
    webhookId: requiredHeader(request.headers, "x-shopify-webhook-id"),
    eventId: request.headers.get("x-shopify-event-id")?.trim() || null,
    topic,
    shopId,
    shopDomain: normalizeShopDomain(
      requiredHeader(request.headers, "x-shopify-shop-domain"),
    ),
    shopIdentitySha256: shopIdentitySha256(shopId),
    payloadSha256: createHash("sha256").update(rawBody, "utf8").digest("hex"),
    apiVersion,
    triggeredAt: optionalTimestamp(
      request.headers.get("x-shopify-triggered-at"),
    ),
    receivedAt: receivedAt.toISOString(),
  });
}
