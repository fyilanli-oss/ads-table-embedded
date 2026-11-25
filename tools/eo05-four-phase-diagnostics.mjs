import assert from "node:assert/strict";

function queryGroup(phase,sql,args,result) {
  if(phase==="providerCollection"){
    if(/^select current_user as role\b/i.test(sql))return "roleProfile";
    if(/^select operations\.(?:load_refresh_quota_context|resolve_shared_api_quota_route|reserve_shared_api_quota|settle_shared_api_quota|record_shared_api_quota_feedback)\(/i.test(sql))return "quota";
  }
  if(phase==="rawStore"){
    if(/^select evidence\.commit_(?:google|klaviyo)_dataset_source\(/i.test(sql))return "commit";
    if(/^select evidence\.read_source_receipt\(/i.test(sql))return "receipt";
    if(/^select evidence\.read_source_pages\(/i.test(sql)){
      const pages=result?.rows?.[0]?.result;
      return Number(args[4])===1&&Array.isArray(pages)&&pages.length===0?"extraPage":"pages";
    }
  }
  if(phase==="receiptReadback"&&/^select analytics\.inspect_(?:google|klaviyo)_daily_report\(/i.test(sql))return "rpc";
  if(phase==="jobClose"&&/^select analytics\.finish_(?:google|klaviyo)_daily_report_job\(/i.test(sql))return "rpc";
  return null;
}

export async function createFourPhaseDiagnostics(client,provider) {
  assert.equal(client.connectionParameters.host,"127.0.0.1");
  assert.equal(Number(client.connectionParameters.port),54322);
  assert.ok(["google","klaviyo"].includes(provider));
  const sqlMs={receiptReadback:{},jobClose:{}};
  const calls={providerCollection:{},rawStore:{},receiptReadback:{},jobClose:{}};
  const start="phase_trace_started:=clock_timestamp();";
  const emit=label=>`raise notice 'EO05_FOUR_PHASE ${label} %',1000*extract(epoch from clock_timestamp()-phase_trace_started);`;
  const edit=async(signature,points)=>{
    const {rows:[{definition}]}=await client.query("select pg_get_functiondef($1::regprocedure) definition",[signature]);
    let sql=definition;
    for(const [original,replacement,alternate] of points){
      const [from,to]=alternate&&!sql.includes(original)?alternate:[original,replacement];
      assert.equal(sql.split(from).length,2,`four phase SQL anchor: ${signature}: ${from}`);
      sql=sql.replace(from,()=>to);
    }
    await client.query(sql);
  };
  const read="  select * into b from evidence.source_batches";
  const notFound="  if not found then return null; end if;";
  const fingerprint=`  if analytics.${provider}_daily_report_fingerprint`;
  await edit(`analytics.inspect_${provider}_daily_report(jsonb,uuid)`,[
    ["  ref jsonb;","  ref jsonb;\n  phase_trace_started timestamptz;"],
    [read,`  ${start}\n${read}`],
    [notFound,`  ${emit("receiptLookup")}\n${notFound}`],
    [fingerprint,`  ${start}\n${fingerprint}`],
    ["  return receipt;",`  ${emit("fingerprint")}\n  return receipt;`],
  ]);
  const lock="  perform 1 from operations.refresh_control where singleton for update;";
  const inspect=`  r:=analytics.inspect_${provider}_daily_report(o,op);`;
  const finish=`operations.finish_refresh_work_before_stops(w,g,'${provider==="google"?"google_ads":"klaviyo"}',a,j,f,'completed')`;
  await edit(`analytics.finish_${provider}_daily_report_job(jsonb,text,bigint,uuid,text)`,[
    ["  r jsonb;","  r jsonb;\n  phase_trace_started timestamptz;\n  phase_trace_finished boolean;"],
    [lock,`  ${start}\n${lock}\n  ${emit("lockAcquisition")}`],
    [inspect,`  ${start}\n${inspect}\n  ${emit("repeatedInspection")}`],
    [`  return ${finish};`,`  ${start}\n  phase_trace_finished:=${finish};\n  ${emit("finalUpdate")}\n  return phase_trace_finished;`,
      [`  if not ${finish} then return false; end if;`,
        `  ${start}\n  phase_trace_finished:=${finish};\n  ${emit("finalUpdate")}\n  if not phase_trace_finished then return false; end if;`]],
  ]);

  let activePhase=null;
  const onNotice=({message})=>{
    const parts=/^EO05_FOUR_PHASE ([a-zA-Z]+) ([\d.eE+-]+)$/.exec(message);
    if(!parts||!activePhase)return;
    const [,key,value]=parts;
    assert.ok(!Object.hasOwn(sqlMs[activePhase],key),key);
    sqlMs[activePhase][key]=Number(value);
  };
  client.on("notice",onNotice);
  return {
    async query(phase,sql,args,run){
      const group=calls[phase];
      if(!group)return run();
      const observedClosure=phase==="receiptReadback"||phase==="jobClose";
      if(observedClosure)activePhase=phase;
      try{
        const started=performance.now(),result=await run();
        const elapsed=performance.now()-started,key=queryGroup(phase,sql,args,result);
        if(key){
          group[key]??={count:0,wallMs:0};
          group[key].count++;
          group[key].wallMs+=elapsed;
        }
        return result;
      }finally{if(observedClosure)activePhase=null;}
    },
    result(durationsMs,requests){
      assert.ok(calls.providerCollection.roleProfile?.count>0);
      assert.ok(calls.providerCollection.quota?.count>=2*requests);
      assert.ok(calls.rawStore.commit?.count>0&&calls.rawStore.pages?.count>0);
      calls.rawStore.extraPage??={count:0,wallMs:0};
      for(const [phase,group] of Object.entries(calls)){
        assert.ok(Number.isFinite(durationsMs[phase]));
        assert.ok(Object.values(group).reduce((s,value)=>s+value.wallMs,0)<=durationsMs[phase]+0.02,phase);
      }
      for(const phase of ["receiptReadback","jobClose"]){
        assert.equal(calls[phase].rpc?.count,1);
        assert.ok(Number.isFinite(sqlMs[phase].receiptLookup)&&Number.isFinite(sqlMs[phase].fingerprint));
      }
      const closure=sqlMs.jobClose;
      assert.ok([closure.lockAcquisition,closure.repeatedInspection,closure.finalUpdate].every(x=>Number.isFinite(x)&&x>=0));
      assert.ok(closure.receiptLookup+closure.fingerprint<=closure.repeatedInspection+0.01);
      assert.ok(closure.lockAcquisition+closure.repeatedInspection+closure.finalUpdate<=calls.jobClose.rpc.wallMs+0.02);
      return {calls,sqlMs};
    },
    close(){client.off("notice",onNotice);},
  };
}
