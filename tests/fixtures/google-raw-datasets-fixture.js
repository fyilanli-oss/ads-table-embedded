import {createHash,randomUUID} from "node:crypto";
import {googleRawServerFixture} from "./google-raw-server-fixture.js";
import {googleDatasetNativeRows} from "./dataset-source-binding-fixture.js";
import {buildGoogleReportingQueries} from "../../app/lib/providers/google-reporting.server.js";
import {createConfiguredSourceEvidenceCipher} from "../../app/lib/database/source-evidence-config.server.js";
export function googleRawDatasetsFixture({merchant=false,googleProducts=null,googleSalesProducts=googleProducts}={}) {
 const x=googleRawServerFixture(),writes=[],receipts=new Map(),hooks={};let pageId=0;
 const {merchantId,merchantQuotaAccountId,merchantBindingEpoch,...target}=x.plan.target;
 Object.assign(x.plan,{version:2,target,merchant:merchant?x.f.f.context.merchant:null});
 x.plan.limits.maxRequests=40;x.plan.limits.maxRows=1000;
 for(const vector of [x.f.budget.global,...x.f.budget.providers.map(x=>x.limit),...x.f.budget.workspaces.map(x=>x.limit),...x.f.budget.accounts.map(x=>x.limit)])vector.dbWrites=10000;
 if(!merchant)delete x.f.f.context.merchant;x.setPlan();
 if(googleProducts!==null)x.f.source.eligibleFromMs=Date.parse("2026-10-31T00:00:00Z");
 const queries=buildGoogleReportingQueries({dateWindow:{start:target.window.from,end:target.window.to}});
 x.hooks.fetch=async(u,init)=>{
  const custom=await hooks.fetch?.(u,init);if(custom)return custom;
  if(u.hostname==="googleads.googleapis.com"){
   const query=JSON.parse(init.body).query;
   if(googleProducts!==null){const family=Object.keys(queries).find(f=>queries[f]===query);
    if(family)return Response.json({results:googleDatasetNativeRows(family,target.accountId,{googleProducts,googleSalesProducts})});}
   return Response.json({results:query.includes("FROM product_link")&&merchant?[{productLink:{resourceName:"customers/123/productLinks/7",productLinkId:"7",type:"MERCHANT_CENTER",merchantCenter:{merchantCenterId:"99"}}}]:[]});
  }
  if(u.hostname==="merchantapi.googleapis.com")return Response.json({products:[]});
 };
 x.hooks.source=async(sql,args)=>{
  const custom=await hooks.source?.(sql,args);if(custom)return custom;
  if(sql.startsWith("select evidence.commit_google_dataset_source(")){
   const body=JSON.parse(args[3]),read=JSON.parse(args[4]);
   const receipt={status:"committed",batchId:String(91+writes.length),commitId:randomUUID(),digest:createHash("sha256").update(args[3]).digest("hex"),sourceState:body.sourceState,
    manifest:{googleDatasetRead:read,counts:Object.fromEntries(["pages","references","rules","mappings","orders","lines","journeys","claims","links"].map(k=>[k,body[k].length]))}};
   receipt.manifest.googleDatasetInputDigest=receipt.digest;
   const pages=body.pages.map(p=>({...p,id:String(++pageId),available:true,expired:false,retentionPruned:false}));
   const w={body,read,receipt,pages,owner:JSON.parse(args[0]),attemptId:args[1],ordinal:args[2]};writes.push(w);receipts.set(args[1]+":"+args[2],w);return {rows:[{result:receipt}]};
  }
  if(sql.startsWith("select evidence.read_source_receipt("))return {rows:[{result:receipts.get(args[1]+":"+args[2])?.receipt??null}]};
  if(sql.startsWith("select evidence.read_source_pages("))return {rows:[{result:receipts.get(args[1]+":"+args[2])?.pages.filter(p=>BigInt(p.id)>BigInt(args[3])).slice(0,args[4])??[]}]};
 };
 function datasetInputs(){
  const sourceWrites=writes.filter(w=>["account_performance","product_performance"].includes(w.read.dataset));
  const queries=[];
  const database={async query(sql,args){
   queries.push(sql);const custom=await hooks.dataset?.(sql,args);if(custom)return custom;
   if(sql.includes("assert_source_owner"))return {rows:[{result:null}]};
   if(sql.includes("read_dataset_source_context"))return {rows:[{source:structuredClone(x.f.source),snapshot_hash:"a".repeat(64)}]};
   if(sql.includes("read_source_receipt"))return {rows:[{result:structuredClone(receipts.get(args[1]+":"+args[2])?.receipt)}]};
   if(sql.includes("read_source_pages"))return {rows:[{result:structuredClone(receipts.get(args[1]+":"+args[2])?.pages.filter(p=>BigInt(p.id)>BigInt(args[3])).slice(0,args[4])??[])}]};
   throw Error("UNEXPECTED_SYNTHETIC_DATASET_QUERY");
  }};
  return {database,queries,owner:sourceWrites[0].owner,cipher:createConfiguredSourceEvidenceCipher(x.environment),
   batches:sourceWrites.map(w=>({attemptId:w.attemptId,ordinal:w.ordinal})),now:x.options.now,
   limits:{maxRows:2000,maxPages:100,maxBytes:16777216,deadlineAt:x.options.now()+120000}};
 }
 return {...x,hooks,writes,datasetInputs};
}
