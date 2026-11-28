const testShop = "gid://shopify/Shop/75618484313";
const appClientId = "58c91f39f69ca282a94ba06e9648be9e";
const eventHandle = "adstable-1.ecosystem_sale_probe";
const runId = "eo06e-development-analytics-first-sale";
const timestamp = "2026-11-19T12:00:00.000Z";
const replayDeadline = Date.parse("2026-11-27T16:34:00.000Z");

class RehearsalError extends Error {}

async function post(path, payload, token) {
  const headers = { "Content-Type": "application/json", "User-Agent": "AdsTable-Analytics-Rehearsal/1.0" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`https://api.shopify.com/${path}`, {
    method: "POST",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify(payload),
  });
}

async function replayCorrection(env, now) {
  if (env.ADSTABLE_ANALYTICS_EXPECT_REPLAY !== "1") throw new RehearsalError("Explicit replay required");
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production") throw new RehearsalError("Vercel production build required");
  if (env.SHOPIFY_API_KEY !== appClientId || !env.SHOPIFY_API_SECRET) throw new RehearsalError("AdsTable credentials unavailable");
  if (env.ADSTABLE_ANALYTICS_TEST_SHOP_GID !== testShop) throw new RehearsalError("Test shop identity mismatch");
  const expires = Date.parse(env.ADSTABLE_ANALYTICS_PROBE_EXPIRES_AT ?? "");
  if (!Number.isFinite(expires) || expires <= now.getTime() || expires - now.getTime() > 3_600_000 || expires > replayDeadline) {
    throw new RehearsalError("Replay window missing or expired");
  }

  const auth = await post("auth/access_token", {
    client_id: appClientId,
    client_secret: env.SHOPIFY_API_SECRET,
    grant_type: "client_credentials",
  });
  if (!auth.ok) throw new RehearsalError(`Shopify token request returned HTTP ${auth.status}`);
  const credential = await auth.json();
  if (credential.token_type !== "Bearer" || typeof credential.access_token !== "string" || !credential.access_token) {
    throw new RehearsalError("Shopify did not return an App Events bearer token");
  }

  if (Date.now() >= expires) throw new RehearsalError("Replay window expired before submission");
  const response = await post("app/2026-10/events", {
    shop_id: testShop,
    event_handle: eventHandle,
    timestamp,
    idempotency_key: `${runId}-correction`,
    attributes: {
      probe_run: runId,
      advertised_product: "A",
      sold_product: "B",
      campaign: "campaign-test-1",
      quantity_delta: 0,
      sales_delta: -2000,
    },
  }, credential.access_token);
  if (response.status !== 202) throw new RehearsalError(`Shopify replay returned HTTP ${response.status}`);
  if (response.headers.get("Idempotent-Replay") !== "true" || (await response.json()).success !== true) {
    throw new RehearsalError("Shopify did not confirm reuse of the correction receipt");
  }
  console.log(JSON.stringify({ runId, eventHandle, timestamp, status: 202, idempotentReplay: true }));
}

try {
  await replayCorrection(process.env, new Date());
} catch (error) {
  const detail = error instanceof RehearsalError ? error.message : "Provider or local validation result could not be confirmed";
  console.error(`Shopify Analytics replay stopped. ${detail}`);
  process.exitCode = 1;
}
