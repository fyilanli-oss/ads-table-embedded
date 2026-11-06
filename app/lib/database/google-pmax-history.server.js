import {createHash} from "node:crypto";
import {createSourceEvidenceRepository,sourceStoreOwner,canonicalSourceJson} from "./source-evidence-store.server.js";
import {buildGoogleReportingQueries} from "../providers/google-reporting.server.js";
import {stableJson} from "../providers/common-adapter.server.js";
import {runIdentityReadDeadline} from "../providers/identity-read-deadline.server.js";

export const GOOGLE_PMAX_HISTORY_FIND_SQL="select evidence.find_google_pmax_source_batches($1::jsonb,$2::date,$3::integer) as result";
const loaders=new WeakSet(),fail=code=>{throw Error("PMAX_HISTORY_"+code);};
const copy=v=>v===null||typeof v!=="object"?v:Object.freeze(Array.isArray(v)?v.map(copy):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,copy(x)])));
const id=v=>typeof v==="string"&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const uuid=v=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const instant=v=>typeof v==="string"&&Number.isFinite(Date.parse(v))&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(v);
const camel=s=>s.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
export const isGooglePmaxHistoryLoader=value=>loaders.has(value);

// Internal read-only factory. No caller JSON becomes historical authority.
// Existing raw captures prove observations only, never a continuity interval.
export function createGooglePmaxHistoryLoader({database,cipher,limits,now=Date.now}={}) {
 if(typeof database?.query!=="function"||typeof cipher?.open!=="function"||typeof now!=="function"
 ||!limits||Object.keys(limits).sort().join()!==["maxBatches","maxBytes","maxElapsedMs","maxPages","maxRows"].sort().join()
 ||Object.values(limits).some(v=>!Number.isSafeInteger(v)||v<1)||limits.maxBatches>10||limits.maxPages>100
 ||limits.maxRows>20000||limits.maxBytes>8388608||limits.maxElapsedMs>120000)fail("INPUT_INVALID");
 const bounds=copy(limits),query=database.query.bind(database),open=cipher.open.bind(cipher),repository=createSourceEvidenceRepository({query});
 let used=false;
 const loader=Object.freeze({async load({owner,businessDate,timezone,signal,deadlineAt,limits:readLimits}={}) {
  const bound=sourceStoreOwner(owner);
  if(bound.provider!=="google_ads"||typeof businessDate!=="string"||!/^\d{4}-\d\d-\d\d$/.test(businessDate)
   ||!Number.isFinite(Date.parse(businessDate))||new Date(businessDate).toISOString().slice(0,10)!==businessDate
   ||typeof timezone!=="string"||!Number.isSafeInteger(deadlineAt)||deadlineAt<=now())fail("INPUT_INVALID");
  try{new Intl.DateTimeFormat("en",{timeZone:timezone});}catch{fail("INPUT_INVALID");}
  // A parent read can only tighten this loader's factory bounds. Snapshot the
  // remaining budget before any asynchronous SQL or caller mutation.
  if(readLimits!==undefined&&(!readLimits||Object.keys(readLimits).sort().join()!=="maxBytes,maxRows"
   ||Object.values(readLimits).some(v=>!Number.isSafeInteger(v)||v<1)))fail("INPUT_INVALID");
  const maxRows=Math.min(bounds.maxRows,readLimits?.maxRows??bounds.maxRows);
  const maxBytes=Math.min(bounds.maxBytes,readLimits?.maxBytes??bounds.maxBytes);
  if(used)fail("EXECUTION_USED");used=true;
  const timeoutMs=Math.min(bounds.maxElapsedMs,deadlineAt-now());
  return runIdentityReadDeadline({signal,timeoutMs,run:async child=>{
   const check=()=>{if(child.aborted||now()>=deadlineAt)fail("STOPPED");};
   const snapshots=[],gaps=[];let pagesRead=0,bytesRead=0,rowsRead=0,retainUntil=Infinity;
   check();let found;
   try{found=await query(GOOGLE_PMAX_HISTORY_FIND_SQL,[JSON.stringify(bound),businessDate,bounds.maxBatches+1]);}catch{fail("READ_FAILED");}check();
   const result=found?.rows?.length===1?found.rows[0].result:null;
   if(!Array.isArray(result))fail("RESULT_INVALID");
   const batches=copy(result);
   if(batches.length>bounds.maxBatches)fail("BATCH_BOUND_EXCEEDED");
   const batchIds=new Set(),attempts=new Set();
   for(const batch of batches){
    if(!id(batch?.batchId)||!uuid(batch.attemptId)||batch.ordinal!==0||batchIds.has(batch.batchId)||attempts.has(batch.attemptId)
     ||!instant(batch.recordedAt)||!instant(batch.retainUntil))fail("RESULT_INVALID");
    batchIds.add(batch.batchId);attempts.add(batch.attemptId);
    const ref={owner:bound,attemptId:batch.attemptId,ordinal:0};
    check();const receipt=await repository.inspect(ref);check();
    const manifest=receipt?.manifest,read=manifest?.googleDatasetRead;
    if(receipt?.batchId!==batch.batchId||! /^[a-f0-9]{64}$/.test(receipt.digest??"")
     ||read?.dataset!=="product_performance"||read.window?.from!==businessDate||read.window?.to!==businessDate
     ||!instant(read.observedAt)||!instant(read.completedAt)||Date.parse(read.completedAt)<Date.parse(read.observedAt)
     ||!Number.isSafeInteger(manifest.counts?.pages)||manifest.counts.pages<1||manifest.counts.pages>100)fail("RECEIPT_INVALID");
    if(receipt.status!=="committed"||receipt.sourceState!=="complete"||manifest.privacyRedacted===true
     ||manifest.retentionPruned===true||Date.parse(batch.retainUntil)<=now()){
     gaps.push({batch_id:batch.batchId,reason:"source_not_available_complete_and_retained"});continue;
    }
    if(!uuid(receipt.commitId))fail("RECEIPT_INVALID");
    let cursor="0",seen=0;const listing=[],pageRefs=[];let unavailable=false;
    retainUntil=Math.min(retainUntil,Date.parse(batch.retainUntil));
    while(seen<manifest.counts.pages){
     check();const stored=await repository.readPages({...ref,after:cursor,limit:Math.min(100,manifest.counts.pages-seen)});check();
     if(!stored.length)fail("PAGE_SET_INCOMPLETE");
     for(const page of stored){
      if(++pagesRead>bounds.maxPages)fail("PAGE_BOUND_EXCEEDED");
      if(!id(page.id)||BigInt(page.id)<=BigInt(cursor))fail("PAGE_SET_INVALID");cursor=page.id;seen++;
      if(page.available!==true||page.expired!==false||page.retentionPruned!==false||!instant(page.retainUntil)||Date.parse(page.retainUntil)<=now()){
       unavailable=true;continue;
      }
      retainUntil=Math.min(retainUntil,Date.parse(page.retainUntil));
      if(page.origin!=="google_ads"||page.schemaVersion!=="google-raw-datasets-v2"||page.sanitizerVersion!=="google-query-fields-v1"
       ||page.numericFidelity!=="lossless_token"||page.captureLayer!=="native_response_projection"
       ||!Number.isSafeInteger(page.plainBytes)||page.plainBytes<1)fail("PAGE_METADATA_INVALID");
      bytesRead+=page.plainBytes;if(bytesRead>maxBytes)fail("BYTE_BOUND_EXCEEDED");
      const payload=open({...ref,page});check();
      if(payload.family!==page.family||!Array.isArray(payload.records))fail("PAGE_PAYLOAD_INVALID");
      rowsRead+=payload.records.length;if(rowsRead>maxRows)fail("ROW_BOUND_EXCEEDED");
      if(page.family==="pmax_listing_tree_current"){
       if(!Number.isSafeInteger(payload.ordinal)||payload.ordinal<0||typeof payload.hasNextPage!=="boolean"
        ||canonicalSourceJson(payload.selectedFields)!==canonicalSourceJson(page.fieldCoverage))fail("LISTING_PAGE_INVALID");
       listing.push(payload);pageRefs.push({page_id:page.id,payload_hash:page.payloadHash});
      }
     }
    }
    check();if((await repository.readPages({...ref,after:cursor,limit:1})).length)fail("PAGE_SET_INVALID");check();
    if(unavailable){gaps.push({batch_id:batch.batchId,reason:"source_page_expired_pruned_or_unavailable"});continue;}
    if(!listing.length)fail("LISTING_PAGE_MISSING");
    listing.sort((a,b)=>a.ordinal-b.ordinal);
    const expectedQuery=buildGoogleReportingQueries({dateWindow:{start:businessDate,end:businessDate}}).pmax_listing_tree_current;
    const fields=/^SELECT\s+([\s\S]+?)\s+FROM\s/i.exec(expectedQuery)[1].split(",").map(s=>s.trim());
    const nativeRows=[],nativeIds=new Set();let total=null;
    for(const [index,page] of listing.entries()){
     if(page.ordinal!==index||page.hasNextPage!==(index<listing.length-1)||page.query!==expectedQuery
      ||stableJson(page.selectedFields)!==stableJson(fields))fail("LISTING_PAGE_SET_INVALID");
     if(page.declaredTotal!==null){
      if(typeof page.declaredTotal!=="string"||!/^\d{1,19}$/.test(page.declaredTotal)||total!==null&&total!==page.declaredTotal)fail("LISTING_TOTAL_INVALID");
      total=page.declaredTotal;
     }
     for(const record of page.records){
      if(!Array.isArray(record?.fields)||record.fields.length>fields.length)fail("LISTING_ROW_INVALID");
      const row={},keys=new Set();
      for(const field of record.fields){
       if(!fields.includes(field?.field)||keys.has(field.field))fail("LISTING_ROW_INVALID");keys.add(field.field);
       const path=field.field.split(".").map(camel);let node=row;
       for(const part of path.slice(0,-1))node=node[part]??=( {} );
       node[path.at(-1)]=field.value;
      }
      const filter=row.assetGroupListingGroupFilter,resource=filter?.resourceName;
      if(row.customer?.id!==bound.accountId||!id(row.campaign?.id)||!id(row.assetGroup?.id)||!id(filter?.id)||typeof resource!=="string"
       ||resource!==`customers/${bound.accountId}/assetGroupListingGroupFilters/${row.assetGroup.id}~${filter.id}`
       ||nativeIds.has(resource)||!["UNIT_INCLUDED","UNIT_EXCLUDED","SUBDIVISION"].includes(filter.type)
       ||filter.listingSource!=="SHOPPING"||filter.assetGroup!==`customers/${bound.accountId}/assetGroups/${row.assetGroup.id}`)fail("LISTING_ROW_INVALID");
      nativeIds.add(resource);nativeRows.push(row);
     }
    }
    if(total!==null&&BigInt(total)!==BigInt(nativeRows.length))fail("LISTING_TOTAL_INVALID");
    // Detect receipt/page invalidation during the read. Equal receipts are not
    // an atomic provider snapshot or a promise against future privacy deletion.
    check();const after=await repository.inspect(ref);check();
    if(canonicalSourceJson(after)!==canonicalSourceJson(receipt))fail("SOURCE_CHANGED");
    snapshots.push({batch_id:batch.batchId,attempt_id:batch.attemptId,commit_id:receipt.commitId,digest:receipt.digest,
     requested_business_date:businessDate,observation_started_at:read.observedAt,observation_completed_at:read.completedAt,
     tree_hash:createHash("sha256").update(stableJson(nativeRows)).digest("hex"),rows:nativeRows,source_pages:pageRefs,
     valid_from:null,valid_to:null,continuity_verified:false});
   }
   check();if(snapshots.length&&retainUntil<=now())fail("SOURCE_EXPIRED_DURING_READ");
   return copy({status:!batches.length?"missing":!snapshots.length?"unavailable":"observed_history_only",
    requested_business_date:businessDate,requested_timezone:timezone,snapshots,gaps,
    counts:{batches:batches.length,pages:pagesRead,rows:rowsRead,bytes:bytesRead},
    complete:false,historical_coverage_verified:false,native_attribution_verified:false,
    authorizesActivation:false,persistable:false,publishable:false,DatasetWritePerformed:false});
  }});
 }});
 loaders.add(loader);return loader;
}
