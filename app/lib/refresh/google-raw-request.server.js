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
 if(plan.version===2){
  const names=["account_performance","product_performance","merchant_identity"],datasets={};
  const safeReasons=new Set(["merchant_link_absent","merchant_context_required","capture_unconfirmed","not_attempted","provider_permission_denied","provider_throttled","provider_http_error",
   "response_invalid","response_limit","page_limit","row_limit","request_limit","merchant_link_changed","merchant_target_not_linked","authority_changed","configuration_missing",
   "read_deadline_exceeded","read_aborted"]);
  for(const name of names){const v=result?.datasets?.[name];
   const known=["stored","unavailable"].includes(v?.status)&&v.receiptVerified===true&&v.contentVerified===true
    &&/^[1-9][0-9]{0,18}$/.test(v.batchId??"")&&/^[0-9a-f-]{36}$/i.test(v.commitId??"")&&/^[a-f0-9]{64}$/.test(v.digest??"");
   const complete=known&&v.status==="stored"&&Number.isSafeInteger(v.recordCount)&&v.recordCount>=0&&v.recordCount<=plan.limits.maxRows;
   datasets[name]=complete?{status:"stored",recordCount:v.recordCount,empty:v.recordCount===0,receiptVerified:true,contentVerified:true,
    receipt:{batchId:v.batchId,commitId:v.commitId,digest:v.digest}}:known&&v.status==="unavailable"
    ?{status:"unavailable",reason:safeReasons.has(v.reason)?v.reason:"capture_unconfirmed",recordCount:null,empty:null,receiptVerified:true,contentVerified:true,
     receipt:{batchId:v.batchId,commitId:v.commitId,digest:v.digest}}:{status:["failed","unconfirmed"].includes(v?.status)?v.status:"not_attempted",
      reason:safeReasons.has(v?.reason)?v.reason:null,recordCount:null,empty:null};
  }
  const complete=result?.status==="stored"&&result.jobPaused===true&&names.every(n=>datasets[n].status==="stored");
  const partial=result?.status==="partial"&&result.jobPaused===true&&names.slice(0,2).every(n=>datasets[n].status==="stored")&&datasets.merchant_identity.status==="unavailable";
  return json(complete?200:partial?207:409,{status:complete?"stored":partial?"partial":result?.status==="stopped"?"stopped":"unconfirmed",complete,datasets,
   ...complete||partial?{}:{reason:safeReasons.has(result?.reason)?result.reason:"capture_unconfirmed"},
   sourceStored:complete||partial?true:result?.sourceStored??null,receiptVerified:complete||partial,contentVerified:complete||partial,
   recordCount:complete?names.reduce((n,k)=>n+datasets[k].recordCount,0):null,empty:complete?names.every(n=>datasets[n].empty):null,
   jobPaused:result?.jobPaused===true,mappingVerified:false,DatasetWritePerformed:false,authorizesActivation:false,hourlyRefreshActivated:false});
 }
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
