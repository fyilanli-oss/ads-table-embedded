import {sourceRuleProbe} from "./eo05-source-rule-probe.mjs";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {verifiedMappingFixture} from "../tests/fixtures/verified-mapping-fixture.js";
import {createVerifiedMappingRepository} from "../app/lib/database/verified-mapping-store.server.js";
import {sourcePayloadHash} from "../app/lib/database/source-evidence-store.server.js";
// Actual private SQL with synthetic reviewed rule and source/Shopify proof. No
// production registration, native acceptance, HTTP or runtime grant is performed.
export async function verifiedMappingProbe(client,{args,cipher}){
 assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
 await client.query("savepoint verified_mapping_fixture");
 try{
  const owner=JSON.parse(args[0]),read=JSON.parse(args[4]),provider=owner.provider;
  const f=verifiedMappingFixture(provider,{owner,cipher,context:provider==="google_ads"?{data_source:"accounts/99/dataSources/888"}:provider==="meta"?{catalog_id:read.target.catalogId,product_feed_id:"888"}:{metric_id:read.sourceContext.metricId}});
  const original=(await client.query("select manifest,request_digest,commit_id from evidence.source_batches where workspace_id=$1 and attempt_id=$2 and batch_ordinal=0",[owner.workspaceId,args[1]])).rows[0];
  // Synthetic landing fixture plus the genuine already-admitted test job context.
  // This is not a native capture or a reviewed-rule registration API.
  const sourceAttempt=randomUUID(),body={sourceState:"complete",policy:JSON.parse(args[3]).policy,pages:[],references:[],rules:[],mappings:[],orders:[],lines:[],journeys:[],claims:[],links:[]};
  const entries=f.entries.filter(x=>x.target==="mapping");
  for(const [i,entry]of entries.entries()){
   const key="s"+i,metadata={key,family:entry.family,ordinal:i,origin:provider,captureLayer:provider==="klaviyo"&&entry.role==="native_product_observation"?"native_response_projection":"collector_projection",numericFidelity:"decoded_only",fieldCoverage:["records"],schemaVersion:entry.schema,sanitizerVersion:"synthetic-v1"};
   body.pages.push(cipher.seal({owner,attemptId:sourceAttempt,ordinal:0,page:metadata,payload:{records:[entry.row]}}));
   body.references.push({key,page:key,locatorKind:"row",locator:"/records/0",nativeType:entry.role,nativeId:null,state:"present",hash:sourcePayloadHash(entry.row)});
   body.links.push({reference:key,targetType:"mapping",target:"m0",role:entry.role});
  }
  const baseline=f.snapshot().mapping;
  body.mappings.push({key:"m0",rule:null,identity:JSON.parse(baseline.identityKey),revision:"1",nativeId:baseline.nativeId,context:baseline.context,productId:null,variantId:null,state:"unresolved",verifiedAt:null,applicability:{state:"synthetic_fixture"}});
  const captured=(await client.query("select evidence.commit_source_batch($1::jsonb,$2::uuid,0,$3::jsonb) as result",[args[0],sourceAttempt,JSON.stringify(body)])).rows[0].result;
  const mappingId=captured.manifest.ids["mapping:m0"],readKey=provider==="google_ads"?"googleRead":provider==="meta"?"metaRead":"klaviyoRead";
  await client.query("update evidence.source_batches set manifest=manifest||jsonb_build_object($1::text,$2::jsonb) where id=$3",[readKey,args[4],captured.batchId]);
  const ruleReceipt=await sourceRuleProbe(client,{owner,mappingId,cipher,policy:f.policy,
   proposal:{ruleKey:f.rule.ruleKey,previousRuleId:null,basis:f.rule.basis,from:f.rule.applicability.from,until:f.rule.applicability.until,maxObservationAgeMs:f.rule.applicability.maxObservationAgeMs}});
  const ruleId=ruleReceipt.manifest.ids["rule:reviewed"],input={owner,mappingId,ruleId};
  for(const mode of ["success","lost","replay","CAS","expired","partial","withdrawn","new_rule","conflicting","wrong_owner","missing_rule","account","connection_version","disconnect","scopes","crypto","hash","late_failure","skip_finalize"]){
   await client.query("savepoint verified_mapping_case");
   try{
    let lastWrite;
    const database={async query(sql,values){if(!sql.includes("commit_verified_mapping"))return client.query(sql,values);lastWrite=values;const result=await client.query(sql,values);if(mode==="lost")throw Error("synthetic lost mapping reply");return result;}};
    const repository=createVerifiedMappingRepository({database,cipher});
    if(mode==="connection_version")await client.query("update integrations.provider_connections set connection_version=connection_version+1 where id=$1",[owner.connectionId]);
    if(mode==="disconnect")await client.query("update integrations.provider_connections set lifecycle_status='disconnect_pending' where id=$1",[owner.connectionId]);
    if(mode==="scopes")await client.query("update integrations.provider_connections set granted_scopes=granted_scopes[1:1] where id=$1",[owner.connectionId]);
    if(mode==="expired")await client.query("update evidence.source_pages set retain_until=clock_timestamp()-interval '1 second' where id=(select page_id from evidence.source_references where id=(select source_reference_id from evidence.source_reference_links where mapping_id=$1 and role='candidate_check' limit 1))",[mappingId]);
    if(mode==="partial")await client.query("update evidence.source_batches set source_state='partial' where id=(select accepted_batch_id from identity.product_identity_mappings where id=$1)",[mappingId]);
    if(mode==="withdrawn")await client.query("update identity.source_rule_versions set review_status='withdrawn' where id=$1",[ruleId]);
    if(mode==="new_rule")await client.query("insert into identity.source_rule_versions(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,accepted_batch_id,rule_key,version,supersedes_id,rule_kind,native_context,parser_version,review_status,documented_basis,applicability) select workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,accepted_batch_id,rule_key,version+1,id,rule_kind,native_context,parser_version,'withdrawn',documented_basis,applicability from identity.source_rule_versions where id=$1",[ruleId]);
    if(mode==="conflicting")await client.query("update identity.product_identity_mappings set mapping_state='conflicting' where id=$1",[mappingId]);
    if(mode==="crypto")await client.query("update evidence.source_pages set auth_tag=decode(repeat('00',16),'hex') where id=(select page_id from evidence.source_references where id=(select source_reference_id from evidence.source_reference_links where mapping_id=$1 and role='candidate_check' limit 1))",[mappingId]);
    if(mode==="hash")await client.query("update evidence.source_references set record_hash=repeat('0',64) where id=(select source_reference_id from evidence.source_reference_links where mapping_id=$1 and role='candidate_check' limit 1)",[mappingId]);
    if(["expired","partial","withdrawn","new_rule","conflicting","wrong_owner","missing_rule","account","connection_version","disconnect","scopes","crypto","hash"].includes(mode)){
     const request=mode==="wrong_owner"?{...input,owner:{...owner,generation:String(BigInt(owner.generation)+1n)}}:mode==="missing_rule"?{...input,ruleId:"999999999"}:mode==="account"?{...input,owner:{...owner,accountId:"other-account"}}:input;
     await assert.rejects(repository.review(request));
     continue;
    }
    const review=await repository.review(input),prepared=repository.prepare(review,{policy:f.policy,deadlineAt:new Date(Date.now()+20000).toISOString()});
    if(mode==="CAS")await client.query("update identity.source_rule_versions set applicability=applicability||jsonb_build_object('changed',true) where id=$1",[ruleId]);
    if(["late_failure","skip_finalize"].includes(mode)){
     await client.query("create function pg_temp.mapping_late_failure() returns trigger language plpgsql as $vf$begin if new.manifest->>'kind'='mapping_verification_v1' then "+(mode==="skip_finalize"?"return null;":"raise exception 'SYNTHETIC_MAPPING_FAILURE';")+"end if;return new;end$vf$");
     await client.query("create trigger mapping_late_failure before update on evidence.source_batches for each row execute function pg_temp.mapping_late_failure()");
    }
    if(["CAS","late_failure","skip_finalize"].includes(mode)){
     await client.query("savepoint rejected_mapping_write");await assert.rejects(repository.commit(prepared),/WRITE_UNCONFIRMED/);await client.query("rollback to savepoint rejected_mapping_write");
     assert.equal((await client.query("select count(*)::int n from identity.product_identity_mappings where workspace_id=$1 and mapping_state='verified'",[owner.workspaceId])).rows[0].n,0);continue;
    }
    let receipt;
    if(mode==="lost"){
     await assert.rejects(repository.commit(prepared),/WRITE_UNCONFIRMED/);await assert.rejects(repository.commit(prepared),/PREPARED_WRITE_REQUIRED/);
     receipt=await repository.inspect({owner,operationId:prepared.operationId});assert.equal(receipt.historical,true);assert.equal(receipt.currentMappingVerified,false);
    }else receipt=await repository.commit(prepared);
    const accepted=receipt.manifest.ids["mapping:accepted"],identity=JSON.parse(baseline.identityKey),current=await repository.readCurrent({owner,identity});
    assert.equal(current.mappingId,accepted);
    assert.equal(current.productId,"gid://shopify/Product/123");assert.equal(current.variantId,"gid://shopify/ProductVariant/456");assert.equal(current.revision,"2");assert.equal(current.reportNamespaceVerified,false);
    if(mode==="replay"){
     const again=(await client.query("select identity.commit_verified_mapping($1::jsonb,$2::uuid,$3::jsonb) as result",lastWrite)).rows[0].result;assert.equal(again.commitId,receipt.commitId);
     await client.query("savepoint conflicting_mapping_operation");const changed=JSON.parse(lastWrite[2]);changed.productId="gid://shopify/Product/999";
     await assert.rejects(client.query("select identity.commit_verified_mapping($1::jsonb,$2::uuid,$3::jsonb)",[lastWrite[0],lastWrite[1],JSON.stringify(changed)]),/MAPPING_OPERATION_CONFLICT/);await client.query("rollback to savepoint conflicting_mapping_operation");
    }
    assert.deepEqual((await client.query("select manifest,request_digest,commit_id from evidence.source_batches where workspace_id=$1 and attempt_id=$2 and batch_ordinal=0",[owner.workspaceId,args[1]])).rows[0],original);
    const old=(await client.query("select mapping_state,shopify_product_id from identity.product_identity_mappings where id=$1",[mappingId])).rows[0];assert.equal(old.mapping_state,"unresolved");assert.equal(old.shopify_product_id,null);
    const next=(await client.query("select supersedes_id::text,accepted_batch_id::text from identity.product_identity_mappings where id=$1",[accepted])).rows[0];assert.equal(next.supersedes_id,mappingId);
    assert.equal((await client.query("select handoff_state from evidence.source_batches where id=$1",[next.accepted_batch_id])).rows[0].handoff_state,"pending");
    await client.query("set constraints all immediate");await client.query("set constraints all deferred");
    // A later conflicted source version blocks use of an older accepted version.
    await client.query("insert into identity.product_identity_mappings(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,accepted_batch_id,supersedes_id,identity_key_version,identity_key_canonical,identity_hash,revision,native_product_id,native_context,mapping_state,applicability) select workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,accepted_batch_id,$2::bigint,identity_key_version,identity_key_canonical,identity_hash,3,native_product_id,native_context,'conflicting',applicability from identity.product_identity_mappings where id=$1",[mappingId,accepted]);
    await assert.rejects(repository.readCurrent({owner,identity}),/MAPPING_NOT_VERIFIED/);
   }finally{await client.query("rollback to savepoint verified_mapping_case");await client.query("release savepoint verified_mapping_case");}
  }
  for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
   for(const signature of ["identity.mapping_review_state(jsonb,bigint,bigint,boolean)","identity.commit_verified_mapping(jsonb,uuid,jsonb)","identity.lookup_verified_mapping(jsonb,jsonb)"])
    assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,signature])).rows[0].ok,false);
  console.log("EO05_VERIFIED_MAPPING_SQL_PASS provider="+provider+" native_and_rule_proof_synthetic=true real_SQL_CAS_version_read_expiry_crypto_FK_rollback_lost_ack=true no_runtime_grants=true no_checkpoint=true");
 }finally{await client.query("rollback to savepoint verified_mapping_fixture");await client.query("release savepoint verified_mapping_fixture");}
}
