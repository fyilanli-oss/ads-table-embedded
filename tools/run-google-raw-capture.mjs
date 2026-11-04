import {createGoogleRawCaptureExecution} from "../app/lib/refresh/google-raw-server.server.js";

// Dedicated server/operator process. Never paste this into a browser console.
// No env pull, secret generation, configuration mutation, scheduler or retry.
const args=process.argv.slice(2);
const controller=new AbortController(),abort=()=>controller.abort();
process.once("SIGTERM",abort);process.once("SIGINT",abort);
let execution,result;
try{
 if(args.length!==2||args[0]!=="--operation-id"||!/^[0-9a-f-]{36}$/i.test(args[1]))throw Error();
 execution=createGoogleRawCaptureExecution({environment:process.env,operationId:args[1],signal:controller.signal});
 result=await execution.run();
}catch{result={status:"stopped",reason:"configuration_or_execution_unavailable",sourceStored:null,recordCount:null,empty:null};}
finally{process.removeListener("SIGTERM",abort);process.removeListener("SIGINT",abort);
 try{await execution?.close();}catch{result={status:"unconfirmed",reason:"close_unconfirmed",sourceStored:result?.sourceStored??null,recordCount:null,empty:null};}}
process.stdout.write(JSON.stringify(result)+"\n");
process.exitCode=result.status==="stored"?0:1;
