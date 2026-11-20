import {readFileSync} from "node:fs";
import pg from "pg";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {ownerFixture} from "./eo05b-dataset-storage-probe.mjs";
import {googleDailyTimingProbe,assertGoogleTimingTarget} from "./eo05-google-daily-timing-probe.mjs";
import {SUPABASE_ROOT_CA_2021} from "../app/lib/database/supabase-root-ca-2021.server.js";

// One explicitly bound, rollback-only Nano run. Password only on stdin; no URLs,
// native credentials, result bodies or unbounded SQL diagnostics in output.
assertGoogleTimingTarget({host:"aws-1-eu-central-1.pooler.supabase.com",port:5432,user:process.env.ADSTABLE_GOOGLE_BENCHMARK_USER});
const flags=process.argv.slice(2);
if(flags.length>1||flags.some(flag=>flag!=="--collection-breakdown"))throw Error("GOOGLE_BENCHMARK_SINGLE_RUN_ONLY");
const password=readFileSync(0,"utf8").replace(/^\uFEFF/,"").trim();
if(!/^[a-zA-Z0-9_-]{40,64}$/.test(password))throw Error("GOOGLE_BENCHMARK_TEMP_PASSWORD_REQUIRED");
const client=new pg.Client({host:"aws-1-eu-central-1.pooler.supabase.com",port:5432,database:"postgres",user:process.env.ADSTABLE_GOOGLE_BENCHMARK_USER,
 password,ssl:{ca:SUPABASE_ROOT_CA_2021,rejectUnauthorized:true,servername:"aws-1-eu-central-1.pooler.supabase.com"},connectionTimeoutMillis:10000,application_name:"adstable-google-nano-single-measurement"});
let open=false;
try{
 await client.connect();await client.query("begin");open=true;await client.query("set local role adstable_owner");
 const lineage=JSON.parse(readFileSync(new URL("../contracts/a6-tech-01-f01-migration-lineage-v1.json",import.meta.url),"utf8"));
 // Nano already has the older prerequisites. Only this Google-specific prepared
 // definition is absent; do not reinstall tables or other providers' writers.
 const entries=lineage.prepared_migrations.filter(e=>e.name==="eo05_google_daily_packages");assert.equal(entries.length,1);
 for(const entry of entries){const text=readFileSync(new URL("../"+entry.file,import.meta.url),"utf8").replace(/\r\n/g,"\n").trim();
  assert.equal(createHash("sha256").update(text).digest("hex"),entry.repository_sql_sha256);
  await client.query(text.replace(/^begin;/," ").replace(/commit;$/," "));}
 await client.query("set local role adstable_owner");
 const result=await googleDailyTimingProbe(client,{ownerFixture,collectionDiagnostics:flags.includes("--collection-breakdown")});
 console.log("EO05_GOOGLE_NANO_END_TO_END_PASS "+JSON.stringify(result));
}catch(error){console.error("EO05_GOOGLE_NANO_END_TO_END_STOP",JSON.stringify({code:error.code??null,message:error.message}));process.exitCode=1;}
finally{try{if(open)await client.query("rollback");}finally{await client.end();}}
