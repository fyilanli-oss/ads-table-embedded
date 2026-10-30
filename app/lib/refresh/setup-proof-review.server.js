import {isShopifyPermissionInspection} from "../shopify/permission-scopes.server.js";
import {isCombinedSetupAssetObservation,combinedSetupAssetSourceContext} from "../oauth/combined-setup-assets.server.js";
import {assessIdentityPermissionScopes, identityPermissionRequirements} from "../oauth/identity-permission-preflight.server.js";
import {isRefreshPdSourceObservation,refreshPdStoredPermissionScopes,refreshPdSetupBindingMatches} from "./pd-source-reader.server.js";
import {refreshCandidateObservationContext} from "./quota-authority-binding.server.js";
import {stableJson} from "../providers/common-adapter.server.js";

const same=(a,b)=>stableJson(a)===stableJson(b);
const freeze=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const fresh=(start,end,now)=>Number.isFinite(Date.parse(start))&&Number.isFinite(Date.parse(end))
  && Date.parse(start)<=Date.parse(end)&&Date.parse(end)<=now&&now-Date.parse(start)<=600000;

/** Source/feature scope review only. Stored provider scopes stay labelled stored;
 * native app-review and activation authority are never inferred from data access.
 */
export function reviewRefreshSetupProof({pdObservation,shopify=null,assets=null,identity=null,includeOrders=false,
  includeOrderHistory=false,now=()=>new Date(),...extra}={}) {
  if(Object.keys(extra).length||typeof includeOrders!=="boolean"||typeof includeOrderHistory!=="boolean"
    || includeOrderHistory&&!includeOrders || typeof now!=="function")throw Error("SETUP_PROOF_INPUT_INVALID");
  const time=now();
  if(!(time instanceof Date)||!Number.isFinite(time.valueOf()))throw Error("SETUP_PROOF_TIME_INVALID");
  const result={status:"blocked",reason:null,baseReady:false,ordersReady:false,ordersRequested:includeOrders,
    historyRequested:includeOrderHistory,providerScopeState:"unknown",providerScopeSource:"retained_scope_list_not_fresh_native_grant",
    productScopeState:"unknown",orderScopeState:"unknown",assetAccessState:"unknown",
    developerAppApproval:"not_observed",nativePermissionVerified:false,
    authorizesActivation:false,persistable:false,publishable:false,DatasetWritePerformed:false};
  const finish=reason=>freeze({...result,reason});
  if(!isRefreshPdSourceObservation(pdObservation))return finish("original_pd_observation_required");
  const p=pdObservation.source_context;
  if(!isShopifyPermissionInspection(shopify))return finish("original_shopify_scope_inspection_required");
  const c=shopify.context;
  if(!same([c.workspaceId,c.installGeneration,c.shopId,c.shopDomain],
    [p.workspace_id,p.installation_generation,p.shop_id,p.shop_domain]))return finish("shopify_scope_owner_mismatch");
  const products=assessIdentityPermissionScopes({context:c,evidence:shopify.evidence,now:()=>new Date(time)});
  const orders=assessIdentityPermissionScopes({context:c,evidence:shopify.evidence,includeOrders:true,includeOrderHistory,now:()=>new Date(time)});
  result.productScopeState=products.scopeStatus;result.orderScopeState=orders.scopeStatus;
  result.orderMissingScopes=orders.missingScopes;
  const stored=refreshPdStoredPermissionScopes(pdObservation), requirements=identityPermissionRequirements({provider:p.provider});
  result.providerScopeState=Array.isArray(stored)?requirements.scopes.every(s=>stored.includes(s))?"stored_sufficient":"stored_missing":"unknown";
  if(result.providerScopeState!=="stored_sufficient")return finish("provider_stored_scope_profile_incomplete");
  if(products.scopeStatus!=="observed_sufficient")return finish(products.scopeStatus==="observed_missing"?"shopify_products_scope_missing":"shopify_scope_evidence_unconfirmed");
  if(p.provider==="klaviyo") {
    const provenance=refreshCandidateObservationContext(identity);
    if(!provenance || provenance.provider!=="klaviyo" || !same([provenance.workspaceId,provenance.installGeneration,provenance.installationId,
      provenance.shopId,provenance.shopDomain,provenance.accountId,provenance.job],
      [p.workspace_id,p.installation_generation,p.installation_id,p.shop_id,p.shop_domain,p.platform_account_id,
        {id:p.job_or_run_id,fence:p.claim_fence,window:{from:p.business_date,to:p.business_date}}])
      || identity.connection_id!==p.provider_connection_id || identity.connection_version!==p.connection_version
      || identity.metric?.attributes?.name!=="Ordered Product" || identity.metric.attributes.integration?.name!=="Shopify")return finish("klaviyo_native_identity_scope_mismatch");
    if(!fresh(identity.evidence?.started_at,identity.evidence?.completed_at,time.valueOf()))return finish("provider_access_evidence_stale_or_future");
    result.assetAccessState="observed_account_metric_event_read";
  } else {
    if(!isCombinedSetupAssetObservation(assets))return finish("original_provider_asset_observation_required");
    if(!same([assets.provider,assets.workspaceId,assets.installGeneration,assets.installationId,assets.connectionId,
      assets.connectionVersion,assets.reportingSelectionEpoch,assets.reportingAccountId],
      [p.provider,p.workspace_id,p.installation_generation,p.installation_id,p.provider_connection_id,
        p.connection_version,p.reporting_selection_epoch,p.platform_account_id])
      || !refreshPdSetupBindingMatches(pdObservation,combinedSetupAssetSourceContext(assets)))return finish("provider_asset_scope_mismatch");
    if(!fresh(assets.observedAt,assets.completedAt,time.valueOf()) || !Number.isFinite(Date.parse(assets.expiresAt))
      || Date.parse(assets.expiresAt)<=time.valueOf())return finish("provider_access_evidence_stale_or_future");
    if(assets.accessState!=="verified" || assets.assetAccess?.productsEndpointReadable!==true)return finish("provider_asset_access_unconfirmed");
    result.assetAccessState="observed_asset_product_endpoint_read";
  }
  result.baseReady=true;result.ordersReady=orders.scopeStatus==="observed_sufficient";
  result.status=includeOrders&&!result.ordersReady?"blocked":"reviewed_for_prewrite_only";
  return finish(includeOrders&&!result.ordersReady?"shopify_orders_scope_required":null);
}
