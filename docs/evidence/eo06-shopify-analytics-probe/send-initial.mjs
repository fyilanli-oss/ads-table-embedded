const testShop = "gid://shopify/Shop/75618484313";
const appClientId = "58c91f39f69ca282a94ba06e9648be9e";
const eventHandle = "adstable-1.ecosystem_sale_probe";
const runId = "eo06e-development-analytics-first-sale";

class RehearsalError extends Error {}

function storeDate(date, timeZone) {
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(dateFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function rehearsalDate(now, timeZone) {
  const elapsedDate = new Date(`${storeDate(now, timeZone)}T12:00:00.000Z`);
  elapsedDate.setUTCDate(elapsedDate.getUTCDate() - 7);
  const day = elapsedDate.toISOString().slice(0, 10);
  for (const hour of [12, 6, 18]) {
    elapsedDate.setUTCHours(hour);
    if (storeDate(elapsedDate, timeZone) === day) return elapsedDate.toISOString();
  }
  throw new RehearsalError("No timestamp for the original shop day");
}

async function post(url, payload, token) {
  const headers = { "Content-Type": "application/json", "User-Agent": "AdsTable-Analytics-Rehearsal/1.0" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, {
    method: "POST",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify(payload),
  });
}

async function sendInitial(env, now) {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production") throw new RehearsalError("Vercel production build required");
  if (env.SHOPIFY_API_KEY !== appClientId || !env.SHOPIFY_API_SECRET) throw new RehearsalError("AdsTable credentials unavailable");
  if (env.ADSTABLE_ANALYTICS_TEST_SHOP_GID !== testShop) throw new RehearsalError("Test shop identity mismatch");
  const timeZone = env.ADSTABLE_ANALYTICS_TEST_SHOP_TIME_ZONE;
  if (!timeZone) throw new RehearsalError("Verified test shop time zone required");
  const expires = Date.parse(env.ADSTABLE_ANALYTICS_PROBE_EXPIRES_AT ?? "");
  if (!Number.isFinite(expires) || expires <= now.getTime() || expires - now.getTime() > 3_600_000) {
    throw new RehearsalError("One-hour rehearsal window required");
  }

  const timestamp = rehearsalDate(now, timeZone);
  const auth = await post("https://api.shopify.com/auth/access_token", {
    client_id: appClientId,
    client_secret: env.SHOPIFY_API_SECRET,
    grant_type: "client_credentials",
  });
  if (!auth.ok) throw new RehearsalError(`Shopify token request returned HTTP ${auth.status}`);
  const credential = await auth.json();
  if (credential.token_type !== "Bearer" || typeof credential.access_token !== "string" || !credential.access_token) {
    throw new RehearsalError("Shopify did not return an App Events bearer token");
  }

  const response = await post("https://api.shopify.com/app/2026-10/events", {
    shop_id: testShop,
    event_handle: eventHandle,
    timestamp,
    idempotency_key: `${runId}-initial`,
    attributes: {
      probe_run: runId,
      advertised_product: "A",
      sold_product: "B",
      campaign: "campaign-test-1",
      quantity_delta: 1,
      sales_delta: 10000,
    },
  }, credential.access_token);
  if (response.status !== 202 || response.headers.get("Idempotent-Replay") === "true") {
    throw new RehearsalError(`Shopify event submission returned HTTP ${response.status} or an existing event receipt`);
  }
  console.log(JSON.stringify({ runId, eventHandle, timestamp, status: 202, quantity: 1, salesMinorUnits: 10000 }));
}

try {
  await sendInitial(process.env, new Date());
} catch (error) {
  const detail = error instanceof RehearsalError ? error.message : "Provider or local validation result could not be confirmed";
  console.error(`Initial Shopify Analytics rehearsal stopped. ${detail}`);
  process.exitCode = 1;
}
