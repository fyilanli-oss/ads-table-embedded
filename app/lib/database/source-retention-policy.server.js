// Normal retention only. Privacy erasure always follows its separate executor.
export const SOURCE_RETENTION_POLICY_VERSION = 'source-retention-90-365-v1';
export const SOURCE_RETENTION_DAYS = Object.freeze({claim:90,identity:90,metadata:365,order:90,raw:90});
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join()===keys.slice().sort().join();
const fail=()=>{throw Error('SOURCE_RETENTION_POLICY_INVALID');};
export function readSourceRetentionDurationPolicy(input) {
 if(!exact(input,['version','days'])||input.version!==SOURCE_RETENTION_POLICY_VERSION
  ||!exact(input.days,Object.keys(SOURCE_RETENTION_DAYS))||Object.entries(SOURCE_RETENTION_DAYS).some(([k,d])=>input.days[k]!==d))fail();
 return Object.freeze({version:SOURCE_RETENTION_POLICY_VERSION,days:SOURCE_RETENTION_DAYS});
}
export function sourceRetentionDurationPolicy(){return readSourceRetentionDurationPolicy({version:SOURCE_RETENTION_POLICY_VERSION,days:SOURCE_RETENTION_DAYS});}
// One immutable anchor per prepared write, not a common deployment expiry.
// Re-reading/using a record must never call this to renew that record's lifetime.
export function resolveSourceRetentionDurationPolicy(input,recordedAt) {
 const p=readSourceRetentionDurationPolicy(input);
 if(typeof recordedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(recordedAt)||!Number.isFinite(Date.parse(recordedAt))||new Date(recordedAt).toISOString()!==recordedAt)fail();
 try{return Object.freeze(Object.fromEntries(Object.entries(p.days).map(([kind,days])=>[kind,Object.freeze({version:p.version,until:new Date(Date.parse(recordedAt)+days*86400000).toISOString()})])));}catch{fail();}
}
