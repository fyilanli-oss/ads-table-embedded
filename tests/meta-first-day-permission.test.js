import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateMetaRawEligibility} from "../app/lib/refresh/meta-raw-eligibility.server.js";
import {metaRawDatasetsFixture} from "./fixtures/meta-raw-datasets-fixture.js";
import {createMetaRawCaptureExecution} from "../app/lib/refresh/meta-raw-server.server.js";
import {metaFirstDayRehearsalEnvironment} from "../tools/eo05-meta-first-day-probe.mjs";
import {readRuntimeDatabaseConfig} from "../app/lib/database/runtime-postgres.server.js";
import {readMetaSourceDatabaseConfig} from "../app/lib/database/meta-source-postgres.server.js";
import {readMetaRawCoordinatorDatabaseConfig,createMetaRawCoordinatorPostgresClient} from "../app/lib/database/meta-raw-coordinator-postgres.server.js";
import {createGoogleAcceptanceCoordinatorPostgresClient} from "../app/lib/database/google-acceptance-coordinator-postgres.server.js";
import {readShopifyPartnerRuntimeConfig} from "../app/lib/shopify/partner-api.server.js";
import {createConfiguredSourceEvidenceCipher} from "../app/lib/database/source-evidence-config.server.js";

function eligibility(date="2026-11-04",start="2026-11-04T08:00:00Z"){
 const nativeDayStartMs=Date.parse(start);return {kind:"meta_raw_native_business_day_v1",businessDate:date,timezone:"America/Los_Angeles",eligibleFromMs:nativeDayStartMs+6*3600000,nativeDayStartMs,includesPreConnectionHours:true,authorizesReportingDataset:false};
}
for(const [date,start]of [["2026-03-08","2026-03-08T08:00:00Z"],["2026-11-01","2026-11-01T07:00:00Z"],["2026-11-04","2026-11-04T08:00:00Z"]])
test("Meta raw provenance preserves native day across daylight-saving boundaries: "+date,()=>{
 const v=eligibility(date,start);assert.deepEqual(validateMetaRawEligibility(v,{window:{from:date,to:date},source:{provider:"meta",timezone:v.timezone,eligibleFromMs:v.eligibleFromMs}}),v);
 assert.equal(v.authorizesReportingDataset,false);
});
test("Meta later full day explicitly records no pre-connection hours",()=>{const v=eligibility();v.eligibleFromMs-=86400000;v.includesPreConnectionHours=false;assert.deepEqual(validateMetaRawEligibility(v),v);});
for(const mode of ["missing","extra","flag","scope","date","timezone","epoch","window","source","nonmidnight"])
test("Meta raw provenance rejects missing or inconsistent scope: "+mode,()=>{
 let v=eligibility(),o={};if(mode==="missing")v=undefined;if(mode==="extra")v.token="private";if(mode==="flag")v.includesPreConnectionHours=false;
 if(mode==="scope")v.authorizesReportingDataset=true;if(mode==="date")v.businessDate="2026-11-03";if(mode==="timezone")v.timezone="invalid";
 if(mode==="epoch")v.eligibleFromMs+=86400000;if(mode==="window")o.window={from:"2026-11-03",to:"2026-11-04"};
 if(mode==="source")o.source={provider:"meta",timezone:v.timezone,eligibleFromMs:v.eligibleFromMs+1};if(mode==="nonmidnight")v.nativeDayStartMs+=1000;
 assert.throws(()=>validateMetaRawEligibility(v,o),/META_RAW_ELIGIBILITY_UNCONFIRMED/);
});
test("Meta private capture uses only operation-bound Meta admission",async()=>{
 const x=metaRawDatasetsFixture(),execution=createMetaRawCaptureExecution(x.options);const result=await execution.run();await execution.close();assert.equal(result.status,"stored");
 const admissions=x.calls.filter(x=>x.sql.includes("commit_meta_raw_preflight"));assert.equal(admissions.length,1);assert.equal(admissions[0].args[5],x.options.operationId);
 assert.equal(x.calls.some(x=>x.sql.includes("commit_refresh_preflight")),false);
 for(const d of Object.values(result.datasets)){assert.equal(d.eligibility.authorizesReportingDataset,false);assert.equal(d.eligibility.businessDate,x.plan.target.window.from);}
});
for(const mode of ["missing","wrong_epoch"])
test("Meta private capture cannot finish without SQL-derived provenance: "+mode,async()=>{
 const x=metaRawDatasetsFixture();x.hooks.source=(sql,args)=>{
  if(!sql.includes("read_source_receipt"))return;
  const w=x.writes.find(w=>w.attemptId===args[1]);if(!w)return;
  if(mode==="missing")delete w.receipt.manifest.metaRawEligibility;else w.receipt.manifest.metaRawEligibility.eligibleFromMs++;
  return {rows:[{result:w.receipt}]};
 };
 const execution=createMetaRawCaptureExecution(x.options),r=await execution.run();await execution.close();assert.notEqual(r.status,"stored");assert.equal(r.empty,null);assert.equal(r.recordCount,null);
});
test("F01 Meta full-server fixture supplies every existing runtime configuration",()=>{
 const env=metaFirstDayRehearsalEnvironment();readRuntimeDatabaseConfig(env);readMetaSourceDatabaseConfig(env);readMetaRawCoordinatorDatabaseConfig(env);readShopifyPartnerRuntimeConfig(env);createConfiguredSourceEvidenceCipher(env);
 assert.equal(env.VERCEL_ENV,"production");assert.equal(env.ADSTABLE_META_RAW_CAPTURE_ENABLED,"true");
});
test("Prepared Meta first-day SQL leaves generic admission definitions unchanged",()=>{
 const sql=readFileSync(new URL("../supabase/migrations/20261104161732_eo05_meta_raw_first_day.sql",import.meta.url),"utf8");
 assert.doesNotMatch(sql,/create(?: or replace)? function operations\.commit_refresh_/i);
 assert.match(sql,/create function operations\.commit_meta_raw_preflight_with_deadline/);assert.match(sql,/authorizesReportingDataset',false/);
 assert.doesNotMatch(sql,/alter role|create role|create table|insert into operations\.refresh_control/i);
});
test("Meta and Google coordinator adapters reject each other's admission before pool acquisition",async()=>{
 const environment=metaFirstDayRehearsalEnvironment();let connections=0;
 const poolFactory=()=>({on(){},async connect(){connections++;throw Error("forbidden");},async end(){}});
 const meta=createMetaRawCoordinatorPostgresClient({environment,poolFactory}),google=createGoogleAcceptanceCoordinatorPostgresClient({environment,poolFactory});
 await assert.rejects(meta.query("select operations.commit_refresh_preflight_with_deadline($1::bigint,$2::bigint,$3::jsonb,$4::jsonb,$5::jsonb,$6::text,$7::bigint) as result",Array(7).fill(null)));
 await assert.rejects(google.query("select operations.commit_meta_raw_preflight_with_deadline($1::bigint,$2::bigint,$3::jsonb,$4::jsonb,$5::jsonb,$6::uuid,$7::bigint) as result",Array(7).fill(null)));
 assert.equal(connections,0);await meta.close();await google.close();
});
