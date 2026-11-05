import {canonicalSourceJson,sourcePayloadHash} from "./source-evidence-store.server.js";
import {isReviewedNonOrderRawPage} from './customer-source-non-order.server.js';
const prepared=new WeakMap();
const fail=code=>{throw Error("SOURCE_PRIVACY_"+code);};
const orderId=value=>typeof value==="string"&&/^gid:\/\/shopify\/Order\/[1-9][0-9]{0,29}$/.test(value)?value
:null;
const freeze=v=>{if(v&&typeof v==="object"){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function bound(snapshot){
 if(!snapshot||!['customer_redact','customer_data_request'].includes(snapshot.kind)||snapshot.scope?.version!==1||!Array.isArray(snapshot.scope.orders)
 ||snapshot.scope.orders.length>1000||snapshot.scope.orders.some(x=>orderId(x)!==x)||!snapshot.digest?.match(/^[a-f0-9]{64}$/))fail("SNAPSHOT_INVALID");
 for(const [k,n]of [['pages',1000],['references',5000],['links',10000],['orders',5000],['lines',5000],['journeys',5000],['claims',5000],['batches',1000]])if(!Array.isArray(snapshot[k])||snapshot[k].length>n)fail("SNAPSHOT_BOUNDS");
 if(snapshot.pages.reduce((n,p)=>n+p.plainBytes,0)>16777216)fail("SNAPSHOT_BOUNDS");
}

// Private, bounded SQL snapshot -> authenticated decrypt -> exact row projection.
// No discovery, customer/profile storage, raw logging or guessed product identity.
export async function prepareCustomerSourceRun({database,cipher,runId}){
 if(typeof database?.query!=="function"||typeof cipher?.open!=="function"||typeof cipher?.seal!=="function"||!runId?.match(/^[a-f0-9-]{36}$/))fail("INPUT_INVALID");
 const response=await database.query("select privacy.customer_source_snapshot($1::uuid) as result",[runId]);
 if(response.rows?.length!==1)fail("SNAPSHOT_INVALID");
 const s=response.rows[0].result;bound(s);if(s.runId!==runId)fail("SNAPSHOT_INVALID");
 const wanted=new Set(s.scope.orders),selectedOrders=new Set(s.orders.filter(x=>wanted.has(x.order_id)).map(x=>String(x.id)));
 const claims=new Map(s.claims.map(x=>[String(x.id),x]));
 const orderByVersion=new Map(s.orders.map(x=>[String(x.id),x.order_id]));
 const claimScope=c=>{
  const native=orderId(c.native_order_reference),linked=c.order_link_state==='verified'&&c.shopify_order_version_id?orderByVersion.get(String(c.shopify_order_version_id)):null;
  if(native&&linked&&native!==linked)fail("SUBJECT_CONFLICT");return linked||native;
 };
 // An unmapped native OrderId is not proof of another customer's identity.
 if(s.claims.some(c=>!claimScope(c)))fail("SUBJECT_UNRESOLVED");
 const subjectByReference=new Map();
 function add(ref,value){if(!value)fail("SUBJECT_UNRESOLVED");const set=subjectByReference.get(String(ref))??new Set();set.add(value);subjectByReference.set(String(ref),set);}
 for(const o of s.orders)add(o.source_reference_id,o.order_id);
 for(const l of s.lines)add(l.source_reference_id,orderByVersion.get(String(l.order_version_id)));
 for(const c of s.claims)add(c.source_reference_id,claimScope(c));
 for(const l of s.links){
  const v=l.order_version_id?orderByVersion.get(String(l.order_version_id)):l.line_version_id?orderByVersion.get(String(s.lines.find(x=>String(x.id)===String(l.line_version_id))?.order_version_id))
   :l.journey_version_id?orderByVersion.get(String(s.journeys.find(x=>String(x.id)===String(l.journey_version_id))?.order_version_id))
   :l.claim_version_id?claimScope(claims.get(String(l.claim_version_id))):null;
  if(v)add(l.source_reference_id,v);
 }
 const changes=[],removedReferences=new Set(),sourceRecords=[];
 for(const page of s.pages){
  const batch=s.batches.find(x=>String(x.id)===page.batchId);if(!batch)fail("SNAPSHOT_INVALID");
  const refs=s.references.filter(r=>String(r.page_id)===page.id);
  const context={owner:batch.authority,attemptId:batch.attempt_id,ordinal:batch.batch_ordinal,page};
  if(!page.available)fail("PROOF_UNAVAILABLE");
  let payload;try{payload=cipher.open(context);}catch{fail("DECRYPT_FAILED");}
  for(const reference of refs){
   let row=payload;
   for(const token of reference.record_locator.split('/').slice(1)){
    const key=token.replaceAll('~1','/').replaceAll('~0','~');
    if(row===null||typeof row!=='object'||!Object.hasOwn(row,key))fail("LOCATOR_INVALID");
    row=row[key];
   }
   if(sourcePayloadHash(row)!==reference.record_hash)fail("REFERENCE_HASH_CHANGED");
  }
  const copy=structuredClone(payload);let modified=false;
  if(isReviewedNonOrderRawPage(page,payload)){
   if(refs.some(r=>subjectByReference.has(String(r.id))))fail('NON_ORDER_SUBJECT_CONFLICT');
   continue;
  }
  if(payload.redacted===true){
   if(Object.keys(payload).sort().join()!=='records,redacted'||!Array.isArray(payload.records)||payload.records.length!==0||refs.length!==0)fail('REDACTED_PROOF_INVALID');
   continue;
  }
  const locations=new Map();
  function at(locator,subjects){
   const set=locations.get(locator)??new Set();for(const x of subjects)set.add(x);locations.set(locator,set);
  }
  for(const r of refs){if(['KlaviyoAccount','KlaviyoMetric','KlaviyoMessageReportRow'].includes(r.native_record_type))continue;const set=subjectByReference.get(String(r.id));if(set)at(r.record_locator,set);}
  if(page.origin==='shopify'){
   if(page.family==='order_headers')for(const [n,row]of payload.records.entries()){if(row!==null){const id=orderId(row.id);if(!id)fail("SUBJECT_UNRESOLVED");at('/records/'+n,[id]);}}
   else if(['order_lines','order_journey'].includes(page.family)){
    const id=orderId(payload.orderId);if(!id)fail("SUBJECT_UNRESOLVED");
    if(wanted.has(id)){
     for(const r of refs)removedReferences.add(String(r.id));
     sourceRecords.push({family:page.family,payload:structuredClone(payload)});
     for(const key of Object.keys(copy))delete copy[key];Object.assign(copy,{records:[],redacted:true});modified=true;
    }
   }else fail("FAMILY_UNSUPPORTED");
  }else if(page.origin==='klaviyo'){
   if(page.family==='klaviyo_ordered_product_events')for(const [n,row]of payload.records.entries()){
    if(row===null)continue;const raw=row.attributes?.event_properties?.OrderId;
    const id=orderId(typeof raw==='object'?raw?.jsonNumber:raw);if(!id)fail("SUBJECT_UNRESOLVED");at('/records/'+n,[id]);
   }
   else if(['klaviyo_interaction','klaviyo_candidate_checks','klaviyo_interaction_checks'].includes(page.family)){
    for(const [n,row]of payload.records.entries())if(row!==null&&!locations.has('/records/'+n))fail("SUBJECT_UNRESOLVED");
   }else if(!['klaviyo_account','klaviyo_metrics','klaviyo_campaign_report','klaviyo_flow_report'].includes(page.family))fail("FAMILY_UNSUPPORTED");
  }else if(page.origin==='google_ads') {if(!['google_merchant_link','google_merchant_status','merchant_products','google_candidate_checks'].includes(page.family))fail("FAMILY_UNSUPPORTED");}
  else if(page.origin==='meta') {if(!['meta_permission_check','meta_catalog_reference','meta_catalog_products','meta_product_report','meta_candidate_checks','meta_report_identity_checks'].includes(page.family))fail("FAMILY_UNSUPPORTED");}
  else fail("FAMILY_UNSUPPORTED");
  if(!modified)for(const [locator,set]of locations){
   if(![...set].some(x=>wanted.has(x)))continue;
   if([...set].some(x=>!wanted.has(x)))fail("SHARED_SUBJECT_DEPENDENCY");
   const match=/^\/(records|included)\/(0|[1-9][0-9]*)$/.exec(locator);
   if(!match)fail("LOCATOR_UNSUPPORTED");const [,key,index]=match;
   if(!Array.isArray(payload[key])||Number(index)>=payload[key].length)fail("LOCATOR_INVALID");
   const row=payload[key][Number(index)];
   for(const r of refs.filter(r=>r.record_locator===locator)){
    if(sourcePayloadHash(row)!==r.record_hash)fail("REFERENCE_HASH_CHANGED");removedReferences.add(String(r.id));
   }
   sourceRecords.push({family:page.family,record:structuredClone(row)});copy[key][Number(index)]=null;modified=true;
  }
  if(modified){
   if(page.origin==='shopify'&&page.family==='order_headers') {if(Object.hasOwn(copy,'after'))copy.after=null;if(Object.hasOwn(copy,'pagination'))copy.pagination={redacted:true};}
   const metadata={...page,fieldCoverage:Object.keys(copy),sanitizerVersion:'source-customer-redact-v1'};
   const sealed=cipher.seal({...context,page:metadata,payload:copy});
   changes.push({...sealed,id:page.id,previousHash:page.payloadHash});
  }
 }
 const artifact=freeze({orders:s.orders.filter(x=>selectedOrders.has(String(x.id))).map(x=>x.native_data),
  lines:s.lines.filter(x=>selectedOrders.has(String(x.order_version_id))).map(x=>x.native_data),
  journeys:s.journeys.filter(x=>selectedOrders.has(String(x.order_version_id))).map(x=>x.payload_projection),
  claims:s.claims.filter(x=>wanted.has(claimScope(x))).map(x=>x.native_data),sourceRecords});
 canonicalSourceJson(artifact); // Bounds and private-field rejection still apply.
 const noCustomerData=Object.values(artifact).every(rows=>rows.length===0);
 const result=Object.freeze({kind:s.kind,noCustomerData,artifact:s.kind==='customer_data_request'?artifact:null});
 prepared.set(result,{runId,digest:s.digest,noCustomerData,changes:{pages:changes,removedReferences:[...removedReferences],matchedSourceRecords:sourceRecords.length},used:false});return result;
}

export async function completeCustomerSourceRun({database,preparedRun,disclosureReceipt=null}){
 const state=prepared.get(preparedRun);if(!state||state.used)fail("PREPARED_RUN_REQUIRED");
 if(preparedRun.kind==='customer_data_request'&&!state.noCustomerData&&!disclosureReceipt?.match(/^[a-f0-9]{64}$/))fail("DISCLOSURE_RECEIPT_REQUIRED");
 if(state.noCustomerData&&disclosureReceipt!==null)fail("INPUT_INVALID");
 if(preparedRun.kind==='customer_redact'&&disclosureReceipt!==null)fail("INPUT_INVALID");
 state.used=true;
 try{const r=await database.query("select privacy.complete_customer_source_run($1::uuid,$2::text,$3::jsonb,$4::text) as result",[state.runId,state.digest,JSON.stringify(state.changes),disclosureReceipt]);
  if(r.rows?.length!==1||r.rows[0].result?.status!=='completed')fail("RESULT_INVALID");return freeze(r.rows[0].result);
 }catch{fail("WRITE_UNCONFIRMED");}
}
