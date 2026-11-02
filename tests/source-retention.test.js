import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareSourceRetentionSweep,createSourceRetentionRepository,SOURCE_RETENTION_KINDS} from '../app/lib/database/source-retention.server.js';
const options=()=>({workspaceId:randomUUID(),installationId:'9007199254740993',generation:'1',kind:'claim',after:'0',limit:5,deadlineAt:new Date(Date.now()+60000).toISOString(),auditPolicy:{version:'synthetic-policy',until:new Date(Date.now()+86400000).toISOString(),maxReceipts:10}});
function fixture(){const input=options(),plan=prepareSourceRetentionSweep(input),calls=[];const receipt={status:'completed',scope:'bounded_scan_only',operationId:plan.operationId,digest:'a'.repeat(64),kind:plan.kind,after:plan.after,lastScannedId:'9007199254740993',scanned:2,held:1,deleted:1,linksDeleted:1,cipherBytesDeleted:'0',completedAt:new Date().toISOString(),expiresAt:input.auditPolicy.until,policyVersion:input.auditPolicy.version};const database={query:async(sql,args)=>{calls.push({sql,args});return {rows:[{result:receipt}]};}};return {input,plan,calls,receipt,database,repo:createSourceRetentionRepository(database)};}
test('source retention: exact text IDs, explicit budgets and detached policy reach one SQL operation',async()=>{
 const f=fixture();f.input.auditPolicy.version='changed-after-preparation';const r=await f.repo.cleanup(f.plan);assert.equal(r.deleted,1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].args[1],'9007199254740993');assert.equal(JSON.parse(f.calls[0].args[8]).version,'synthetic-policy');assert.ok(Object.isFrozen(r));
});
test('source retention: every reviewed kind is explicit; no raw SQL name or default policy is accepted',()=>{
 for(const kind of SOURCE_RETENTION_KINDS)assert.equal(prepareSourceRetentionSweep({...options(),kind}).kind,kind);
 for(const patch of [{kind:'source.orders'},{limit:0},{limit:1001},{after:0},{installationId:9007199254740992},{generation:'01'},{deadlineAt:null},{auditPolicy:null},{auditPolicy:{version:'v1',until:'infinity',maxReceipts:10}},{auditPolicy:{version:'v1',until:new Date().toISOString(),maxReceipts:1001}},{force:true}])assert.throws(()=>prepareSourceRetentionSweep({...options(),...patch}),/INPUT_INVALID/);
 assert.throws(()=>prepareSourceRetentionSweep(),/INPUT_INVALID/);
});
test('source retention: copied, forged and reused plans never open a second write',async()=>{
 const f=fixture();await assert.rejects(f.repo.cleanup(structuredClone(f.plan)),/CAPABILITY_REQUIRED/);await f.repo.cleanup(f.plan);await assert.rejects(f.repo.cleanup(f.plan),/CAPABILITY_REQUIRED/);assert.equal(f.calls.length,1);
});
test('source retention: a lost SQL response is one-use unknown without automatic retry',async()=>{
 const f=fixture();let n=0;const repo=createSourceRetentionRepository({query:async()=>{n++;throw Error('synthetic reply lost');}});await assert.rejects(repo.cleanup(f.plan),/WRITE_UNCONFIRMED/);await assert.rejects(repo.cleanup(f.plan),/CAPABILITY_REQUIRED/);assert.equal(n,1);
});
test('source retention: malformed completion/counts/cursor cannot become accepted cleanup',async()=>{
 for(const patch of [{operationId:randomUUID()},{kind:'rule'},{scanned:6},{held:0},{lastScannedId:'-1'},{cipherBytesDeleted:1},{scope:'all_records'},{expiresAt:'infinity'}]){const f=fixture();Object.assign(f.receipt,patch);await assert.rejects(f.repo.cleanup(f.plan),/WRITE_UNCONFIRMED/);}
});
test('source retention: inspection is explicit and absence is not rollback proof',async()=>{
 const f=fixture(),repo=createSourceRetentionRepository({query:async()=>({rows:[{result:{status:'not_observed',rollbackProven:false}}]})});const {workspaceId,installationId,generation,operationId}=f.plan;assert.deepEqual(await repo.inspect({workspaceId,installationId,generation,operationId}),{status:'not_observed',rollbackProven:false});
 await assert.rejects(repo.inspect({...f.plan}),/INPUT_INVALID/);
});
test('source retention: historical receipt is distinct from current activation and expired receipts remain marked',async()=>{
 const f=fixture(),repo=createSourceRetentionRepository({query:async()=>({rows:[{result:{status:'recorded',receipt:f.receipt,expired:true}}]})});const {workspaceId,installationId,generation,operationId}=f.plan;assert.equal((await repo.inspect({workspaceId,installationId,generation,operationId})).expired,true);
});
test('source retention: failed inspection never repeats SQL or upgrades an absent receipt',async()=>{
 const f=fixture();let n=0;const repo=createSourceRetentionRepository({query:async()=>{n++;throw Error('synthetic SQL loss');}});const {workspaceId,installationId,generation,operationId}=f.plan;await assert.rejects(repo.inspect({workspaceId,installationId,generation,operationId}),/READ_FAILED/);assert.equal(n,1);
});
