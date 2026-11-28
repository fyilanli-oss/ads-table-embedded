const testShop = "gid://shopify/Shop/75618484313";
const appClientId = "58c91f39f69ca282a94ba06e9648be9e";
const eventHandle = "adstable-1.ecosystem_role_probe";
const runId = "eo06e-development-product-level-v2";
const timestamp = "2026-11-27T12:00:00.000Z";

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

  const advertised = "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik";
  const sold = "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Kolye";
  const products = { braidedNecklace: { id: "9900000000001", name: sold } };
  const rows = [{
    id: "meta-bracelets-sold",
    platform: "Meta",
    campaign: "YILBAŞI KAMPANYASI",
    channel: "BİLEKLİKLER",
    product: "braidedNecklace",
    advertisedProduct: advertised,
    soldProduct: sold,
    role: "Contribution From",
    salesRole: "Cross Sell",
    sales: 8000,
    contributionTo: 0,
  }];
  for (const row of rows) {
    const product = products[row.product];
    const response = await post("app/2026-10/events", {
      shop_id: testShop,
      event_handle: eventHandle,
      timestamp,
      idempotency_key: `${runId}-${row.id}`,
      attributes: {
        probe_run: runId,
        advertised_product: row.advertisedProduct,
        sold_product: row.soldProduct,
        platform: row.platform,
        campaign: row.campaign,
        channel: row.channel,
        product_id: product.id,
        product_name: product.name,
        sku: "Yok",
        sales_role: row.salesRole,
        quantity_delta: 1,
        sales_delta: row.sales,
        contribution_role: row.role,
        contribution_to_sales_amount: row.contributionTo,
      },
    }, credential.access_token);
    if (response.status !== 202 || response.headers.get("Idempotent-Replay") === "true") {
      throw new RehearsalError(`Shopify ${row.id} event returned HTTP ${response.status} or an existing receipt`);
    }
    if ((await response.json()).success !== true) {
      throw new RehearsalError(`Shopify ${row.id} receipt could not be verified`);
    }
    console.log(JSON.stringify({ runId, timestamp, status: 202, ...row, productId: product.id }));
  }
}

try {
  await sendContribution(process.env, new Date());
} catch (error) {
  const detail = error instanceof RehearsalError ? error.message : "Provider or local validation result could not be confirmed";
  console.error(`Shopify Analytics contribution stopped. ${detail}`);
  process.exitCode = 1;
}
