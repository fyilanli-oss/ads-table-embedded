import {prepareSourceWrite,createSourceEvidenceRepository,canonicalSourceJson,sourcePayloadHash} from "./source-evidence-store.server.js";
import {validateKlaviyoRawEligibility} from "../refresh/klaviyo-raw-eligibility.server.js";

const fail=()=>{throw Error("KLAVIYO_DATASET_READBACK_UNCONFIRMED");};
function prepareKlaviyoSourcePackage({owner,attemptId,ordinal,pages,complete,cipher,policy,limits,now}) {
 const records={references:[],rules:[],mappings:[],orders:[],lines:[],journeys:[],claims:[],links:[]};
 const preparedPages=pages.map((p,i)=>{
  const key="p"+i;
  for(let n=0;n<(p.records?.length??0);n++)records.references.push({key:key+"r"+n,page:key,locatorKind:"row",locator:"/records/"+n,nativeType:"KlaviyoRawObservation",nativeId:p.records[n]?.id??null,state:"present"});
  return {key,family:p.family,ordinal:i,origin:"klaviyo",captureLayer:"native_response_projection",numericFidelity:"lossless_token",
   fieldCoverage:p.selectedFields??["records"],schemaVersion:"klaviyo-raw-datasets-v1",sanitizerVersion:"klaviyo-native-fields-v1",payload:p};
 });
 return prepareSourceWrite({owner,attemptId,ordinal,sourceState:complete?"complete":"partial",pages:preparedPages,records,cipher,policy,limits,now});
}

// Keep native response pages intact. A byte-bound split uses the serialized
// encrypted write, including reference hashes, as its size check.
export function prepareKlaviyoRawDatasetPackages({pages,limits,maxPackages=1,...options}) {
 if (!Array.isArray(pages) || pages.length === 0 ||
  !Number.isInteger(maxPackages) || maxPackages < 1 || maxPackages > 100) throw Error("KLAVIYO_SOURCE_PACKAGE_INVALID");
 if (maxPackages === 1) return [prepareKlaviyoSourcePackage({...options,limits,pages,ordinal:0})];

 const writes=[];
 let start=0;
 while (start < pages.length) {
  if (writes.length === maxPackages) throw Error("SOURCE_STORE_BOUNDS");
  let count=0,end=start;
  while (end < pages.length) {
   count+=1+(pages[end].records?.length??0);
   if (count > limits.maxRows) break;
   end++;
  }

  let low=start+1,high=end,bestEnd=start,bestWrite;
  while (low <= high) {
   const split=Math.ceil((low+high)/2);
   try {
    bestWrite=prepareKlaviyoSourcePackage({...options,limits,pages:pages.slice(start,split),ordinal:writes.length});
    bestEnd=split;
    low=split+1;
   } catch (error) {
    if (error?.message !== "SOURCE_STORE_BOUNDS") throw error;
    high=split-1;
   }
  }
  if (!bestWrite) throw Error("SOURCE_STORE_BOUNDS");
  writes.push(bestWrite);
  start=bestEnd;
 }
 return writes;
}

// The current SQL entry point accepts one envelope per dataset.
export async function storeKlaviyoRawDataset({database,owner,attemptId,dataset,pages,complete,read,cipher,policy,limits,now,onCommitted=()=>{}}) {
 const [write]=prepareKlaviyoRawDatasetPackages({owner,attemptId,pages,complete,cipher,policy,limits,now});
 const repository=createSourceEvidenceRepository(database);
 // Once a write has been sent, a lost acknowledgement is unknown. No second
 // write or automatic receipt/page inspection follows that exception.
 const receipt=await repository.commitKlaviyoDataset(write,{...read,dataset});
 onCommitted();
 const known=await repository.inspect({owner,attemptId,ordinal:0});
 if(canonicalSourceJson(known)!==canonicalSourceJson(receipt))fail();
 let cursor="0",seen=0;
 while(seen<write.body.pages.length){
  const stored=await repository.readPages({owner,attemptId,ordinal:0,after:cursor,limit:Math.min(100,write.body.pages.length-seen)});
  if(!stored.length)fail();
  for(const page of stored){
   const expected=write.body.pages[seen],plain=pages[seen];
   if(!expected||page.available!==true||page.expired!==false||page.retentionPruned!==false
    ||! /^[1-9][0-9]*$/.test(page.id??"")||BigInt(page.id)<=BigInt(cursor))fail();
   for(const key of ["family","ordinal","origin","captureLayer","numericFidelity","schemaVersion","sanitizerVersion","keyVersion","plainBytes","payloadHash","ciphertext","nonce","authTag"])
    if(page[key]!==expected[key])fail();
   if(canonicalSourceJson(page.fieldCoverage)!==canonicalSourceJson(expected.fieldCoverage))fail();
   const payload=cipher.open({owner,attemptId,ordinal:0,page});
   if(sourcePayloadHash(payload)!==sourcePayloadHash(plain))fail();
   cursor=page.id;seen++;
  }
 }
 const extra=await repository.readPages({owner,attemptId,ordinal:0,after:cursor,limit:1});if(extra.length)fail();
 const eligibility=receipt.manifest?.klaviyoRawEligibility;
 return Object.freeze({batchId:receipt.batchId,commitId:receipt.commitId,digest:receipt.digest,receiptVerified:true,contentVerified:true,
  ...eligibility===undefined?{}:{eligibility:validateKlaviyoRawEligibility(eligibility,{window:read.window})}});
}
