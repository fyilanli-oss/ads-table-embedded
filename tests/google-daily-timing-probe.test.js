import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assertGoogleTimingTarget,googleTimingParameter,createGoogleTimingLedger,loadObservedGoogleReader} from "../tools/eo05-google-daily-timing-probe.mjs";

test("Google measurement refuses production, alternate project/host and unbound users",()=>{
 assert.equal(assertGoogleTimingTarget({host:"127.0.0.1",port:54322}),"local");
 assert.equal(assertGoogleTimingTarget({host:"aws-1-eu-central-1.pooler.supabase.com",port:5432,user:"adstable_benchmark_google_r1.lxphenczjmueblnonklm"}),"nano");
 for(const c of [{host:"127.0.0.1",port:5432},{host:"aws-1-eu-central-1.pooler.supabase.com",port:6543,user:"adstable_benchmark_google_r1.lxphenczjmueblnonklm"},
  {host:"aws-0-eu-central-1.pooler.supabase.com",port:5432,user:"adstable_benchmark_google_r1.lxphenczjmueblnonklm"},
  {host:"aws-1-eu-central-1.pooler.supabase.com",port:5432,user:"postgres.lxphenczjmueblnonklm"},
  {host:"aws-1-eu-central-1.pooler.supabase.com",port:5432,user:"adstable_benchmark_google_r1.podpwkrpmjiksskxhwsu"}])assert.throws(()=>assertGoogleTimingTarget(c));
});
test("role adapter preserves parameter bytes, nulls and escaped PostgreSQL arrays",()=>{
 assert.equal(googleTimingParameter(Buffer.from([0,255])),"\\x00ff");assert.equal(googleTimingParameter(null),null);
 assert.equal(googleTimingParameter(["a(b,c)",'a"b',"a\\b"]),'{"a(b,c)","a\\"b","a\\\\b"}');
 assert.equal(googleTimingParameter({decimal:"9007199254740993.125"}),'{"decimal":"9007199254740993.125"}');
});
test("outer ledger partitions source DB calls once and preserves the total",async()=>{
 let t=0;const l=createGoogleTimingLedger(()=>t);l.start();t=3;l.phaseAt("queueAndAdmission");t=7;l.phaseAt("reportPreparation");
 await l.sql(async()=>{t=12;},"dataset");t=15;l.phaseAt("reportWrite");await l.sql(async()=>{t=30;},"dataset");
 t=32;l.phaseAt("receiptReadback");t=35;l.phaseAt("jobClose");t=40;const r=l.stop();
 assert.equal(r.totalMs,40);assert.equal(r.postgresCallWallMs,20);assert.equal(r.durationsMs.reportSourceRead,5);assert.equal(r.durationsMs.reportPreparation,3);
 assert.equal(Object.values(r.durationsMs).reduce((a,b)=>a+b,0),40);
});
test("storage observations load a fresh module without changing production source bytes",async()=>{
 const p=new URL("../app/lib/refresh/google-raw-datasets.server.js",import.meta.url),before=readFileSync(p);
 const reader=await loadObservedGoogleReader({raw(){}});assert.equal(typeof reader,"function");
 assert.deepEqual(readFileSync(p),before);delete globalThis[Symbol.for("adstable.google.nano.stage-observer")];
});
