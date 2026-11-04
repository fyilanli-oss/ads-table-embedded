import {createKlaviyoSourceCapture} from "../providers/klaviyo-source-capture.server.js";
import {KLAVIYO_ACCOUNTS_ENDPOINT,KLAVIYO_API_REVISION} from "../providers/klaviyo-api.server.js";
import {buildKlaviyoShopifyMetricsRequest,buildKlaviyoCampaignValuesRequest,buildKlaviyoFlowValuesRequest,
 buildKlaviyoPdValuesRequest,buildKlaviyoOrderedProductEventsRequest,normalizeKlaviyoReportRow,
 normalizeKlaviyoOrderedProductEvent,klaviyoBusinessDayTimeframe,selectKlaviyoPdShopifyMetrics,KLAVIYO_PD_CONVERSION_METRICS} from "../providers/klaviyo-reporting.server.js";
const fail=code=>{throw Error(code);};
export function klaviyoRawDelay(ms,signal){return new Promise((resolve,reject)=>{
 if(signal.aborted)return reject(Error("read_aborted"));
 const abort=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);reject(Error("read_aborted"));};
 const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},ms);signal.addEventListener("abort",abort,{once:true});
});}
// Per-endpoint pacing supplements (never replaces) the shared SQL quota boundary.
export function createKlaviyoRawPacer({now,signal,delay=klaviyoRawDelay}){
 const last=new Map();return async kind=>{const spacing={campaign:31000,flow:31000,accounts:4100,metrics:410,events:20}[kind];if(!spacing)return;
  for(;;){if(signal.aborted)fail("read_aborted");const wait=last.has(kind)?spacing-(now()-last.get(kind)):0;if(wait<=0)break;await delay(wait,signal);}
  last.set(kind,now());
 };
}
function cursorOf(body,path,parameter){
 if(!body.links||!Object.hasOwn(body.links,"next"))fail("response_invalid");if(body.links.next===null)return null;
 let next;try{next=new URL(body.links.next);}catch{fail("response_invalid");}
 const cursor=next.searchParams.get(parameter);
 if(next.origin!=="https://a.klaviyo.com"||next.pathname!==path||next.username||next.password||next.hash
  ||next.searchParams.getAll(parameter).length!==1||typeof cursor!=="string"||!cursor||cursor.length>4096||cursor!==cursor.trim())fail("response_invalid");
 return cursor;
}
// Only fixed approved builders; no composition, identity mapping or Profile API.
export async function collectKlaviyoRawDatasets({accessToken,accountId,source,window,limits,transport,guard,signal,now,delay,pacerFactory=createKlaviyoRawPacer,onStartDataset=()=>{},onDataset}){
 const capture=createKlaviyoSourceCapture({maxBytes:limits.maxBytes,check:()=>{if(signal.aborted)fail("read_aborted");},signal});
 const pace=pacerFactory({now,signal,delay}),accountPages=[];let account=null,total=0;
 const headers={authorization:"Bearer "+accessToken,accept:"application/vnd.api+json",revision:KLAVIYO_API_REVISION};
 async function read(request,kind=null){
  await pace(kind??(new URL(request.url).pathname.includes("accounts")?"accounts":new URL(request.url).pathname.includes("metrics")?"metrics":"events"));await guard();const response=await transport(request.url,{method:request.method,headers:request.headers,...request.body==null?{}:{body:request.body}});
  if(!response.ok)fail("provider_http_error");const body=await capture.read(response,request.url);
  if(!body||Array.isArray(body)||body.errors!==undefined&&(!Array.isArray(body.errors)||body.errors.length))fail("response_invalid");
  await guard();const page=capture.finish().at(-1),url=new URL(request.url);
  return {body,page:{family:page.family,...page.payload,request:{method:request.method,path:url.pathname,
   fields:Object.fromEntries([...url.searchParams].filter(([k])=>k.startsWith("fields["))),
   ...request.body==null?{}:{body:JSON.parse(request.body)}},selectedFields:request.body?JSON.parse(request.body).data.attributes.statistics:["records"]}};
 }
 async function readAccount(){const result=await read({url:KLAVIYO_ACCOUNTS_ENDPOINT+"?fields%5Baccount%5D=id%2Cpreferred_currency%2Ctimezone",method:"GET",headers});
  const a=result.body.data;if(!Array.isArray(a)||a.length!==1||a[0]?.type!=="account"||a[0].id!==accountId
   ||a[0].attributes?.timezone!==source.timezone||typeof a[0].attributes?.preferred_currency!=="string"
   ||!/^[A-Z]{3}$/.test(a[0].attributes.preferred_currency))fail("authority_changed");
  const selected={id:a[0].id,timezone:a[0].attributes.timezone,currency:a[0].attributes.preferred_currency};
  if(source.currency!==undefined&&source.currency!==selected.currency)fail("authority_changed");
  if(account&&JSON.stringify(account)!==JSON.stringify(selected))fail("authority_changed");
  account=selected;accountPages.push(result.page);
 }
 onStartDataset("configuration");await readAccount();const timeframe=klaviyoBusinessDayTimeframe({businessDate:window.from,timeZone:account.timezone});
 async function collect(build,{kind=null,validate=()=>{}}={}){
  let cursor=null;const seen=new Set(),pages=[],items=[];
  for(let n=0;n<limits.maxPages;n++){
   const request=build(cursor),result=await read(request,kind),body=result.body;
   const rows=kind===null?body.data:body.data?.attributes?.results;
   if(!Array.isArray(rows)||kind!==null&&body.data?.type!==kind+"-values-report"||body.included!==undefined&&!Array.isArray(body.included))fail("response_invalid");
   total+=rows.length+(body.included?.length??0);if(total>limits.maxRows)fail("row_limit");
   for(const row of rows)validate(row);items.push(...rows);pages.push(result.page);
   const next=cursorOf(body,new URL(request.url).pathname,kind===null?"page[cursor]":"page_cursor");if(next===null)return {pages,items};
   if(seen.has(next))fail("cursor_loop");seen.add(next);cursor=next;
  }fail("page_limit");
 }
 const metrics=await collect(cursor=>buildKlaviyoShopifyMetricsRequest({accessToken,cursor}),{validate:row=>{
  if(row?.type!=="metric"||typeof row.id!=="string"||!/^[A-Za-z0-9_-]{1,256}$/.test(row.id)
   ||typeof row.attributes?.name!=="string"||row.attributes.integration?.name!=="Shopify")fail("response_invalid");
 }});
 if(new Set(metrics.items.map(m=>m.id)).size!==metrics.items.length)fail("response_invalid");
 const selected=selectKlaviyoPdShopifyMetrics(metrics.items),ordered=metrics.items.filter(m=>m.attributes.name==="Ordered Product");
 if(ordered.length>1)fail("response_invalid");
 const proof=[...accountPages,...metrics.pages],entry=(family,metricId,pages,state="present")=>({family,metricId,state,pageCount:pages.length,recordCount:pages.reduce((n,p)=>n+p.records.length,0)});
 await onDataset({dataset:"configuration",pages:proof,complete:true,coverage:[entry("accounts",null,accountPages),entry("metrics",null,metrics.pages)],recordCount:metrics.items.length});
 onStartDataset("account_performance");const reportPages=[],coverage=[];
 for(const name of KLAVIYO_PD_CONVERSION_METRICS)for(const kind of ["campaign","flow"]){
  const m=selected[name],family=kind+":"+name;
  if(m.state!=="present"){coverage.push(entry(family,null,[],"account_configuration_missing"));continue;}
  const result=await collect(pageCursor=>{const input={accessToken,businessDate:window.from,timeZone:account.timezone,conversionMetricId:m.metric_id,pageCursor};
   return name==="Placed Order"?(kind==="campaign"?buildKlaviyoCampaignValuesRequest:buildKlaviyoFlowValuesRequest)(input):buildKlaviyoPdValuesRequest({...input,kind,conversionMetricName:name});
  },{kind,validate:row=>{normalizeKlaviyoReportRow(kind,row);}});
  reportPages.push(...result.pages);coverage.push(entry(family,m.metric_id,result.pages));
 }
 await readAccount();const complete=coverage.every(v=>v.state==="present");
 await onDataset({dataset:"account_performance",pages:[...proof,...reportPages,accountPages.at(-1)],complete,coverage,
  recordCount:complete?reportPages.reduce((n,p)=>n+p.records.length,0):null});
 onStartDataset("product_performance");let events={pages:[],items:[]};
 if(ordered.length){const metricId=ordered[0].id;events=await collect(cursor=>buildKlaviyoOrderedProductEventsRequest({accessToken,orderedProductMetricId:metricId,businessDate:window.from,timeZone:account.timezone,cursor}),{validate:row=>{
   const e=normalizeKlaviyoOrderedProductEvent(row),time=Date.parse(e.occurred_at);
   if(e.provider_metric_id!==metricId||!Number.isFinite(time)||time<Date.parse(timeframe.start)||time>Date.parse(timeframe.end))fail("response_invalid");
  }});
 }
 await readAccount();
 await onDataset({dataset:"product_performance",pages:[...proof,...events.pages,accountPages.at(-1)],complete:ordered.length===1,
  coverage:[entry("ordered_product_events",ordered[0]?.id??null,events.pages,ordered.length?"present":"account_configuration_missing")],recordCount:ordered.length?events.items.length:null});
}
