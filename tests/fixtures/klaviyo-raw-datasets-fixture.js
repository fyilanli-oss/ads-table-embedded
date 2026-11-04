import {randomBytes,randomUUID,createHash} from "node:crypto";
import {googleAcceptanceFixture} from "./google-acceptance-fixture.js";
import {sourceStoreFixture} from "./source-store-fixture.js";
import {createTokenEnvelopeCipher,readProviderTokenKeyring} from "../../app/lib/oauth/token-envelope.server.js";
import {KLAVIYO_SOURCE_ROLE_CHECK_SQL} from "../../app/lib/database/klaviyo-source-postgres.server.js";
export function klaviyoRawDatasetsFixture(){
 const f=googleAcceptanceFixture(),key=()=>randomBytes(32).toString("base64url"),hooks={},writes=[],calls=[],receipts=new Map();let pageId=0;
 const {merchantId,merchantQuotaAccountId,merchantBindingEpoch,...target}=f.plan;target.accountId="klaviyo_a";target.selectionId=null;
 Object.assign(f.source,{provider:"klaviyo",accountId:target.accountId,selectionId:null});Object.assign(f.authority,{provider:"klaviyo",accountId:target.accountId});
 f.budget.providers[0].provider="klaviyo";Object.assign(f.budget.accounts[0],{provider:"klaviyo",accountId:target.accountId});
 for(const v of [f.budget.global,...f.budget.providers.map(x=>x.limit),...f.budget.workspaces.map(x=>x.limit),...f.budget.accounts.map(x=>x.limit)])v.dbWrites=10000;
 let clock=f.options.now();const now=()=>clock,scopes=["accounts:read","campaigns:read","events:read","flows:read","metrics:read"];
 const context={provider:"klaviyo",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:1,accountId:target.accountId,organizationId:null,apiVersion:"2026-10-15"};
 const environment={...f.options.environment,ADSTABLE_KLAVIYO_RAW_CAPTURE_ENABLED:"true",KLAVIYO_APP_ID:"12345",KLAVIYO_APP_SECRET:"SYNTHETIC-APP-SECRET",
  ADSTABLE_RUNTIME_DATABASE_URL:"postgresql://adstable_runtime.podpwkrpmjiksskxhwsu:"+"r".repeat(32)+"@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require",
  ADSTABLE_KLAVIYO_SOURCE_DATABASE_URL:"postgresql://adstable_klaviyo_source_runner.podpwkrpmjiksskxhwsu:"+"s".repeat(32)+"@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require",ADSTABLE_KLAVIYO_SOURCE_DB_TIMEOUT_MS:"1000",
  ADSTABLE_SOURCE_EVIDENCE_ACTIVE_KEY_VERSION:"1",ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1:key(),ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:key(),ADSTABLE_SESSION_ENCRYPTION_KEY_V1:key()};
 const plan={version:1,target,limits:{maxBytes:1048576,maxElapsedMs:120000,maxPages:2,maxRows:100,maxRequests:15},storageLimits:{maxRows:1000,maxBytes:1048576},sourcePolicy:sourceStoreFixture().input.policy};
 const setPlan=()=>{environment.ADSTABLE_KLAVIYO_RAW_CAPTURE_PLAN=JSON.stringify(plan);};setPlan();
 const token={access_token:"SYNTHETIC-KLAVIYO-TOKEN",scopes,expires_at:new Date(now()+3600000).toISOString()};
 const cipher=createTokenEnvelopeCipher({keyring:readProviderTokenKeyring(environment)});let sealed=cipher.seal({identity:{recordId:target.credentialId,workspaceId:target.workspaceId,installGeneration:3,provider:"klaviyo",purpose:"provider_token_set"},secret:JSON.stringify(token)});
 const result=v=>({rows:[{result:v}]});
 const identity=()=>({installation_id:"42",workspace_id:target.workspaceId,install_generation:3,installation_status:"active",shop_id:target.shopId,shop_domain:target.shopDomain,
  connection_id:target.connectionId,credential_id:target.credentialId,connection_version:f.authority.connectionVersion,lifecycle_status:"connected",granted_scopes:scopes,
  accounts:[{id:target.accountId,kind:"account",reporting_eligible:true,status:"active",login_account_id:null}],reporting_account_id:null,reporting_selection_epoch:target.selectionId});
 f.hooks.sql=(sql,args)=>sql.includes("load_refresh_quota_context")&&args[8]==="klaviyo"?result(context):undefined;
 async function query(sql,args,role){calls.push({sql,args,role});const custom=await hooks[role]?.(sql,args);if(custom)return custom;
  if(["begin","commit","rollback"].includes(sql)||sql.startsWith("select pg_catalog.set_config"))return {rows:[]};
  if(sql===KLAVIYO_SOURCE_ROLE_CHECK_SQL)return {rows:[{role:"adstable_klaviyo_source_runner",profile_ready:true}]};
  if(sql.includes("load_provider_identity_authority"))return {rows:[identity()]};
  if(sql.includes("load_active_installation_owner"))return {rows:[identity()]};
  if(sql.includes("token_vault_runtime_guard"))return {rows:[{contract_version:1,used_key_versions:[1]}]};
  if(sql.includes("load_provider_credential_envelope"))return {rows:[{record_id:target.credentialId,workspace_id:target.workspaceId,install_generation:3,provider:"klaviyo",payload_ciphertext:sealed.ciphertext,nonce:sealed.nonce,auth_tag:sealed.authTag,key_version:1,expires_at:token.expires_at}]};
  if(sql.includes("load_refresh_quota_context"))return result(context);
  if(sql.includes("resolve_shared_api_quota_route"))return result(args[0]);
  if(sql.includes("reserve_shared_api_quota"))return result({status:"reserved",operationKey:args[0],attemptId:args[1],dispatchBeforeMs:now()+10000,dispatchBudgetMs:10000});
  if(/settle_shared_api_quota|record_shared_api_quota_feedback|stop_shared_api_quota/.test(sql))return result(true);
  if(sql.includes("commit_klaviyo_dataset_source")){
   const body=JSON.parse(args[3]),read=JSON.parse(args[4]),receipt={status:"committed",batchId:String(91+writes.length),commitId:randomUUID(),digest:createHash("sha256").update(args[3]).digest("hex"),sourceState:body.sourceState,
    manifest:{counts:Object.fromEntries(["pages","references","rules","mappings","orders","lines","journeys","claims","links"].map(k=>[k,body[k].length])),
     klaviyoRawEligibility:{kind:"klaviyo_raw_native_business_day_v1",businessDate:read.window.from,timezone:f.source.timezone,eligibleFromMs:f.source.eligibleFromMs,
      nativeDayStartMs:Date.parse(read.window.from+"T00:00:00Z"),includesPreConnectionHours:Date.parse(read.window.from+"T00:00:00Z")<f.source.eligibleFromMs,authorizesReportingDataset:false}}};
   const w={body,read,receipt,owner:JSON.parse(args[0]),attemptId:args[1],pages:body.pages.map(p=>({...p,id:String(++pageId),available:true,expired:false,retentionPruned:false}))};writes.push(w);receipts.set(args[1],w);return result(receipt);
  }
  if(sql.includes("read_source_receipt"))return result(receipts.get(args[1])?.receipt);
  if(sql.includes("read_source_pages"))return result(receipts.get(args[1])?.pages.filter(p=>BigInt(p.id)>BigInt(args[3])).slice(0,args[4])??[]);
  throw Error("Unexpected synthetic SQL");
 }
 const pool=role=>()=>({on(){},async end(){},async connect(){return {release(){},query:(s,a)=>query(s,a,role)};}});
 const fetchFn=async(url,init)=>{const u=new URL(url),custom=await hooks.fetch?.(u,init);if(custom){f.http.push(u);return custom;}
  if(u.hostname==="a.klaviyo.com"){f.http.push(u);
   if(u.pathname==="/api/accounts/")return Response.json({data:[{type:"account",id:target.accountId,attributes:{timezone:"UTC",preferred_currency:"USD"}}]});
   if(u.pathname==="/api/metrics")return Response.json({data:["Placed Order","Added to Cart","Checkout Started","Ordered Product"].map((name,i)=>({type:"metric",id:"metric"+i,attributes:{name,integration:{name:"Shopify"}}})),links:{next:null}});
   if(u.pathname.includes("values-reports"))return Response.json({data:{type:u.pathname.includes("campaign")?"campaign-values-report":"flow-values-report",attributes:{results:[]}},links:{next:null}});
   return Response.json({data:[],links:{next:null}});
  }
  return f.options.fetchFn(url,init);
 };
 const coordinatorPoolFactory=options=>{const p=f.options.coordinatorPoolFactory(options);return {...p,async connect(){const c=await p.connect();return {...c,async query(sql,args){
  const custom=await hooks.coordinator?.(sql,args);if(custom)return custom;
  if(sql.includes("commit_klaviyo_raw_preflight_with_deadline")){calls.push({role:"coordinator",sql,args});return c.query(sql.replace("commit_klaviyo_raw_preflight_with_deadline","commit_refresh_preflight_with_deadline").replace("$6::uuid","$6::text"),[...args.slice(0,5),"klaviyo-raw-capture:"+args[5],args[6]]);}
  return c.query(sql,args);
 }};}};};
 return {setToken:patch=>{Object.assign(token,patch);sealed=cipher.seal({identity:{recordId:target.credentialId,workspaceId:target.workspaceId,installGeneration:3,provider:"klaviyo",purpose:"provider_token_set"},secret:JSON.stringify(token)});},advance:ms=>{clock+=ms;},f,environment,plan,hooks,writes,calls,context,setPlan,options:{environment,operationId:target.operationId,now,delay:async ms=>{clock+=ms;},fetchFn,runtimePoolFactory:pool("runtime"),readerPoolFactory:pool("source"),coordinatorPoolFactory}};
}
