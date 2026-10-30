import {createHash} from "node:crypto";
import {stableJson} from "./common-adapter.server.js";

export const GOOGLE_PD_METADATA_QUERIES = Object.freeze({
  account: "SELECT customer.id, customer.currency_code, customer.time_zone FROM customer",
  actions: "SELECT conversion_action.resource_name, conversion_action.category, conversion_action.owner_customer, conversion_action.attribution_model_settings.attribution_model, conversion_action.click_through_lookback_window_days, conversion_action.view_through_lookback_window_days, conversion_action.counting_type FROM conversion_action WHERE conversion_action.category IN ('ADD_TO_CART', 'BEGIN_CHECKOUT', 'PURCHASE')",
});
const hash = v => createHash("sha256").update(stableJson(v)).digest("hex");
const fail = () => {throw new Error("GOOGLE_PD_NATIVE_METADATA_READ_INVALID");};

/** Uses the already prepared, quota-bound client and exact reporting account.
 * Never follows a conversion owner into another customer or refreshes separately.
 */
export async function readGooglePdNativeMetadata({client, accountId, currency, timezone, limits} = {}) {
  if (typeof client?.search !== "function" || !/^[0-9]+$/.test(accountId ?? "") || !/^[A-Z]{3}$/.test(currency ?? "")
    || typeof timezone !== "string" || !timezone || !["maxPages", "maxRows", "maxBytes"].every(k => Number.isSafeInteger(limits?.[k]) && limits[k] > 0)
    || limits.maxPages > 20 || limits.maxRows > 20_000) fail();
  const result = {};
  let count = 0, bytes = 0;
  for (const [family, query] of Object.entries(GOOGLE_PD_METADATA_QUERIES)) {
    const rows = [], request_ids = [], seen = new Set();
    let cursor = null, complete = false;
    for (let i = 0; i < limits.maxPages; i++) {
      const page = await client.search({customerId: accountId, query, pageToken: cursor});
      if (!Array.isArray(page.results)) fail();
      count += page.results.length; bytes += Buffer.byteLength(JSON.stringify(page), "utf8");
      if (count > limits.maxRows || bytes > limits.maxBytes) fail();
      rows.push(...page.results.map(row => family === "account" ? {customer: {id: row.customer?.id,
        currencyCode: row.customer?.currencyCode, timeZone: row.customer?.timeZone}}
        : {conversionAction: {resourceName: row.conversionAction?.resourceName, ownerCustomer: row.conversionAction?.ownerCustomer,
          category: row.conversionAction?.category, attributionModelSettings: {attributionModel: row.conversionAction?.attributionModelSettings?.attributionModel},
          clickThroughLookbackWindowDays: row.conversionAction?.clickThroughLookbackWindowDays,
          viewThroughLookbackWindowDays: row.conversionAction?.viewThroughLookbackWindowDays, countingType: row.conversionAction?.countingType}}));
      if (page.request_id) request_ids.push(page.request_id);
      const next = page.next_page_token;
      if (next === null || next === "") {complete = true; break;}
      if (typeof next !== "string" || next.length > 4096 || seen.has(next)) fail();
      seen.add(next); cursor = next;
    }
    if (!complete) fail();
    if (family === "account" && (rows.length !== 1 || rows[0].customer?.id !== accountId
      || rows[0].customer.currencyCode !== currency || rows[0].customer.timeZone !== timezone)) fail();
    result[family] = {rows, request_ids, query_fingerprint: hash(query)};
  }
  return {...result, observed_rows: count, observed_response_bytes: bytes};
}
