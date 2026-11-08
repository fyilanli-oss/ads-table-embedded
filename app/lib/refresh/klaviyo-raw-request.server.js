import {handleDatasetWriteRequest} from "./dataset-request.server.js";
import {createDatasetServerExecution} from "./dataset-server.server.js";
import {readKlaviyoPrivateRequest} from "./klaviyo-private-request.server.js";
import {createKlaviyoRawCaptureExecution,readKlaviyoRawCapturePlan} from "./klaviyo-raw-server.server.js";
import {validateKlaviyoRawEligibility} from "./klaviyo-raw-eligibility.server.js";
export const KLAVIYO_RAW_CAPTURE_PATH="/internal/klaviyo/raw-capture";
const reasons=new Set(["capture_unconfirmed","not_attempted","provider_permission_denied","provider_throttled","provider_http_error","provider_api_error",
 "response_invalid","response_limit","page_limit","row_limit","request_limit","cursor_loop","credential_refresh_required","authority_changed","configuration_missing",
 "read_deadline_exceeded","read_aborted","stopped_before_call","authority_required","admission_waiting","admission_not_accepted","request_outcome_unknown",
 "entitlement_required","authority_check_failed_after_request","closure_unconfirmed","execution_unconfirmed","admission_unconfirmed","close_unconfirmed"]);
export async function handleKlaviyoRawCaptureRequest(request,{environment=process.env,createExecution=createKlaviyoRawCaptureExecution,now=Date.now,createDatasetExecution=createDatasetServerExecution}={}){
 const env={...environment};
 if(env.ADSTABLE_DATASET_WRITE_ENABLED==="true")return handleDatasetWriteRequest(request,{environment:env,provider:"klaviyo",path:KLAVIYO_RAW_CAPTURE_PATH,readPrivateRequest:readKlaviyoPrivateRequest,now,createExecution:createDatasetExecution});
 const json=(status,value)=>Response.json(value,{status,headers:{"cache-control":"no-store, max-age=0","cdn-cache-control":"no-store","x-content-type-options":"nosniff"}});
 const stop=(status,reason)=>json(status,{status:"stopped",reason,sourceStored:null,recordCount:null,empty:null});
 const gate=await readKlaviyoPrivateRequest(request,{environment:env,path:KLAVIYO_RAW_CAPTURE_PATH,enabled:env.ADSTABLE_KLAVIYO_RAW_CAPTURE_ENABLED==="true",
  readPlan:readKlaviyoRawCapturePlan,operationId:p=>p?.target.operationId,now});
 if(!gate.ok)return stop(gate.status,gate.reason);
 let execution,result;
 try{execution=createExecution({environment:env,operationId:gate.input.operationId,signal:request.signal,now});result=await execution.run();}
 catch{return stop(503,"execution_unavailable");}
 finally{try{await execution?.close();}catch{result={status:"unconfirmed",reason:"close_unconfirmed",sourceStored:result?.sourceStored??null};}}
 const datasets={};
 for(const name of ["configuration","account_performance","product_performance"]){const v=result?.datasets?.[name];
  let eligibility;try{eligibility=validateKlaviyoRawEligibility(v?.eligibility,{window:gate.plan.target.window});}catch{}
  const known=!!eligibility&&["stored","partial","unavailable"].includes(v?.status)&&v.receiptVerified===true&&v.contentVerified===true
   &&/^[1-9][0-9]{0,18}$/.test(v.batchId??"")&&/^[0-9a-f-]{36}$/i.test(v.commitId??"")&&/^[a-f0-9]{64}$/.test(v.digest??"")
   &&(v.status!=="stored"?v.recordCount===null&&v.empty===null:Number.isSafeInteger(v.recordCount)&&v.recordCount>=0&&v.recordCount<=gate.plan.limits.maxRows);
  datasets[name]=known?{status:v.status,recordCount:v.recordCount,empty:v.recordCount===null?null:v.recordCount===0,receiptVerified:true,contentVerified:true,
   receipt:{batchId:v.batchId,commitId:v.commitId,digest:v.digest},eligibility}:{status:["failed","unconfirmed"].includes(v?.status)?v.status:"not_attempted",
    reason:reasons.has(v?.reason)?v.reason:null,recordCount:null,empty:null};
 }
 const settled=["stored","partial"].includes(result?.status)&&result.sourceStored===true&&result.jobPaused===true&&Object.values(datasets).every(v=>["stored","partial","unavailable"].includes(v.status));
 const complete=result?.status==="stored"&&result.sourceStored===true&&result.jobPaused===true&&Object.values(datasets).every(v=>v.status==="stored");
 return json(settled?200:409,{status:complete?"stored":settled?"partial":result?.status==="stopped"?"stopped":"unconfirmed",complete,datasets,
  ...settled?{}:{reason:reasons.has(result?.reason)?result.reason:"capture_unconfirmed"},
  sourceStored:settled?true:[true,false,null].includes(result?.sourceStored)?result.sourceStored:null,receiptVerified:settled,contentVerified:settled,
  recordCount:complete?Object.values(datasets).reduce((n,v)=>n+v.recordCount,0):null,empty:complete?Object.values(datasets).every(v=>v.empty):null,
  jobPaused:result?.jobPaused===true,reservationMayExist:result?.reservationMayExist!==false,catalogueIdentityVerified:false,mappingVerified:false,
  DatasetWritePerformed:false,authorizesActivation:false,hourlyRefreshActivated:false});
}
