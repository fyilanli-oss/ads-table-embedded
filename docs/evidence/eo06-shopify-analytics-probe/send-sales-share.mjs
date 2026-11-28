const testShop = "gid://shopify/Shop/75618484313";
const appClientId = "58c91f39f69ca282a94ba06e9648be9e";
// Each amount is in TRY minor units. The first day mirrors the accepted V52 detail fixture.
// The second day adds 80 TRY to Google Keywords and 280 TRY to Google Holiday Bracelets.
// Product columns: ID, title, platform, total, Direct, Cross Sell, Indirect.
// Channel columns: platform, campaign, channel, total, Same Channel, Other Channels in Campaign,
// Other Channels in Other Campaigns, Non Advertised Products, Unknown.
const days = [
  [
    "2026-11-27",
    [
    ["8523622678575","925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik","Meta",40000,10000,0,30000],
    ["9900000000001","925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Kolye","Meta",28000,20000,8000,0],
    ["9900000000008","Gümüş Yüzük","Meta",40000,40000,0,0],
    ["9900000000007","Gümüş Küpe","Meta",50000,50000,0,0],
    ["9900000000009","Gümüş Halka Küpe","Meta",4000,0,4000,0],
    ["9900000000010","Gümüş Halhal","Meta",6000,0,6000,0],
    ["8523766988847","925 Gümüş 14K Altın Kaplama Zirkon Taşlı İp Bileklik","Google",60000,60000,0,0],
    ["8523622678575","925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik","Google",92000,0,12000,80000],
    ["9900000000003","925 Gümüş 14K Altın Kaplama Zirkon Taşlı Göz Örgü Kolye","Google",70000,70000,0,0],
    ["9900000000008","Gümüş Yüzük","Google",90000,90000,0,0],
    ["9900000000007","Gümüş Küpe","Google",100000,100000,0,0],
    ["8523622678575","925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik","Klaviyo",230000,0,0,230000],
    ],
    [
    ["Meta","YILBAŞI KAMPANYASI","BİLEKLİKLER",18000,10000,8000,0,0,0],
    ["Meta","YILBAŞI KAMPANYASI","KOLYELER",20000,20000,0,0,0,0],
    ["Meta","Catalog Kampanyası","Catalog",30000,0,0,0,0,30000],
    ["Meta","Fırsat Kampanyası","YÜZÜKLER",40000,40000,0,0,0,0],
    ["Meta","Fırsat Kampanyası","KÜPELER",60000,54000,0,0,6000,0],
    ["Google","GOOGLE YILBAŞI KAMPANYASI","BİLEKLİKLER",72000,60000,0,12000,0,0],
    ["Google","GOOGLE YILBAŞI KAMPANYASI","KOLYELER",70000,70000,0,0,0,0],
    ["Google","Keyword Kampanyası","Keywords",80000,0,0,0,0,80000],
    ["Google","Fırsat Kampanyası","YÜZÜKLER",90000,90000,0,0,0,0],
    ["Google","Fırsat Kampanyası","KÜPELER",100000,100000,0,0,0,0],
    ["Klaviyo","KLAVIYO YILBAŞI KAMPANYASI","E-Mail",110000,0,0,0,0,110000],
    ["Klaviyo","Trigger Kampanyası","Triggers",120000,0,0,0,0,120000],
    ],
  ],
  [
    "2026-11-28",
    [
    ["8523622678575","925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik","Google",8000,0,0,8000],
    ["8523766988847","925 Gümüş 14K Altın Kaplama Zirkon Taşlı İp Bileklik","Google",28000,28000,0,0],
    ],
    [
    ["Google","Keyword Kampanyası","Keywords",8000,0,0,0,0,8000],
    ["Google","GOOGLE YILBAŞI KAMPANYASI","BİLEKLİKLER",28000,28000,0,0,0,0],
    ],
  ],
];


const layouts = [
  ["product","adstable-1.ecosystem_product_sales_share_probe",["product_id","product_title","platform","sales_delta","direct_sales_amount","cross_sell_sales_amount","indirect_sales_amount"]],
  ["channel","adstable-1.ecosystem_channel_sales_share_probe",["platform","campaign","channel","sales_delta","same_channel_sales_amount","same_campaign_other_channel_sales_amount","other_campaign_sales_amount","non_advertised_sales_amount","unknown_relationship_sales_amount"]],
];

function events() {
  const result = [];
  for (const [date, products, channels] of days) {
    for (const [index, rows] of [products, channels].entries()) {
      const [kind, eventHandle, fields] = layouts[index];
      for (const [rowIndex, row] of rows.entries()) {
        if (row.length !== fields.length || row.slice(4).reduce((sum, amount) => sum + amount, 0) !== row[3]) {
          throw new RehearsalError("Synthetic summary total does not match its components");
        }
        result.push({
          timestamp: date + "T12:00:00.000Z",
          event_handle: eventHandle,
          idempotency_key: "eo06e-share-" + date + "-" + kind + "-" + (rowIndex + 1),
          attributes: Object.fromEntries(fields.map((field, column) => [field, row[column]])),
        });
      }
    }
  }
  if (result.length !== 28) throw new RehearsalError("Expected exactly 28 synthetic summary events");
  return result;
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

  const approvedEvents = events();
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

  for (const event of approvedEvents) {
    const response = await post("app/2026-10/events", {
      shop_id: testShop,
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
      date: event.timestamp.slice(0, 10),
      status: 202,
      success: true,
    }));
  }
}

try {
  await sendContribution(process.env, new Date());
} catch (error) {
  const detail = error instanceof RehearsalError ? error.message : "Provider or local validation result could not be confirmed";
  console.error("Shopify Analytics sales share rehearsal stopped. " + detail);
  process.exitCode = 1;
}
