import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createSourceRuleRepository} from "../app/lib/database/source-rule-store.server.js";

// Synthetic explicit reviewer; never installed in production composition.
export async function sourceRuleProbe(client,{owner,mappingId,proposal,policy,cipher}){
 assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
 const input={owner,mappingId,proposal};let lastWrite;
 const authority=async r=>({status:"approved",decisionId:randomUUID(),snapshotHash:r.snapshotHash,proposalHash:r.proposalHash,validUntil:r.expiresAt});
 function repository(mode){return createSourceRuleRepository({cipher,reviewAuthority:mode==="denied"?async()=>({status:"denied"}):authority,
  database:{async query(sql,values){if(!sql.includes("commit_reviewed_source_rule"))return client.query(sql,values);
   lastWrite=values;const r=await client.query(sql,values);if(mode==="lost")throw Error("synthetic lost rule reply");return r;}}});}
 const prepare=async r=>r.prepare(await r.review(input),{policy,deadlineAt:new Date(Date.now()+20000).toISOString()});
 for(const mode of ["success","lost","replay","version","predecessor","CAS","expired","partial","wrong_owner","scopes","crypto","hash","denied","late_failure","skip_finalize"]){
  await client.query("savepoint source_rule_case");
  try{
   const r=repository(mode);
   if(mode==="expired")await client.query("update identity.product_identity_mappings set retain_until=clock_timestamp()-interval '1 second' where id=$1",[mappingId]);
   if(mode==="partial")await client.query("update evidence.source_batches set source_state='partial' where id=(select accepted_batch_id from identity.product_identity_mappings where id=$1)",[mappingId]);
   if(mode==="scopes")await client.query("update integrations.provider_connections set granted_scopes=granted_scopes[1:1] where id=$1",[owner.connectionId]);
   if(mode==="crypto")await client.query("update evidence.source_pages set auth_tag=decode(repeat('00',16),'hex') where id=(select page_id from evidence.source_references where id=(select source_reference_id from evidence.source_reference_links where mapping_id=$1 and role='candidate_check' limit 1))",[mappingId]);
   if(mode==="hash")await client.query("update evidence.source_references set record_hash=repeat('0',64) where id=(select source_reference_id from evidence.source_reference_links where mapping_id=$1 and role='candidate_check' limit 1)",[mappingId]);
   if(["expired","partial","wrong_owner","scopes","crypto","hash","denied"].includes(mode)){
    await assert.rejects(r.review(mode==="wrong_owner"?{...input,owner:{...owner,generation:String(BigInt(owner.generation)+1n)}}:input));continue;
   }
   const prepared=await prepare(r);
   if(mode==="CAS")await client.query("update identity.product_identity_mappings set applicability=applicability||jsonb_build_object('changed',true),retain_until=retain_until-interval '1 second' where id=$1",[mappingId]);
   if(["late_failure","skip_finalize"].includes(mode)){
    await client.query("create function pg_temp.rule_late_failure() returns trigger language plpgsql as $vf$begin if new.manifest->>'kind'='source_rule_review_v1' then "+(mode==="skip_finalize"?"return null;":"raise exception 'SYNTHETIC_RULE_FAILURE';")+"end if;return new;end$vf$");
    await client.query("create trigger rule_late_failure before update on evidence.source_batches for each row execute function pg_temp.rule_late_failure()");
   }
   if(["CAS","late_failure","skip_finalize"].includes(mode)){
    await client.query("savepoint rejected_rule_write");await assert.rejects(r.commit(prepared),/WRITE_UNCONFIRMED/);await client.query("rollback to savepoint rejected_rule_write");
    assert.equal((await client.query("select count(*)::int n from identity.source_rule_versions where workspace_id=$1 and rule_key=$2",[owner.workspaceId,proposal.ruleKey])).rows[0].n,0);continue;
   }
   let receipt;
   if(mode==="lost"){
    await assert.rejects(r.commit(prepared),/WRITE_UNCONFIRMED/);await assert.rejects(r.commit(prepared),/PREPARED_WRITE_REQUIRED/);
    receipt=await r.inspect({owner,operationId:prepared.operationId});assert.equal(receipt.currentRuleVerified,false);
   }else receipt=await r.commit(prepared);
   const rid=receipt.manifest.ids["rule:reviewed"],first=(await client.query("select version::text,supersedes_id::text,applicability,accepted_batch_id::text from identity.source_rule_versions where id=$1",[rid])).rows[0];
   assert.equal(first.version,"1");assert.equal(first.supersedes_id,null);assert.equal(first.applicability.identity.nativeId,JSON.parse((await client.query("select identity_key_canonical from identity.product_identity_mappings where id=$1",[mappingId])).rows[0].identity_key_canonical).nativeId);
   assert.equal((await client.query("select handoff_state from evidence.source_batches where id=$1",[first.accepted_batch_id])).rows[0].handoff_state,"pending");
   if(mode==="replay"){
    const again=(await client.query("select identity.commit_reviewed_source_rule($1::jsonb,$2::uuid,$3::jsonb) as result",lastWrite)).rows[0].result;assert.equal(again.commitId,receipt.commitId);
    await client.query("savepoint rule_operation_conflict");const changed=JSON.parse(lastWrite[2]);changed.policy.version="different";
    await assert.rejects(client.query("select identity.commit_reviewed_source_rule($1::jsonb,$2::uuid,$3::jsonb)",[lastWrite[0],lastWrite[1],JSON.stringify(changed)]),/SOURCE_RULE_OPERATION_CONFLICT/);await client.query("rollback to savepoint rule_operation_conflict");
   }
   if(mode==="predecessor")await assert.rejects(r.review(input));
   if(mode==="version"){
    const nextInput={...input,proposal:{...proposal,previousRuleId:rid}},review=await r.review(nextInput),next=r.prepare(review,{policy,deadlineAt:new Date(Date.now()+20000).toISOString()}),nextReceipt=await r.commit(next);
    const second=(await client.query("select version::text,supersedes_id::text from identity.source_rule_versions where id=$1",[nextReceipt.manifest.ids["rule:reviewed"]])).rows[0];
    assert.deepEqual(second,{version:"2",supersedes_id:rid});assert.deepEqual((await client.query("select version::text,supersedes_id::text,applicability,accepted_batch_id::text from identity.source_rule_versions where id=$1",[rid])).rows[0],first);
   }
   assert.equal((await client.query("select mapping_state from identity.product_identity_mappings where id=$1",[mappingId])).rows[0].mapping_state,"unresolved");
   await client.query("set constraints all immediate");await client.query("set constraints all deferred");
  }finally{await client.query("rollback to savepoint source_rule_case");await client.query("release savepoint source_rule_case");}
 }
 for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
  for(const signature of ["identity.source_rule_review_state(jsonb,bigint,jsonb)","identity.commit_reviewed_source_rule(jsonb,uuid,jsonb)"])
   assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,signature])).rows[0].ok,false);
 const r=repository("final"),receipt=await r.commit(await prepare(r));
 console.log("EO05_SOURCE_RULE_SQL_PASS provider="+owner.provider+" synthetic_explicit_review=true real_SQL_versions_CAS_crypto_rollback_lost_ack=true no_native_HTTP=true no_runtime_grants=true");
 return receipt;
}
