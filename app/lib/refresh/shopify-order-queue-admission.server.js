import {shopifyOrderRangeProposal} from "./shopify-order-range-plan.server.js";
import {createShopifyOrderQueueRepository} from "../database/shopify-order-queue-repository.server.js";
import {quotaRouteIdentity} from "./quota-scope-resolver.server.js";

const states=new Set(["not_configured","not_current","quota_configuration_required","conflict","record_conflict","queue_full"]);
const flags={workerAdmitted:false,quotaReserved:false,authorizesDispatch:false,authorizesActivation:false,
  checkpointAdvanced:false,persistable:false,DatasetWritePerformed:false};
const freeze=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const routesFor=contexts=>[
  ["shopify_partner","partner_graphql"],...["permission_scopes","order_headers","order_lines","order_journey"].map(f=>["shopify_admin",f])
].map(([provider,family])=>{
  const ctx=contexts[provider],identity=quotaRouteIdentity(ctx,{provider,family,accountId:ctx.accountId,
    organizationId:ctx.organizationId,version:ctx.apiVersion,includes:[]});
  return {...identity,family};
});
// Queue metadata only. No worker claim/fence, entitlement proof, quota debit or native client.
export function createShopifyOrderQueueAdmission({database,quotaStore,...extra}={}){
  if(Object.keys(extra).length||typeof quotaStore?.resolveRoute!=="function")throw Error("SHOPIFY_ORDER_QUEUE_INPUT_INVALID");
  const repository=createShopifyOrderQueueRepository(database);
  return Object.freeze({async enqueue({plan,rangeKey,...overrides}={}){
    if(Object.keys(overrides).length)throw Error("SHOPIFY_ORDER_QUEUE_INPUT_INVALID");
    const proposal=shopifyOrderRangeProposal(plan,rangeKey);let attempted=false;
    try{
      const input=await repository.readAdmission(proposal.owner);
      if(states.has(input?.status))return freeze({status:input.status,...flags});
      if(input?.status!=="ready"||!Number.isSafeInteger(input.revision)||input.revision<0
        ||!Number.isSafeInteger(input.configurationEpoch)||input.configurationEpoch<1
        ||!input.contexts||Object.keys(input.contexts).sort().join(",")!=="shopify_admin,shopify_partner")throw Error();
      const contexts=structuredClone(input.contexts),routes=routesFor(contexts);
      for(const route of routes)if(await quotaStore.resolveRoute(route)!==route.routeKey)return freeze({status:"quota_configuration_required",...flags});
      attempted=true;
      const result=await repository.enqueue({proposal,revision:input.revision,configurationEpoch:input.configurationEpoch,contexts,routes});
      if(states.has(result?.status))return freeze({status:result.status,...flags});
      if(!["queued","already_recorded"].includes(result?.status)||result.rangeKey!==proposal.key
        ||!["queued","cancelled"].includes(result.recordStatus)||!Number.isSafeInteger(result.version)||result.version<1)throw Error();
      return freeze({...result,metadataRecorded:true,...flags});
    }catch{return freeze({status:"needs_attention",reason:attempted?"queue_write_unconfirmed":"queue_readiness_unavailable",
      rangeKey:proposal.key,queueWriteMayHaveCommitted:attempted,...flags});}
  },async readPending({plan,rangeKey,...overrides}={}){
    if(Object.keys(overrides).length)throw Error("SHOPIFY_ORDER_QUEUE_INPUT_INVALID");
    const proposal=shopifyOrderRangeProposal(plan,rangeKey);
    try{
      const row=await repository.read(proposal);
      if(row===null)return freeze({status:"not_observed",rangeKey:proposal.key,...flags});
      if(row?.rangeKey!==proposal.key||!["queued","cancelled"].includes(row.recordStatus)
        ||!Number.isSafeInteger(row.version)||row.version<1||row.fromInclusive!==proposal.range.fromInclusive
        ||row.toExclusive!==proposal.range.toExclusive)throw Error();
      return freeze({status:"observed",...row,...flags});
    }catch{return freeze({status:"needs_attention",reason:"queue_read_unavailable",rangeKey:proposal.key,...flags});}
  }});
}
