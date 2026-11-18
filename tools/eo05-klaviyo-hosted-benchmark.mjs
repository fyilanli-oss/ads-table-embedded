import {readFileSync} from "node:fs";
import pg from "pg";
import {SUPABASE_ROOT_CA_2021} from "../app/lib/database/supabase-root-ca-2021.server.js";
import {ownerFixture} from "./eo05b-dataset-storage-probe.mjs";
import {klaviyoHostedReportProbe} from "./eo05-klaviyo-daily-timing-probe.mjs";

const host="aws-1-eu-central-1.pooler.supabase.com";
const flags=process.argv.slice(2);
if(flags.length>1 || flags.some(flag=>!["--reduce-report-repeats","--details","--cleanup","--compare-details","--compare-phases"].includes(flag))) {
  throw new Error("Invalid benchmark mode");
}
const compareDetails=flags[0]==="--compare-details";
const comparePhases=flags[0]==="--compare-phases";
const hostedDetail=flags[0]==="--details"||compareDetails||comparePhases;
const variants=comparePhases?[{},{phaseCandidate:"ordered-json"},{phaseCandidate:"trigger-source"}]
  .map(variant=>({reportWriteCleanup:true,...variant}))
  :(compareDetails?[false,true]:Array(hostedDetail?1:3).fill(flags[0]==="--cleanup"))
    .map(reportWriteCleanup=>({reportWriteCleanup}));
const reduceReportRepeats=flags.length===1;
const password=readFileSync(0,"utf8").replace(/^\uFEFF/,"").trim();
if(!/^[a-zA-Z0-9_-]{40,64}$/.test(password)) throw new Error("Temporary benchmark database password required on stdin");
const connection={host,port:5432,database:"postgres",user:"adstable_benchmark_session.lxphenczjmueblnonklm",
  password,ssl:{ca:SUPABASE_ROOT_CA_2021,rejectUnauthorized:true,servername:host},connectionTimeoutMillis:10000,
  application_name:"adstable-hosted-klaviyo-benchmark"};
const client=new pg.Client(connection);
try {
  await client.connect();
  for(const [index,variant] of variants.entries()) {
    await client.query("begin");
    try {
      await client.query("set local role adstable_owner");
      const result=await klaviyoHostedReportProbe(client,{ownerFixture,connection,reduceReportRepeats,hostedDetail,...variant});
      console.log("EO05_KLAVIYO_HOSTED_REPORT_PASS "+JSON.stringify({run:index+1,reduceReportRepeats,...variant,...result}));
    } finally {
      await client.query("rollback");
    }
  }
} catch(error) {
  console.error("EO05_KLAVIYO_HOSTED_REPORT_STOP",JSON.stringify({code:error.code,message:error.message}));
  process.exitCode=1;
} finally {
  await client.end();
}
