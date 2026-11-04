const keys=["kind","businessDate","timezone","eligibleFromMs","nativeDayStartMs","includesPreConnectionHours","authorizesReportingDataset"];
const fail=()=>{throw Error("META_RAW_ELIGIBILITY_UNCONFIRMED");};
function midnight(time,timezone){const p=new Intl.DateTimeFormat("en-GB",{timeZone:timezone,hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).format(new Date(time));return p==="00:00:00"&&time%1000===0;}
function day(time,timezone){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(time));
 const get=k=>parts.find(p=>p.type===k)?.value;return `${get("year")}-${get("month")}-${get("day")}`;}
// Database-derived observation scope. It never makes a raw day publishable or
// claims that daily aggregates have been clipped to the connection timestamp.
export function validateMetaRawEligibility(value,{window,source}={}){
 try{
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join()!==keys.slice().sort().join()
   ||value.kind!=="meta_raw_native_business_day_v1"||value.authorizesReportingDataset!==false
   ||typeof value.businessDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value.businessDate)||typeof value.timezone!=="string"
   ||![value.eligibleFromMs,value.nativeDayStartMs].every(n=>Number.isSafeInteger(n)&&Math.abs(n)<=8640000000000000)
   ||typeof value.includesPreConnectionHours!=="boolean"||value.includesPreConnectionHours!==(value.nativeDayStartMs<value.eligibleFromMs)
   ||!midnight(value.nativeDayStartMs,value.timezone)||day(value.nativeDayStartMs,value.timezone)!==value.businessDate
   ||value.includesPreConnectionHours&&day(value.eligibleFromMs,value.timezone)!==value.businessDate
   ||window&&(window.from!==window.to||window.from!==value.businessDate)
   ||source&&(source.provider!=="meta"||source.timezone!==value.timezone||source.eligibleFromMs!==value.eligibleFromMs))fail();
  return Object.freeze({...value});
 }catch{fail();}
}
