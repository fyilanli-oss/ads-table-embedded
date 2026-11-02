import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createRefreshGoogleIdentityReader} from "../app/lib/refresh/quota-authority-binding.server.js";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";
import {createSourceEvidenceRepository} from "../app/lib/database/source-evidence-store.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";

// Existing F01 rollback-only fixture: real SQL/authority/quota/REST clients,
// synthetic token and physical HTTP only. No native account or data mutation.
export async function googleSourceCaptureProbe(client,{store,execution,quotaStore,connection}){
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const {workspaceId,installGeneration,accountId}=execution.claim;
  const installation=(await client.query("select id::text,shop_id,shop_domain from shopify.installations where workspace_id=$1 and install_generation=$2 and status='active'",[workspaceId,installGeneration])).rows[0];
  const verified={installationAuthority:{authority:"shopify_installation_verified",status:"active",workspaceId,installGeneration:Number(installGeneration)},
    identity:{session:{authority:"shopify_id_token_verified",shopDomain:installation.shop_domain},shop:{authority:"shopify_admin_verified",shopId:installation.shop_id,myshopifyDomain:installation.shop_domain}},
    context:{admin:{graphql(){throw Error("Admin not used by native-only source fixture");}}}};
  async function routes(){
    const ctx=await store.loadQuotaContext({...execution,provider:"google_ads"});assert.ok(ctx?.merchant);
    for(const [family,account,version] of [["reporting_query",accountId,ctx.apiVersion],["merchant_products","99","products/v1"]]){
      const r=quotaRouteIdentity(ctx,{provider:"google_ads",family,accountId:account,organizationId:null,version,includes:[]}),policy=randomUUID();
      await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,'google_ads') on conflict do nothing",[ctx.connectionScopeKey]);
      await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled,route_required) values($1,'google_ads',true,true) on conflict do nothing",[r.routeKey]);
      await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'google_ads',60000,1000000,0,5000,1000)",[policy]);
      await client.query("insert into operations.api_quota_bindings(operation_key,policy_id,units) values($1,$2,1)",[r.routeKey,policy]);
      await client.query("update operations.api_quota_policies set max_units=1000000,interactive_reserve=0 where id in(select policy_id from operations.api_quota_bindings where operation_key=$1)",[r.routeKey]);
      await client.query("insert into operations.api_quota_failure_bindings(operation_key,domain_id) values($1,$2) on conflict do nothing",[r.routeKey,ctx.connectionScopeKey]);
      await client.query("insert into operations.api_quota_route_profiles(operation_key,domain_id,quota_fingerprint,enabled) select $1,$2,operations.shared_api_quota_fingerprint($1),true on conflict(operation_key) do update set quota_fingerprint=excluded.quota_fingerprint,enabled=true",[r.routeKey,ctx.connectionScopeKey]);
      await client.query("insert into operations.api_quota_routes(route_key,operation_key,enabled) values($1,$1,true) on conflict(route_key) do update set enabled=true",[r.routeKey]);
    }
  }
  async function scenario(mode){
    await client.query("savepoint google_source_case");
    try{
      // This historical parent fixture intentionally uses v24. Source collection
      // uses the current REST client's v25; align only this rollback-only fixture.
      await client.query("update operations.refresh_quota_contexts set api_version='v25',connection_epoch=connection_epoch+1,merchant_binding_epoch=merchant_binding_epoch+1 where workspace_id=$1 and provider='google_ads'",[workspaceId]);
      const {input}=sourceStoreFixture();let nativeCalls=0,writeCalls=0,lastArgs,sqlCode;
      if(mode==="late_failure"){
        await client.query("create function pg_temp.reject_google_mapping() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_GOOGLE_MAPPING_FAILURE';end$$");
        await client.query("create trigger reject_google_mapping before insert on identity.product_identity_mappings for each row execute function pg_temp.reject_google_mapping()");
      }
      const db={async query(sql,args){
        if(!sql.includes("evidence.commit_google_identity_source"))return client.query(sql,args);
        writeCalls++;lastArgs=args;
        if(mode==="fence")await client.query("update operations.refresh_runs set fence=fence+1000 where workspace_id=$1 and provider='google_ads' and job_id=$2",[workspaceId,execution.claim.id]);
        if(mode==="disconnect")await client.query("update integrations.provider_connections set lifecycle_status='disconnect_pending' where id=$1",[connection]);
        if(mode==="context")await client.query("update operations.refresh_quota_contexts set merchant_binding_epoch=merchant_binding_epoch+1 where workspace_id=$1 and provider='google_ads'",[workspaceId]);
        if(mode==="expired"){const r=JSON.parse(args[4]);r.deadlineAt=new Date(Date.now()-1000).toISOString();args=[...args.slice(0,4),JSON.stringify(r)];}
        await client.query("savepoint google_source_rpc");let result;
        try{result=await client.query(sql,args);await client.query("release savepoint google_source_rpc");}
        catch(error){sqlCode=error.code;await client.query("rollback to savepoint google_source_rpc");await client.query("release savepoint google_source_rpc");throw error;}
        if(mode==="lost")throw Error("synthetic lost source acknowledgement");return result;
      }};
      async function read(){
        await routes();
        const row=(await client.query("select credential_id,granted_scopes from integrations.provider_connections where id=$1",[connection])).rows[0],issued=Date.now();
        const token={access_token:"SYNTHETIC-ONLY",refresh_token:"SYNTHETIC-ONLY",permission_profile:"identity_v1",scope:row.granted_scopes.join(" "),
          scope_verified_at:new Date(issued).toISOString(),expires_in:3600,expires_at:new Date(issued+3600000).toISOString()};
        const reader=createRefreshGoogleIdentityReader({verified,database:db,tokenVault:{loadProviderTokenSet:async()=>token},merchantId:"99",developerToken:"SYNTHETIC-ONLY",
          ...execution,workStore:store,quotaStore,now:Date.now,readNow:()=>new Date(),sourceStorage:{cipher:input.cipher,policy:input.policy,limits:{maxRows:1000,maxBytes:1000000}},
          fetchFn:async endpoint=>{
            nativeCalls++;const u=new URL(endpoint);
            if(u.hostname==="googleads.googleapis.com")return Response.json({results:[{productLink:{resourceName:`customers/${accountId}/productLinks/7`,productLinkId:"7",type:"MERCHANT_CENTER",merchantCenter:{merchantCenterId:"99"}}}]});
            if(mode==="native_failure")return Response.json({error:{message:"SYNTHETIC-PRIVATE"}},{status:500});
            return Response.json({products:mode==="empty"?[]:[{name:"accounts/99/products/en~US~shopify_US_123_456",offerId:"shopify_US_123_456",feedLabel:"US",contentLanguage:"en",dataSource:"accounts/99/dataSources/7"}]});
          }});
        let outcome,error;try{outcome=await reader.readEvidence();}catch(e){error=e;}
        await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);return {outcome,error};
      }
      const first=await read(),successful=["success","empty","reuse","new_version"].includes(mode);
      if(successful){
        assert.ok(first.outcome,JSON.stringify({mode,sqlCode,error:first.error?.message}));assert.equal(first.outcome.sourceStored,true);
        assert.equal(first.outcome.persistable,false);assert.equal(first.outcome.authorizes_activation,false);assert.equal(first.outcome.mapping_write_performed,false);
        const receipt=first.outcome.sourceReceipt;assert.equal(receipt.manifest.counts.mappings,mode==="empty"?0:1);
        const same=(await client.query("select evidence.commit_google_identity_source($1::jsonb,$2::uuid,$3::integer,$4::jsonb,$5::jsonb) as result",lastArgs)).rows[0].result;
        assert.equal(same.commitId,receipt.commitId);
        const sourceOwner=JSON.parse(lastArgs[0]),repo=createSourceEvidenceRepository(client);
        const pages=await repo.readPages({owner:sourceOwner,attemptId:lastArgs[1],ordinal:0,limit:100});assert.equal(pages.length,3);
        for(const page of pages){const payload=input.cipher.open({owner:sourceOwner,attemptId:lastArgs[1],ordinal:0,page});assert.ok(Array.isArray(payload.records));}
        if(mode!=="empty"){
          const m=(await client.query("select * from identity.product_identity_mappings where id=$1",[receipt.manifest.ids["mapping:m0"]])).rows[0];
          assert.equal(m.mapping_state,"unresolved");assert.equal(m.shopify_product_id,null);assert.equal(m.source_rule_version_id,null);
        }
        if(["reuse","new_version"].includes(mode)){
          if(mode==="new_version"){
            await client.query("update integrations.provider_connections set connection_version=connection_version+1 where id=$1",[connection]);
            await client.query("update operations.refresh_quota_contexts set connection_version=connection_version+1,connection_epoch=connection_epoch+1,merchant_binding_epoch=merchant_binding_epoch+1 where workspace_id=$1 and provider='google_ads'",[workspaceId]);
            await client.query("update operations.refresh_work_bindings set source=operations.refresh_preflight_source(workspace_id,install_generation,provider,account_id) where workspace_id=$1 and provider='google_ads'",[workspaceId]);
          }
          const next=await read();assert.ok(next.outcome,JSON.stringify({mode,sqlCode,error:next.error?.message}));
          const id=next.outcome.sourceReceipt.manifest.ids["mapping:m0"];
          if(mode==="reuse")assert.equal(id,receipt.manifest.ids["mapping:m0"]);
          else{const m=(await client.query("select revision::text,supersedes_id::text from identity.product_identity_mappings where id=$1",[id])).rows[0];assert.equal(m.revision,"2");assert.equal(m.supersedes_id,receipt.manifest.ids["mapping:m0"]);}
        }
      }else{
        assert.ok(first.error);assert.equal(writeCalls,mode==="native_failure"?0:1);
        const rows=(await client.query("select * from evidence.source_batches where workspace_id=$1 and installation_id=$2",[workspaceId,installation.id])).rows;
        if(mode==="lost"){
          assert.equal(rows.length,1);assert.equal(first.error.message,"SOURCE_STORE_WRITE_UNCONFIRMED");
          const historical=await createSourceEvidenceRepository(client).inspect({owner:JSON.parse(lastArgs[0]),attemptId:lastArgs[1],ordinal:0});assert.equal(historical.status,"committed");
        }else assert.equal(rows.length,0,JSON.stringify({mode,sqlCode,error:first.error.message}));
      }
      assert.equal(nativeCalls,mode==="native_failure"?2:["reuse","new_version"].includes(mode)?6:3);
      const state=(await client.query("select status from operations.refresh_runs where workspace_id=$1 and provider='google_ads' and job_id=$2",[workspaceId,execution.claim.id])).rows[0];assert.equal(state.status,"running");
    }finally{await client.query("rollback to savepoint google_source_case");await client.query("release savepoint google_source_case");}
  }
  for(const mode of ["success","empty","reuse","new_version","lost","fence","disconnect","context","expired","late_failure","native_failure"])await scenario(mode);
  for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
    assert.equal((await client.query("select has_function_privilege($1,'evidence.commit_google_identity_source(jsonb,uuid,integer,jsonb,jsonb)','EXECUTE') ok",[role])).rows[0].ok,false);
  console.log("EO05_GOOGLE_SOURCE_CAPTURE_PASS real_SQL_quota_REST_synthetic_HTTP=true encrypted_page_readback=true unresolved_not_verified=true durable_revision_and_supersedes=true stale_fence_context_disconnect_expiry_denied=true late_failure_rollback=true lost_ack_explicit_readback=true no_runtime_grants=true no_checkpoint=true");
}
