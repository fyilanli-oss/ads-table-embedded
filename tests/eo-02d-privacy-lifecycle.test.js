import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  InvalidShopifyWebhookError,
  verifyShopifyWebhookRequest,
} from "../app/lib/shopify/privacy-webhook.server.js";
import {
  createPrivacyLifecycleRepository,
} from "../app/lib/database/privacy-lifecycle-repository.server.js";
import {
  createPrivacyLifecycleRuntime,
} from "../app/lib/shopify/privacy-lifecycle.server.js";
import {shopIdentitySha256} from "../app/lib/shopify/shop-identity.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read(
  "supabase/migrations/20261008190000_eo02d_privacy_lifecycle.sql",
);
const secret = "s".repeat(32);
const rawBody = JSON.stringify({
  shop_id: 123456789,
  shop_domain: "example-store.myshopify.com",
});

function signedRequest({
  body = rawBody,
  hmac = createHmac("sha256", secret).update(body).digest("base64"),
  topic = "shop/redact",
} = {}) {
  return new Request("https://embedded.adstable.app/webhooks/shopify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": "example-store.myshopify.com",
      "x-shopify-webhook-id": "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9a",
      "x-shopify-event-id": "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9b",
      "x-shopify-api-version": "2026-10",
      "x-shopify-triggered-at": "2026-10-08T18:00:00.000Z",
    },
    body,
  });
}

test("Shopify webhook ingress verifies raw-body HMAC before producing a claim", async () => {
  const claim = await verifyShopifyWebhookRequest(signedRequest(), {
    environment: {SHOPIFY_API_SECRET: secret},
    receivedAt: new Date("2026-10-08T18:00:01.000Z"),
  });

  assert.equal(claim.verified, true);
  assert.equal(claim.topic, "shop/redact");
  assert.equal(claim.shopId, "gid://shopify/Shop/123456789");
  assert.equal(claim.shopDomain, "example-store.myshopify.com");
  assert.equal(claim.apiVersion, "2026-10");
  assert.equal(claim.shopIdentitySha256.equals(
    shopIdentitySha256("gid://shopify/Shop/123456789"),
  ), true);
  assert.match(claim.payloadSha256, /^[0-9a-f]{64}$/);
  assert.equal("payload" in claim, false);
});

test("invalid HMAC and unsupported topics fail closed before persistence", async () => {
  await assert.rejects(
    verifyShopifyWebhookRequest(signedRequest({hmac: Buffer.alloc(32).toString("base64")}), {
      environment: {SHOPIFY_API_SECRET: secret},
    }),
    InvalidShopifyWebhookError,
  );
  await assert.rejects(
    verifyShopifyWebhookRequest(signedRequest({topic: "orders/create"}), {
      environment: {SHOPIFY_API_SECRET: secret},
    }),
    /SHOPIFY_WEBHOOK_TOPIC_INVALID/,
  );
});

test("privacy repository uses only approved function boundaries", async () => {
  const calls = [];
  const database = {
    async query(text, values) {
      calls.push({text, values});
      if (text.includes("claim_shopify_webhook")) {
        return {rows: [{
          claim_id: "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9a",
          deletion_run_id: "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9b",
          workspace_id: "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9c",
          install_generation: 1,
          outcome: "queued",
          duplicate: false,
        }]};
      }
      if (text.includes("request_workspace_deletion")) {
        return {rows: [{deletion_run_id: "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9b"}]};
      }
      return {rows: [{
        deletion_run_id: "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9b",
        deletion_status: "completed",
        manifest_id: "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9d",
        manifest_result: "deleted",
      }]};
    },
  };
  const repository = createPrivacyLifecycleRepository(database);
  const fingerprint = Buffer.alloc(32, 1);

  const claimed = await repository.claimWebhook({
    webhookId: "webhook-id",
    eventId: null,
    topic: "shop/redact",
    shopId: "gid://shopify/Shop/123456789",
    shopDomain: "example-store.myshopify.com",
    shopIdentitySha256: fingerprint,
    payloadSha256: "a".repeat(64),
    apiVersion: "2026-10",
    triggeredAt: null,
    receivedAt: "2026-10-08T18:00:00.000Z",
  });
  assert.equal(claimed.outcome, "queued");
  await repository.requestWorkspaceDeletion({
    requestKey: "merchant:request-id",
    shopId: "gid://shopify/Shop/123456789",
    shopDomain: "example-store.myshopify.com",
    installGeneration: 1,
    shopIdentitySha256: fingerprint,
    requestedAt: "2026-10-08T18:00:00.000Z",
  });
  const executed = await repository.executeDeletionRun(
    "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9b",
  );
  assert.equal(executed.result, "deleted");

  const sql = calls.map(({text}) => text).join("\n");
  for (const name of [
    "privacy.claim_shopify_webhook",
    "privacy.request_workspace_deletion",
    "privacy.execute_deletion_run",
  ]) assert.match(sql, new RegExp(name.replace(".", "\\.")));
  assert.doesNotMatch(sql, /\b(?:insert|update|delete)\s+(?:into|from)?\s*privacy\./i);
});

test("merchant deletion requires verified Admin identity and is generation scoped", async () => {
  let persisted;
  const runtime = createPrivacyLifecycleRuntime({
    repository: {
      async requestWorkspaceDeletion(value) {
        persisted = value;
        return "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9b";
      },
    },
  });
  await assert.rejects(
    runtime.requestMerchantDeletion({
      shop: {
        shopId: "gid://shopify/Shop/123456789",
        myshopifyDomain: "example-store.myshopify.com",
      },
      installGeneration: 1,
    }),
    /VERIFIED_SHOPIFY_ADMIN_IDENTITY_REQUIRED/,
  );
  await runtime.requestMerchantDeletion({
    shop: {
      authority: "shopify_admin_verified",
      shopId: "gid://shopify/Shop/123456789",
      myshopifyDomain: "example-store.myshopify.com",
    },
    installGeneration: 3,
    requestedAt: new Date("2026-10-08T18:00:00.000Z"),
    requestKey: "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9e",
  });
  assert.equal(persisted.installGeneration, 3);
  assert.equal(persisted.requestKey.startsWith("merchant:"), true);
});

test("migration enforces private forced-RLS lifecycle and generation-safe deletion", () => {
  for (const table of [
    "privacy.webhook_claims",
    "privacy.deletion_runs",
    "privacy.deletion_manifests",
  ]) {
    assert.match(migration, new RegExp(
      "alter table " + table.replace(".", "\\.") + " enable row level security",
    ));
    assert.match(migration, new RegExp(
      "alter table " + table.replace(".", "\\.") + " force row level security",
    ));
  }
  assert.match(migration, /webhook_id text not null unique/);
  assert.match(migration, /ignored_reinstalled/);
  assert.match(migration, /installation\.status = 'uninstall_pending_redaction'/);
  assert.match(migration, /installation\.status = 'deletion_pending'/);
  assert.match(migration, /shop_identity_sha256 = current_run\.shop_identity_sha256/);
  assert.match(migration, /coalesce\(max\(manifest\.install_generation\), 0\) \+ 1/);
  assert.match(migration, /p_received_at \+ interval '30 days'/);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete|all)[^;]*to\s+adstable_runtime/i);
  assert.doesNotMatch(migration, /grant[^;]*to\s+(?:anon|authenticated|service_role)/);
  assert.doesNotMatch(migration, /\b(?:customer_email|customer_phone|raw_payload|payload_json)\b/i);
});

test("webhook route uses the isolated verifier and never requires a revoked shop token", () => {
  const route = read("app/routes/webhooks.shopify.tsx");
  assert.match(route, /verifyShopifyWebhookRequest\(request\)/);
  assert.match(route, /claimVerifiedWebhook\(claim\)/);
  assert.match(route, /status: 202/);
  assert.match(route, /status: 401/);
  assert.doesNotMatch(route, /authenticate\.webhook|accessToken|refreshToken/);
});

test("live database evidence proves migration safety without claiming runtime closure", () => {
  const evidence = JSON.parse(read(
    "docs/evidence/EO_02D_DATABASE_ACCEPTANCE_2026-10-08.json",
  ));
  assert.equal(evidence.status, "PASS_DATABASE_MIGRATION");
  assert.equal(evidence.migration.applied, true);
  assert.equal(evidence.database_boundary.row_level_security, "enabled_and_forced");
  assert.deepEqual(evidence.database_boundary.direct_table_access, {
    anon: false,
    authenticated: false,
    service_role: false,
    adstable_runtime: false,
  });
  assert.equal(evidence.advisor.security_findings, 0);
  assert.equal(evidence.data_safety.existing_live_state_changed, false);
  assert.equal(evidence.data_safety.production_data_deleted, false);
  assert.equal(evidence.data_safety.synthetic_rows_persisted, false);
  assert.equal(evidence.runtime_acceptance.status, "PENDING_POST_DEPLOY");
  assert.equal(
    evidence.shopify_subscription_acceptance.status,
    "PENDING_POST_DEPLOY",
  );
  assert.equal(evidence.secrets_in_evidence, false);
});
