import {bindShopifyProductVerification} from "../shopify/product-identity-verification.server.js";
import {takeMetaIdentitySourceCapture} from "./meta-identity-collection.server.js";
import {prepareSourceWrite, sourcePayloadHash} from "../database/source-evidence-store.server.js";
import {META_GRAPH_VERSION} from "./meta-graph.server.js";

const fieldState = (row, key) => !Object.hasOwn(row, key) ? "missing" : row[key] === null ? "null" : row[key] === "" ? "empty" : "observed";

// One-use genuine completed collection. No caller-created evidence, reviewed rule,
// verified mapping, report namespace inference, order claim or Dataset fact.
export function prepareMetaIdentitySourceWrite({observation, attemptId, policy, cipher, limits, now, ...extra} = {}) {
  if (Object.keys(extra).length) throw Error("META_SOURCE_WRITE_INPUT_INVALID");
  const capture = takeMetaIdentitySourceCapture(observation), pages = [];
  const records = {references: [], rules: [], mappings: [], orders: [], lines: [], journeys: [], claims: [], links: []};
  const relationRefs = [], mappings = new Map();
  const verificationChecks = new Map(capture.productChecks.map(check => [sourcePayloadHash([check.nativeId, check.context]), bindShopifyProductVerification(check.verification, capture.owner)]));
  function page(family, payload) {
    const key = "p" + pages.length;
    pages.push({key, family, ordinal: pages.length, origin: "meta", captureLayer: "collector_projection", numericFidelity: "decoded_only",
      fieldCoverage: Object.keys(payload), schemaVersion: "meta-identity-allowlist-v1", sanitizerVersion: "meta-identity-source-v1", payload});
    return key;
  }
  function reference(key, i, nativeType, nativeId) {
    const ref = key + "r" + i;
    records.references.push({key: ref, page: key, locatorKind: "row", locator: "/records/" + i, nativeType, nativeId, state: "present"});
    return ref;
  }
  for (const p of capture.pages) {
    const key = page(p.family, p.payload);
    for (const [i, row] of p.payload.records.entries()) {
      const product = p.family === "meta_catalog_products", report = p.family === "meta_product_report";
      const ref = reference(key, i, product ? "MetaCatalogProduct" : report ? "MetaProductReportRow"
        : p.family === "meta_permission_check" ? "PermissionInspection" : "AdCatalogReference",
      product ? row.id : report ? row.product_id : capture.owner.accountId);
      if (p.family === "meta_catalog_reference" || p.family === "meta_permission_check") relationRefs.push(ref);
      if (!product) continue;
      const candidate = observation.product_identity_candidates?.rows.find(r => r.catalog_product_id === row.id);
      const state = candidate?.product_identity_verification.state === "conflicting" ? "conflicting" : "unresolved";
      const feedState = fieldState(row, "product_feed"), groupState = fieldState(row, "retailer_product_group_id");
      const context = {catalog_id: capture.target.catalogId, graph_version: META_GRAPH_VERSION, identity_namespace: "catalog_product_id",
        product_feed_state: feedState, ...(feedState === "observed" ? {product_feed_id: row.product_feed.id} : {})};
      const mapping = "m" + records.mappings.length;
      records.mappings.push({key: mapping, rule: null, identity: {provider: "meta", accountId: capture.owner.accountId, nativeId: row.id, context},
        revision: "1", nativeId: row.id, context, productId: null, variantId: null, state, verifiedAt: null,
        applicability: {state: "verification_pending", reason: candidate?.product_identity_verification.reason ?? "verified_source_rule_required",
          retailerId: row.retailer_id, groupState, ...(groupState === "observed" ? {retailerGroupId: row.retailer_product_group_id} : {})}});
      mappings.set(row.id, mapping);
      records.links.push({reference: ref, targetType: "mapping", target: mapping, role: "native_product"});
    }
  }
  if (relationRefs.length !== 3) throw Error("META_SOURCE_LINK_EVIDENCE_REQUIRED");
  for (const target of mappings.values()) for (const ref of relationRefs) records.links.push({reference: ref, targetType: "mapping", target, role: "relationship"});
  if (observation.product_identity_candidates) {
    const rows = observation.product_identity_candidates.rows.map(row => {
      const verification = row.product_identity_verification;
      const candidate = verification.candidate_index === null ? null : observation.product_identity_candidates.candidates[verification.candidate_index];
      return {catalogProductId: row.catalog_product_id, retailerId: row.retailer_id, context: row.product_context,
        state: verification.state, reason: verification.reason,
        shopifyVerification: verificationChecks.get(sourcePayloadHash([row.catalog_product_id, row.product_context])) ?? null, candidate: candidate === null ? null : {
          productId: candidate.shopify_product_id, variantId: candidate.shopify_variant_id}};
    });
    const key = page("meta_candidate_checks", {records: rows});
    pages.at(-1).schemaVersion = "meta-candidate-check-v2";
    for (const [i, row] of rows.entries()) records.links.push({reference: reference(key, i, "CandidateCheck", row.catalogProductId),
      targetType: "mapping", target: mappings.get(row.catalogProductId), role: "candidate_check"});
  }
  if (observation.product_report_candidate_links) {
    // Namespace checks are evidence only. No report-to-product edge is accepted here.
    const rows = observation.product_report_candidate_links.links.map(row => ({reportRowIndex: row.report_row_index,
      providerProductId: row.provider_product_id, adId: row.ad_id, businessDate: row.business_date,
      state: row.state, reason: row.reason, identityNamespace: row.identity_namespace}));
    const key = page("meta_report_identity_checks", {records: rows});
    rows.forEach((row, i) => reference(key, i, "ReportIdentityCheck", row.providerProductId));
  }
  const write = prepareSourceWrite({owner: capture.owner, attemptId, ordinal: 0, sourceState: "complete", policy, cipher, limits, now, pages, records});
  return Object.freeze({write, target: capture.target, completedAt: capture.completedAt, permissionExpiresAt: capture.permissionExpiresAt});
}
