import {abstractFetch} from "@shopify/shopify-api/runtime";
import {createGoogleSourceMappingFlow} from "./google-source-mapping-flow.server.js";
import {isShopifyAdminIdentitySdkBridge} from "./shopify-admin-sdk-quota-bridge.server.js";
import {createGoogleSourcePostgresClient,readGoogleSourceDatabaseConfig} from "../database/google-source-postgres.server.js";
import {createConfiguredSourceEvidenceCipher,readSourceStoragePolicy} from "../database/source-evidence-config.server.js";
import {createRefreshWorkRepository} from "../database/refresh-work-repository.server.js";
import {createSharedQuotaRepository} from "../database/shared-quota-repository.server.js";

const fail=()=>{throw Error("GOOGLE_SOURCE_SERVER_CONFIGURATION_REQUIRED");};
// Explicit trusted-server entry only. No route, scheduler, SDK global setter,
// admission bypass, reviewer default, secret provisioning or role installation.
export function createGoogleSourceServerExecution({environment,verified,tokenVault,sdkBridge,execution,configuration,
 reviewAuthority,signal,now=Date.now,poolFactory,fetchFn=globalThis.fetch}={}) {
 if(typeof now!=="function"||typeof fetchFn!=="function"||typeof reviewAuthority!=="function"
  ||typeof tokenVault?.loadProviderTokenSet!=="function"||!isShopifyAdminIdentitySdkBridge(sdkBridge)||abstractFetch!==sdkBridge.fetch)fail();
 let config,scope,time;try{config=structuredClone(configuration);scope=structuredClone(execution);time=now();}catch{fail();}
 if(!config||Object.keys(config).sort().join()!=="limits,merchantId,plan,sourcePolicy,sourceRules"
  ||!scope||Object.keys(scope).sort().join()!=="claim,entitlementReceipt,window"||scope.claim?.provider!=="google_ads"
  ||config.plan?.identity?.accountId!==scope.claim.accountId||config.plan?.identity?.context?.merchant_id!==config.merchantId
  ||!Array.isArray(config.sourceRules)||!config.sourceRules.length||config.sourceRules.length>1000
  ||!config.limits||Object.keys(config.limits).sort().join()!=="maxBytes,maxElapsedMs,maxLinkPages,maxLinks,maxPages,maxRows"
  ||Object.values(config.limits).some(v=>!Number.isSafeInteger(v)||v<1)
  ||config.limits.maxBytes>16777216||config.limits.maxElapsedMs>120000
  ||["maxRows","maxPages","maxLinks","maxLinkPages"].some(k=>config.limits[k]>1000))fail();
 let env;try{env={...environment};}catch{fail();}const developerToken=env.GOOGLE_ADS_DEVELOPER_TOKEN;
 if(typeof developerToken!=="string"||!developerToken||developerToken.length>256||/[\u0000-\u0020\u007f]/.test(developerToken))fail();
 readGoogleSourceDatabaseConfig(env);
 const cipher=createConfiguredSourceEvidenceCipher(env),policy=readSourceStoragePolicy(config.sourcePolicy,time);
 const mainDatabase=createGoogleSourcePostgresClient({environment:env,poolFactory});
 let inspectionDatabase=null,used=false,running=false,inspecting=false,closed=false;
 const database=Object.freeze({query:(sql,args)=>(inspectionDatabase??mainDatabase).query(sql,args)});
 let flow;
 try{
  flow=createGoogleSourceMappingFlow({plan:config.plan,reviewAuthority,now,readerOptions:{verified,database,
   tokenVault:Object.freeze({loadProviderTokenSet:tokenVault.loadProviderTokenSet.bind(tokenVault)}),sdkBridge,
   ...scope,workStore:createRefreshWorkRepository(database),quotaStore:createSharedQuotaRepository(database),
   merchantId:config.merchantId,developerToken,sourceRules:config.sourceRules,signal,now,readNow:()=>new Date(now()),fetchFn,
   maxElapsedMs:config.limits.maxElapsedMs,maxPages:config.limits.maxPages,maxRows:config.limits.maxRows,
   maxLinkPages:config.limits.maxLinkPages,maxLinks:config.limits.maxLinks,
   sourceStorage:{cipher,policy,limits:{maxRows:config.limits.maxRows,maxBytes:config.limits.maxBytes}}}});
 }catch{void mainDatabase.close().catch(()=>{});fail();}
 return Object.freeze({
  async run(){if(used||closed||inspecting)throw Error("GOOGLE_SOURCE_SERVER_EXECUTION_USED");used=true;running=true;
   try{return await flow.run();}finally{running=false;}},
  async inspect(which){
   if(!used||closed||running||inspecting||!["source","rule","mapping"].includes(which))throw Error("GOOGLE_SOURCE_SERVER_INSPECTION_UNAVAILABLE");
   inspecting=true;
   try{
    // Fresh read-only transport is explicit after a stopped flow, including lost
    // write acknowledgement. It cannot retry writes or reset the run capability.
    inspectionDatabase=createGoogleSourcePostgresClient({environment:env,poolFactory,inspectionOnly:true});
    return await flow.inspect(which);
   }finally{const inspected=inspectionDatabase;inspectionDatabase=null;inspecting=false;if(inspected)await inspected.close();}
  },
  async close(){if(running||inspecting)throw Error("GOOGLE_SOURCE_SERVER_BUSY");closed=true;await mainDatabase.close();},
 });
}
