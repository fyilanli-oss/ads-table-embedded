import {resolveReadOnlyShopifyRouteAuthority} from "../shopify/shopify-route-authority.server.js";
import {createGoogleAcceptanceExecution,readGoogleAcceptancePlan} from "./google-acceptance-server.server.js";

export const GOOGLE_ACCEPTANCE_HEADER="x-adstable-google-acceptance";
export async function handleGoogleAcceptanceRequest({request,authenticateAdmin,database,tokenVault,environment=process.env,
 coordinatorPoolFactory,readerPoolFactory,fetchFn=globalThis.fetch,now=Date.now}){
 const env={...environment};
 const json=(value,status)=>new Response(JSON.stringify(value),{status,headers:{"cache-control":"no-store","content-type":"application/json; charset=utf-8"}});
 const rejected=(reason,status=400)=>json({status:"stopped",reason,recordCount:null,empty:null,provider_retry_performed:false},status);
 let plan;
 try{plan=readGoogleAcceptancePlan(env,now());}catch{return rejected("configuration_missing",503);}
 if(!plan)return rejected("not_enabled",503);
 if(request.method!=="POST"||request.headers.get(GOOGLE_ACCEPTANCE_HEADER)!=="v1"
  ||!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return rejected("request_contract_invalid");
 let input;
 try{
  const reader=request.body?.getReader();if(!reader)throw Error();const chunks=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1024){await reader.cancel();throw Error();}chunks.push(part.value);}}
  finally{reader.releaseLock();}
  input=JSON.parse(Buffer.concat(chunks).toString("utf8"));
 }catch{return rejected("request_contract_invalid");}
 if(!input||Object.keys(input).sort().join()!=="mode,operationId"||input.mode!=="step15_google_zero_acceptance"
  ||input.operationId!==plan.operationId)return rejected("request_contract_invalid");
 // Accept only the existing authenticated Shopify resolver result. No caller,
 // account or job object from the HTTP body can enter the internal execution.
 const verified=await resolveReadOnlyShopifyRouteAuthority({request,database,authenticateAdmin:async req=>{
  const context=await authenticateAdmin(req);
  return {...context,admin:{...context.admin,graphql:(query,options)=>context.admin.graphql(query,{...options,tries:1})}};
 }});
 let execution;
 try{
  execution=createGoogleAcceptanceExecution({environment:env,verified,database,tokenVault,operationId:input.operationId,
   coordinatorPoolFactory,readerPoolFactory,fetchFn,now,signal:request.signal});
  const result=await execution.run();return json(result,result.status==="observed"?200:409);
 }catch{return rejected("execution_unavailable",503);}
}
