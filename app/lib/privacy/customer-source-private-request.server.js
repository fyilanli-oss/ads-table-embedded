import {parseMetaRawJson} from "../providers/meta-raw-projection.server.js";
import {timingSafeEqual} from "node:crypto";

// Private customer-source gate. No cookies, browser session, forwarded host or
// caller/account authority from input. A rejection performs no database I/O.
export async function readCustomerSourcePrivateRequest(request,{environment,now=Date.now}) {
 const env={...environment},stop=(status,reason)=>({ok:false,status,reason});
 if(request.method!=="POST")return stop(405,"method_not_allowed");
 if(env.VERCEL_ENV!=="production"||env.ADSTABLE_PRIVACY_SOURCE_WORKER_ENABLED!=="true")return stop(503,"not_enabled");
 const secret=env.ADSTABLE_PRIVACY_SOURCE_SERVER_SECRET,auth=request.headers.get("authorization");
 if(typeof secret!=="string"||!/^[A-Za-z0-9_-]{32,256}$/.test(secret)||typeof auth!=="string"||!/^Bearer [A-Za-z0-9_-]{32,256}$/.test(auth)||auth.length!==secret.length+7
  ||!timingSafeEqual(Buffer.from(auth),Buffer.from(`Bearer ${secret}`)))return stop(401,"unauthorized");
 try{const url=new URL(request.url),app=new URL(env.SHOPIFY_APP_URL);
  if(app.protocol!=="https:"||app.origin!==env.SHOPIFY_APP_URL||url.origin!==app.origin||url.pathname!=="/internal/privacy/source-worker"||url.search)throw Error();
 }catch{return stop(400,"request_not_allowed");}
 if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")return stop(400,"request_contract_invalid");
 if(request.headers.has("origin")||request.headers.has("cookie"))return stop(400,"request_not_allowed");
 let input;
 try{
  const reader=request.body?.getReader();if(!reader)throw Error();let size=0,expired=false;const chunks=[];
  const cancel=()=>{void reader.cancel().catch(()=>{});},timer=setTimeout(()=>{expired=true;cancel();},5000);
  request.signal.addEventListener("abort",cancel,{once:true});if(request.signal.aborted)cancel();
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1024){cancel();throw Error();}chunks.push(part.value);}
   if(expired||request.signal.aborted)throw Error();input=parseMetaRawJson(Buffer.concat(chunks).toString("utf8"));
  }finally{clearTimeout(timer);request.signal.removeEventListener("abort",cancel);reader.releaseLock();}
 }catch{return stop(400,"request_contract_invalid");}
 if(!input||typeof input!=="object"||Array.isArray(input)||!["run","inspect"].includes(input.mode)
 ||typeof input.operationId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId)
 ||Object.keys(input).sort().join()!==(input.mode==="run"?"deadlineAt,mode,operationId":"mode,operationId")||request.signal.aborted)return stop(400,"request_contract_invalid");
 if(input.mode==="run"&&(typeof input.deadlineAt!=="string"||!Number.isFinite(Date.parse(input.deadlineAt))
 ||new Date(input.deadlineAt).toISOString()!==input.deadlineAt||Date.parse(input.deadlineAt)<=now()
 ||Date.parse(input.deadlineAt)>now()+45000))return stop(400,"request_contract_invalid");
 return {ok:true,environment:env,input};
}
