import {randomUUID} from 'node:crypto';
const capabilities=new WeakMap();
const fail=code=>{throw Error('SOURCE_RETENTION_'+code);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const id=v=>typeof v==='string'&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const SOURCE_RETENTION_KINDS=Object.freeze(['claim','journey','line','order','mapping','rule','reference','page','batch']);

// No default retention days, downstream receipt, provider request or scheduling.
// Existing class-specific retain_until values are authoritative minimum dates.
export function prepareSourceRetentionSweep({workspaceId,installationId,generation,kind,after,limit,deadlineAt,auditPolicy,...extra}={}){
 if(Object.keys(extra).length||!uuid(workspaceId)||!id(installationId)||!id(generation)||!SOURCE_RETENTION_KINDS.includes(kind)
 ||!(after==='0'||id(after))||!Number.isInteger(limit)||limit<1||limit>1000||!instant(deadlineAt)
 ||!object(auditPolicy)||Object.keys(auditPolicy).sort().join()!=='maxReceipts,until,version'
 ||typeof auditPolicy.version!=='string'||auditPolicy.version.length<1||auditPolicy.version.length>128
 ||!instant(auditPolicy.until)||Date.parse(auditPolicy.until)<Date.parse(deadlineAt)||!Number.isInteger(auditPolicy.maxReceipts)
 ||auditPolicy.maxReceipts<1||auditPolicy.maxReceipts>1000)fail('INPUT_INVALID');
 const plan=freeze({workspaceId,installationId,generation,operationId:randomUUID(),kind,after,limit,deadlineAt,auditPolicy:structuredClone(auditPolicy)});
 capabilities.set(plan,{used:false});return plan;
}

export function createSourceRetentionRepository(database){
 if(typeof database?.query!=='function')fail('DATABASE_REQUIRED');
 return Object.freeze({
  async cleanup(plan){
   const state=capabilities.get(plan);if(!state||state.used)fail('CAPABILITY_REQUIRED');state.used=true;
   try{
    const result=await database.query('select evidence.cleanup_source_retention($1::uuid,$2::bigint,$3::bigint,$4::uuid,$5::text,$6::bigint,$7::integer,$8::timestamptz,$9::jsonb) as result',
     [plan.workspaceId,plan.installationId,plan.generation,plan.operationId,plan.kind,plan.after,plan.limit,plan.deadlineAt,JSON.stringify(plan.auditPolicy)]);
    const r=result.rows?.length===1?result.rows[0].result:null;
    if(!object(r)||r.status!=='completed'||r.scope!=='bounded_scan_only'||r.operationId!==plan.operationId||r.kind!==plan.kind
     ||r.after!==plan.after||!(r.lastScannedId==='0'||id(r.lastScannedId))||BigInt(r.lastScannedId)<BigInt(plan.after)
     ||!['scanned','held','deleted','linksDeleted'].every(k=>Number.isInteger(r[k])&&r[k]>=0)
     ||r.scanned>plan.limit||r.held+r.deleted!==r.scanned||r.linksDeleted>1000||typeof r.digest!=='string'||!/^[a-f0-9]{64}$/.test(r.digest)
     ||typeof r.cipherBytesDeleted!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(r.cipherBytesDeleted)
     ||!instant(r.completedAt)||r.expiresAt!==plan.auditPolicy.until||r.policyVersion!==plan.auditPolicy.version)fail('RESULT_INVALID');
    return freeze(r);
   }catch{fail('WRITE_UNCONFIRMED');}
  },
  async inspect({workspaceId,installationId,generation,operationId,...extra}={}){
   if(Object.keys(extra).length||!uuid(workspaceId)||!id(installationId)||!id(generation)||!uuid(operationId))fail('INPUT_INVALID');
   try{
    const response=await database.query('select evidence.inspect_source_retention($1::uuid,$2::bigint,$3::bigint,$4::uuid) as result',[workspaceId,installationId,generation,operationId]);
    const r=response.rows?.length===1?response.rows[0].result:null;
    if(!object(r)||!['recorded','not_observed'].includes(r.status)||r.status==='not_observed'&&r.rollbackProven!==false
     ||r.status==='recorded'&&(!object(r.receipt)||r.receipt.operationId!==operationId||typeof r.expired!=='boolean'))fail('READ_INVALID');
    return freeze(r);
   }catch{fail('READ_FAILED');}
  },
 });
}
