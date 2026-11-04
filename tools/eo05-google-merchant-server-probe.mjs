import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {createTokenEnvelopeCipher,readProviderTokenKeyring} from "../app/lib/oauth/token-envelope.server.js";
import {createGoogleMerchantServerExecution} from "../app/lib/refresh/google-merchant-server.server.js";
import {handleGoogleMerchantServerRequest} from "../app/lib/refresh/google-merchant-request.server.js";
import {GOOGLE_MERCHANT_LINK_QUERY} from "../app/lib/providers/google-merchant-account-link.server.js";

// Existing disposable F01 databases only. No live credentials, grants or HTTP.
export async function googleMerchantServerRehearsal(client,{workspace,shopId,shopDomain}) {
 assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
 await client.query("begin");
 try{
  await client.query("set local role postgres");
  await client.query("grant adstable_runtime,adstable_refresh_coordinator to adstable_owner with inherit false,set true,admin false");
  await client.query("set local role adstable_owner");let ordinal=0;
  for(const mode of ["linked","empty","expired_token","permission","partial","wrong_role","lost_renewal","authority_drift"]){
   await client.query("savepoint merchant_case");
   try{
    const issued=Date.now(),scopes=oauthPermissionScopes("google_ads","identity_v1");
    await client.query("update integrations.provider_connections set granted_scopes=$2 where workspace_id=$1 and provider='google_ads'",[workspace,scopes]);
    const row=(await client.query("select * from integrations.load_provider_identity_authority($1,1,'google_ads',$2,$3)",[workspace,shopId,shopDomain])).rows[0];assert.ok(row);
    const environment={VERCEL_ENV:"production",SHOPIFY_APP_URL:"https://embedded.adstable.app",ADSTABLE_GOOGLE_RAW_CAPTURE_SERVER_SECRET:randomBytes(32).toString("base64url"),
     ADSTABLE_RUNTIME_DATABASE_URL:`postgresql://adstable_runtime.podpwkrpmjiksskxhwsu:${"x".repeat(32)}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require`,
     ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:randomBytes(32).toString("base64url"),
     GOOGLE_ADS_DEVELOPER_TOKEN:"SYNTHETIC-DEVELOPER",GOOGLE_ADS_OAUTH_CLIENT_ID:"SYNTHETIC-CLIENT",GOOGLE_ADS_OAUTH_CLIENT_SECRET:"SYNTHETIC-SECRET",
     GOOGLE_ADS_OAUTH_REDIRECT_URI:"https://embedded.adstable.app/auth/google-ads/callback"};
    for(const {v}of(await client.query("select distinct key_version v from integrations.provider_credential_envelopes union select distinct key_version v from integrations.oauth_pkce_envelopes")).rows)
     if(Number(v)!==1)environment[`ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V${v}`]=randomBytes(32).toString("base64url");
    const expired=["expired_token","lost_renewal"].includes(mode),token={access_token:"SYNTHETIC-ACCESS",refresh_token:"SYNTHETIC-REFRESH",permission_profile:"identity_v1",scope:scopes.join(" "),
     scope_verified_at:new Date(issued-(expired?3600001:0)).toISOString(),expires_in:3600,expires_at:new Date(issued+(expired?-1:3600000)).toISOString()};
    const sealed=createTokenEnvelopeCipher({keyring:readProviderTokenKeyring(environment)}).seal({identity:{recordId:row.credential_id,workspaceId:workspace,installGeneration:1,provider:"google_ads",purpose:"provider_token_set"},secret:JSON.stringify(token)});
    await client.query("update integrations.provider_credential_envelopes set payload_ciphertext=$2,nonce=$3,auth_tag=$4,key_version=$5 where id=$1",[row.credential_id,sealed.ciphertext,sealed.nonce,sealed.authTag,sealed.keyVersion]);
    const plan={operationId:randomUUID(),workspaceId:workspace,installGeneration:"1",shopId,shopDomain,connectionId:row.connection_id,connectionVersion:Number(row.connection_version),credentialId:row.credential_id,
     selectionId:row.reporting_selection_epoch,accountId:row.reporting_account_id,expiresAt:new Date(issued+600000).toISOString()};
    environment.ADSTABLE_GOOGLE_MERCHANT_DISCOVERY_PLAN=JSON.stringify(plan);
    const counts=async()=>(await client.query("select (select count(*) from evidence.source_batches)::int batches,(select count(*) from operations.refresh_runs)::int jobs")).rows[0];
    const before=await counts();let googleCalls=0,tokenCalls=0;
    const runtimePoolFactory=()=>({on(){},async end(){},async connect(){const name="merchant_rpc_"+(++ordinal);let committed=false,lastSql="";
     return {release(){},async query(sql,args){
      if(sql==="begin")return client.query("savepoint "+name);
      if(sql==="commit"){await client.query("set local role adstable_owner");await client.query("release savepoint "+name);committed=true;
       if(mode==="lost_renewal"&&lastSql.includes("commit_google_identity_renewal"))throw Error("SYNTHETIC-LOST");return {rows:[]};}
      if(sql==="rollback"){if(!committed){await client.query("rollback to savepoint "+name);await client.query("release savepoint "+name);}await client.query("set local role adstable_owner");return {rows:[]};}
      if(sql.startsWith("select pg_catalog.set_config"))return client.query(sql,args);
      await client.query("set local role "+(mode==="wrong_role"?"adstable_refresh_coordinator":"adstable_runtime"));
      lastSql=sql;const r=await client.query(sql,args);await client.query("set local role adstable_owner");return r;
     }};
    }});
    const fetchFn=async(endpoint,init)=>{
     const u=new URL(endpoint);assert.equal(init.method,"POST");
     if(u.hostname==="oauth2.googleapis.com"){tokenCalls++;assert.equal(tokenCalls,1);return Response.json({access_token:"SYNTHETIC-NEW",expires_in:3600,token_type:"Bearer",scope:scopes.join(" ")});}
     assert.equal(u.hostname,"googleads.googleapis.com");assert.equal(u.pathname,`/v25/customers/${plan.accountId}/googleAds:search`);assert.equal(init.body,JSON.stringify({query:GOOGLE_MERCHANT_LINK_QUERY}));
     googleCalls++;assert.equal(googleCalls,1);
     if(mode==="permission")return Response.json({error:{code:403,status:"PERMISSION_DENIED",message:"SYNTHETIC-PRIVATE"}},{status:403});
     if(mode==="authority_drift")await client.query("update integrations.provider_connections set connection_version=connection_version+1 where id=$1",[plan.connectionId]);
     return Response.json({results:mode==="empty"?[]:[{productLink:{resourceName:`customers/${plan.accountId}/productLinks/7`,productLinkId:"7",type:"MERCHANT_CENTER",merchantCenter:{merchantCenterId:"99"}}}],...mode==="partial"?{nextPageToken:"more"}:{}});
    };
    const request=new Request("https://embedded.adstable.app/internal/google/merchant-links",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${environment.ADSTABLE_GOOGLE_RAW_CAPTURE_SERVER_SECRET}`},body:JSON.stringify({operationId:plan.operationId})});
    const response=await handleGoogleMerchantServerRequest(request,{environment,createExecution:args=>createGoogleMerchantServerExecution({...args,runtimePoolFactory,fetchFn})}),result=await response.json();
    if(["linked","empty","expired_token"].includes(mode)){
     assert.equal(response.status,200,JSON.stringify({mode,result}));assert.equal(result.complete,true);assert.deepEqual(result.merchant_ids,mode==="empty"?[]:["99"]);
     assert.equal(googleCalls,1);assert.equal(tokenCalls,mode==="expired_token"?1:0);assert.equal(result.credential_renewed,mode==="expired_token");
    }else{
     assert.notEqual(response.status,200);assert.equal(result.complete,false);assert.equal(result.merchant_ids,null);assert.equal(result.link_count,null);
     assert.equal(googleCalls,["wrong_role","lost_renewal"].includes(mode)?0:1);
     if(mode==="lost_renewal")assert.equal((await client.query("select count(*)::int n from integrations.provider_connection_lifecycle_events where event_id=$1",[plan.operationId])).rows[0].n,1);
    }
    assert.deepEqual(await counts(),before);assert.equal(result.product_read_performed,false);assert.equal(result.authorizes_activation,false);
    assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC|payload|ciphertext|access_token|credentialId/);
   }catch(e){console.error("EO05_GOOGLE_MERCHANT_SERVER_CASE_STOP",JSON.stringify({mode,code:e.code??"ASSERTION_FAILED",message:e.code==="ERR_ASSERTION"?e.message:undefined}));throw e;}
   finally{await client.query("rollback to savepoint merchant_case");await client.query("release savepoint merchant_case");}
  }
  console.log("EO05_GOOGLE_MERCHANT_SERVER_SQL_PASS scenarios=8 actual_runtime_vault_and_background_owner=true browser_free_HTTP=true renewal_once=true unknown_no_followup=true no_jobs_or_source_writes=true native_HTTP=synthetic live_changes=false");
 }finally{await client.query("rollback");}
}
