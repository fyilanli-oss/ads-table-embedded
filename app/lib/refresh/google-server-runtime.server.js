import pg from "pg";
import {createRuntimePostgresClient} from "../database/runtime-postgres.server.js";

// Existing runtime role only. Transaction-local limits work through the shared
// transaction pooler; a lost acknowledgement permanently stops this client.
export function createGoogleServerRuntime({environment,poolFactory=options=>new pg.Pool(options)}) {
 return createRuntimePostgresClient({environment,poolFactory:options=>{
  const pool=poolFactory({...options,query_timeout:5000});let stopped=false,busy=false;
  pool.on?.("error",()=>{stopped=true;});
  return {async query({text,values}){
   if(stopped||busy)throw Error("GOOGLE_SERVER_RUNTIME_DATABASE_UNAVAILABLE");
   busy=true;let client,broken=false;
   try{
    client=await pool.connect();await client.query("begin");
    await client.query("select pg_catalog.set_config('statement_timeout',$1,true),pg_catalog.set_config('lock_timeout',$1,true)",["5000ms"]);
    const result=await client.query(text,values);await client.query("commit");return result;
   }catch{stopped=true;broken=true;if(client){try{await client.query("rollback");}catch{}}throw Error("GOOGLE_SERVER_RUNTIME_DATABASE_UNAVAILABLE");}
   finally{busy=false;client?.release(broken);}
  },end:()=>pool.end()};
 }});
}
