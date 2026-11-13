import {randomUUID} from "node:crypto";
import {sourceStoreFixture} from "./source-store-fixture.js";
import {datasetStorageFixture} from "./dataset-storage-fixture.js";
import {sourcePayloadHash} from "../../app/lib/database/source-evidence-store.server.js";
import {reportRetentionPolicy} from "../../app/lib/database/report-retention-policy.server.js";
import {buildGoogleReportingQueries, GOOGLE_REPORTING_QUERY_FAMILIES} from "../../app/lib/providers/google-reporting.server.js";
import {parseGoogleRawJson, projectGoogleRawPage} from "../../app/lib/providers/google-raw-projection.server.js";
import {parseMetaRawJson, projectMetaRawPage} from "../../app/lib/providers/meta-raw-projection.server.js";
import {createKlaviyoSourceCapture} from "../../app/lib/providers/klaviyo-source-capture.server.js";
import {buildKlaviyoCampaignValuesRequest, buildKlaviyoFlowValuesRequest, buildKlaviyoPdValuesRequest} from "../../app/lib/providers/klaviyo-reporting.server.js";

function nativeGoogle(family, account, nonempty, purchase, day) {
  if (family === "account_identity") return [{customer: {id: account, currencyCode: "USD", timeZone: "UTC", descriptiveName: "Synthetic"}}];
  if (!nonempty) return [];
  const base = {customer: {id: account}, campaign: {id: "10", name: "Synthetic Shopping", advertisingChannelType: "SHOPPING"},
    adGroup: {id: "20", name: "Synthetic Group"}, segments: {date: day}};
  if (family === "ad_group_channel_daily") return [{...base, metrics: {impressions: "9007199254740993", clicks: "4", costMicros: "1234567"}}];
  if (family === "shopping_ad_group_conversion_action_daily") return [{...base, segments: {...base.segments, conversionAction: "customers/123/conversionActions/1", conversionActionCategory: "PURCHASE"}, metrics: {conversions: purchase, conversionsValue: "12.250000000000000001"}}];
  if (family === "shopping_product_daily") return [{...base, segments: {...base.segments, productMerchantId: "99", productFeedLabel: "US", productItemId: "product-1"}, metrics: {impressions: "7", clicks: "2", costMicros: "1234567"}}];
  if (["shopping_cart_data_product_sales_daily", "cart_data_product_sales_daily"].includes(family)) return [{...base,
    segments: {...base.segments, productMerchantId: "99", productFeedLabel: "US", productItemId: "product-1", productSoldItemId: "product-1"},
    metrics: {unitsSold: "2", revenueMicros: "12500000", leadUnitsSold: "2", leadRevenueMicros: "12500000", crossSellUnitsSold: "0", crossSellRevenueMicros: "0", allUnitsSold: "2", allRevenueMicros: "12500000"}}];
  return [];
}
async function nativeKlaviyoPage(path, body, request = null) {
  const c = createKlaviyoSourceCapture({maxBytes: 100000, check() {}, signal: new AbortController().signal});
  // A native JSON number beyond IEEE precision, constructed without Number.
  await c.read(new Response(JSON.stringify(body).replaceAll('"9007199254740993"', '9007199254740993'), {headers: {"content-type": "application/json"}}), "https://a.klaviyo.com" + path);
  const page = c.finish()[0];
  return {family: page.family, ...page.payload, request: request ? {body: JSON.parse(request.body)} : {method: "GET", path}, selectedFields: request ? JSON.parse(request.body).data.attributes.statistics : ["records"]};
}

/** All native responses/credentials/owners are synthetic. Real capture projection,
 * AEAD and decrypt paths are used; this fake DB is not SQL/native acceptance. */
export async function datasetSourceBindingFixture(provider = "google_ads", {nonempty = true, missingMetric = false, mixedMetrics = false, eventOrderId = null, googlePurchase = "2.5", googleProductCount = 1, businessDate: day = "2026-11-01", owner: givenOwner = null, cipher: givenCipher = null} = {}) {
  const window = {from: day, to: day};
  const owner = givenOwner ? structuredClone(givenOwner) : datasetStorageFixture().owner;
  if (!givenOwner) {owner.installationId = "1"; owner.provider = provider; owner.accountId = provider === "meta" ? "act_123" : provider === "klaviyo" ? "account-1" : "123";}
  if (provider === "klaviyo") owner.selectionEpoch = null;
  const operationId = randomUUID(), jobId = day === "2026-11-01" ? "synthetic-binding-job" : "synthetic-binding-job-" + day, fence = "1", source = {workspaceId: owner.workspaceId, installGeneration: owner.generation,
    provider, accountId: owner.accountId, connectionId: owner.connectionId, connectionVersion: owner.connectionVersion, accountRowId: "1", selectionId: owner.selectionEpoch,
    eligibleFromMs: Date.parse("2026-10-31T00:00:00Z"), timezone: "UTC", currency: "USD"};
  const spec = provider === "google_ads" ? {read: "googleDatasetRead", digest: "googleDatasetInputDigest", schema: "google-raw-datasets-v2", sanitizer: "google-query-fields-v1"}
    : provider === "meta" ? {read: "metaDatasetRead", digest: "metaDatasetInputDigest", schema: "meta-raw-datasets-v1", sanitizer: "meta-query-fields-v1"}
      : {read: "klaviyoDatasetRead", digest: "klaviyoDatasetInputDigest", schema: "klaviyo-raw-datasets-v1", sanitizer: "klaviyo-native-fields-v1"};
  const native = [];
  if (provider === "google_ads") {
    const queries = buildGoogleReportingQueries({dateWindow: {start: day, end: day}});
    for (const [dataset, families] of [["account_performance", GOOGLE_REPORTING_QUERY_FAMILIES.slice(0, 9)], ["product_performance", GOOGLE_REPORTING_QUERY_FAMILIES.slice(9)]]) {
      native.push({dataset, pages: families.flatMap(family => {
        const original = nativeGoogle(family, owner.accountId, nonempty, googlePurchase, day);
        const pages = [original];
        if (family === "shopping_product_daily" && original.length && googleProductCount > 1) {
          pages.length = 0;
          for (let start = 0; start < googleProductCount; start += 25) {
            pages.push(Array.from({length: Math.min(25, googleProductCount - start)}, (_, i) =>
              ({...original[0], segments: {...original[0].segments, productItemId: "product-" + (start + i + 1)}})));
          }
        }
        return pages.map((results, ordinal) => projectGoogleRawPage(parseGoogleRawJson(JSON.stringify({results})),
          {family, query: queries[family], ordinal, accountId: owner.accountId, requestId: "synthetic"}));
      })});
    }
  } else if (provider === "meta") {
    for (const [dataset, family] of [["account_performance", "ad_channel_daily_insights"], ["product_performance", "ad_product_breakdown_daily_insights"]]) {
      const record = {account_id: "123", campaign_id: "10", adset_id: "20", ad_id: "30", campaign_name: "Campaign", adset_name: "Group", ad_name: "Ad", date_start: day, date_stop: day,
        impressions: "9007199254740993", spend: "1.234567890123456789", clicks: "5", outbound_clicks: [{action_type: "outbound_click", value: "4"}],
        actions: [{action_type: "offsite_conversion.fb_pixel_purchase", value: "2.5"}], action_values: [{action_type: "offsite_conversion.fb_pixel_purchase", value: "12.5"}],
        product_id: "product-1", converted_product_quantity: "2", converted_product_value: "12.5"};
      const page = projectMetaRawPage(parseMetaRawJson(JSON.stringify({data: nonempty ? [record] : []})), {family, ordinal: 0, accountId: owner.accountId, window, requestId: "synthetic"}).page;
      native.push({dataset, pages: [{family: "meta_permission_check", records: [], selectedFields: ["scopes"]}, page]});
    }
  } else {
    const metrics = [["order", "Placed Order"], ["cart", "Added to Cart"], ...missingMetric ? [] : [["checkout", "Checkout Started"]], ["product", "Ordered Product"]]
      .map(([id, name]) => ({type: "metric", id, attributes: {name, integration: {name: "Shopify"}}}));
    if (mixedMetrics) metrics.push({type: "metric", id: "other-order", attributes: {name: "Ordered Product", integration: {name: "Other"}}},
      {type: "metric", id: "other-purchase", attributes: {name: "Placed Order", integration: {name: "Other"}}});
    const account = await nativeKlaviyoPage("/api/accounts/", {data: [{type: "account", id: owner.accountId, attributes: {timezone: "UTC", preferred_currency: "USD"}}]});
    const m = await nativeKlaviyoPage("/api/metrics", {data: metrics, links: {next: null}}), proof = [account, m], reports = [], coverage = [];
    for (const [name, id] of [["Placed Order", "order"], ["Added to Cart", "cart"], ["Checkout Started", "checkout"]]) for (const kind of ["campaign", "flow"]) {
      if (missingMetric && id === "checkout") {coverage.push({family: kind + ":" + name, metricId: null, state: "account_configuration_missing", pageCount: 0, recordCount: 0}); continue;}
      const input = {accessToken: "synthetic", businessDate: day, timeZone: "UTC", conversionMetricId: id};
      const request = name === "Placed Order" ? (kind === "campaign" ? buildKlaviyoCampaignValuesRequest : buildKlaviyoFlowValuesRequest)(input)
        : buildKlaviyoPdValuesRequest({...input, kind, conversionMetricName: name});
      const records = nonempty && kind === "campaign" ? [{groupings: {campaign_id: "campaign-1", campaign_name: "Campaign", campaign_message_id: "message-1", campaign_message_name: "Message", send_channel: "email"},
        statistics: {delivered: "9007199254740993", clicks: "4", conversions: "2.5", conversion_value: "12.500000000000000001"}}] : [];
      reports.push(await nativeKlaviyoPage("/api/" + kind + "-values-reports", {data: {type: kind + "-values-report", attributes: {results: records}}, links: {next: null}}, request));
      coverage.push({family: kind + ":" + name, metricId: id, state: "present", pageCount: 1, recordCount: records.length});
    }
    const eventId = day === "2026-11-01" ? "event-1" : "event-" + day;
    const event = {type: "event", id: eventId, attributes: {datetime: day + "T12:00:00Z", event_properties: {ProductID: "product-1", Quantity: "2.5", $value: "12.500000000000000001"}},
      relationships: {metric: {data: {type: "metric", id: "product"}}, attributions: {data: [{type: "attribution", id: "attribution-1"}]}}};
    if (eventOrderId !== null) event.attributes.event_properties.OrderId = eventOrderId;
    const events = await nativeKlaviyoPage("/api/events", {data: nonempty ? [event] : [], included: nonempty ? [{type: "attribution", id: "attribution-1", relationships: {
      campaign: {data: {type: "campaign", id: "campaign-1"}}, "campaign-message": {data: {type: "campaign-message", id: "message-1"}}, event: {data: {type: "event", id: eventId}}}}] : [], links: {next: null}});
    native.push({dataset: "configuration", pages: proof, coverage: [{family: "accounts", state: "present"}, {family: "metrics", state: "present"}]},
      {dataset: "account_performance", pages: [...proof, ...reports], partial: missingMetric, coverage},
      {dataset: "product_performance", pages: [...proof, events], coverage: [{family: "ordered_product_events", metricId: "product", state: "present", pageCount: 1, recordCount: nonempty ? 1 : 0}]});
  }
  const seed = sourceStoreFixture({owner, ...givenCipher ? {cipher: givenCipher} : {}}), cipher = seed.input.cipher, batches = [], envelopes = new Map(); let nextId = 100;
  for (const item of native) {
    const attemptId = randomUUID(), pages = item.pages.map((page, ordinal) => ({key: "p" + ordinal, family: page.family, ordinal, origin: provider,
      captureLayer: "native_response_projection", numericFidelity: "lossless_token", fieldCoverage: page.selectedFields ?? ["records"], schemaVersion: spec.schema, sanitizerVersion: spec.sanitizer, payload: page}));
    const records = Object.fromEntries(["references", "rules", "mappings", "orders", "lines", "journeys", "claims", "links"].map(k => [k, []]));
    const f = sourceStoreFixture({owner, cipher, attemptId, sourceState: item.partial ? "partial" : "complete", pages, records,
      ...(googleProductCount > 1 ? {limits: {maxBytes: 4_000_000, maxRows: 1000}} : {})});
    const write = f.prepare(), batchId = String(++nextId), read = {jobId, fence, window, operationId, dataset: item.dataset, ...(item.coverage ? {coverage: item.coverage} : {})};
    const receipt = {status: "committed", batchId, commitId: randomUUID(), digest: sourcePayloadHash(write.body), sourceState: write.body.sourceState,
      manifest: {counts: {pages: pages.length}, [spec.read]: read, [spec.digest]: sourcePayloadHash(write.body)}};
    const storedPages = write.body.pages.map(p => ({...p, id: String(++nextId), available: true, expired: false, retentionPruned: false}));
    envelopes.set(attemptId, {receipt, pages: storedPages, dataset: item.dataset, sourceWrite: write}); batches.push({attemptId, ordinal: 0});
  }
  const writes = [], queries = [], storageReceipts = new Map(), hooks = {};
  const database = {async query(sql, args) {
    queries.push(sql); const custom = await hooks.query?.(sql, args); if (custom) return custom;
    if (sql.includes("assert_source_owner")) return {rows: [{result: null}]};
    if (sql.includes("evidence.read_dataset_source_context")) return {rows: [{source: structuredClone(source), snapshot_hash: "a".repeat(64)}]};
    if (sql.includes("read_source_receipt")) return {rows: [{result: structuredClone(envelopes.get(args[1])?.receipt)}]};
    if (sql.includes("read_source_pages")) return {rows: [{result: structuredClone(envelopes.get(args[1])?.pages.filter(p => BigInt(p.id) > BigInt(args[3])).slice(0, args[4]) ?? [])}]};
    if (sql.includes("commit_dataset_empty_retention")) {
      const body = JSON.parse(args[1]), receipt = {status: "retained_empty", operationId: body.operationId, digest: sourcePayloadHash(body), sources: body.sources, until: body.policy.until, consumerReceipt: false};
      storageReceipts.set(body.operationId, receipt); return {rows: [{result: structuredClone(receipt)}]};
    }
    if (sql.includes("inspect_dataset_empty_retention")) return {rows: [{result: structuredClone(storageReceipts.get(args[2]) ?? null)}]};
    if (sql.includes("commit_dataset_storage")) {
      const body = JSON.parse(args[1]); writes.push(body);
      const receipt = {status: "stored", operationId: body.operationId, digest: sourcePayloadHash(body), consumerReceipt: false,
        rows: body.rows.map(r => ({table: r.table, id: String(++nextId), nativeKeyHash: r.row.native_key_hash}))};
      storageReceipts.set(body.operationId, receipt); return {rows: [{result: structuredClone(receipt)}]};
    }
    if (sql.includes("inspect_dataset_storage")) return {rows: [{result: structuredClone(storageReceipts.get(args[2]) ?? null)}]};
    throw Error("UNEXPECTED_SYNTHETIC_DATABASE_QUERY");
  }};
  return {database, cipher, owner, batches, envelopes, native, source, hooks, writes, queries, jobId, fence, businessDate: day,
    limits: {maxPages: 100, maxRows: googleProductCount > 1 ? 2000 : 1000, maxBytes: 1000000, deadlineAt: Date.now() + 60000},
    policy: reportRetentionPolicy()};
}
