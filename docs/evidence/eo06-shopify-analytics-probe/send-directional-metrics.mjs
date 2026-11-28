const testShop = "gid://shopify/Shop/75618484313";
const appClientId = "58c91f39f69ca282a94ba06e9648be9e";
const eventHandle = "adstable-1.ecosystem_sale_probe";
const runId = "eo06e-development-contribution-metrics-v1";
const timestamp = "2026-11-19T12:00:00.000Z";

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

async function sendContribution(env, now) {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production") throw new RehearsalError("Vercel production build required");
  if (env.SHOPIFY_API_KEY !== appClientId || !env.SHOPIFY_API_SECRET) throw new RehearsalError("AdsTable credentials unavailable");
  if (env.ADSTABLE_ANALYTICS_TEST_SHOP_GID !== testShop) throw new RehearsalError("Test shop identity mismatch");
  const expires = Date.parse(env.ADSTABLE_ANALYTICS_PROBE_EXPIRES_AT ?? "");
  if (!Number.isFinite(expires) || expires <= now.getTime() || expires - now.getTime() > 3_600_000) {
    throw new RehearsalError("One-hour rehearsal window required");
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

  const rows = [
    { direction: "from", advertisedProduct: "C", soldProduct: "A", from: 5000, to: 0 },
    { direction: "to", advertisedProduct: "A", soldProduct: "B", from: 0, to: 8000 },
  ];
  for (const row of rows) {
    const response = await post("app/2026-10/events", {
      shop_id: testShop,
      event_handle: eventHandle,
      timestamp,
      idempotency_key: `${runId}-${row.direction}`,
      attributes: {
        probe_run: runId,
        advertised_product: row.advertisedProduct,
        sold_product: row.soldProduct,
        campaign: "campaign-test-1",
        quantity_delta: 1,
        sales_delta: row.from + row.to,
        focus_product: "A",
        contribution_from_amount: row.from,
        contribution_to_amount: row.to,
      },
    }, credential.access_token);
    if (response.status !== 202 || response.headers.get("Idempotent-Replay") === "true") {
      throw new RehearsalError(`Shopify ${row.direction} event returned HTTP ${response.status} or an existing receipt`);
    }
    if ((await response.json()).success !== true) {
      throw new RehearsalError(`Shopify ${row.direction} receipt could not be verified`);
    }
    console.log(JSON.stringify({ runId, timestamp, status: 202, ...row }));
  }
}

try {
  await sendContribution(process.env, new Date());
} catch (error) {
  const detail = error instanceof RehearsalError ? error.message : "Provider or local validation result could not be confirmed";
  console.error(`Shopify Analytics contribution stopped. ${detail}`);
  process.exitCode = 1;
}
