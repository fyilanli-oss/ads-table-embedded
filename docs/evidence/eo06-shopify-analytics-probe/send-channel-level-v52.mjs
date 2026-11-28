const testShop = "gid://shopify/Shop/75618484313";
const appClientId = "58c91f39f69ca282a94ba06e9648be9e";
const timestamp = "2026-11-27T12:00:00.000Z";
const productRun = "eo06e-development-product-level-v2";
const productEvent = "adstable-1.ecosystem_role_probe";
const channelEvent = "adstable-1.ecosystem_channel_level_full_probe";

const products = {
  bracelet: { id: "8523622678575", title: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Bileklik" },
  necklace: { id: "9900000000001", title: "925 Gümüş 14K Altın Kaplama Yuvarlak Zirkon Taşlı Örgü İp Kolye" },
  zircon: { id: "8523766988847", title: "925 Gümüş 14K Altın Kaplama Zirkon Taşlı İp Bileklik" },
  eye: { id: "9900000000003", title: "925 Gümüş 14K Altın Kaplama Zirkon Taşlı Göz Örgü Kolye" },
  ring: { id: "9900000000008", title: "Gümüş Yüzük" },
  earrings: { id: "9900000000007", title: "Gümüş Küpe" },
  hoops: { id: "9900000000009", title: "Gümüş Halka Küpe" },
  anklet: { id: "9900000000010", title: "Gümüş Halhal" },
};

const metaHoliday = "YILBAŞI KAMPANYASI";
const googleHoliday = "GOOGLE YILBAŞI KAMPANYASI";
const opportunity = "Fırsat Kampanyası";
const bracelets = "BİLEKLİKLER";
const necklaces = "KOLYELER";
const rings = "YÜZÜKLER";
const earrings = "KÜPELER";
const same = ["Same Channel", "This Channel"];
const otherInCampaign = ["Other Channels in Campaign", necklaces];
const otherCampaign = ["Other Channels in Other Campaigns", opportunity + " · " + bracelets];
const nonAdvertised = ["Non Advertised Products", "No Channel"];
const unknown = ["Unknown", "Unknown"];

const rows = [
  // ID, platform, campaign, channel, relationship, advertised, sold, direction, TRY, new Product Level row
  ["meta-bracelet", "Meta", metaHoliday, bracelets, same, "bracelet", "bracelet", "from", 100],
  ["meta-necklace-cross-from", "Meta", metaHoliday, bracelets, otherInCampaign, "bracelet", "necklace", "from", 80],
  ["meta-necklace-cross-to", "Meta", metaHoliday, bracelets, otherInCampaign, "bracelet", "necklace", "to", 80],
  ["meta-necklace", "Meta", metaHoliday, necklaces, same, "necklace", "necklace", "from", 200],
  ["meta-catalog", "Meta", "Catalog Kampanyası", "Catalog", unknown, null, "bracelet", "from", 300],
  ["meta-ring", "Meta", opportunity, rings, same, "ring", "ring", "from", 400],
  ["meta-earrings", "Meta", opportunity, earrings, same, "earrings", "earrings", "from", 500],
  ["meta-hoops-cross-from", "Meta", opportunity, earrings, same, "earrings", "hoops", "from", 40, true],
  ["meta-hoops-cross-to", "Meta", opportunity, earrings, same, "earrings", "hoops", "to", 40, true],
  ["meta-anklet-cross-from", "Meta", opportunity, earrings, nonAdvertised, "earrings", "anklet", "from", 60, true],
  ["meta-anklet-cross-to", "Meta", opportunity, earrings, nonAdvertised, "earrings", "anklet", "to", 60, true],
  ["google-bracelet", "Google", googleHoliday, bracelets, same, "zircon", "zircon", "from", 600],
  ["google-bracelet-cross-from", "Google", googleHoliday, bracelets, otherCampaign, "zircon", "bracelet", "from", 120, true],
  ["google-bracelet-cross-to", "Google", googleHoliday, bracelets, otherCampaign, "zircon", "bracelet", "to", 120],
  ["google-necklace", "Google", googleHoliday, necklaces, same, "eye", "eye", "from", 700],
  ["google-keywords", "Google", "Keyword Kampanyası", "Keywords", unknown, null, "bracelet", "from", 800],
  ["google-ring", "Google", opportunity, rings, same, "ring", "ring", "from", 900],
  ["google-earrings", "Google", opportunity, earrings, same, "earrings", "earrings", "from", 1000],
  ["klaviyo-email", "Klaviyo", "KLAVIYO YILBAŞI KAMPANYASI", "E-Mail", unknown, null, "bracelet", "from", 1100],
  ["klaviyo-triggers", "Klaviyo", "Trigger Kampanyası", "Triggers", unknown, null, "bracelet", "from", 1200],
];

function events() {
  const productAdditions = [];
  const channels = [];
  for (const [id, platform, campaign, channel, relationship, advertised, sold, direction, amount, addProduct] of rows) {
    const incoming = direction === "from";
    const product = products[incoming ? sold : advertised];
    const shared = {
      platform, campaign, channel,
      product_id: product.id,
      sku: "Yok",
      advertised_product: advertised ? products[advertised].title : "Unknown",
      sold_product: products[sold].title,
      contribution_role: incoming ? "Contribution From" : "Contribution To",
      sales_role: !advertised ? "Indirect" : advertised === sold ? "Direct" : "Cross Sell",
      sales_delta: incoming ? amount * 100 : 0,
      contribution_to_sales_amount: incoming ? 0 : amount * 100,
    };
    if (addProduct) {
      productAdditions.push({
        event_handle: productEvent,
        idempotency_key: "eo06e-v52-product-" + id,
        attributes: { ...shared, probe_run: productRun, product_name: product.title, quantity_delta: 1 },
      });
    }
    const [interactivity, interacted_channel] = relationship;
    channels.push({
      event_handle: channelEvent,
      idempotency_key: "eo06e-v52-channel-" + id,
      attributes: { ...shared, product_title: product.title, interactivity, interacted_channel },
    });
  }

  return [...productAdditions, ...channels];
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
  console.error("Shopify Analytics V52 rehearsal stopped. " + detail);
  process.exitCode = 1;
}
