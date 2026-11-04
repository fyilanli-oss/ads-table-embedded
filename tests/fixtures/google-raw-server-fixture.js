import {randomBytes,randomUUID,createHash} from "node:crypto";
import {googleAcceptanceFixture} from "./google-acceptance-fixture.js";
import {sourceStoreFixture} from "./source-store-fixture.js";
import {createTokenEnvelopeCipher,readProviderTokenKeyring} from "../../app/lib/oauth/token-envelope.server.js";

export function googleRawServerFixture(){
 const f=googleAcceptanceFixture(),key=()=>randomBytes(32).toString("base64url"),hooks={},calls=[];
 for(const vector of [f.budget.global,...f.budget.providers.map(x=>x.limit),...f.budget.workspaces.map(x=>x.limit),...f.budget.accounts.map(x=>x.limit)])vector.dbWrites=4096;
 const environment={...f.options.environment,ADSTABLE_GOOGLE_RAW_CAPTURE_ENABLED:"true",
  ADSTABLE_RUNTIME_DATABASE_URL:"postgresql://adstable_runtime.podpwkrpmjiksskxhwsu:"+"r".repeat(32)+"@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require",
  ADSTABLE_SOURCE_EVIDENCE_ACTIVE_KEY_VERSION:"1",ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1:key(),
  ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:key(),ADSTABLE_SESSION_ENCRYPTION_KEY_V1:key(),
  GOOGLE_ADS_OAUTH_CLIENT_ID:"SYNTHETIC-CLIENT",GOOGLE_ADS_OAUTH_CLIENT_SECRET:"SYNTHETIC-SECRET",
  GOOGLE_ADS_OAUTH_REDIRECT_URI:"https://embedded.adstable.app/auth/google-ads/callback"};
 const plan={target:f.plan,limits:{maxBytes:1000000,maxElapsedMs:60000,maxPages:1,maxRows:100,maxLinkPages:1,maxLinks:100},
  storageLimits:{maxRows:1000,maxBytes:1000000},sourcePolicy:sourceStoreFixture().input.policy};
 const setPlan=()=>{environment.ADSTABLE_GOOGLE_RAW_CAPTURE_PLAN=JSON.stringify(plan);};setPlan();
 const cipher=createTokenEnvelopeCipher({keyring:readProviderTokenKeyring(environment)});
 let credential=f.plan.credentialId,token=f.f.token,receipt=null,storedBody=null;
 const seal=()=>cipher.seal({identity:{recordId:credential,workspaceId:f.plan.workspaceId,installGeneration:3,provider:"google_ads",purpose:"provider_token_set"},secret:JSON.stringify(token)});
 let sealed=seal();
 const pool=f.options.readerPoolFactory,base=pool().connect();
 async function sourceQuery(sql,args){
  const custom=await hooks.source?.(sql,args);if(custom)return custom;
  if(sql.includes("commit_google_identity_source")){
   storedBody=JSON.parse(args[3]);receipt={status:"committed",batchId:"91",commitId:randomUUID(),
    digest:createHash("sha256").update(args[3]).digest("hex"),sourceState:"complete",
    manifest:{counts:Object.fromEntries(["pages","references","rules","mappings","orders","lines","journeys","claims","links"].map(k=>[k,storedBody[k].length]))}};
   return {rows:[{result:receipt}]};
  }
  if(sql.includes("read_source_receipt"))return {rows:[{result:receipt}]};
  const r=await (await base).query(sql,args);
  if(sql.includes("load_provider_identity_authority")){
   if(args[2]!=="google_ads"||args[3]!==f.plan.shopId||args[4]!==f.plan.shopDomain)throw Error("Identity SQL scope required");
   r.rows[0].credential_id=credential;r.rows[0].connection_version=f.authority.connectionVersion;}
  return r;
 }
 const readerPoolFactory=()=>{const p=pool();return {...p,async connect(){const c=await p.connect();return {...c,query:async(sql,args)=>{
  calls.push({role:"source",sql,args});return sourceQuery(sql,args);
 }};}};};
 const runtimePoolFactory=options=>{if("statement_timeout" in options)throw Error("No session startup timeout in transaction pooler");return {async end(){calls.push({role:"runtime",sql:"end"});},async connect(){return {release(){},async query(sql,args){
  calls.push({role:"runtime",sql,args});const custom=await hooks.runtime?.(sql,args);if(custom)return custom;
  if(["begin","commit","rollback"].includes(sql)||sql.startsWith("select pg_catalog.set_config"))return {rows:[]};
  if(sql.includes("load_active_installation_owner"))return {rows:[{installation_id:"42",workspace_id:f.plan.workspaceId,install_generation:3,
   shop_id:f.plan.shopId,shop_domain:f.plan.shopDomain,installation_status:"active"}]};
  if(sql.includes("token_vault_runtime_guard"))return {rows:[{contract_version:1,used_key_versions:[1]}]};
  if(sql.includes("load_provider_credential_envelope"))return {rows:[{record_id:credential,workspace_id:f.plan.workspaceId,
   install_generation:3,provider:"google_ads",payload_ciphertext:sealed.ciphertext,nonce:sealed.nonce,auth_tag:sealed.authTag,key_version:1,expires_at:token.expires_at}]};
  if(sql.includes("commit_google_refresh_renewal")){
   credential=args[6];sealed={ciphertext:args[9],nonce:args[10],authTag:args[11]};
   f.authority.connectionVersion++;f.source.connectionVersion++;
   return {rows:[{renewal_id:args[0],connection_id:f.plan.connectionId,lifecycle_status:"connected",connection_version:f.authority.connectionVersion,credential_id:credential}]};
  }
  if(sql.includes("load_provider_identity_authority"))return sourceQuery(sql,args);
  throw Error("Unexpected runtime query");
 }}}};};
 const fetchFn=async(url,init)=>{
  const u=new URL(url),custom=await hooks.fetch?.(u,init);if(custom)return custom;
  if(u.hostname==="oauth2.googleapis.com"){f.http.push(u);return Response.json({access_token:"SYNTHETIC-NEW",expires_in:3600,token_type:"Bearer",scope:f.f.token.scope});}
  return f.options.fetchFn(url,init);
 };
 const options={environment,operationId:f.plan.operationId,runtimePoolFactory,readerPoolFactory,
  coordinatorPoolFactory:f.options.coordinatorPoolFactory,fetchFn,now:f.options.now};
 return {f,plan,environment,hooks,calls,options,setPlan,get body(){return storedBody;},expire(){token.scope_verified_at=new Date(options.now()-3600001).toISOString();token.expires_at=new Date(options.now()-1).toISOString();sealed=seal();}};
}
