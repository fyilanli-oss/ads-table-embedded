import {randomUUID} from "node:crypto";
import {sourceStoreFixture} from "./source-store-fixture.js";
import {prepareSourceWrite} from "../../app/lib/database/source-evidence-store.server.js";
import {createGooglePmaxHistoryLoader,GOOGLE_PMAX_HISTORY_FIND_SQL} from "../../app/lib/database/google-pmax-history.server.js";
import {buildGoogleReportingQueries} from "../../app/lib/providers/google-reporting.server.js";
import {projectGoogleRawPage,parseGoogleRawJson} from "../../app/lib/providers/google-raw-projection.server.js";

export function pmaxHistoryFixture({owner:givenOwner,now=Date.now}={}) {
 const f=sourceStoreFixture(),owner=givenOwner??{...f.input.owner,provider:"google_ads",connectionId:randomUUID(),
  connectionVersion:"2",credentialId:randomUUID(),accountId:"123",selectionEpoch:"71"};
 const businessDate="2026-10-01",timezone="Europe/Istanbul",calls=[],hooks={};
 const row={customer:{id:owner.accountId},campaign:{id:"10"},assetGroup:{id:"40",name:"Group",status:"ENABLED"},
  assetGroupListingGroupFilter:{resourceName:`customers/${owner.accountId}/assetGroupListingGroupFilters/40~1`,id:"1",
   assetGroup:`customers/${owner.accountId}/assetGroups/40`,path:{dimensions:[]},type:"UNIT_INCLUDED",listingSource:"SHOPPING"}};
 function encode(rows=[row],pageOverrides={}){
  const query=buildGoogleReportingQueries({dateWindow:{start:businessDate,end:businessDate}}).pmax_listing_tree_current;
  const payload={...projectGoogleRawPage(parseGoogleRawJson(JSON.stringify({results:rows})),
   {query,accountId:owner.accountId,family:"pmax_listing_tree_current",ordinal:0,requestId:"synthetic"}),...pageOverrides};
  const write=prepareSourceWrite({...f.input,owner,sourceState:"complete",records:Object.fromEntries(
   ["references","rules","mappings","orders","lines","journeys","claims","links"].map(k=>[k,[]])),
   pages:[{key:"p0",family:payload.family,ordinal:0,origin:"google_ads",captureLayer:"native_response_projection",
    numericFidelity:"lossless_token",fieldCoverage:payload.selectedFields,schemaVersion:"google-raw-datasets-v2",
    sanitizerVersion:"google-query-fields-v1",payload}]});
  return {...write.body.pages[0],id:"1",available:true,expired:false,retentionPruned:false,retainUntil:f.input.policy.raw.until};
 }
 const state={pages:[encode()],receipt:{status:"committed",sourceState:"complete",batchId:"1",commitId:randomUUID(),digest:"a".repeat(64),
  manifest:{counts:{pages:1},googleDatasetRead:{dataset:"product_performance",window:{from:businessDate,to:businessDate},
   observedAt:f.input.now,completedAt:f.input.now}}}};
 const batches=[{batchId:"1",attemptId:f.input.attemptId,ordinal:0,recordedAt:f.input.now,retainUntil:f.input.policy.metadata.until}];
 const database={async query(sql,args){calls.push({sql,args});const custom=await hooks.query?.(sql,args);if(custom)return custom;
  if(sql===GOOGLE_PMAX_HISTORY_FIND_SQL)return {rows:[{result:JSON.stringify(owner)===args[0]&&args[1]===businessDate?batches:[]}]};
  if(sql.startsWith("select evidence.read_source_receipt("))return {rows:[{result:structuredClone(state.receipt)}]};
  if(sql.startsWith("select evidence.read_source_pages("))return {rows:[{result:state.pages.filter(p=>BigInt(p.id)>BigInt(args[3])).slice(0,args[4])}]};
  throw Error("Unexpected SQL in history fixture");
 }};
 const limits={maxBatches:4,maxPages:20,maxBytes:1000000,maxRows:1000,maxElapsedMs:5000};
 const create=(overrides={})=>createGooglePmaxHistoryLoader({database,cipher:f.input.cipher,limits,now,...overrides});
 const input=()=>({owner,businessDate,timezone,deadlineAt:now()+5000});
 return {owner,businessDate,timezone,calls,hooks,state,batches,row,encode,create,input,cipher:f.input.cipher,limits};
}
