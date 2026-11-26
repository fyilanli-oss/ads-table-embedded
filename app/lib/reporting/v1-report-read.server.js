const GRAINS = new Set(["product", "channel", "campaign", "platform"]);
const BUCKETS = new Set(["selected_range", "daily", "weekly", "monthly", "quarterly"]);
const ROLES = new Set(["Advertised", "Cross-sell", "Assisted", "Triggered", "Unclassified"]);
const PLATFORMS = new Set(["google_ads", "meta", "klaviyo"]);
const PRODUCT_ID = /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/;
const DAY_MS = 86_400_000;

export function readV1ReportOptions(params) {
  const grain = params.get("grain"), bucket = params.get("bucket");
  const platforms = [...new Set(params.getAll("platform"))];
  const products = [...new Set(params.getAll("product"))];
  const account = params.get("account"), campaign = params.get("campaign"), channel = params.get("channel");
  const role = params.get("role");
  if (!GRAINS.has(grain) || !BUCKETS.has(bucket) || (role !== null && !ROLES.has(role))
      || platforms.some(value => !PLATFORMS.has(value)) || products.some(value => value.length > 128 || !PRODUCT_ID.test(value))
      || (account !== null && platforms.length !== 1) || (campaign !== null && account === null)
      || (channel !== null && campaign === null)
      || [account, campaign, channel].some(value => value !== null && (!value.trim() || value.length > 1024))) {
    throw new RangeError("COMPARE_FILTER_INVALID");
  }
  return {grain, bucket, role, filters: [platforms, account, campaign, channel, products]};
}

function decimal(text) {
  if (typeof text !== "string" || !/^-?\d+(?:\.\d+)?$/.test(text)) throw new Error("COMPARE_RESULT_INVALID");
  const [integer, fraction = ""] = text.split(".");
  return {coefficient: BigInt(integer + fraction), scale: fraction.length};
}

function add(left, right) {
  if (!left) return right;
  const scale = Math.max(left.scale, right.scale);
  return {scale, coefficient: left.coefficient * 10n ** BigInt(scale - left.scale)
    + right.coefficient * 10n ** BigInt(scale - right.scale)};
}

function render(value) {
  if (!value) return null;
  const {coefficient, scale} = value;
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const sign = coefficient < 0n ? "-" : "";
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, "") : "";
  return sign + (scale ? digits.slice(0, -scale) : digits) + (fraction ? `.${fraction}` : "");
}

function metric() {
  return {amount: null, gaps: new Set(), partial: false};
}

function record(target, amount, support, observation, partial) {
  if (support === "supported" && observation === "present" && amount !== null) {
    target.amount = add(target.amount, decimal(amount));
    target.partial ||= partial;
  } else {
    target.gaps.add(support === "unsupported" || observation === "unsupported" ? "unsupported"
      : observation === "missing" && support === "supported" ? "missing" : "unknown");
  }
}

function readMetric({amount, gaps, partial}) {
  let state = "unknown";
  if (amount !== null) state = gaps.size || partial ? "partial" : "present";
  else if (gaps.size === 1) [state] = gaps;
  return {value: render(amount), state};
}

function makeTotals() {
  return {purchase: metric(), sales: new Map(), reporting: metric(), reportingCurrency: null,
    missingCurrency: false, missingConversion: false};
}

function sum(totals, row) {
  const partial = row.sourceCompleteness === "partial";
  record(totals.purchase, row.salesQuantity, row.quantitySupport, row.quantityObservation, partial);
  if (row.currency === null) totals.missingCurrency = true;
  const native = totals.sales.get(row.currency) ?? metric();
  totals.sales.set(row.currency, native);
  record(native, row.salesValue, row.valueSupport, row.valueObservation, partial);
  if (row.reportingCurrency) {
    totals.reportingCurrency = row.reportingCurrency;
    totals.missingConversion ||= row.valueSupport === "supported" && row.valueObservation === "present"
      && row.salesValue !== null && row.reportingValue === null;
    record(totals.reporting, row.reportingValue, row.valueSupport, row.valueObservation, partial);
  }
}

function readTotals(totals) {
  const salesByCurrency = [...totals.sales].filter(([currency]) => currency !== null)
    .map(([currency, val]) => ({currency, ...readMetric(val)}));
  const fallback = !totals.missingCurrency && salesByCurrency.length === 1 ? salesByCurrency[0] : null;
  const unknownSale = {currency: null, value: null, state: "unknown"};
  let sales = fallback ?? unknownSale;
  if (totals.reportingCurrency) {
    const converted = readMetric(totals.reporting);
    // Keep native subtotals available even when a combined FX total is unavailable.
    sales = {currency: totals.reportingCurrency, ...converted};
    if (totals.missingConversion) sales = {...sales, value: null, state: "unknown"};
  }
  return {sales, salesByCurrency, purchase: readMetric(totals.purchase)};
}

function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS);
}

function dateBuckets(calendar, bucket) {
  const spans = new Map();
  const byOffset = [];
  for (let offset = 0; offset < calendar.dayCount; offset++) {
    const date = addDays(calendar.primary.startDate, offset);
    const day = date.toISOString().slice(0, 10);
    let key = calendar.primary.startDate;
    if (bucket === "daily") key = day;
    if (bucket === "weekly") key = new Date(date.getTime() - (date.getUTCDay() + 6) % 7 * DAY_MS).toISOString().split("T")[0];
    if (bucket === "monthly") key = day.slice(0, 7);
    if (bucket === "quarterly") key = `${day.slice(0, 4)}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    const span = spans.get(key) ?? {key, first: offset, last: offset};
    span.last = offset;
    spans.set(key, span);
    byOffset.push(key);
  }
  return {byOffset, spans: [...spans.values()]};
}

function groupIdentity(grain, row) {
  if (grain === "product" && row.soldProductId) return [row.soldProductId];
  if (grain === "product" || grain === "platform") return [row.platform, grain === "product" ? row.accountId : null];
  const campaign = [row.platform, row.accountId, row.campaignType, row.campaignId];
  return grain === "campaign" ? campaign : [...campaign, row.channelType, row.channelId];
}

function reportingScope(row) {
  const basis = [row.sourceTimezone, row.timeBasis, row.conversionScope, row.units];
  return basis.every(Boolean) ? basis : [...basis, row.platform, row.accountId];
}

function addTo(map, identity, row, bucketKey, labels = []) {
  const key = JSON.stringify(identity);
  if (!map.has(key)) map.set(key, {identity, total: makeTotals(), buckets: new Map(), labels: labels.map(() => new Set())});
  const entry = map.get(key);
  labels.forEach((name, index) => {if (name) entry.labels[index].add(name);});
  sum(entry.total, row);
  if (!entry.buckets.has(bucketKey)) entry.buckets.set(bucketKey, makeTotals());
  sum(entry.buckets.get(bucketKey), row);
}

function share(part, total) {
  if (part.state !== "present" || total.state !== "present" || part.currency !== total.currency) return null;
  const a = decimal(part.value), b = decimal(total.value);
  if (a.coefficient < 0n || b.coefficient <= 0n) return null;
  const scale = 8;
  const ratio = (a.coefficient * 10n ** BigInt(b.scale + scale)) / (b.coefficient * 10n ** BigInt(a.scale));
  if (ratio > 10n ** BigInt(scale)) return null;
  return render({coefficient: ratio, scale});
}

function relationship(row) {
  if (!row.advertisedProductId || !row.soldProductId || row.channelResolution !== "verified" || row.destinationCount !== 1) return null;
  const sameCampaign = row.campaignType === row.destinationCampaignType && row.campaignId === row.destinationCampaignId;
  const sameChannel = sameCampaign && row.channelType === row.destinationChannelType && row.channelId === row.destinationChannelId;
  const category = sameChannel ? "Same Channel" : sameCampaign ? "Other Channels in Campaign" : "Other Channels in Other Campaigns";
  return {category, source: [row.campaignType, row.campaignId, row.channelType, row.channelId],
    destination: [row.destinationCampaignType, row.destinationCampaignId, row.destinationChannelType, row.destinationChannelId]};
}

function hasObservedSale(row) {
  return (row.quantitySupport === "supported" && row.quantityObservation === "present" && row.salesQuantity !== null
      && decimal(row.salesQuantity).coefficient > 0n)
    || (row.valueSupport === "supported" && row.valueObservation === "present" && row.salesValue !== null
      && decimal(row.salesValue).coefficient > 0n);
}

export function summarizeV1Reports(calendar, options, rowsByPeriod) {
  const {spans, byOffset} = dateBuckets(calendar, options.bucket);
  function summarize(period) {
    const range = calendar[period];
    if (!range) return null;
    const scopes = new Map(), groups = new Map(), productLinks = new Map(), channelLinks = new Map();
    for (const row of rowsByPeriod[period]) {
      if (options.role && row.salesRole !== options.role) continue;
      const scope = reportingScope(row), bucket = byOffset[row.dayOffset];
      addTo(scopes, scope, row, bucket);
      const labels = [row.campaignName, row.channelName, row.campaignFormat];
      addTo(groups, [scope, groupIdentity(options.grain, row)], row, bucket,
        options.grain === "campaign" || options.grain === "channel" ? labels : []);
      if (!row.advertisedProductId || !row.soldProductId || !hasObservedSale(row)) continue;
      addTo(productLinks, [scope, row.advertisedProductId, row.soldProductId], row, bucket);
      const link = relationship(row);
      if (link) addTo(channelLinks, [scope, row.platform, row.accountId, link.category, link.source, link.destination,
        row.advertisedProductId, row.soldProductId], row, bucket);
    }
    function readEntry(entry) {
      return {...readTotals(entry.total), buckets: [...entry.buckets].map(([key, total]) => ({key, ...readTotals(total)}))};
    }
    return {...range, buckets: spans.map(({key, first, last}) => ({key,
      startDate: addDays(range.startDate, first).toISOString().slice(0, 10),
      endDate: addDays(range.startDate, last).toISOString().slice(0, 10)})),
    scopes: [...scopes.values()].map(entry => ({scope: entry.identity, ...readEntry(entry)})),
    groups: [...groups.values()].map(entry => {
      const [scope, identity] = entry.identity;
      const result = readEntry(entry), total = readTotals(scopes.get(JSON.stringify(scope)).total);
      const [campaignName = null, channelName = null, campaignFormat = null] = entry.labels.map(names => names.size === 1 ? [...names][0] : null);
      return {scope, identity, productName: null, sku: null, campaignName, channelName, campaignFormat,
        salesShare: share(result.sales, total.sales), purchaseShare: share(result.purchase, total.purchase), ...result};
    }),
    productLinks: [...productLinks.values()].map(entry => {
      const [scope, from, to] = entry.identity;
      const mutual = from !== to && productLinks.has(JSON.stringify([scope, to, from]));
      return {scope, from, to, mutual, ...readEntry(entry)};
    }),
    channelLinks: [...channelLinks.values()].map(entry => {
      const [scope, platform, accountId, category, from, to, advertisedProductId, soldProductId] = entry.identity;
      return {scope, platform, accountId, category, from, to, advertisedProductId, soldProductId, ...readEntry(entry)};
    })};
  }
  return {version: "report-v1", grain: options.grain, bucket: options.bucket, mode: calendar.mode,
    dayCount: calendar.dayCount, primary: summarize("primary"), comparison: summarize("comparison")};
}
