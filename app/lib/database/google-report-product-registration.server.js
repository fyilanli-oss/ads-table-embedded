import {isStoredDatasetSource} from "./dataset-source-reader.server.js";
import {projectStoredGoogleDataset} from "../providers/stored-dataset-projection.server.js";
import {createVerifiedMappingRepository} from "./verified-mapping-store.server.js";
import {sourcePayloadHash} from "./source-evidence-store.server.js";

export const REGISTER_GOOGLE_REPORT_PRODUCT_SQL = "select identity.register_google_report_product_link($1::jsonb,$2::jsonb) as result";
const roleFields = {
  performance: ["cpd_product_performance_facts", "native_product_id"],
  sold: ["cpd_product_sales_facts", "native_sold_product_id"],
  advertised: ["cpd_product_sales_facts", "native_advertised_product_id"],
};
const id = value => typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value)<=9223372036854775807n;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail = code => { throw Error("GOOGLE_REPORT_PRODUCT_" + code); };

// Trusted server operation. The reviewer receives the authenticated proof and
// must explicitly approve its exact fingerprint. There is no default approval.
export async function registerReviewedGoogleReportProduct({source, database, cipher, reviewAuthority, now=Date.now, target, deadlineAt}) {
  target=structuredClone(target);
  if (!isStoredDatasetSource(source) || source.owner.provider!=="google_ads" || !target || !Object.hasOwn(roleFields,target.role)
    || !id(target.pageId) || !target.identity || (target.replacesMappingId!==null&&!id(target.replacesMappingId))
    || typeof reviewAuthority!=="function" || typeof now!=="function" || !Number.isSafeInteger(deadlineAt)
    || deadlineAt<=now() || deadlineAt>now()+600000) fail("INPUT_INVALID");
  const owner=source.owner, [table,nativeField]=roleFields[target.role];
  const product=source.datasets.find(dataset=>dataset.dataset==="product_performance");
  const page=product?.pages.find(item=>item.ref.page_id===target.pageId);
  const matches=projectStoredGoogleDataset(source).rows.filter(item=>item.table===table
    && item.row[nativeField]===target.identity.nativeId && item.row.provenance.sources.some(ref=>ref.page_id===target.pageId));
  const merchant=target.identity.context;
  if (!page || !merchant || !merchant.merchant_id || !merchant.feed_label || !merchant.content_language
    || !matches.length || matches.some(({row:{product_context:c}})=>c.merchant_id!==merchant.merchant_id
      || c.feed_label!==merchant.feed_label || c.language!==merchant.content_language)) fail("REPORT_EVIDENCE_REQUIRED");
  const repository=createVerifiedMappingRepository({database,cipher,now});
  const mapping=await repository.readCurrent({owner,identity:target.identity});
  if (mapping.mappingId===target.replacesMappingId) fail("REPLACEMENT_INVALID");
  const claim={owner,businessDate:source.scope.window.from,role:target.role,identity:target.identity,
    page:page.ref,mappingId:mapping.mappingId,ruleId:mapping.ruleId,revision:mapping.revision,
    productId:mapping.productId,replacesMappingId:target.replacesMappingId};
  const proposalHash=sourcePayloadHash(claim);
  const approval=structuredClone(await reviewAuthority(structuredClone({claim,proposalHash,expiresAt:mapping.expiresAt})));
  const expiry=Date.parse(approval?.validUntil);
  if (now()>=deadlineAt || approval?.status!=="approved" || !uuid.test(approval.decisionId??"")
    || approval.proposalHash!==proposalHash || !Number.isFinite(expiry) || expiry<=now()
    || expiry>Date.parse(mapping.expiresAt) || new Date(expiry).toISOString()!==approval.validUntil) fail("EXPLICIT_REVIEW_REQUIRED");
  const body={businessDate:claim.businessDate,role:claim.role,mappingId:claim.mappingId,ruleId:claim.ruleId,
    revision:claim.revision,productId:claim.productId,replacesMappingId:claim.replacesMappingId,
    sourcePageId:page.ref.page_id,sourceBatchId:page.ref.batch_id,sourceDigest:page.ref.payload_hash,
    decisionId:approval.decisionId,proposalHash,validUntil:approval.validUntil,deadlineAt:new Date(deadlineAt).toISOString()};
  try {
    const response=await database.query(REGISTER_GOOGLE_REPORT_PRODUCT_SQL,[JSON.stringify(owner),JSON.stringify(body)]);
    const receipt=response.rows?.[0]?.result;
    if (response.rows?.length!==1 || receipt?.status!=="registered" || receipt.mappingId!==body.mappingId
      || receipt.businessDate!==body.businessDate || receipt.role!==body.role || receipt.decisionId!==body.decisionId) fail("RECEIPT_INVALID");
    return Object.freeze(receipt);
  } catch { fail("REGISTRATION_UNCONFIRMED"); }
}
