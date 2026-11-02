import {createRefreshGoogleCandidateReader,refreshGoogleSourceStorageContext} from "./quota-authority-binding.server.js";
import {createSourceEvidenceRepository,canonicalSourceJson} from "../database/source-evidence-store.server.js";
import {createSourceRuleRepository} from "../database/source-rule-store.server.js";
import {createVerifiedMappingRepository} from "../database/verified-mapping-store.server.js";
import {quotaBoundaryControl} from "./quota-native-fetch.server.js";

const fail=code=>{throw Error("GOOGLE_MAPPING_FLOW_"+code);};
const id=x=>typeof x==="string"&&/^[1-9][0-9]{0,18}$/.test(x)&&BigInt(x)<=9223372036854775807n;
const same=(a,b)=>canonicalSourceJson(a)===canonicalSourceJson(b);
const freeze=x=>{if(x&&typeof x==="object"){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const instant=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const policy=(p,t)=>p&&Object.keys(p).sort().join()==="until,version"&&typeof p.version==="string"&&p.version.length>0&&p.version.length<=128&&instant(p.until)&&Date.parse(p.until)>t;
const receiptRef=r=>({batchId:r.batchId,commitId:r.commitId,digest:r.digest});

// Inactive server-only single-target composition. The target is a trusted work
// plan identity and must occur in the genuine source write. No UI selector,
// default reviewer, key provisioning, grant, job finish or Dataset write.
export function createGoogleSourceMappingFlow({readerOptions,plan,reviewAuthority,now=Date.now}={}){
 if(typeof now!=="function"||typeof reviewAuthority!=="function"||typeof readerOptions?.database?.query!=="function"
  ||typeof readerOptions?.sourceStorage?.cipher?.seal!=="function"||typeof readerOptions?.sourceStorage?.cipher?.open!=="function")fail("CONFIG_INVALID");
 plan=freeze(structuredClone(plan));const time=now();
 if(!Number.isSafeInteger(time)||!plan||Object.keys(plan).sort().join()!=="deadlineAt,identity,mappingPolicy,rulePolicy,ruleProposal"
  ||!plan.identity||Object.keys(plan.identity).sort().join()!=="accountId,context,nativeId,provider"||plan.identity.provider!=="google_ads"
  ||plan.identity.accountId!==readerOptions.claim?.accountId||typeof plan.identity.nativeId!=="string"||!plan.identity.nativeId.length||plan.identity.nativeId.length>1024
  ||typeof plan.identity.context!=="object"||plan.identity.context===null||Array.isArray(plan.identity.context)
  ||Buffer.byteLength(canonicalSourceJson(plan.identity))>8192||!plan.ruleProposal
  ||!instant(plan.deadlineAt)||Date.parse(plan.deadlineAt)<=time||Date.parse(plan.deadlineAt)>time+600000
  ||!policy(plan.rulePolicy,time)||!policy(plan.mappingPolicy,time))fail("PLAN_INVALID");
 const database=readerOptions.database,cipher=readerOptions.sourceStorage.cipher,external=readerOptions.signal,abort=new AbortController();
 const reader=createRefreshGoogleCandidateReader({...readerOptions,signal:abort.signal});
 const rules=createSourceRuleRepository({database,cipher,reviewAuthority,now}),mappings=createVerifiedMappingRepository({database,cipher,now});
 const state={source:null,rule:null,mapping:null};let used=false,running=false,owner=null,stage="source",sourceMappingId=null,ruleId=null,acceptedMappingId=null;
 function check(){if(now()>=Date.parse(plan.deadlineAt))fail("DEADLINE_EXCEEDED");if(external?.aborted||abort.signal.aborted)fail("ABORTED");}
 async function bounded(action){
  check();let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=()=>reject(Error("GOOGLE_MAPPING_FLOW_ABORTED"));});
  abort.signal.addEventListener("abort",rejectAbort,{once:true});
  try{return await Promise.race([action(),interrupted]);}finally{abort.signal.removeEventListener("abort",rejectAbort);}
 }
 const snapshot=(status,reason=null,current=null)=>freeze({status,stage,reason,source:state.source?structuredClone(state.source):null,
  rule:state.rule?structuredClone(state.rule):null,mapping:state.mapping?structuredClone(state.mapping):null,
  sourceMappingId,ruleId,acceptedMappingId,...current?{current}: {},reportNamespaceVerified:false,authorizesActivation:false,DatasetWritePerformed:false});
 return Object.freeze({
  async run(){
   if(used)fail("EXECUTION_USED");used=true;running=true;
   const forward=()=>abort.abort();external?.addEventListener("abort",forward,{once:true});
   const timer=setTimeout(()=>abort.abort(),Math.max(1,Date.parse(plan.deadlineAt)-now()));timer.unref?.();
   try{
    check();const observation=await bounded(()=>reader.readEvidence()),captured=refreshGoogleSourceStorageContext(observation);
    if(!captured||captured.status!=="committed"||captured.owner.provider!=="google_ads"||observation.sourceStored!==true)fail("SOURCE_PROVENANCE_REQUIRED");
    owner=captured.owner;state.source={status:"committed",attemptId:captured.attemptId,...receiptRef(captured.receipt)};check();
    stage="selection";
    const selected=captured.targets.filter(x=>same(x.identity,plan.identity));
    if(selected.length!==1||selected[0].state!=="unresolved")fail("TARGET_NOT_UNRESOLVED");
    sourceMappingId=captured.receipt.manifest?.ids?.["mapping:"+selected[0].key];if(!id(sourceMappingId))fail("SOURCE_RECEIPT_INVALID");
    stage="rule_review";check();const ruleReview=await bounded(()=>rules.review({owner,mappingId:sourceMappingId,expectedSourceBatchId:state.source.batchId,proposal:plan.ruleProposal}));check();
    const ruleWrite=rules.prepare(ruleReview,{policy:plan.rulePolicy,deadlineAt:plan.deadlineAt});
    const ruleReceipt=await bounded(()=>{state.rule={status:"unconfirmed",operationId:ruleWrite.operationId};stage="rule_write";return rules.commit(ruleWrite);});ruleId=ruleReceipt.manifest.ids["rule:reviewed"];
    state.rule={status:"committed",operationId:ruleWrite.operationId,...receiptRef(ruleReceipt)};check();
    if(ruleReceipt.manifest.sourceBatchId!==state.source.batchId||ruleReceipt.manifest.sourceMappingId!==sourceMappingId)fail("RULE_SOURCE_CHANGED");
    stage="mapping_review";check();const mappingReview=await bounded(()=>mappings.review({owner,mappingId:sourceMappingId,ruleId}));check();
    const mappingWrite=mappings.prepare(mappingReview,{policy:plan.mappingPolicy,deadlineAt:plan.deadlineAt});
    const mappingReceipt=await bounded(()=>{state.mapping={status:"unconfirmed",operationId:mappingWrite.operationId};stage="mapping_write";return mappings.commit(mappingWrite);});acceptedMappingId=mappingReceipt.manifest.ids["mapping:accepted"];
    state.mapping={status:"committed",operationId:mappingWrite.operationId,...receiptRef(mappingReceipt)};check();
    stage="current_read";const current=await bounded(()=>mappings.readCurrent({owner,identity:plan.identity}));check();
    if(current.mappingId!==acceptedMappingId||current.ruleId!==ruleId||!same(current.owner,owner)||!same(current.context,plan.identity.context))fail("CURRENT_CHANGED");
    stage="complete";return snapshot("verified",null,{mappingId:current.mappingId,revision:current.revision,productId:current.productId,variantId:current.variantId});
   }catch(error){
    const failedSource=refreshGoogleSourceStorageContext(error)??refreshGoogleSourceStorageContext(reader);
    if(!state.source&&failedSource){owner=failedSource.owner;state.source={status:failedSource.status,attemptId:failedSource.attemptId,...failedSource.receipt?receiptRef(failedSource.receipt):{}};}
    const unknown=Object.values(state).some(x=>x?.status==="unconfirmed"),control=quotaBoundaryControl(error);
    const reason=unknown?"write_unconfirmed":control?"quota_"+control.status:
     (error?.message?.length<=128&&/^(?:GOOGLE_MAPPING_FLOW_|SOURCE_RULE_|MAPPING_STORE_|MAPPING_)[A-Z_]+$/.test(error.message))?error.message:"stage_failed";
    return snapshot(unknown?"unconfirmed":"stopped",reason);
   }finally{clearTimeout(timer);external?.removeEventListener("abort",forward);running=false;}
  },
  async inspect(which){
   if(running||!used||!owner||!["source","rule","mapping"].includes(which)||!state[which])fail("INSPECTION_UNAVAILABLE");
   // Explicit read only. Inspection never advances, retries or resets run().
   const receipt=which==="source"?await createSourceEvidenceRepository(database).inspect({owner,attemptId:state.source.attemptId,ordinal:0}):
    await(which==="rule"?rules:mappings).inspect({owner,operationId:state[which].operationId});
   return freeze({stage:which,receipt:structuredClone(receipt),historical:true,flowAdvanced:false,currentMappingVerified:false});
  }
 });
}
