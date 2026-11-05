import {googleReadRunnerFixture} from "./google-read-runner-fixture.js";
import {GOOGLE_ACCEPTANCE_COORDINATOR_ROLE,GOOGLE_ACCEPTANCE_COORDINATOR_ROLE_CHECK_SQL} from "../../app/lib/database/google-acceptance-coordinator-postgres.server.js";
export function googleAcceptanceFixture(){
 const f=googleReadRunnerFixture(),now=f.options.now(),owner=f.options.verified.installationAuthority;
 const plan={operationId:"44444444-4444-4444-8444-444444444444",workspaceId:owner.workspaceId,installGeneration:"3",
  shopId:"gid://shopify/Shop/12",shopDomain:"test.myshopify.com",accountId:"123",connectionId:"22222222-2222-4222-8222-222222222222",
  connectionVersion:2,credentialId:"33333333-3333-4333-8333-333333333333",selectionId:"71",merchantId:"99",merchantQuotaAccountId:"98",
  merchantBindingEpoch:1,window:{from:"2026-11-01",to:"2026-11-01"},expiresAt:new Date(now+600000).toISOString()};
 // Synthetic connection belongs to the selected report day, independent of the host calendar.
 const source={workspaceId:plan.workspaceId,installGeneration:"3",provider:"google_ads",accountId:"123",connectionId:plan.connectionId,
  connectionVersion:2,selectionId:"71",accountRowId:"72",eligibleFromMs:Date.parse(plan.window.from+"T01:00:00Z"),timezone:"UTC",currency:"USD",
  scheduledHour:Math.floor(now/3600000)*3600000-3600000,queuedAt:now-3600000};
 const vector={requests:100,dbWrites:1000,connections:10,rows:10000,bytes:10000000};
 const budget={global:vector,interactiveReserve:{requests:0,dbWrites:0,connections:0,rows:0,bytes:0},
  providers:[{provider:"google_ads",limit:vector}],workspaces:[{workspaceId:plan.workspaceId,limit:vector}],accounts:[{provider:"google_ads",accountId:"123",limit:vector}]};
 const state={configured:true,profile:true,phase:null,claims:[],revision:0,nextFence:1,nextTurn:1,lastServed:[],ids:new Set(),paused:0,closed:0,admissions:0,entitled:false,stops:0};
 const calls=[],http=[],hooks={};
 const authority={workspaceId:plan.workspaceId,installGeneration:"3",provider:"google_ads",accountId:"123",connectionId:plan.connectionId,
  connectionVersion:2,installationVerified:true,connected:true,setupComplete:true,allowedWindow:true};
 const environment={...f.options.environment,ADSTABLE_GOOGLE_ACCEPTANCE_ENABLED:"true",ADSTABLE_GOOGLE_ACCEPTANCE_PLAN:JSON.stringify(plan),
  ADSTABLE_GOOGLE_ACCEPTANCE_COORDINATOR_DATABASE_URL:"postgresql://adstable_refresh_coordinator.podpwkrpmjiksskxhwsu:"+"z".repeat(32)+"@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require",
  ADSTABLE_GOOGLE_ACCEPTANCE_COORDINATOR_DB_TIMEOUT_MS:"1000",SHOPIFY_PARTNER_ORG_ID:"10",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"SYNTHETIC-PARTNER"};
 const result=value=>({rows:[{result:value}]});
 const coordinatorPoolFactory=()=>({on(){},async end(){state.closed++;},async connect(){return {release(){},async query(sql,args){
  calls.push({sql,args});const custom=await hooks.sql?.(sql,args);if(custom)return custom;
  if(sql===GOOGLE_ACCEPTANCE_COORDINATOR_ROLE_CHECK_SQL)return {rows:[{role:GOOGLE_ACCEPTANCE_COORDINATOR_ROLE,profile_ready:state.profile}]};
  if(["begin","commit","rollback"].includes(sql)||sql.startsWith("select pg_catalog.set_config"))return {rows:[]};
  if(sql.includes("read_refresh_preflight_snapshot"))return result({configured:state.configured,candidates:[structuredClone(source)],queueRevision:1,budget,
   bounds:{maxCandidates:4,maxClaims:4,maxAdmissions:1,maxWorkspaces:4},state:{revision:state.revision,nextFence:state.nextFence,nextTurn:state.nextTurn,lastServed:state.lastServed,claims:state.claims}});
  if(sql.includes("commit_refresh_preflight_with_deadline")){
   const s=JSON.parse(args[2]),claim=s.claims.at(-1);if(state.ids.has(claim.id)||args[0]!==state.revision)return result(false);
   state.ids.add(claim.id);Object.assign(state,{revision:s.revision,nextFence:s.nextFence,nextTurn:s.nextTurn,lastServed:s.lastServed,claims:s.claims});state.admissions++;
   if(state.lostAdmission)throw Error("PRIVATE-LOST-COMMIT");return result(true);
  }
  if(sql.includes("load_refresh_bound_authority"))return result(authority);
  if(sql.includes("advance_refresh_work_stage")){if(args[6]!==state.phase)return result(false);state.phase=args[7];return result(true);}
  if(sql.includes("load_refresh_entitlement_installation"))return result({workspaceId:plan.workspaceId,installGeneration:3,status:"active",shopId:plan.shopId,shopDomain:plan.shopDomain,observedAt:new Date(now).toISOString()});
  if(sql.includes("apply_refresh_entitlement_snapshot")){state.entitled=true;return result(JSON.parse(args[6]));}
  if(sql.includes("refresh_entitlement_is_current"))return result(state.entitled);
  if(sql.includes("refresh_claim_is_current"))return result(state.claims.length===1);
  if(sql.includes("load_refresh_quota_context"))return result(args[8]==="google_ads"?f.context:{provider:"shopify_partner",clientScopeKey:"c".repeat(64),connectionScopeKey:"d".repeat(64),connectionEpoch:1,accountId:null,organizationId:"10",apiVersion:"2026-07"});
  if(sql.includes("resolve_shared_api_quota_route"))return result(args[0]);
  if(sql.includes("reserve_shared_api_quota"))return result({status:"reserved",operationKey:args[0],attemptId:args[1],dispatchBeforeMs:now+10000,dispatchBudgetMs:10000});
  if(/settle_shared_api_quota|record_shared_api_quota_feedback|stop_shared_api_quota/.test(sql))return result(true);
  if(sql.includes("read_refresh_admission_snapshot"))return result({state:{revision:state.revision},budget,bounds:{maxCandidates:4,maxClaims:4,maxAdmissions:1,maxWorkspaces:4}});
  if(sql.includes("record_refresh_work_stop")){state.stops++;return result({recorded:true});}
  if(sql.includes("finish_refresh_work")){if(state.phase!=="response_received"||args[6]!=="paused")return result(false);state.paused++;state.claims=[];return result(true);}
  throw Error("Unexpected coordinator SQL");
 }};}});
 const runtimeClient=f.options.poolFactory().connect();
 const database={async query(sql,args){
  if(sql.includes("resolve_active_installation"))return {rows:[{workspace_id:plan.workspaceId,install_generation:3,installation_status:"active"}]};
  return (await runtimeClient).query(sql,args);
 }};
 const fetchFn=async(url,init)=>{
  const u=new URL(url);http.push(u);const custom=await hooks.fetch?.(u,init);if(custom)return custom;
  if(u.hostname==="partners.shopify.com")return Response.json({data:{activeSubscription:{shop:{id:plan.shopId,myshopifyDomain:plan.shopDomain},billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:false,trialEndsAt:null,
   currentBillingCycle:{startTime:new Date(now-86400000).toISOString(),endTime:new Date(now+86400000).toISOString()},items:[{handle:"monthly",price:{active:true}}],pendingUpdate:null}}});
  return f.options.fetchFn(url,init);
 };
 const options={environment,verified:f.options.verified,database,tokenVault:f.options.tokenVault,operationId:plan.operationId,
  coordinatorPoolFactory,readerPoolFactory:f.options.poolFactory,fetchFn,now:f.options.now};
 return {f,plan,source,state,authority,budget,calls,http,hooks,options,setPlan(){environment.ADSTABLE_GOOGLE_ACCEPTANCE_PLAN=JSON.stringify(plan);}};
}
