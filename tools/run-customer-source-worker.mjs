import {randomUUID} from "node:crypto";
import {pathToFileURL} from "node:url";
// Explicit operator caller. No loop, scheduling, automatic inspect or retry.
export async function callCustomerSourceWorker({environment=process.env,args=process.argv.slice(2),fetchFn=fetch,now=Date.now}={}){
 if(environment.ADSTABLE_PRIVACY_SOURCE_OPERATOR_APPROVED!=="true")throw Error("PRIVACY_OPERATOR_APPROVAL_REQUIRED");
 const origin=environment.SHOPIFY_APP_URL,secret=environment.ADSTABLE_PRIVACY_SOURCE_SERVER_SECRET;
 if(origin!=="https://embedded.adstable.app"||typeof secret!=="string"||!/^[A-Za-z0-9_-]{32,256}$/.test(secret))throw Error("PRIVACY_OPERATOR_CONFIGURATION_REQUIRED");
 let input;
 if(args.length===1&&args[0]==="--run")input={mode:"run",operationId:randomUUID(),deadlineAt:new Date(now()+40000).toISOString()};
 else if(args.length===2&&args[0]==="--inspect"&&/^[0-9a-f-]{36}$/i.test(args[1]))input={mode:"inspect",operationId:args[1]};
 else throw Error("PRIVACY_OPERATOR_ARGUMENTS_INVALID");
 // Print this identifier before the request so a lost response can be inspected later.
 const observation={operationId:input.operationId,mode:input.mode};
 try{
  const r=await fetchFn(origin+"/internal/privacy/source-worker",{method:"POST",redirect:"error",signal:AbortSignal.timeout(50000),
   headers:{"content-type":"application/json",authorization:"Bearer "+secret},body:JSON.stringify(input)});
  if(!r.ok)throw Error();const text=await r.text();if(Buffer.byteLength(text)>2048)throw Error();
  const body=JSON.parse(text);
  if(body.operationId!==input.operationId||!["idle","reserved","held","completed","unknown","not_observed"].includes(body.status))throw Error();
  return {...observation,status:body.status,
   ...(body.result==="deleted"||body.result==="no_customer_data"?{result:body.result}:{}),
   ...(["disclosure_required","review_required"].includes(body.reason)?{reason:body.reason}:{})};
 }catch{return {...observation,status:"unknown",rollbackProven:false};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 // The identifier is generated within the caller and retained even on a failed HTTP response.
 try{console.log(JSON.stringify(await callCustomerSourceWorker()));}
 catch{console.error("PRIVACY_OPERATOR_STOPPED");process.exitCode=1;}
}
