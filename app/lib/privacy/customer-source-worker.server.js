import {createPrivacySourcePostgresClient,PRIVACY_SOURCE_RPC} from "../database/privacy-source-postgres.server.js";
import {createConfiguredSourceEvidenceCipher} from "../database/source-evidence-config.server.js";
import {createPrivacyLifecycleRuntime} from "../shopify/privacy-lifecycle.server.js";
import {readCustomerSourcePrivateRequest} from "./customer-source-private-request.server.js";
const [reserve,snapshot,complete,hold,inspect]=PRIVACY_SOURCE_RPC.map(x=>x[0]);
const response=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
// No request can select a customer, workspace, kind, source or disclosure receipt.
export async function handleCustomerSourceWorkerRequest(request,{
 environment=process.env,now=Date.now,
 databaseFactory=options=>createPrivacySourcePostgresClient(options),
 cipherFactory=createConfiguredSourceEvidenceCipher
}={}) {
 const gate=await readCustomerSourcePrivateRequest(request,{environment,now});
 if(!gate.ok)return response({status:"rejected",reason:gate.reason},gate.status);
 const {input,environment:env}=gate;let database,body,failed=false,completionSent=false;
 const unknown=()=>({operationId:input.operationId,status:"unknown",rollbackProven:false});
 const current=()=>!request.signal.aborted&&(input.mode==="inspect"||now()<Date.parse(input.deadlineAt));
 try {
  // Validate encryption before reserving work. No new key is generated.
  const cipher=input.mode==="run"?cipherFactory(env):null;
  database=databaseFactory({environment:env,inspectionOnly:input.mode==="inspect"});
  const query=async(sql,args)=>{
   if(!current())throw Error("PRIVACY_DEADLINE");
   try{return await database.query(sql,args);}catch{failed=true;throw Error("PRIVACY_DATABASE_UNCONFIRMED");}
  };
  if(input.mode==="inspect"){
   const result=(await query(inspect,[input.operationId])).rows?.[0]?.result;
   body=safeObservation(result,input.operationId);
  }else {
   const reserved=(await query(reserve,[input.operationId,input.deadlineAt])).rows?.[0]?.result;
   if(reserved?.status==="idle")body={operationId:input.operationId,status:"idle"};
   else if(reserved?.status==="recorded")body=safeObservation(reserved.observation,input.operationId);
   else if(reserved?.status==="reserved"&&["customer_redact","customer_data_request"].includes(reserved.kind)
     &&typeof reserved.runId==="string"){
    const adapter={async query(sql,args){
     if(args?.[0]!==reserved.runId)throw Error("PRIVACY_SCOPE_INVALID");
     if(sql==="select privacy.customer_source_run_kind($1::uuid) as kind")return {rows:[{kind:reserved.kind}]};
     if(sql==="select privacy.customer_source_snapshot($1::uuid) as result")return query(snapshot,[input.operationId]);
     if(sql==="select privacy.complete_customer_source_run($1::uuid,$2::text,$3::jsonb,$4::text) as result"&&args.length===4&&args[3]===null){
      completionSent=true;return query(complete,[input.operationId,args[1],args[2]]);
     }
     throw Error("PRIVACY_QUERY_DENIED");
    }};
    try {
     const done=await createPrivacyLifecycleRuntime({database:adapter,sourcePrivacy:{cipher}}).executeDeletionRun(reserved.runId);
     body=safeObservation({operationId:input.operationId,status:done.status,receipt:{manifestId:done.manifestId,result:done.result}},input.operationId);
    }catch(error){
     if(failed||completionSent||!current())throw error;
     const reason=error.message==="SOURCE_PRIVACY_DISCLOSURE_RECEIPT_REQUIRED"?"disclosure_required":
       /^SOURCE_PRIVACY_/.test(error.message)?"review_required":null;
     if(!reason)throw error;
     body=safeObservation((await query(hold,[input.operationId,reason])).rows?.[0]?.result,input.operationId);
    }
   }else throw Error("PRIVACY_RESERVATION_INVALID");
  }
 }catch{body=unknown();}
 finally{if(database)try{await database.close();}catch{body=unknown();}}
 return response(body,body.status==="unknown"?202:200);
}
// Reconstruct a tiny metadata-only response; never forward DB/native/artifact objects.
function safeObservation(value,operationId){
 if(value?.operationId!==operationId||!["idle","reserved","held","completed","unknown","not_observed"].includes(value.status))throw Error("PRIVACY_RECEIPT_INVALID");
 const out={operationId,status:value.status};
 if(value.status==="not_observed"||value.status==="unknown")out.rollbackProven=false;
 if(value.status==="held"){
  if(!["disclosure_required","review_required"].includes(value.receipt?.reason))throw Error("PRIVACY_RECEIPT_INVALID");
  out.reason=value.receipt.reason;
 }
 if(value.status==="completed"){
  if(!["deleted","no_customer_data"].includes(value.receipt?.result)
   ||typeof value.receipt?.manifestId!=="string"||!/^[0-9a-f-]{36}$/i.test(value.receipt.manifestId))throw Error("PRIVACY_RECEIPT_INVALID");
  out.result=value.receipt.result;out.manifestId=value.receipt.manifestId;
 }
 return out;
}
