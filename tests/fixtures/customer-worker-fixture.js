import {randomUUID} from 'node:crypto';
import {sourceStoreFixture} from './source-store-fixture.js';
import {sourcePayloadHash} from '../../app/lib/database/source-evidence-store.server.js';
import {prepareCustomerSourceRun} from '../../app/lib/database/customer-source-privacy.server.js';
const gid=n=>'gid://shopify/Order/'+n;
export function customerWorkerFixture(kind='customer_redact'){
 const {input}=sourceStoreFixture(),runId=randomUUID(),attempt=randomUUID();
 const rows=[{id:gid(101),amount:'12.5000'},{id:gid(102),amount:'9.99'}];
 const page=input.cipher.seal({owner:input.owner,attemptId:attempt,ordinal:0,page:{family:'order_headers',ordinal:0,origin:'shopify',captureLayer:'collector_projection',numericFidelity:'decoded_only',fieldCoverage:['records'],schemaVersion:'v1',sanitizerVersion:'v1'},payload:{records:rows}});
 const snapshot={runId,kind,scope:{version:1,orders:[gid(101)]},digest:'a'.repeat(64),installationId:'1',workspaceId:input.owner.workspaceId,generation:'1',shopId:input.owner.shopId,
 batches:[{id:'1',authority:input.owner,attempt_id:attempt,batch_ordinal:0}],pages:[{...page,id:'1',batchId:'1',available:true}],
 references:rows.map((r,n)=>({id:String(n+1),page_id:'1',record_locator:'/records/'+n,record_hash:sourcePayloadHash(r),native_record_type:'Order'})),links:[],
 orders:rows.map((r,n)=>({id:String(n+1),order_id:r.id,source_reference_id:String(n+1),native_data:r})),lines:[],journeys:[],claims:[]};
 const calls=[];const database={async query(sql,args){calls.push({sql,args});return {rows:[{result:sql.includes('snapshot')?structuredClone(snapshot):{status:'completed'}}]};}};
 return {input,runId,snapshot,database,calls,prepare:()=>prepareCustomerSourceRun({database,cipher:input.cipher,runId})};
}