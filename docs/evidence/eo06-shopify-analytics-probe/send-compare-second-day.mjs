const testShop = "gid://shopify/Shop/75618484313";
const appClientId = "58c91f39f69ca282a94ba06e9648be9e";
const timestamp = "2026-11-28T12:00:00.000Z";
const productRun = "eo06e-development-product-level-v2";
const productEvent = "adstable-1.ecosystem_role_probe";
const channelEvent = "adstable-1.ecosystem_channel_level_full_probe";

// The two 28 November sales rows mirror the previously accepted two-day share fixture.
const rows = [
  ["google-bracelet", {
    platform: "Google",
    campaign: "GOOGLE YILBAŞI KAMPANYASI",
    channel: "BİLEKLİKLER",
    product_id: "8523766988847",
    sku: "Yok",
    advertised_product: "925 Gümüş 14K Altın Kaplama Zirkon Taşlı İp Bileklik",
    sold_product: "925 Gümüş 14K Altın Kaplama Zirkon Taşlı İp Bileklik",
    contribution_role: "Contribution From",
    sales_role: "Direct",
    sales_delta: 28000,
    contribution_to_sales_amount: 0,
    product_title: "925 Gümüş 14K Altın Kaplama Zirkon Taşlı İp Bileklik",
    interactivity: "Same Channel",
    interacted_channel: "This Channel",
  }],
  ["google-keywords", {
    platform: "Google",
    campaign: "Keyword Kampanyası",
    channel: "Keywords",
    product_id: "8523622678575",
    sku: "Yok",
    advertised_product: "Unknown",
    sold_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    contribution_role: "Contribution From",
    sales_role: "Indirect",
    sales_delta: 8000,
    contribution_to_sales_amount: 0,
    product_title: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    interactivity: "Unknown",
    interacted_channel: "Unknown",
  }],
];

function events() {
  return rows.flatMap(([id, attributes]) => {
    const { product_title: title, interactivity, interacted_channel, ...common } = attributes;
    return [
      {
        event_handle: productEvent,
        idempotency_key: "eo06e-compare-20261128-product-" + id,
        attributes: { ...common, probe_run: productRun, product_name: title, quantity_delta: 1 },
      },
      {
        event_handle: channelEvent,
        idempotency_key: "eo06e-compare-20261128-channel-" + id,
        attributes,
      },
    ];
  });
}

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

  for (const event of events()) {
    const response = await post("app/2026-10/events", {
      shop_id: testShop,
      timestamp,
      ...event,
    }, credential.access_token);
    if (response.status !== 202 || response.headers.get("Idempotent-Replay") === "true") {
      throw new RehearsalError("Shopify " + event.idempotency_key + " returned HTTP " + response.status + " or an existing receipt");
    }
    if ((await response.json()).success !== true) {
      throw new RehearsalError("Shopify " + event.idempotency_key + " receipt could not be verified");
    }
    console.log(JSON.stringify({
      id: event.idempotency_key,
      event: event.event_handle,
      sales: event.attributes.sales_delta,
      contributionTo: event.attributes.contribution_to_sales_amount,
      status: 202,
      success: true,
    }));
  }
}

try {
  await sendContribution(process.env, new Date());
} catch (error) {
  const detail = error instanceof RehearsalError ? error.message : "Provider or local validation result could not be confirmed";
  console.error("Shopify Analytics compare rehearsal stopped. " + detail);
  process.exitCode = 1;
}
