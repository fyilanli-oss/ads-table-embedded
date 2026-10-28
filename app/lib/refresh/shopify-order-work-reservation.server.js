import {randomUUID} from "node:crypto";
import {shopifyOrderRangeProposal} from "./shopify-order-range-plan.server.js";

const uuid=v=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const flags={workerAdmitted:false,authorizesDispatch:false,authorizesActivation:false,entitlementVerified:false,quotaReserved:false,checkpointAdvanced:false,persistable:false,DatasetWritePerformed:false};
const states=new Set(["not_configured","not_current","attempt_exists","installation_busy","quota_configuration_required","budget_full","budget_unknown"]);
const amounts=v=>v&&Object.keys(v).sort().join(",")==="bytes,connections,dbWrites,requests,rows"
  &&Object.values(v).every(n=>Number.isSafeInteger(n)&&n>0);
const frozen=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(frozen);Object.freeze(v);}return v;};
const fail=()=>{throw Error("SHOPIFY_ORDER_WORK_INPUT_INVALID");};
const factories=new WeakMap();
export function shopifyOrderWorkReservationBinding(factory){
  const binding=factories.get(factory);if(!binding)fail();return binding;
}

// Inactive pre-HTTP reservation adapter only. No HTTP callback, timer, lease release,
// entitlement receipt, quota debit or Dataset writer can be supplied here.
export function createShopifyOrderWorkReservations({database,...extra}={}){
  if(Object.keys(extra).length||typeof database?.query!=="function")fail();
  const handles=new WeakMap();
  const args=p=>[p.owner.installationId,p.owner.workspaceId,p.owner.installGeneration,p.owner.shopId,p.owner.shopDomain,p.key];
  async function one(sql,params){const result=await database.query(sql,params);
    if(!Array.isArray(result?.rows)||result.rows.length!==1||!Object.hasOwn(result.rows[0],"result"))throw Error();
    return result.rows[0].result;
  }
  const valid=(r,p,id)=>r?.attemptId===id&&r.rangeKey===p.key&&Number.isSafeInteger(r.fence)&&r.fence>0&&amounts(r.cost);
  const factory=Object.freeze({async reserve({plan,rangeKey,...overrides}={}){
    if(Object.keys(overrides).length)fail();const p=shopifyOrderRangeProposal(plan,rangeKey),attemptId=randomUUID();
    try{
      const r=await one("select operations.reserve_shopify_order_work($1::bigint,$2::uuid,$3::bigint,$4::text,$5::text,$6::text,$7::uuid) as result",[...args(p),attemptId]);
      if(states.has(r?.status))return frozen({status:r.status,...flags});
      if(r?.status!=="reserved"||!valid(r,p,attemptId))throw Error();
      const result=frozen({...r,reservationHeld:true,...flags});handles.set(result,{p,attemptId,fence:r.fence,cost:result.cost});return result;
    }catch{return frozen({status:"needs_attention",reason:"reservation_write_unconfirmed",attemptId,rangeKey:p.key,reservationMayBeHeld:true,...flags});}
  },async readReservation({plan,rangeKey,attemptId,...overrides}={}){
    if(Object.keys(overrides).length||!uuid(attemptId))fail();const p=shopifyOrderRangeProposal(plan,rangeKey);
    try{
      const r=await one("select operations.read_shopify_order_work_reservation($1::bigint,$2::uuid,$3::bigint,$4::text,$5::text,$6::text,$7::uuid) as result",[...args(p),attemptId]);
      if(r===null)return frozen({status:"not_observed",attemptId,rangeKey:p.key,...flags});
      if(!valid(r,p,attemptId)||!["reserved","released"].includes(r.reservationStatus))throw Error();
      // Historical observation is deliberately NOT registered as a releasable handle.
      return frozen({status:"observed",...r,...flags});
    }catch{return frozen({status:"needs_attention",reason:"reservation_read_unavailable",attemptId,rangeKey:p.key,...flags});}
  },async releaseBeforeRequest({reservation,...overrides}={}){
    const h=handles.get(reservation);if(Object.keys(overrides).length||!h)fail();
    handles.delete(reservation);
    try{
      const released=await one("select operations.release_shopify_order_work($1::bigint,$2::uuid,$3::bigint,$4::text,$5::text,$6::text,$7::uuid,$8::bigint) as result",[...args(h.p),h.attemptId,h.fence]);
      if(typeof released!=="boolean")throw Error();
      handles.delete(reservation);return frozen({status:released?"released":"not_current",...flags});
    }catch{
      // The same handle cannot issue a second write after an unknown release outcome.
      handles.delete(reservation);return frozen({status:"needs_attention",reason:"reservation_release_unconfirmed",attemptId:h.attemptId,rangeKey:h.p.key,reservationMayBeHeld:true,...flags});
    }
  }});
  factories.set(factory,Object.freeze({database,has:reservation=>handles.has(reservation),take(reservation){
    const h=handles.get(reservation);if(!h)fail();handles.delete(reservation);return h;
  }}));return factory;
}
