const testShop = "gid://shopify/Shop/75618484313";
const appClientId = "58c91f39f69ca282a94ba06e9648be9e";
const timestamp = "2026-11-28T12:00:00.000Z";
const productRun = "eo06e-development-product-level-v2";
const productEvent = "adstable-1.ecosystem_role_probe";
const channelEvent = "adstable-1.ecosystem_channel_level_full_probe";

// Complete the 28 November detail fixture. Amounts are incremental, in TRY minor units.
// Google Bileklikler receives 270 TRY on top of 280 TRY, and Keywords receives 640 TRY on top of 80 TRY.
const rows = [
  ["meta-bracelet", {
    platform: "Meta",
    campaign: "YILBAŞI KAMPANYASI",
    channel: "BİLEKLİKLER",
    product_id: "8523622678575",
    sku: "Yok",
    advertised_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    sold_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    contribution_role: "Contribution From",
    sales_role: "Direct",
    sales_delta: 12000,
    contribution_to_sales_amount: 0,
    product_title: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    interactivity: "Same Channel",
    interacted_channel: "This Channel",
  }],
  ["meta-necklace-cross-from", {
    platform: "Meta",
    campaign: "YILBAŞI KAMPANYASI",
    channel: "BİLEKLİKLER",
    product_id: "9900000000001",
    sku: "Yok",
    advertised_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    sold_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Kolye",
    contribution_role: "Contribution From",
    sales_role: "Cross Sell",
    sales_delta: 10000,
    contribution_to_sales_amount: 0,
    product_title: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Kolye",
    interactivity: "Other Channels in Campaign",
    interacted_channel: "KOLYELER",
  }],
  ["meta-necklace-cross-to", {
    platform: "Meta",
    campaign: "YILBAŞI KAMPANYASI",
    channel: "BİLEKLİKLER",
    product_id: "8523622678575",
    sku: "Yok",
    advertised_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    sold_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Kolye",
    contribution_role: "Contribution To",
    sales_role: "Cross Sell",
    sales_delta: 0,
    contribution_to_sales_amount: 10000,
    product_title: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    interactivity: "Other Channels in Campaign",
    interacted_channel: "KOLYELER",
  }],
  ["meta-necklace", {
    platform: "Meta",
    campaign: "YILBAŞI KAMPANYASI",
    channel: "KOLYELER",
    product_id: "9900000000001",
    sku: "Yok",
    advertised_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Kolye",
    sold_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Kolye",
    contribution_role: "Contribution From",
    sales_role: "Direct",
    sales_delta: 18000,
    contribution_to_sales_amount: 0,
    product_title: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Kolye",
    interactivity: "Same Channel",
    interacted_channel: "This Channel",
  }],
  ["meta-catalog", {
    platform: "Meta",
    campaign: "Catalog Kampanyası",
    channel: "Catalog",
    product_id: "8523622678575",
    sku: "Yok",
    advertised_product: "Unknown",
    sold_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    contribution_role: "Contribution From",
    sales_role: "Indirect",
    sales_delta: 33000,
    contribution_to_sales_amount: 0,
    product_title: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    interactivity: "Unknown",
    interacted_channel: "Unknown",
  }],
  ["meta-ring", {
    platform: "Meta",
    campaign: "Fırsat Kampanyası",
    channel: "YÜZÜKLER",
    product_id: "9900000000008",
    sku: "Yok",
    advertised_product: "Gümüş Yüzük",
    sold_product: "Gümüş Yüzük",
    contribution_role: "Contribution From",
    sales_role: "Direct",
    sales_delta: 42000,
    contribution_to_sales_amount: 0,
    product_title: "Gümüş Yüzük",
    interactivity: "Same Channel",
    interacted_channel: "This Channel",
  }],
  ["meta-earrings", {
    platform: "Meta",
    campaign: "Fırsat Kampanyası",
    channel: "KÜPELER",
    product_id: "9900000000007",
    sku: "Yok",
    advertised_product: "Gümüş Küpe",
    sold_product: "Gümüş Küpe",
    contribution_role: "Contribution From",
    sales_role: "Direct",
    sales_delta: 48000,
    contribution_to_sales_amount: 0,
    product_title: "Gümüş Küpe",
    interactivity: "Same Channel",
    interacted_channel: "This Channel",
  }],
  ["meta-hoops-cross-from", {
    platform: "Meta",
    campaign: "Fırsat Kampanyası",
    channel: "KÜPELER",
    product_id: "9900000000009",
    sku: "Yok",
    advertised_product: "Gümüş Küpe",
    sold_product: "Gümüş Halka Küpe",
    contribution_role: "Contribution From",
    sales_role: "Cross Sell",
    sales_delta: 5500,
    contribution_to_sales_amount: 0,
    product_title: "Gümüş Halka Küpe",
    interactivity: "Same Channel",
    interacted_channel: "This Channel",
  }],
  ["meta-hoops-cross-to", {
    platform: "Meta",
    campaign: "Fırsat Kampanyası",
    channel: "KÜPELER",
    product_id: "9900000000007",
    sku: "Yok",
    advertised_product: "Gümüş Küpe",
    sold_product: "Gümüş Halka Küpe",
    contribution_role: "Contribution To",
    sales_role: "Cross Sell",
    sales_delta: 0,
    contribution_to_sales_amount: 5500,
    product_title: "Gümüş Küpe",
    interactivity: "Same Channel",
    interacted_channel: "This Channel",
  }],
  ["meta-anklet-cross-from", {
    platform: "Meta",
    campaign: "Fırsat Kampanyası",
    channel: "KÜPELER",
    product_id: "9900000000010",
    sku: "Yok",
    advertised_product: "Gümüş Küpe",
    sold_product: "Gümüş Halhal",
    contribution_role: "Contribution From",
    sales_role: "Cross Sell",
    sales_delta: 4500,
    contribution_to_sales_amount: 0,
    product_title: "Gümüş Halhal",
    interactivity: "Non Advertised Products",
    interacted_channel: "No Channel",
  }],
  ["meta-anklet-cross-to", {
    platform: "Meta",
    campaign: "Fırsat Kampanyası",
    channel: "KÜPELER",
    product_id: "9900000000007",
    sku: "Yok",
    advertised_product: "Gümüş Küpe",
    sold_product: "Gümüş Halhal",
    contribution_role: "Contribution To",
    sales_role: "Cross Sell",
    sales_delta: 0,
    contribution_to_sales_amount: 4500,
    product_title: "Gümüş Küpe",
    interactivity: "Non Advertised Products",
    interacted_channel: "No Channel",
  }],
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
    sales_delta: 27000,
    contribution_to_sales_amount: 0,
    product_title: "925 Gümüş 14K Altın Kaplama Zirkon Taşlı İp Bileklik",
    interactivity: "Same Channel",
    interacted_channel: "This Channel",
  }],
  ["google-bracelet-cross-from", {
    platform: "Google",
    campaign: "GOOGLE YILBAŞI KAMPANYASI",
    channel: "BİLEKLİKLER",
    product_id: "8523622678575",
    sku: "Yok",
    advertised_product: "925 Gümüş 14K Altın Kaplama Zirkon Taşlı İp Bileklik",
    sold_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    contribution_role: "Contribution From",
    sales_role: "Cross Sell",
    sales_delta: 14000,
    contribution_to_sales_amount: 0,
    product_title: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    interactivity: "Other Channels in Other Campaigns",
    interacted_channel: "Fırsat Kampanyası · BİLEKLİKLER",
  }],
  ["google-bracelet-cross-to", {
    platform: "Google",
    campaign: "GOOGLE YILBAŞI KAMPANYASI",
    channel: "BİLEKLİKLER",
    product_id: "8523766988847",
    sku: "Yok",
    advertised_product: "925 Gümüş 14K Altın Kaplama Zirkon Taşlı İp Bileklik",
    sold_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    contribution_role: "Contribution To",
    sales_role: "Cross Sell",
    sales_delta: 0,
    contribution_to_sales_amount: 14000,
    product_title: "925 Gümüş 14K Altın Kaplama Zirkon Taşlı İp Bileklik",
    interactivity: "Other Channels in Other Campaigns",
    interacted_channel: "Fırsat Kampanyası · BİLEKLİKLER",
  }],
  ["google-necklace", {
    platform: "Google",
    campaign: "GOOGLE YILBAŞI KAMPANYASI",
    channel: "KOLYELER",
    product_id: "9900000000003",
    sku: "Yok",
    advertised_product: "925 Gümüş 14K Altın Kaplama Zirkon Taşlı Göz Örgü Kolye",
    sold_product: "925 Gümüş 14K Altın Kaplama Zirkon Taşlı Göz Örgü Kolye",
    contribution_role: "Contribution From",
    sales_role: "Direct",
    sales_delta: 76000,
    contribution_to_sales_amount: 0,
    product_title: "925 Gümüş 14K Altın Kaplama Zirkon Taşlı Göz Örgü Kolye",
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
    sales_delta: 64000,
    contribution_to_sales_amount: 0,
    product_title: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    interactivity: "Unknown",
    interacted_channel: "Unknown",
  }],
  ["google-ring", {
    platform: "Google",
    campaign: "Fırsat Kampanyası",
    channel: "YÜZÜKLER",
    product_id: "9900000000008",
    sku: "Yok",
    advertised_product: "Gümüş Yüzük",
    sold_product: "Gümüş Yüzük",
    contribution_role: "Contribution From",
    sales_role: "Direct",
    sales_delta: 90000,
    contribution_to_sales_amount: 0,
    product_title: "Gümüş Yüzük",
    interactivity: "Same Channel",
    interacted_channel: "This Channel",
  }],
  ["google-earrings", {
    platform: "Google",
    campaign: "Fırsat Kampanyası",
    channel: "KÜPELER",
    product_id: "9900000000007",
    sku: "Yok",
    advertised_product: "Gümüş Küpe",
    sold_product: "Gümüş Küpe",
    contribution_role: "Contribution From",
    sales_role: "Direct",
    sales_delta: 105000,
    contribution_to_sales_amount: 0,
    product_title: "Gümüş Küpe",
    interactivity: "Same Channel",
    interacted_channel: "This Channel",
  }],
  ["klaviyo-email", {
    platform: "Klaviyo",
    campaign: "KLAVIYO YILBAŞI KAMPANYASI",
    channel: "E-Mail",
    product_id: "8523622678575",
    sku: "Yok",
    advertised_product: "Unknown",
    sold_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    contribution_role: "Contribution From",
    sales_role: "Indirect",
    sales_delta: 116000,
    contribution_to_sales_amount: 0,
    product_title: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    interactivity: "Unknown",
    interacted_channel: "Unknown",
  }],
  ["klaviyo-triggers", {
    platform: "Klaviyo",
    campaign: "Trigger Kampanyası",
    channel: "Triggers",
    product_id: "8523622678575",
    sku: "Yok",
    advertised_product: "Unknown",
    sold_product: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik",
    contribution_role: "Contribution From",
    sales_role: "Indirect",
    sales_delta: 114000,
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
        idempotency_key: "eo06e-full-1128-product-" + id,
        attributes: { ...common, probe_run: productRun, product_name: title, quantity_delta: 1 },
      },
      {
        event_handle: channelEvent,
        idempotency_key: "eo06e-full-1128-channel-" + id,
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
