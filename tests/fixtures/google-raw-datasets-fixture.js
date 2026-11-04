import {createHash,randomUUID} from "node:crypto";
import {googleRawServerFixture} from "./google-raw-server-fixture.js";
export function googleRawDatasetsFixture({merchant=false}={}) {
 const x=googleRawServerFixture(),writes=[],receipts=new Map(),hooks={};let pageId=0;
 const {merchantId,merchantQuotaAccountId,merchantBindingEpoch,...target}=x.plan.target;
 Object.assign(x.plan,{version:2,target,merchant:merchant?x.f.f.context.merchant:null});
 x.plan.limits.maxRequests=40;x.plan.limits.maxRows=1000;
 for(const vector of [x.f.budget.global,...x.f.budget.providers.map(x=>x.limit),...x.f.budget.workspaces.map(x=>x.limit),...x.f.budget.accounts.map(x=>x.limit)])vector.dbWrites=10000;
 if(!merchant)delete x.f.f.context.merchant;x.setPlan();
 x.hooks.fetch=async(u,init)=>{
  const custom=await hooks.fetch?.(u,init);if(custom)return custom;
  if(u.hostname==="googleads.googleapis.com"){
   const query=JSON.parse(init.body).query;
   return Response.json({results:query.includes("FROM product_link")&&merchant?[{productLink:{resourceName:"customers/123/productLinks/7",productLinkId:"7",type:"MERCHANT_CENTER",merchantCenter:{merchantCenterId:"99"}}}]:[]});
  }
  if(u.hostname==="merchantapi.googleapis.com")return Response.json({products:[]});
 };
 x.hooks.source=async(sql,args)=>{
  const custom=await hooks.source?.(sql,args);if(custom)return custom;
  if(sql.startsWith("select evidence.commit_google_dataset_source(")){
   const body=JSON.parse(args[3]),read=JSON.parse(args[4]);
   const receipt={status:"committed",batchId:String(91+writes.length),commitId:randomUUID(),digest:createHash("sha256").update(args[3]).digest("hex"),sourceState:body.sourceState,
    manifest:{counts:Object.fromEntries(["pages","references","rules","mappings","orders","lines","journeys","claims","links"].map(k=>[k,body[k].length]))}};
   const pages=body.pages.map(p=>({...p,id:String(++pageId),available:true,expired:false,retentionPruned:false}));
   const w={body,read,receipt,pages,owner:JSON.parse(args[0]),attemptId:args[1]};writes.push(w);receipts.set(args[1],w);return {rows:[{result:receipt}]};
  }
  if(sql.startsWith("select evidence.read_source_receipt("))return {rows:[{result:receipts.get(args[1])?.receipt??null}]};
  if(sql.startsWith("select evidence.read_source_pages("))return {rows:[{result:receipts.get(args[1])?.pages.filter(p=>BigInt(p.id)>BigInt(args[3])).slice(0,args[4])??[]}]};
 };
 return {...x,hooks,writes};
}
