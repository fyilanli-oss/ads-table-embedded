import {GOOGLE_DAILY_PRODUCT_LINKS_SQL, GOOGLE_DAILY_PRODUCT_MAPPING_SQL} from "./dataset-rpc.server.js";
import {canonicalSourceJson} from "./source-evidence-store.server.js";
import {validateCurrentMappingEvidence} from "./verified-mapping-store.server.js";

const fields = {
  cpd_product_performance_facts: [["performance", "native_product_id", "product_mapping_id"]],
  cpd_product_sales_facts: [
    ["sold", "native_sold_product_id", "sold_product_mapping_id"],
    ["advertised", "native_advertised_product_id", "advertised_product_mapping_id"],
  ],
};
const fail = () => { throw Error("GOOGLE_DAILY_PRODUCT_MAPPING_INVALID"); };

export async function bindGoogleDailyProductMappings({database, ownerJson, contextJson, deadline, owner, rows, cipher, now, stop}) {
  const requests = new Map();
  const rowFields = new Map();
  for (const {table, row} of rows) {
    if (!Object.hasOwn(fields, table)) continue;
    const {merchant_id:merchantId, feed_label:feedLabel, language} = row.product_context;
    if (!merchantId || !feedLabel || !language) continue;
    for (const [role, nativeField, mappingField] of fields[table]) {
      const nativeId = row[nativeField];
      if (!nativeId) continue;
      const request = {role, nativeId, merchantId, feedLabel, language};
      const key = canonicalSourceJson(request);
      requests.set(key, request);
      if (!rowFields.has(row)) rowFields.set(row, []);
      rowFields.get(row).push({key, mappingField});
    }
  }

  const linksByKey = new Map(), evidenceByMapping = new Map();
  const entries = [...requests];
  const args = [ownerJson, contextJson, deadline];
  for (let index = 0; index < entries.length; index += 250) {
    stop();
    const chunk = entries.slice(index, index + 250);
    const response = await database.query(GOOGLE_DAILY_PRODUCT_LINKS_SQL, [...args, JSON.stringify(chunk.map(([, request]) => request))]);
    const links = response.rows?.[0]?.result;
    if (response.rows?.length !== 1 || !Array.isArray(links) || links.length > chunk.length) fail();
    const indexes = new Set();
    for (const link of links) {
      if (!Number.isInteger(link?.index) || !chunk[link.index] || indexes.has(link.index) || !/^[1-9][0-9]{0,18}$/.test(link.mappingId ?? "")) fail();
      indexes.add(link.index);
      const [key, request] = chunk[link.index];
      const context = link.context;
      if (!context || context.merchant_id !== request.merchantId || context.feed_label !== request.feedLabel
        || context.content_language !== request.language || typeof context.legacy_local !== "boolean"
        || typeof context.data_source !== "string" || !context.data_source.startsWith(`accounts/${request.merchantId}/dataSources/`)) fail();
      if (!evidenceByMapping.has(link.mappingId)) {
        stop();
        const result = await database.query(GOOGLE_DAILY_PRODUCT_MAPPING_SQL, [...args, link.mappingId]);
        if (result.rows?.length !== 1 || !Object.hasOwn(result.rows[0], "result")) fail();
        const evidence = result.rows[0].result;
        if (evidence !== null) validateCurrentMappingEvidence(evidence, owner, cipher, now());
        evidenceByMapping.set(link.mappingId, evidence?.mapping ?? null);
      }
      const evidence = evidenceByMapping.get(link.mappingId);
      if (evidence === null) continue;
      if (evidence.id !== link.mappingId || evidence.nativeId !== request.nativeId
        || canonicalSourceJson(evidence.context) !== canonicalSourceJson(context)) fail();
      linksByKey.set(key, link);
    }
  }
  stop();
  for (const [row, fieldsToBind] of rowFields) {
    const accepted = fieldsToBind.flatMap(({key, mappingField}) => linksByKey.has(key) ? [{mappingField, ...linksByKey.get(key)}] : []);
    if (!accepted.length) continue;
    const context = accepted[0].context;
    if (accepted.some(link => canonicalSourceJson(link.context) !== canonicalSourceJson(context))) continue;
    row.product_context = context;
    for (const {mappingField, mappingId} of accepted) row[mappingField] = mappingId;
  }
}
