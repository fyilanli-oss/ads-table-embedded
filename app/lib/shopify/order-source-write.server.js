import {isShopifyOrderCollectionObservation,takeShopifyOrderSourceObservation} from "./order-collection.server.js";
import {reviewShopifyOrderPrewrite} from "./order-prewrite.server.js";
import {prepareSourceWrite} from "../database/source-evidence-store.server.js";

const fail=()=>{throw Error("SHOPIFY_ORDER_SOURCE_OBSERVATION_INVALID");};

// Internal collector projection, not an HTTP dump or native permission receipt.
// No provider call, inferred attribution, new query field, key lookup or SQL grant.
export function prepareShopifyOrderSourceWrite({collection,owner,attemptId,policy,cipher,limits,now,...extra}={}){
  if(Object.keys(extra).length||!isShopifyOrderCollectionObservation(collection)||owner?.provider!=="shopify")fail();
  reviewShopifyOrderPrewrite({expected:{installationId:owner.installationId,workspaceId:owner.workspaceId,
    installGeneration:Number(owner.generation),shopId:owner.shopId,shopDomain:owner.shopDomain},current:collection});
  const captured=takeShopifyOrderSourceObservation(collection);
  const pages=[],records={references:[],rules:[],mappings:[],orders:[],lines:[],journeys:[],claims:[],links:[]};
  const headers=new Map(),lines=new Map(),journeys=new Map();
  for(const [ordinal,page] of captured.entries()){
    const key="p"+ordinal,payload={records:page.rows,state:page.state,pagination:page.pagination,
      orderId:page.orderId,after:page.after,...page.summary?{summary:page.summary}:{}};
    pages.push({key,family:page.family,ordinal,origin:"shopify",captureLayer:"collector_projection",
      numericFidelity:"decoded_only",fieldCoverage:Object.keys(payload),schemaVersion:"shopify-order-parsed-2026-10-v1",
      sanitizerVersion:"shopify-order-collector-allowlist-v1",payload});
    if(page.family==="order_headers")for(const [i,row] of page.rows.entries())if(!headers.has(row.id))headers.set(row.id,{page:key,locator:"/records/"+i});
    if(page.family==="order_lines")for(const [i,row] of page.rows.entries()){
      const id=page.orderId+":"+row.id;if(!lines.has(id))lines.set(id,{page:key,locator:"/records/"+i});
    }
    if(page.family==="order_journey"){
      const entry=journeys.get(page.orderId)??[];entry.push({page:key,summary:page.summary,rows:page.rows,after:page.after});journeys.set(page.orderId,entry);
    }
  }
  const referenceLocations=new Map();
  function reference(key,location,nativeType,nativeId){
    if(!location)fail();
    const address=location.page+":"+location.locator,existing=referenceLocations.get(address);
    if(existing){if(existing.nativeType!==nativeType||existing.nativeId!==nativeId)fail();return existing.key;}
    const row={key,...location,locatorKind:location.locator==="/summary"?"object":"row",nativeType,nativeId,state:"present"};
    records.references.push(row);referenceLocations.set(address,row);return key;
  }
  for(const [index,order] of collection.orders.entries()){
    const key="o"+index,header=order.header,ref=reference(key,headers.get(header.id),"Order",header.id);
    records.orders.push({key,reference:ref,orderId:header.id,updatedAt:new Date(header.updatedAt).toISOString(),data:header});
    for(const [i,line] of order.lineItems.entries()){
      const lineKey=key+"l"+i,lineRef=reference(lineKey,lines.get(header.id+":"+line.id),"LineItem",line.id);
      records.lines.push({key:lineKey,reference:lineRef,order:key,lineId:line.id,data:line});
    }
    const primary=journeys.get(header.id)?.filter(p=>p.after!==null||p===journeys.get(header.id)[0]);
    if(!primary?.length)fail();
    // Retain page observations, including unavailable/pending states; never turn
    // a missing journey into zero or a paid-platform claim. Rechecks stay in pages.
    for(const [i,page] of primary.entries()){
      const journeyKey=key+"j"+i,journeyRef=reference(journeyKey,{page:page.page,locator:"/summary"},"JourneySummary",null);
      records.journeys.push({key:journeyKey,order:key,kind:"summary",ordinal:i,
        state:page.summary.state==="parsed"?"ready":page.summary.state==="journey_pending"?"pending":"unavailable",
        ready:page.summary.ready,complete:order.journey.fullyPaged,
        data:{...page.summary,moments:page.rows}});
      records.links.push({reference:journeyRef,targetType:"journey",target:journeyKey,role:"summary"});
      for(const [n,row] of page.rows.entries()){
        const momentRef=reference(journeyKey+"m"+n,{page:page.page,locator:"/records/"+n},"CustomerVisit",row.id);
        records.links.push({reference:momentRef,targetType:"journey",target:journeyKey,role:"moment"});
      }
    }
  }
  const orderKeys=new Map(records.orders.map(r=>[r.orderId,r.key]));
  const lineKeys=new Map(records.lines.map(r=>[r.order+":"+r.lineId,r.key]));
  // Consistency rereads are evidence too. Link them so their retention follows
  // the records they support, rather than treating them as disposable raw pages.
  for(const [ordinal,page] of captured.entries()){
    const key="p"+ordinal;
    for(const [i,row] of page.rows.entries()){
      const targetType=page.family==="order_headers"?"order":page.family==="order_lines"?"line":"journey";
      const orderKey=orderKeys.get(page.family==="order_headers"?row.id:page.orderId);
      const target=targetType==="order"?orderKey:targetType==="line"?lineKeys.get(orderKey+":"+row.id):orderKey+"j0";
      if(!target)fail();
      const ref=reference("check"+ordinal+"r"+i,{page:key,locator:"/records/"+i},
        targetType==="order"?"Order":targetType==="line"?"LineItem":"CustomerVisit",row.id);
      records.links.push({reference:ref,targetType,target,role:"consistency"});
    }
    if(page.summary){
      const target=orderKeys.get(page.orderId)+"j0";
      const ref=reference("check"+ordinal+"s",{page:key,locator:"/summary"},"JourneySummary",null);
      records.links.push({reference:ref,targetType:"journey",target,role:"consistency"});
    }
  }
  return prepareSourceWrite({owner,attemptId,ordinal:0,sourceState:collection.journeyPagesComplete?"complete":"partial",
    policy,cipher,limits,now,pages,records});
}
