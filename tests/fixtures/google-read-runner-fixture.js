import {GOOGLE_SOURCE_ROLE,GOOGLE_SOURCE_ROLE_CHECK_SQL} from "../../app/lib/database/google-source-postgres.server.js";
import {oauthPermissionScopes} from "../../app/lib/oauth/oauth-permission-profile.server.js";

export function googleReadRunnerFixture(){
 const workspace="11111111-1111-4111-8111-111111111111",connection="22222222-2222-4222-8222-222222222222";
 const now=Date.now(),scopes=oauthPermissionScopes("google_ads","identity_v1"),sqlCalls=[],httpCalls=[],hooks={};
 const state={contextMissing:false,profile:true,version:2,wait:false,closed:0};
 const context={provider:"google_ads",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:1,
  accountId:"123",organizationId:null,apiVersion:"v25",merchant:{targetAccountId:"99",quotaAccountId:"98",apiVersion:"products/v1",bindingEpoch:1}};
 const token={access_token:"SYNTHETIC-ACCESS",refresh_token:"SYNTHETIC-REFRESH",permission_profile:"identity_v1",scope:scopes.join(" "),
  scope_verified_at:new Date(now).toISOString(),expires_in:3600,expires_at:new Date(now+3600000).toISOString()};
 const options={environment:{GOOGLE_ADS_DEVELOPER_TOKEN:"SYNTHETIC-DEVELOPER",ADSTABLE_GOOGLE_SOURCE_DB_TIMEOUT_MS:"1000",
  ADSTABLE_GOOGLE_SOURCE_DATABASE_URL:"postgresql://adstable_google_source_runner.podpwkrpmjiksskxhwsu:"+"x".repeat(32)+"@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require"},
  verified:{installationAuthority:{authority:"shopify_installation_verified",status:"active",workspaceId:workspace,installGeneration:3},
   identity:{session:{authority:"shopify_id_token_verified",shopDomain:"test.myshopify.com"},shop:{authority:"shopify_admin_verified",shopId:"gid://shopify/Shop/12",myshopifyDomain:"test.myshopify.com"}},
   context:{admin:{graphql(){throw Error("Shopify HTTP forbidden in native observation");}}}},
  execution:{claim:{workspaceId:workspace,installGeneration:"3",provider:"google_ads",accountId:"123",id:"job1",fence:2},
   window:{from:"2026-11-01",to:"2026-11-01"},entitlementReceipt:{observedAt:new Date(now).toISOString()}},
  configuration:{merchantId:"99",limits:{maxBytes:100000,maxElapsedMs:5000,maxPages:3,maxRows:10,maxLinkPages:3,maxLinks:10}},
  tokenVault:{loadProviderTokenSet:async()=>token},now:()=>now,
  poolFactory:()=>({on(){},async end(){state.closed++;},async connect(){return {release(){},async query(sql,args){
   sqlCalls.push({sql,args});await hooks.sql?.(sql,args);
   if(sql===GOOGLE_SOURCE_ROLE_CHECK_SQL)return {rows:[{role:GOOGLE_SOURCE_ROLE,profile_ready:state.profile}]};
   if(["begin","commit","rollback"].includes(sql)||sql.startsWith("select pg_catalog.set_config"))return {rows:[]};
   if(sql.includes("load_provider_identity_authority"))return {rows:[{installation_id:"42",workspace_id:workspace,install_generation:3,installation_status:"active",shop_id:"gid://shopify/Shop/12",shop_domain:"test.myshopify.com",
    connection_id:connection,credential_id:"33333333-3333-4333-8333-333333333333",connection_version:state.version,lifecycle_status:"connected",granted_scopes:scopes,reporting_account_id:"123",reporting_selection_epoch:"71",
    accounts:[{id:"123",kind:"advertiser",status:"active",reporting_eligible:true,login_account_id:"456"}]}]};
   if(sql.includes("load_refresh_quota_context"))return {rows:[{result:state.contextMissing?null:context}]};
   if(sql.includes("resolve_shared_api_quota_route"))return {rows:[{result:args[0]}]};
   if(sql.includes("reserve_shared_api_quota"))return {rows:[{result:state.wait?{status:"waiting"}:{status:"reserved",operationKey:args[0],attemptId:args[1],dispatchBeforeMs:now+10000,dispatchBudgetMs:10000}}]};
   if(/settle_shared_api_quota|record_shared_api_quota_feedback|stop_shared_api_quota/.test(sql))return {rows:[{result:true}]};
   throw Error("Unexpected SQL");
  }};}}),
  fetchFn:async(input,init)=>{
   const url=new URL(input);httpCalls.push(url);const custom=await hooks.fetch?.(url,init,httpCalls.length);if(custom)return custom;
   if(url.hostname==="googleads.googleapis.com")return Response.json({results:[{productLink:{resourceName:"customers/123/productLinks/7",productLinkId:"7",type:"MERCHANT_CENTER",merchantCenter:{merchantCenterId:"99"}}}]});
   if(url.hostname==="merchantapi.googleapis.com")return Response.json({products:[]});
   throw Error("Unexpected HTTP");
  }};
 return {options,state,context,token,hooks,sqlCalls,httpCalls};
}
