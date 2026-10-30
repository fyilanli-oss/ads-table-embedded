import {reviewRefreshReferencePrewrite} from "../providers/reference-prewrite.server.js";
import {reviewShopifyProviderClaimReadiness} from "../shopify/provider-claim-prewrite.server.js";
import {providerPrewriteOwner} from "../providers/prewrite-owner.server.js";
import {refreshCandidateObservationContext, refreshInteractionObservationContext} from "./quota-authority-binding.server.js";
import {isRefreshPdSourceObservation} from "./pd-source-reader.server.js";
import {refreshWorkIdentity} from "./work-stop-policy.server.js";
import {stableJson} from "../providers/common-adapter.server.js";

const fail = code => {throw Error(`INTEGRATED_PREWRITE_${code}`);};
const freeze = v => {if(v && typeof v === "object" && !Object.isFrozen(v)) {Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const same = (a,b) => stableJson(a) === stableJson(b);
const keys = (v,allowed) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every(k=>allowed.includes(k));

/** Read-only review of completed in-process families. Independent observations
 * retain their own scope and time range. No numerical join or role inference.
 */
export function reviewRefreshIntegratedPrewrite({claim,window,pdObservation,identity,shopify=null,interaction=null,...extra}={}) {
  if(Object.keys(extra).length || !keys(identity,["expected","observation"]) || !identity.observation
    || shopify!==null && !keys(shopify,["current","previous"])) fail("INPUT_INVALID");
  refreshWorkIdentity(claim,{claimRequired:true});
  const scope=providerPrewriteOwner(identity.expected), provenance=refreshCandidateObservationContext(identity.observation);
  if(!provenance || !same(provenance.job,{id:claim.id,fence:claim.fence,window})
    || scope.workspaceId!==claim.workspaceId || String(scope.installGeneration)!==claim.installGeneration
    || scope.provider!==claim.provider || scope.accountId!==claim.accountId) fail("IDENTITY_EXECUTION_MISMATCH");
  if(!isRefreshPdSourceObservation(pdObservation)) fail("PD_OBSERVATION_REQUIRED");
  const p=pdObservation.source_context;
  if(!same([p.workspace_id,p.installation_id,p.installation_generation,p.shop_id,p.shop_domain,p.provider,
    p.provider_connection_id,p.connection_version,p.reporting_selection_epoch,p.platform_account_id,p.job_or_run_id,p.claim_fence,p.business_date],
    [scope.workspaceId,scope.installationId,scope.installGeneration,scope.shopId,scope.shopDomain,scope.provider,
      scope.connectionId,scope.connectionVersion,scope.reportingSelectionEpoch,scope.accountId,claim.id,claim.fence,window.from])
    || window.from!==window.to) fail("PD_IDENTITY_SCOPE_MISMATCH");
  const referenceReview=reviewRefreshReferencePrewrite(identity);
  const orderReview=shopify===null?null:reviewShopifyProviderClaimReadiness({
    expected:Object.fromEntries(["workspaceId","installGeneration","installationId","shopId","shopDomain"].map(k=>[k,scope[k]])),
    current:shopify.current,previous:shopify.previous??null,providers:[identity]});
  let interactionReview={state:"not_supplied",links:[],clickedProductVerified:false};
  if(interaction!==null) {
    const context=refreshInteractionObservationContext(interaction);
    if(scope.provider!=="klaviyo" || !context || Object.keys(scope).some(k=>!same(scope[k],context[k]))
      || !same(context.job,provenance.job)) fail("INTERACTION_SCOPE_MISMATCH");
    if(!same(identity.observation.events,interaction.events) || !same(identity.observation.attributions,interaction.attributions)
      || !same(identity.observation.metric,interaction.metric) || !same(identity.observation.account,interaction.account)) fail("INTERACTION_SALE_REFERENCES_CHANGED");
    const evidence=interaction.attributed_interactions;
    if(!evidence || evidence.clicked_product_verified!==false || evidence.sales_roles_changed!==false) fail("INTERACTION_EVIDENCE_INVALID");
    interactionReview={state:evidence.links.some(l=>l.status.includes("conflict"))?"conflicting_references":"reviewed",
      links:evidence.links,events:evidence.events,clickedProductVerified:false,
      consistency:"independent_reads_equal_sale_references_not_atomic_snapshot"};
  }
  return freeze({status:"structurally_reviewed_open_gates",scope,job:provenance.job,
    pdState:pdObservation.records?.status??"records_not_supplied",referenceReview,orderReview,interactionReview,
    ordersState:shopify===null?"not_supplied":orderReview.orderReview.orders.length===0?"observed_empty":"reviewed",
    timeRangesEquated:false,productMappingAssigned:false,lineItemMatchAssigned:false,exactOverlapVerified:false,
    providerClaimVerified:false,nativePermissionVerified:false,canonicalScopeReady:false,
    persistable:false,publishable:false,authorizesActivation:false,DatasetWritePerformed:false,salesRolesChanged:false,
    remaining:["native_setup_and_source_identity_claim_proof","canonical_mapping_storage_step15","Dataset_FX_writer_step23"]});
}
