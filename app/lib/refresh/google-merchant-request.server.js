import {readGooglePrivateRequest} from "./google-private-request.server.js";
import {createGoogleMerchantServerExecution,readGoogleMerchantServerPlan} from "./google-merchant-server.server.js";

export const GOOGLE_MERCHANT_SERVER_PATH="/internal/google/merchant-links";
const reasons=new Set(["authority_required","authority_changed","stopped","response_invalid","response_limit","incomplete_response",
 "request_contract_invalid","configuration_required","renewal_not_allowed","renewal_write_unconfirmed","provider_error","read_unconfirmed","close_unconfirmed"]);
const numeric=v=>typeof v==="string"&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
export async function handleGoogleMerchantServerRequest(request,{environment=process.env,createExecution=createGoogleMerchantServerExecution,now=Date.now}={}) {
 const env={...environment},json=(status,v)=>Response.json(v,{status,headers:{"cache-control":"no-store, max-age=0","cdn-cache-control":"no-store","x-content-type-options":"nosniff"}});
 const boundary={product_read_performed:false,quota_account_resolved:false,provider_retry_performed:false,authorizes_activation:false};
 const stop=(status,reason)=>json(status,{status:"stopped",reason,complete:false,merchant_ids:null,link_count:null,has_linked_merchant:null,...boundary});
 const gate=await readGooglePrivateRequest(request,{environment:env,path:GOOGLE_MERCHANT_SERVER_PATH,
  enabled:typeof env.ADSTABLE_GOOGLE_MERCHANT_DISCOVERY_PLAN==="string"&&env.ADSTABLE_GOOGLE_MERCHANT_DISCOVERY_PLAN.length>0,
  readPlan:readGoogleMerchantServerPlan,operationId:p=>p?.operationId,now});
 if(!gate.ok)return stop(gate.status,gate.reason);
 let execution,result;
 try{execution=createExecution({environment:env,operationId:gate.input.operationId,signal:request.signal,now});result=await execution.run();}
 catch{return stop(503,"execution_unavailable");}
 finally{try{await execution?.close();}catch{result={status:"stopped",reason:"close_unconfirmed"};}}
 const observed=result?.status==="observed"&&result.complete===true&&Array.isArray(result.merchant_ids)&&result.merchant_ids.length<=1000
  &&result.merchant_ids.every(numeric)&&new Set(result.merchant_ids).size===result.merchant_ids.length
  &&Number.isSafeInteger(result.link_count)&&result.link_count>=0&&result.link_count<=1000
  &&(result.link_count===0?result.merchant_ids.length===0:result.merchant_ids.length>0&&result.merchant_ids.length<=result.link_count)
  &&result.has_linked_merchant===(result.link_count>0);
 if(!observed)return stop(409,reasons.has(result?.reason)?result.reason:"read_unconfirmed");
 return json(200,{status:"observed",complete:true,merchant_ids:result.merchant_ids,link_count:result.link_count,
  has_linked_merchant:result.has_linked_merchant,credential_renewed:result.credential_renewed===true,...boundary});
}
