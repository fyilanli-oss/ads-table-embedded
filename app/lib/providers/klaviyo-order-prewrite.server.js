import {reviewShopifyOrderPrewrite} from "../shopify/order-prewrite.server.js";
import {reviewRefreshReferencePrewrite} from "./reference-prewrite.server.js";
import {refreshCandidateReferenceInputs} from "../refresh/quota-authority-binding.server.js";
import {isKlaviyoOrderIdentityRuleLoader} from "./klaviyo-order-rules.server.js";

export class KlaviyoOrderPrewriteError extends Error {
  constructor(code){super(`KLAVIYO_ORDER_PREWRITE_${code}`);this.name="KlaviyoOrderPrewriteError";}
}
const fail=code=>{throw new KlaviyoOrderPrewriteError(code);};
const freeze=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function orderId(value,format){
  if(format==="Shopify_Order_GID")return typeof value==="string"&&/^gid:\/\/shopify\/Order\/[1-9][0-9]*$/.test(value)?value:null;
  const raw=Number.isSafeInteger(value)&&value>0?String(value):value;
  return typeof raw==="string"&&/^[1-9][0-9]{0,19}$/.test(raw)&&BigInt(raw)<=18446744073709551615n?`gid://shopify/Order/${raw}`:null;
}

// Structural OrderId/Message candidates from genuine completed observations only.
// A source rule must bind this account/metric/integration to the exact Shopify shop.
export function reviewKlaviyoOrderClaimPrewrite({expected,observation,current,previous=null,...extra}={}){
  if(Object.keys(extra).length||expected?.provider!=="klaviyo")fail("INPUT_INVALID");
  const referenceReview=reviewRefreshReferencePrewrite({expected,observation});
  const {scope}=referenceReview;
  const orderReview=reviewShopifyOrderPrewrite({expected:{workspaceId:scope.workspaceId,installGeneration:scope.installGeneration,installationId:scope.installationId,
    shopId:scope.shopId,shopDomain:scope.shopDomain},current,previous});
  const loader=refreshCandidateReferenceInputs(observation)?.orderRules;
  if(!isKlaviyoOrderIdentityRuleLoader(loader))fail("ORIGINAL_RULE_LOADER_REQUIRED");
  const ruleScope=Object.fromEntries(["provider","workspaceId","installGeneration","shopId","shopDomain","connectionId","connectionVersion","accountId"].map(k=>[k,scope[k]]));
  const rule=loader.load({scope:ruleScope,metricId:observation.metric.id,integrationId:observation.metric.attributes.integration.id??null});
  const orders=new Map(orderReview.orders.map(order=>[order.observed.id,order])),rows=[];
  for(const row of referenceReview.referenceReview.rows){
    const event=row.reference,property=event.provider_order_properties.OrderId,resolution=event.attribution_resolution;
    let state="unresolved",reason="verified_order_identity_rule_required",candidate=null,order=null;
    if(property.state==="absent")reason="order_reference_missing";
    else if(property.value===null||property.value==="")reason="order_reference_empty";
    else if(rule!==null){
      candidate=orderId(property.value,rule.format);
      if(candidate===null)reason="order_reference_format_invalid";
      else {
        order=orders.get(candidate)??null;
        if(order===null)reason="order_not_observed_in_Shopify_collection";
        else if(resolution.reason!=="message_channel_exact"||!resolution.channel_id)reason="native_Message_reference_unresolved";
        else {state="structural_Order_Message_reference";reason="reviewed_source_rule_Order_and_Message_linked_not_canonical_claim";}
      }
    }
    rows.push({sourceReference:row.sourceReference,orderReference:property,state,reason,
      candidateShopifyOrderId:candidate,ShopifyOrderKey:order?.key??null,ShopifyOrder:order?.observed??null,
      MessageReference:resolution,sourceRule:rule,observed:event,canonicalClaimId:null});
  }
  return freeze({status:"structurally_reviewed_open_gates",scope,referenceReview,orderReview,rows,observedEmpty:rows.length===0,
    orderReferencesReviewed:true,sourceRuleRegisteredByDefault:false,readableOrderClaimVerified:false,providerClaimVerified:false,
    exactOverlapVerified:false,lineItemMatchAssigned:false,nativePermissionVerified:false,canonicalScopeReady:false,persistable:false,authorizesActivation:false,
    mappingWritePerformed:false,DatasetWritePerformed:false,salesRolesChanged:false,amountsOrQuantitiesChanged:false,
    remaining:["native_account_metric_integration_shop_order_identity_and_attribution_claim_proof",
      "native_SQL_profile_capacity_and_existing_step14_review_before_tables_and_writers"]});
}
