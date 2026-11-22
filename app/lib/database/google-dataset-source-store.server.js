import {prepareSourceWrite,createSourceEvidenceRepository,canonicalSourceJson,sourcePayloadHash} from "./source-evidence-store.server.js";

const fail=()=>{throw Error("GOOGLE_DATASET_READBACK_UNCONFIRMED");};
// A separate envelope per dataset, joined by operation/job/window in the SQL
// manifest. No identity mapping, source rule, report or Dataset is written.
function prepareGooglePackage({owner,attemptId,pages,complete,cipher,policy,limits,now,ordinal=0}) {
 const records={references:[],rules:[],mappings:[],orders:[],lines:[],journeys:[],claims:[],links:[]};
 const preparedPages=pages.map((p,i)=>{
  const key="p"+i;
  for(let n=0;n<(p.records?.length??0);n++)records.references.push({key:key+"r"+n,page:key,locatorKind:"row",locator:"/records/"+n,nativeType:"GoogleRawObservation",nativeId:null,state:"present"});
  return {key,family:p.family,ordinal:i,origin:"google_ads",captureLayer:"native_response_projection",numericFidelity:"lossless_token",
   fieldCoverage:p.selectedFields??["records"],schemaVersion:"google-raw-datasets-v2",sanitizerVersion:"google-query-fields-v1",payload:p};
 });
 return prepareSourceWrite({owner,attemptId,ordinal,sourceState:complete?"complete":"partial",pages:preparedPages,records,cipher,policy,limits,now});
}

export function prepareGoogleRawDatasetPackages(options) {
 if(!Array.isArray(options.pages)||options.pages.length===0)throw Error("GOOGLE_DATASET_PACKAGE_INVALID");
 if(options.pages.length<=options.limits.maxRows){
  try{return [prepareGooglePackage(options)];}catch(error){if(error.message!=="SOURCE_STORE_BOUNDS"||!options.complete||options.dataset==="merchant_identity")throw error;}
 }else if(!options.complete||options.dataset==="merchant_identity")throw Error("SOURCE_STORE_BOUNDS");
 const writes=[];let offset=0;
 while(offset<options.pages.length){
  if(writes.length===20)throw Error("SOURCE_STORE_BOUNDS");
  let low=offset+1,high=Math.min(options.pages.length,offset+options.limits.maxRows),best,end=offset;
  while(low<=high){const stop=Math.ceil((low+high)/2);
   try{best=prepareGooglePackage({...options,pages:options.pages.slice(offset,stop),complete:false,ordinal:writes.length});end=stop;low=stop+1;}
   catch(error){if(error.message!=="SOURCE_STORE_BOUNDS")throw error;high=stop-1;}
  }
  if(!best)throw Error("SOURCE_STORE_BOUNDS");writes.push(best);offset=end;
 }
 return writes;
}

export async function storeGoogleRawDataset(options) {
 const {dataset,pages,read,onCommitted=()=>{},onSending=()=>{},guard=async()=>{}}=options;
 const writes=prepareGoogleRawDatasetPackages(options);
 const binding={...read,dataset,...writes.length>1?{packageCount:writes.length,pageCount:pages.length,
  recordCount:pages.reduce((n,p)=>n+p.records.length,0),families:[...new Set(pages.map(p=>p.family))].sort()}: {}};
 const receipts=[];let offset=0;
 for(const write of writes){await guard();const end=offset+write.body.pages.length;
  const receipt=await storeGooglePackage({...options,write,pages:pages.slice(offset,end),read:binding,onCommitted,onSending});
  receipts.push({...receipt,attemptId:options.attemptId,ordinal:write.ordinal});offset=end;await guard();
 }
 return writes.length===1?receipts[0]:Object.freeze({...receipts[0],packageReceipts:Object.freeze(receipts)});
}

async function storeGooglePackage({database,owner,attemptId,pages,read,cipher,write,onCommitted,onSending}) {
 const ordinal=write.ordinal;
 const repository=createSourceEvidenceRepository(database);
 // Once a write has been sent, a lost acknowledgement is unknown. No second
 // write or automatic receipt/page inspection follows that exception.
 onSending();
 const receipt=await repository.commitGoogleDataset(write,read);
 onCommitted();
 const known=await repository.inspect({owner,attemptId,ordinal});
 if(canonicalSourceJson(known)!==canonicalSourceJson(receipt))fail();
 if((read.packageCount!==undefined||read.reportPlan!==undefined)&&canonicalSourceJson(receipt.manifest?.googleDatasetRead??null)!==canonicalSourceJson(read))fail();
 let cursor="0",seen=0;
 while(seen<write.body.pages.length){
  const stored=await repository.readPages({owner,attemptId,ordinal,after:cursor,limit:Math.min(100,write.body.pages.length-seen)});
  if(!stored.length)fail();
  for(const page of stored){
   const expected=write.body.pages[seen],plain=pages[seen];
   if(!expected||page.available!==true||page.expired!==false||page.retentionPruned!==false
    ||! /^[1-9][0-9]*$/.test(page.id??"")||BigInt(page.id)<=BigInt(cursor))fail();
   for(const key of ["family","ordinal","origin","captureLayer","numericFidelity","schemaVersion","sanitizerVersion","keyVersion","plainBytes","payloadHash","ciphertext","nonce","authTag"])
    if(page[key]!==expected[key])fail();
   if(canonicalSourceJson(page.fieldCoverage)!==canonicalSourceJson(expected.fieldCoverage))fail();
   const payload=cipher.open({owner,attemptId,ordinal,page});
   if(sourcePayloadHash(payload)!==sourcePayloadHash(plain))fail();
   cursor=page.id;seen++;
  }
 }
 const extra=await repository.readPages({owner,attemptId,ordinal,after:cursor,limit:1});if(extra.length)fail();
 return Object.freeze({batchId:receipt.batchId,commitId:receipt.commitId,digest:receipt.digest,receiptVerified:true,contentVerified:true});
}
