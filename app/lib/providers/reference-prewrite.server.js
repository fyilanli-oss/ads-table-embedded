import {reviewRefreshCandidatePrewrite,reviewRefreshCandidatePrewriteCurrent} from "./candidate-prewrite.server.js";
import {refreshCandidateReferenceInputs} from "../refresh/quota-authority-binding.server.js";
import {attachMetaReportCandidateReferences} from "./meta-report-candidates.server.js";
import {attachAttributionEvidence} from "./klaviyo-reporting-authority.server.js";
import {resolveKlaviyoOrderedProductSales} from "./klaviyo-attribution-resolution.server.js";
import {klaviyoBusinessDayTimeframe} from "./klaviyo-reporting.server.js";
import {stableJson} from "./common-adapter.server.js";

export class ReferencePrewriteError extends Error {
  constructor(code){super(`REFERENCE_PREWRITE_${code}`);this.name="ReferencePrewriteError";}
}
const fail=code=>{throw new ReferencePrewriteError(code);};
const equal=(a,b)=>stableJson(a)===stableJson(b);
const freeze=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};

// Recheck completed immutable source references. No new provider queries or sales claims.
export function reviewRefreshReferencePrewrite({expected,observation,...extra}={}){
  if(Object.keys(extra).length)fail("INPUT_INVALID");
  const candidateReview=reviewRefreshCandidatePrewrite({expected,observation});
  const {scope,provenance}=candidateReview,rows=[];
  let family=null,observed=null,state="not_collected_in_this_reader_mode";
  if(scope.provider==="meta"&&provenance.kind==="report"){
    const inputs=refreshCandidateReferenceInputs(observation),report=observation.native_product_report;
    if(!inputs||!equal(report?.date_window,{start:provenance.job.window.from,end:provenance.job.window.to})
      ||report.metrics_interpreted!==false||report.exhaustive_product_coverage_proven!==false)fail("META_REPORT_CONTEXT_INVALID");
    const checked=attachMetaReportCandidateReferences({report,source:observation.native_source,
      productCandidates:observation.product_identity_candidates,
      ownerScope:{workspace_id:scope.workspaceId,installation_generation:scope.installGeneration,
        provider_connection_id:scope.connectionId,platform:"meta",platform_account_id:scope.accountId},
      target:inputs.target,reportRules:inputs.reportRules});
    if(!equal(checked,observation.product_report_candidate_links))fail("META_REFERENCE_MISMATCH");
    for(const link of checked.links)rows.push({sourceReference:{family:"ad_product_breakdown_daily_insights",
      nativeKey:JSON.stringify([scope.accountId,link.ad_id,link.business_date,link.provider_product_id]),
      context:{ad_id:link.ad_id,business_date:link.business_date,identity_namespace:link.identity_namespace}},
      candidateIndex:link.candidate_index,state:link.state,reason:link.reason,standardizedProductId:null,
      reference:observation.product_report_candidate_links.links[link.report_row_index],observed:report.rows[link.report_row_index]});
    family="meta_product_report";observed=observation.product_report_candidate_links;state="structurally_reviewed_open_gates";
  }else if(scope.provider==="klaviyo"){
    const message=observation.message_evidence,metric=message?.reporting_metric;
    const timeframe=klaviyoBusinessDayTimeframe({businessDate:provenance.job.window.from,timeZone:observation.account.timezone});
    if(!message||metric?.attributes?.name!=="Placed Order"||metric.attributes.integration?.name!=="Shopify"
      ||!equal(timeframe,observation.timeframe)||!Array.isArray(message.channels?.campaign)||!Array.isArray(message.channels?.flow)
      ||message.composition_scope!=="same_native_account_credential_and_business_day_collection"
      ||message.product_sale_statistics_source!=="Ordered Product"||message.reporting_statistics_used_as_product_sales!==false)fail("MESSAGE_CONTEXT_INVALID");
    const candidates=new Map(observation.product_identity_candidates.rows.map(row=>[row.provider_event_id,row]));
    const events=attachAttributionEvidence(observation.events,observation.attributions).map(row=>({...row,
      product_identity_verification:candidates.get(row.provider_event_id).product_identity_verification}));
    const checked=resolveKlaviyoOrderedProductSales({campaignChannels:message.channels.campaign,
      flowChannels:message.channels.flow,orderedProductEvents:events});
    if(!equal(checked,message.resolved_product_sales))fail("MESSAGE_REFERENCE_MISMATCH");
    const native=new Map(observation.events.map(row=>[row.id,row]));
    for(const row of message.resolved_product_sales.rows)rows.push({sourceReference:{family:"ordered_product_event",
      nativeKey:row.provider_event_id,context:{metric_id:row.provider_metric_id}},
      candidateIndex:row.product_identity_verification.candidate_index,
      state:row.attribution_resolution.sales_role==="Unclassified"?"unresolved":"message_reference",
      reason:row.attribution_resolution.reason,standardizedProductId:null,
      reference:row,observed:native.get(row.provider_event_id)});
    family="klaviyo_Message";observed=message;state="structurally_reviewed_open_gates";
  }
  return freeze({status:"structurally_reviewed_open_gates",scope,provenance,candidateReview,
    referenceReview:{state,family,rows,observed,observedEmpty:observed===null?null:rows.length===0},
    referenceLinksReviewed:observed!==null,providerClaimsReviewed:false,
    providerClaimState:"not_collected_in_identity_observation",providerClaimVerified:false,
    exactOverlapVerified:false,providerLinkVerified:false,canonicalScopeReady:false,nativePermissionVerified:false,
    persistable:false,authorizesActivation:false,mappingWritePerformed:false,DatasetWritePerformed:false,salesRolesChanged:false,
    remaining:["readable_provider_order_claim_and_Shopify_order_reconciliation","native_source_namespace_and_access_proof",
      "existing_step14_review_before_canonical_tables_and_writers"]});
}

export async function reviewRefreshReferencePrewriteCurrent({expected,observation,database,signal,...extra}={}){
  if(Object.keys(extra).length)fail("INPUT_INVALID");
  const structural=reviewRefreshReferencePrewrite({expected,observation});
  const candidateReview=await reviewRefreshCandidatePrewriteCurrent({expected:structural.scope,observation,database,signal});
  return freeze({...structural,candidateReview,authorityReobserved:true,atomicWriteGuardVerified:false});
}
