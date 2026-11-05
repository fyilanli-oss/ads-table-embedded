import {buildGoogleReportingQueries,GOOGLE_REPORTING_QUERY_FAMILIES} from '../providers/google-reporting.server.js';
import {META_AD_CHANNEL_INSIGHTS_FIELDS,META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS} from '../providers/meta-reporting.server.js';

const queries=buildGoogleReportingQueries({dateWindow:{start:'2026-01-01',end:'2026-01-01'}});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const normalizeDates=s=>typeof s==='string'?s.replace(/\d{4}-\d{2}-\d{2}/g,'<day>'):null;
const fieldRows=(payload,fields)=>Array.isArray(payload.selectedFields)&&same(payload.selectedFields,fields)
 &&Array.isArray(payload.records)&&payload.records.every(row=>row&&Object.keys(row).join()==='fields'
  &&Array.isArray(row.fields)&&new Set(row.fields.map(x=>x.field)).size===row.fields.length
  &&row.fields.every(x=>x&&Object.keys(x).sort().join()==='field,value'&&fields.includes(x.field)));

// Only the existing, fixed aggregate-report producers. A label, missing record,
// unknown family/schema or collector-shaped lookalike is not absence proof.
export function isReviewedNonOrderRawPage(page,payload){
 if(page.origin==='google_ads'&&page.schemaVersion==='google-raw-datasets-v2'
  &&page.sanitizerVersion==='google-query-fields-v1'&&GOOGLE_REPORTING_QUERY_FAMILIES.includes(page.family)){
  const query=queries[page.family],fields=/^SELECT\s+([\s\S]+?)\s+FROM\s/i.exec(query)[1].split(',').map(s=>s.trim());
  return payload.family===page.family&&normalizeDates(payload.query)===normalizeDates(query)&&fieldRows(payload,fields)
   &&Object.keys(payload).every(k=>['family','ordinal','query','requestId','records','selectedFields','hasNextPage','declaredTotal'].includes(k));
 }
 if(page.origin==='meta'&&page.schemaVersion==='meta-raw-datasets-v1'&&page.sanitizerVersion==='meta-query-fields-v1'){
  const fields=page.family==='ad_channel_daily_insights'?META_AD_CHANNEL_INSIGHTS_FIELDS
   :page.family==='ad_product_breakdown_daily_insights'?[...META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS,'product_id']:null;
  return fields!==null&&payload.family===page.family&&fieldRows(payload,fields)
   &&Object.keys(payload).every(k=>['family','ordinal','records','selectedFields','hasNextPage','request','requestId'].includes(k));
 }
 return false;
}
