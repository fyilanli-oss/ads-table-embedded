import {createShopifyInstallationOwnerRepository} from "../database/shopify-installation-owner-repository.server.js";
import {resolveReadOnlyShopifyRouteAuthority} from "../shopify/shopify-route-authority.server.js";
import {resolveComparisonCalendar} from "./compare-calendar.server.js";

const COMPARE_SQL = `select period, day_offset, to_char(business_date, 'YYYY-MM-DD') as business_date,
  source_timezone, platform, platform_account_id, root_entity_type, campaign_id, campaign_name,
  channel_type, channel_id, channel_resolution, advertised_product_id, sold_product_id, sales_role,
  sales_quantity, sales_value, currency, source_completeness,
  quantity_support, quantity_observation, value_support, value_observation
  from analytics.read_report_sales_compare($1::uuid,$2::bigint,$3::bigint,$4::text,$5::date,$6::date,
    $7::date,$8::date,$9::text,$10::text,$11::text,$12::text,$13::text)`;

const INPUT_KEYS = new Set([
  "view", "startDate", "endDate", "mode", "compareStartDate", "compareEndDate",
  "platform", "account", "campaign", "channel", "product",
]);
const PLATFORMS = new Set(["google_ads", "meta", "klaviyo"]);

function requestFilters(params) {
  const platform = params.get("platform");
  const account = params.get("account");
  const campaign = params.get("campaign");
  const channel = params.get("channel");
  const product = params.get("product");
  if ((platform !== null && !PLATFORMS.has(platform)) || (account !== null && platform === null)
      || ((campaign !== null || channel !== null) && account === null)
      || [account, campaign, channel].some(value => value !== null && (value.trim() === "" || value.length > 1024))
      || (product !== null && (product.length > 128 || !/^gid:\/\/shopify\/Product\/[1-9][0-9]*$/.test(product)))) {
    throw new RangeError("COMPARE_FILTER_INVALID");
  }
  return [platform, account, campaign, channel, product];
}

function readQuery(params) {
  const seen = new Set();
  for (const key of params.keys()) {
    if (!INPUT_KEYS.has(key) || seen.has(key)) throw new RangeError("COMPARE_REQUEST_INVALID");
    seen.add(key);
  }
  const view = params.get("view");
  const mode = params.get("mode") ?? "none";
  const startDate = params.get("compareStartDate");
  const endDate = params.get("compareEndDate");
  if (mode !== "custom" && (startDate !== null || endDate !== null)) {
    throw new RangeError("COMPARE_REQUEST_INVALID");
  }
  const calendar = resolveComparisonCalendar({
    view, startDate: params.get("startDate"), endDate: params.get("endDate"),
    comparison: {mode, startDate, endDate},
  });
  return {view, calendar, filters: requestFilters(params)};
}

function toResponse({calendar, view}, result) {
  if (!Array.isArray(result?.rows)) throw new Error("COMPARE_RESULT_INVALID");
  const primary = {...calendar.primary, rows: []};
  const comparison = calendar.comparison && {...calendar.comparison, rows: []};
  for (const row of result.rows) {
    const period = row.period === "primary" ? primary : row.period === "comparison" ? comparison : null;
    if (!period || typeof row.business_date !== "string"
        || row.business_date < period.startDate || row.business_date > period.endDate
        || !Number.isInteger(row.day_offset) || row.day_offset < 0 || row.day_offset >= calendar.dayCount) {
      throw new Error("COMPARE_RESULT_INVALID");
    }
    period.rows.push({
      date: row.business_date, dayOffset: row.day_offset, sourceTimezone: row.source_timezone,
      platform: row.platform, accountId: row.platform_account_id, campaignType: row.root_entity_type,
      campaignId: row.campaign_id, campaignName: row.campaign_name, channelType: row.channel_type,
      channelId: row.channel_id, channelResolution: row.channel_resolution,
      advertisedProductId: row.advertised_product_id, soldProductId: row.sold_product_id, salesRole: row.sales_role,
      salesQuantity: row.sales_quantity, salesValue: row.sales_value, currency: row.currency,
      sourceCompleteness: row.source_completeness, quantitySupport: row.quantity_support,
      quantityObservation: row.quantity_observation, valueSupport: row.value_support, valueObservation: row.value_observation,
    });
  }
  return {version: "compare-v1", view, mode: calendar.mode, dayCount: calendar.dayCount, primary, comparison};
}

function json(body, status = 200, headers = {}) {
  return Response.json(body, {status, headers: {...headers, "cache-control": "no-store"}});
}

export async function handleCompareRequest(request, {authenticateAdmin, database}) {
  if (request.method !== "GET") return json({code: "COMPARE_METHOD_NOT_ALLOWED"}, 405, {allow: "GET"});
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== url.origin) return json({code: "COMPARE_ORIGIN_INVALID"}, 403);
  if (!/^Bearer \S+$/i.test(request.headers.get("authorization") ?? "")) {
    return json({code: "COMPARE_SESSION_REQUIRED"}, 401);
  }

  let input;
  try {
    input = readQuery(url.searchParams);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return json({code: error.message}, 400);
  }

  try {
    const {identity, installationAuthority} = await resolveReadOnlyShopifyRouteAuthority({request, authenticateAdmin, database});
    const owner = await createShopifyInstallationOwnerRepository(database).load({
      workspaceId: installationAuthority.workspaceId,
      installGeneration: installationAuthority.installGeneration,
      shopId: identity.shop.shopId, shopDomain: identity.shop.myshopifyDomain,
    });
    if (!owner) return json({code: "COMPARE_SCOPE_UNAVAILABLE"}, 403);
    const {view, calendar: {primary, comparison}, filters} = input;
    const result = await database.query(COMPARE_SQL, [owner.workspaceId, owner.installationId, owner.installGeneration,
      view, primary.startDate, primary.endDate, comparison?.startDate ?? null, comparison?.endDate ?? null, ...filters]);
    return json(toResponse(input, result));
  } catch (error) {
    // Keep Shopify's resource-route session recovery response and its headers intact.
    if (error instanceof Response) {
      const headers = new Headers(error.headers);
      headers.set("cache-control", "no-store");
      return new Response(error.body, {status: error.status, statusText: error.statusText, headers});
    }
    if (["INSTALLATION_RESOLVE_ACTIVE_RESULT_INVALID", "ACTIVE_INSTALLATION_REQUIRED", "SHOP_ID_TOKEN_ADMIN_IDENTITY_MISMATCH"].includes(error?.message)
        || (error?.code === "42501" && error.message === "REPORT_COMPARE_SCOPE_UNAVAILABLE")) {
      return json({code: "COMPARE_SCOPE_UNAVAILABLE"}, 403);
    }
    return json({code: "COMPARE_UNAVAILABLE"}, 503);
  }
}
