import {readGooglePrivateRequest} from "./google-private-request.server.js";
import {createGoogleRawCaptureExecution,readGoogleRawCapturePlan} from "./google-raw-server.server.js";

export const GOOGLE_RAW_CAPTURE_PATH="/internal/google/raw-capture";
// Private server-to-server resource only. No cookies, browser auth, caller IDs,
// forwarded origins, native permission request, or automatic retry.
export async function handleGoogleRawCaptureRequest(request,{environment=process.env,createExecution=createGoogleRawCaptureExecution,now=Date.now}={}) {
 const env={...environment};
 const json=(status,value)=>Response.json(value,{status,headers:{"cache-control":"no-store, max-age=0","cdn-cache-control":"no-store","x-content-type-options":"nosniff"}});
 const stop=(status,reason)=>json(status,{status:"stopped",reason,sourceStored:null,recordCount:null,empty:null});
 const gate=await readGooglePrivateRequest(request,{environment:env,path:GOOGLE_RAW_CAPTURE_PATH,
  enabled:env.ADSTABLE_GOOGLE_RAW_CAPTURE_ENABLED==="true",readPlan:readGoogleRawCapturePlan,operationId:p=>p?.target.operationId,now});
 if(!gate.ok)return stop(gate.status,gate.reason);
 const {input,plan}=gate;
 let execution,result;
 try{
  execution=createExecution({environment:env,operationId:input.operationId,signal:request.signal,now});
  result=await execution.run();
 }catch{return stop(503,"execution_unavailable");}
 finally{try{await execution?.close();}catch{result={status:"unconfirmed",reason:"close_unconfirmed",sourceStored:result?.sourceStored??null,recordCount:null,empty:null};}}
 const reasons=new Set(["stopped_before_call","authority_required","configuration_missing","admission_waiting","admission_not_accepted",
  "request_outcome_unknown","entitlement_required","provider_permission_denied","provider_throttled","authority_check_failed_after_request",
  "closure_unconfirmed","execution_unconfirmed","admission_unconfirmed","close_unconfirmed"]);
 const stored=result?.status==="stored"&&result.sourceStored===true&&result.receiptVerified===true&&result.jobPaused===true
  &&Number.isSafeInteger(result.recordCount)&&result.recordCount>=0&&result.recordCount<=plan.limits.maxRows
  &&/^[1-9][0-9]{0,18}$/.test(result.receipt?.batchId??"")&&/^[0-9a-f-]{36}$/i.test(result.receipt?.commitId??"")&&/^[a-f0-9]{64}$/.test(result.receipt?.digest??"");
 const output={status:stored?"stored":result?.status==="stopped"?"stopped":"unconfirmed",
  sourceStored:[true,false,null].includes(result?.sourceStored)?result.sourceStored:null,receiptVerified:stored,
  reservationMayExist:result?.reservationMayExist!==false,
  recordCount:stored?result.recordCount:null,empty:stored?result.recordCount===0:null,
  mappingVerified:false,DatasetWritePerformed:false,authorizesActivation:false,hourlyRefreshActivated:false,
  ...stored?{receipt:{batchId:result.receipt.batchId,commitId:result.receipt.commitId,digest:result.receipt.digest},jobPaused:result.jobPaused===true}:
   {reason:reasons.has(result?.reason)?result.reason:"execution_unconfirmed"}};
 return json(stored?200:409,output);
}
