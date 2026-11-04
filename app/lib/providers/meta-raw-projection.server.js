import {parseGoogleRawJson,googleRawScalar} from "./google-raw-projection.server.js";
import {META_AD_CHANNEL_INSIGHTS_FIELDS,META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS} from "./meta-reporting.server.js";

// Reuse the strict lexical JSON parser, without passing Meta numbers through
// Number or admitting arbitrary native fields, URLs, paging links or credentials.
export const parseMetaRawJson=parseGoogleRawJson;
const fail=()=>{throw Error("META_RAW_RESPONSE_INVALID");};
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const actionFields=new Set(["action_type","value","1d_click","7d_click","28d_click","1d_view","7d_view","28d_view"]);
function scalar(v){if(v===null||["string","boolean"].includes(typeof v))return v;
 if(object(v)&&typeof googleRawScalar(v)==="string"&&googleRawScalar(v)!==v)return v;fail();}
function fieldValue(v){if(!Array.isArray(v))return scalar(v);
 return v.map(row=>{if(!object(row)||typeof row.action_type!=="string")fail();
  return Object.fromEntries(Object.entries(row).filter(([k])=>actionFields.has(k)).map(([k,value])=>[k,scalar(value)]));});}
export function projectMetaRawPage(body,{family,ordinal,accountId,window,requestId}){
 if(!object(body)||Object.hasOwn(body,"error")||!Array.isArray(body.data))fail();
 const fields=family==="ad_channel_daily_insights"?META_AD_CHANNEL_INSIGHTS_FIELDS
  :family==="ad_product_breakdown_daily_insights"?[...META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS,"product_id"]:null;
 if(!fields)fail();
 const records=body.data.map(row=>{
  if(!object(row)||row.account_id!==accountId.slice(4)||row.date_start!==window.from||row.date_stop!==window.to
   ||![row.ad_id,row.adset_id,row.campaign_id].every(v=>typeof v==="string"&&/^[1-9][0-9]{0,29}$/.test(v))
   ||family==="ad_product_breakdown_daily_insights"&&(typeof row.product_id!=="string"||!row.product_id))fail();
  return {fields:fields.filter(k=>Object.hasOwn(row,k)).map(field=>({field,value:fieldValue(row[field])}))};
 });
 const next=body.paging?.next;
 if(next!==undefined&&(typeof next!=="string"||!next))fail();
 const cursor=next===undefined?null:body.paging?.cursors?.after;
 if(cursor!==null&&(typeof cursor!=="string"||!cursor||cursor.length>4096||/[\u0000-\u001f\u007f]/.test(cursor)))fail();
 return {page:{family,ordinal,records,selectedFields:fields,hasNextPage:cursor!==null,
  requestId:typeof requestId==="string"&&/^[A-Za-z0-9_-]{1,256}$/.test(requestId)?requestId:null},cursor};
}
