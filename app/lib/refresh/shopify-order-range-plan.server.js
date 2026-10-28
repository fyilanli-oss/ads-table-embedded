import {createHash} from "node:crypto";
import {shopifyPrewriteOwner} from "../providers/prewrite-owner.server.js";
import {createShopifyInstallationOwnerRepository} from "../database/shopify-installation-owner-repository.server.js";
import {createShopifyOrderPageRequest,SHOPIFY_ORDER_READ_API_VERSION} from "../shopify/order-read-protocol.server.js";
import {isShopifyOrderCollectionObservation} from "../shopify/order-collection.server.js";
import {quotaBoundaryControl} from "./quota-native-fetch.server.js";

export class ShopifyOrderRangePlanError extends Error {
  constructor(code){super(`SHOPIFY_ORDER_RANGE_PLAN_${code}`);this.name="ShopifyOrderRangePlanError";}
}
const fail=code=>{throw new ShopifyOrderRangePlanError(code);};
const freeze=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const plans=new WeakMap();
export function shopifyOrderRangeProposal(plan,key){
  const row=plans.get(plan)?.get(key);if(!row)fail("PROVENANCE_REQUIRED");
  return Object.freeze({owner:plan.owner,range:row.range,key:row.key,
    includeOrderHistory:plan.policy.includeOrderHistory,pageSize:plan.policy.pageSize});
}
function instant(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))fail("TIME_INVALID");
  const ms=Date.parse(value);if(!Number.isFinite(ms))fail("TIME_INVALID");
  const canonical=new Date(ms).toISOString();
  if(canonical.slice(0,19)!==value.slice(0,19))fail("TIME_INVALID");return ms;
}
const iso=ms=>{try{const s=new Date(ms).toISOString();instant(s);return s;}catch{fail("TIME_INVALID");}};
function policySnapshot(value){
  if(!value||Object.keys(value).sort().join(",")!=="anchorAt,cadenceMs,includeOrderHistory,maxRanges,pageSize,settleDelayMs,sliceMs")fail("POLICY_REQUIRED");
  const p={...value,anchorAt:iso(instant(value.anchorAt))};
  if(![p.cadenceMs,p.sliceMs].every(n=>Number.isSafeInteger(n)&&n>0)
    ||!Number.isSafeInteger(p.settleDelayMs)||p.settleDelayMs<0
    ||!Number.isSafeInteger(p.maxRanges)||p.maxRanges<1||p.maxRanges>1000
    ||!Number.isSafeInteger(p.pageSize)||p.pageSize<1||p.pageSize>100||typeof p.includeOrderHistory!=="boolean")fail("POLICY_REQUIRED");
  return freeze(p);
}

// SQL-bound proposal only. No advertising provider/account/day, scheduler entry,
// cursor/checkpoint, progress mutation, native request or worker admission is accepted.
export function createShopifyOrderRangePlanner({expected,database,policy,now=()=>new Date(),signal,...extra}={}){
  if(Object.keys(extra).length||typeof now!=="function"||signal!==undefined&&!(signal instanceof AbortSignal))fail("INPUT_INVALID");
  let owner;try{owner=shopifyPrewriteOwner(expected);}catch{fail("INPUT_INVALID");}
  const selected=policySnapshot(policy),repository=createShopifyInstallationOwnerRepository(database);
  const clock=()=>{try{const d=now();if(!(d instanceof Date))throw Error();return instant(d.toISOString());}catch{fail("CLOCK_INVALID");}};
  const check=()=>{if(signal?.aborted)fail("ABORTED");};
  async function current(){
    check();let actual;try{actual=await repository.load(owner);}catch{fail("OWNER_READ_FAILED");}check();
    if(actual?.installationId!==owner.installationId)fail("OWNER_CHANGED");
  }
  return Object.freeze({async plan({fromInclusive,...overrides}={}){
    if(Object.keys(overrides).length)fail("INPUT_INVALID");
    const from=instant(fromInclusive),observedAt=clock();check();await current();
    const anchor=instant(selected.anchorAt),tick=observedAt<anchor?null:anchor+Math.floor((observedAt-anchor)/selected.cadenceMs)*selected.cadenceMs;
    const cutoff=tick===null?null:tick-selected.settleDelayMs,ranges=[];
    let cursor=from;
    while(cutoff!==null&&cursor<cutoff&&ranges.length<selected.maxRanges){
      const end=Math.min(cutoff,cursor+selected.sliceMs);
      const range={fromInclusive:iso(cursor),toExclusive:iso(end)};
      const key=createHash("sha256").update(JSON.stringify(["shopify_orders",owner,SHOPIFY_ORDER_READ_API_VERSION,selected.includeOrderHistory,range])).digest("hex");
      const headerRequest=createShopifyOrderPageRequest({family:"order_headers",shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},range,first:selected.pageSize});
      ranges.push({key,range,headerRequest});cursor=end;
    }
    await current();check();if(clock()<observedAt)fail("CLOCK_REGRESSED");
    const result=freeze({status:ranges.length?"proposed":"not_due",source:"shopify_orders",owner,apiVersion:SHOPIFY_ORDER_READ_API_VERSION,
      policy:selected,observedAt:iso(observedAt),scheduledAt:tick===null?null:iso(tick),closedBefore:cutoff===null?null:iso(cutoff),
      nextCheckAt:iso(tick===null?anchor:tick+selected.cadenceMs),ranges,
      remainingRange:cutoff!==null&&cursor<cutoff?{fromInclusive:iso(cursor),toExclusive:iso(cutoff)}:null,
      fromInclusiveSource:"explicit_server_input_not_verified_durable_checkpoint",checkpointAdvanced:false,
      historicalCoverageVerified:false,nativePermissionVerified:false,queueAdmitted:false,
      authorizesDispatch:false,authorizesActivation:false,persistable:false,DatasetWritePerformed:false});
    plans.set(result,new Map(ranges.map(r=>[r.key,r])));return result;
  }});
}

// Classify only genuine in-process plan/collection/control identities. This cannot
// authorize resuming, reloading the first page, dropping a prefix or advancing progress.
export function reviewShopifyOrderRangeInterruption({plan,rangeKey,error,current,...extra}={}){
  const range=plans.get(plan)?.get(rangeKey);
  if(Object.keys(extra).length||!range||(error===undefined)===(current===undefined))fail("PROVENANCE_REQUIRED");
  let status,action;
  if(current!==undefined){
    if(!isShopifyOrderCollectionObservation(current))fail("COLLECTION_REQUIRED");
    if(current.scope.installation_id!==plan.owner.installationId||current.scope.workspace_id!==plan.owner.workspaceId
      ||current.scope.installation_generation!==plan.owner.installGeneration||current.shop.id!==plan.owner.shopId
      ||current.shop.myshopifyDomain!==plan.owner.shopDomain
      ||current.apiVersion!==plan.apiVersion||current.nativeScopeObservation?.includeOrderHistory!==plan.policy.includeOrderHistory
      ||iso(instant(current.extractionRange.fromInclusive))!==range.range.fromInclusive
      ||iso(instant(current.extractionRange.toExclusive))!==range.range.toExclusive)fail("OWNER_OR_RANGE_MISMATCH");
    status=current.salesPagesComplete===true&&current.journeyPagesComplete===true?"collected_not_durably_committed":"incomplete_not_durably_committed";
    action="durable_evidence_and_writer_review_required";
  }else{
    const control=quotaBoundaryControl(error),attempts=control?.priorBoundaryAttempts;
    if(control?.status==="waiting"&&Number.isSafeInteger(attempts)&&attempts>=0){
      status=attempts===0?"waiting_before_first_attempt":"partial_read_not_durable";
      action=attempts===0?"fresh_admission_required":"durable_prefix_review_required";
    }else{status="outcome_not_established";action="manual_review_required";}
  }
  return freeze({status,action,rangeKey,range:range.range,owner:plan.owner,
    checkpointAdvanced:false,resumeAuthorized:false,reloadFirstPageAuthorized:false,
    authorizesDispatch:false,authorizesActivation:false,persistable:false,DatasetWritePerformed:false});
}
