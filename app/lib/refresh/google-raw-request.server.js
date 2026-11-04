import {timingSafeEqual} from "node:crypto";
import {createGoogleRawCaptureExecution,readGoogleRawCapturePlan} from "./google-raw-server.server.js";

export const GOOGLE_RAW_CAPTURE_PATH="/internal/google/raw-capture";
// Private server-to-server resource only. No cookies, browser auth, caller IDs,
// forwarded origins, native permission request, or automatic retry.
export async function handleGoogleRawCaptureRequest(request,{environment=process.env,createExecution=createGoogleRawCaptureExecution,now=Date.now}={}) {
 const env={...environment};
 const json=(status,value)=>Response.json(value,{status,headers:{"cache-control":"no-store, max-age=0","cdn-cache-control":"no-store","x-content-type-options":"nosniff"}});
 const stop=(status,reason)=>json(status,{status:"stopped",reason,sourceStored:null,recordCount:null,empty:null});
 if(request.method!=="POST")return stop(405,"method_not_allowed");
 if(env.VERCEL_ENV!=="production"||env.ADSTABLE_GOOGLE_RAW_CAPTURE_ENABLED!=="true")return stop(503,"not_enabled");
 const secret=env.ADSTABLE_GOOGLE_RAW_CAPTURE_SERVER_SECRET,auth=request.headers.get("authorization");
 if(typeof secret!=="string"||!/^[A-Za-z0-9_-]{32,256}$/.test(secret)||typeof auth!=="string"||!/^Bearer [A-Za-z0-9_-]{32,256}$/.test(auth)||auth.length!==secret.length+7
  ||!timingSafeEqual(Buffer.from(auth),Buffer.from(`Bearer ${secret}`)))return stop(401,"unauthorized");
 let url;
 try{url=new URL(request.url);const app=new URL(env.SHOPIFY_APP_URL);
  if(app.protocol!=="https:"||app.origin!==env.SHOPIFY_APP_URL||url.origin!==app.origin||url.pathname!==GOOGLE_RAW_CAPTURE_PATH||url.search)throw Error();
 }catch{return stop(400,"request_not_allowed");}
 if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")return stop(400,"request_contract_invalid");
 let input,plan;
 try{
  plan=readGoogleRawCapturePlan(env,now());
  const reader=request.body?.getReader();if(!reader)throw Error();let size=0,expired=false;const chunks=[];
  const cancel=()=>{void reader.cancel().catch(()=>{});},timer=setTimeout(()=>{expired=true;cancel();},5000);
  request.signal.addEventListener("abort",cancel,{once:true});if(request.signal.aborted)cancel();
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1024){cancel();throw Error();}chunks.push(part.value);}
   if(expired||request.signal.aborted)throw Error();input=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }finally{clearTimeout(timer);request.signal.removeEventListener("abort",cancel);reader.releaseLock();}
 }catch{return stop(400,"request_contract_invalid");}
 if(!input||Object.keys(input).join()!=="operationId"||input.operationId!==plan?.target.operationId||request.signal.aborted)return stop(400,"request_contract_invalid");
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
