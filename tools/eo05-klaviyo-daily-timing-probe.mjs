import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createKlaviyoSourcePostgresClient} from "../app/lib/database/klaviyo-source-postgres.server.js";
import {createIdentityRuntimeAuthorityLoader} from "../app/lib/providers/identity-runtime-authority.server.js";
import {loadKlaviyoBackgroundOwner} from "../app/lib/refresh/klaviyo-background-owner.server.js";
import {createTokenVault} from "../app/lib/oauth/token-vault.server.js";
import {createTokenEnvelopeCipher,readProviderTokenKeyring} from "../app/lib/oauth/token-envelope.server.js";
import {createRefreshKlaviyoRawTransport} from "../app/lib/refresh/quota-authority-binding.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {createSourceEvidenceCipher} from "../app/lib/database/source-evidence-store.server.js";
import {storeKlaviyoRawDataset,storeKlaviyoRawProductPackages} from "../app/lib/database/klaviyo-dataset-source-store.server.js";
import {KLAVIYO_DAILY_STAGE_SQL,KLAVIYO_DAILY_PUBLISH_SQL,KLAVIYO_DAILY_INSPECT_SQL,KLAVIYO_DAILY_FINISH_SQL} from "../app/lib/database/dataset-rpc.server.js";
import {collectKlaviyoRawDatasets} from "../app/lib/refresh/klaviyo-raw-collection.server.js";
import {createRefreshEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";
import {runScheduledRefreshCheck} from "../app/lib/refresh/scheduled-queue-check.server.js";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";
import {createFourPhaseDiagnostics} from "./eo05-four-phase-diagnostics.mjs";
import {loadSingleReportCloseCandidate, verifySingleReportCloseRejections} from "./eo05-single-report-close-probe.mjs";
import {installKlaviyoQuotaCandidate,loadKlaviyoRawHashCandidate} from "./eo05-final-synthetic-candidate.mjs";
import {seedShopifyMappingTimingFixture} from "./eo05-shopify-mapping-timing-fixture.mjs";

const productEvents=1000;
const pageSize=200;
const storageLimits={maxRows:1000,maxBytes:1048576};
const bulkWriterCommit="e591f130a19d43db796b23901f1fe36680c3b541";

async function installExactBulkWriter(client) {
  const sql=readFileSync(new URL("../tests/fixtures/eo05-klaviyo-bulk-writer-378.sql",import.meta.url));
  assert.equal(createHash("sha256").update(sql).digest("hex"),
    "9f91643d8c11d61318bf108dc81f217f348d404b218e0f749c360bcfeb513659");
  // Reuse the enclosing rollback transaction instead of committing the migration.
  await client.query(sql.toString("utf8").trim().replace(/^begin;/," ").replace(/commit;$/," "));
  await client.query("set local role adstable_owner");
}

async function installRetentionComparison(client,variant,{measure}) {
  if(!measure&&variant==="current") return;
  if(measure) await client.query(`set local eo05.retention_calls='0';
    create function analytics.eo05_count_report_retention(d date,tz text) returns timestamptz
      language plpgsql set search_path='' as $measure$
      begin
        perform set_config('eo05.retention_calls',(current_setting('eo05.retention_calls')::integer+1)::text,true);
        return analytics.report_retention_until(d,tz);
      end $measure$`);
  const {rows:[{definition}]}=await client.query(
    "select pg_get_functiondef('analytics.commit_dataset_storage(jsonb,jsonb)'::regprocedure) definition");
  let sql=definition;
  function replace(anchor,value) {
    assert.equal(sql.split(anchor).length,2,`retention timing anchor: ${anchor}`);
    sql=sql.replace(anchor,()=>value);
  }
  const policyBlock="\n if p->'policy'->>'version'='report-source-3y-v1' then";
  const originalCall="analytics.report_retention_until((r->>'business_date')::date,r->>'source_timezone')";
  const retentionFn=measure?"analytics.eo05_count_report_retention":"analytics.report_retention_until";
  replace("\nbegin\n",`\n${measure?" eo05_retention_started timestamptz;\n":""}${variant==="cached"?
    " eo05_day date; eo05_timezone text; eo05_until timestamptz;\n":""}\nbegin\n`);
  if(measure) replace(policyBlock,"\n eo05_retention_started:=clock_timestamp();"+policyBlock);
  if(variant==="cached") {
    await client.query(`create temp table eo05_report_retention_cache (
      business_day date, source_timezone text, retain_until timestamptz not null,
      primary key (business_day,source_timezone)
    ) on commit drop`);
    const rowLoop="\n  for item in select value from jsonb_array_elements(p->'rows') loop";
    replace(rowLoop,`
  if staged_klaviyo and verified_day_sources then
   eo05_day:=(p->'rows'->0->'row'->>'business_date')::date;
   eo05_timezone:=p->'rows'->0->'row'->>'source_timezone';
   select retain_until into eo05_until from pg_temp.eo05_report_retention_cache
    where business_day=eo05_day and source_timezone=eo05_timezone;
   if not found then
    eo05_until:=${retentionFn}(eo05_day,eo05_timezone);
    insert into pg_temp.eo05_report_retention_cache values(eo05_day,eo05_timezone,eo05_until);
   end if;
  end if;${rowLoop}`);
    // Preserve verification for every row and retain the original computation
    // for other days, timezones, and unverified or non-staged callers.
    replace(originalCall,`(case when staged_klaviyo and verified_day_sources
      and (r->>'business_date')::date=eo05_day and r->>'source_timezone'=eo05_timezone then eo05_until
      else ${retentionFn}((r->>'business_date')::date,r->>'source_timezone') end)`);
  } else replace(originalCall,originalCall.replace("report_retention_until","eo05_count_report_retention"));
  const afterBlock="\n if (select count(*) from jsonb_array_elements(p->'rows'))";
  if(measure) replace(afterBlock,`\n raise notice 'EO05_RETENTION_COMPARISON %',1000*extract(epoch from clock_timestamp()-eo05_retention_started);${afterBlock}`);
  await client.query(sql);
}

async function installCombinedFactVerification(client) {
  const args="jsonb,jsonb,timestamptz,uuid,jsonb,jsonb";
  async function definition(name) {
    const {rows:[{sql}]}=await client.query("select pg_get_functiondef($1::regprocedure) sql",[`analytics.${name}(${args})`]);
    return sql;
  }
  let check=await definition("check_klaviyo_daily_report_facts");
  const declaration="  item jsonb;\n  fact jsonb;";
  assert.equal(check.split(declaration).length,2);
  check=check.replace(declaration,`  all_matched boolean;
  table_leaves text[];
  leaves text[]:='{}';
  tz text:=c->'sourceContext'->'snapshot'->>'timezone';`);
  const from=check.indexOf("  foreach table_name in array "),to=check.indexOf("  if d<=clock_timestamp()",from);
  assert.ok(from>=0&&to>from);
  check=check.slice(0,from)+`  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    execute format($verify$
      with expected as materialized (
        select item->'row' payload from pg_temp.adstable_klaviyo_daily_report_stage s
        cross join lateral jsonb_array_elements(s.body->'rows') item where item->>'table'=$6
      ), actual as materialized (
        select x.grain_version,x.native_key_hash,to_jsonb(x) fact from analytics.%I x
        where x.workspace_id=$1 and x.installation_id=$2 and x.installation_generation=$3
          and x.platform='klaviyo' and x.platform_account_id=$4 and x.business_date=$5
        limit 4001 for share of x
      )
      select count(*)::integer,coalesce(bool_and(
        payload is not null and fact is not null and fact->>'provider_connection_id' is not distinct from $7
        and fact->>'source_timezone' is not distinct from $8 and (fact->>'retain_until')::timestamptz>clock_timestamp()
        and fact->>'native_key_canonical' is not distinct from payload->>'native_key_canonical'
        and fact->>'payload_digest' is not distinct from payload->>'payload_digest'
        and analytics.klaviyo_report_fact_matches($6,fact,payload) is true
      ),true),coalesce(array_agg(analytics.dataset_digest(jsonb_build_array($6,native_key_hash,fact->>'payload_digest'))
        order by native_key_hash collate "C") filter (where fact is not null),'{}')
      from actual full join expected on grain_version=payload->>'grain_version' and native_key_hash=payload->>'native_key_hash'
    $verify$,table_name) into n,all_matched,table_leaves using w,i,g,a,day,table_name,o->>'connectionId',tz;
    if not all_matched then raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH'; end if;
    total:=total+n;
    if total>(summary->>'rowCount')::integer then raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH'; end if;
    leaves:=leaves||table_leaves;
  end loop;
  if total<>(summary->>'rowCount')::integer then raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH'; end if;
`+check.slice(to);
  const proof="return summary||jsonb_build_object('digest',analytics.dataset_digest(summary));";
  assert.equal(check.split(proof).length,2);
  check=check.replace(proof,"return summary||jsonb_build_object('digest',analytics.dataset_digest(summary),'factsDigest',analytics.dataset_digest(to_jsonb(leaves)));");
  await client.query(check);
  let publish=await definition("publish_klaviyo_staged_report_day");
  const fingerprint="analytics.klaviyo_daily_report_fingerprint(o,day,tz,(proof->>'rowCount')::integer,true)";
  assert.equal(publish.split(fingerprint).length,2);
  publish=publish.replace(fingerprint,"proof->>'factsDigest'");
  await client.query(publish);
}

async function installReportRepeatReduction(client) {
  const signature="jsonb,jsonb,timestamptz,uuid,jsonb,jsonb";
  async function definition(name,args=signature) {
    const {rows:[{sql}]}=await client.query("select pg_get_functiondef($1::regprocedure) sql",[`analytics.${name}(${args})`]);
    return sql;
  }
  function change(sql,from,to) {
    assert.equal(sql.split(from).length,2,`report repeat reduction anchor: ${from}`);
    return sql.replace(from,()=>to);
  }
  async function installPrivateVariant(name,edit) {
    const variant=`${name}_verified`;
    let sql=change(await definition(name),`analytics.${name}(o jsonb, c jsonb, d timestamp with time zone, operation uuid, policy jsonb, digests jsonb)`,
      `analytics.${variant}(o jsonb, c jsonb, d timestamp with time zone, operation uuid, policy jsonb, digests jsonb, verified_summary jsonb)`);
    sql=change(sql," SECURITY DEFINER"," SECURITY INVOKER");
    await client.query(edit(sql));
    await client.query(`revoke all on function analytics.${variant}(${signature},jsonb)
      from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner`);
  }
  const stageCall="analytics.verify_klaviyo_daily_report_stage(o,c,d,operation,policy,digests)";
  await installPrivateVariant("check_klaviyo_daily_report_facts",sql=>
    change(sql,`summary:=${stageCall};`,"summary:=verified_summary;"));
  await installPrivateVariant("write_klaviyo_staged_first_report_day",sql=>{
    sql=change(sql,`  perform ${stageCall};\n`,"");
    return change(sql,"return analytics.check_klaviyo_daily_report_facts(o,c,d,operation,policy,digests);",
      "return analytics.check_klaviyo_daily_report_facts_verified(o,c,d,operation,policy,digests,verified_summary);");
  });
  let publish=change(await definition("publish_klaviyo_staged_report_day"),"  proof jsonb;","  proof jsonb;\n  verified_summary jsonb;");
  publish=change(publish,`perform ${stageCall};`,`verified_summary:=${stageCall};`);
  publish=change(publish,"proof:=analytics.write_klaviyo_staged_first_report_day(o,c,d,operation,policy,digests);",
    "proof:=analytics.write_klaviyo_staged_first_report_day_verified(o,c,d,operation,policy,digests,verified_summary);");
  await client.query(publish);

  let writer=change(await definition("commit_dataset_storage","jsonb,jsonb"),"\nbegin\n",`
  column_metadata jsonb:='{}';
  numeric_columns text[];
  table_metadata jsonb;
begin
`);
  const [catalogStart,catalogEnd]=["  select array_agg(attname::text order by attnum)","   if r->k<>'null'::jsonb"];
  const start=writer.indexOf(catalogStart),end=writer.indexOf(catalogEnd,start);
  assert.ok(start>=0&&end>start);
  const catalog=writer.slice(start,end);
  const exclusions=catalog.match(/and attname not in \([^)]+\)/)?.[0];
  assert.ok(exclusions);
  writer=change(writer,catalog,`  table_metadata:=column_metadata->name;
  if table_metadata is null then
   select coalesce(array_agg(attname::text order by attnum) filter (where true ${exclusions}),'{}'),
     coalesce(array_agg(attname::text order by attnum) filter (where atttypid='numeric'::regtype),'{}')
   into allowed,numeric_columns
   from pg_catalog.pg_attribute
   where attrelid=('analytics.'||name)::regclass and attnum>0 and not attisdropped;
   column_metadata:=column_metadata||jsonb_build_object(name,jsonb_build_object('allowed',allowed,'numeric',numeric_columns));
  else
   allowed:=array(select jsonb_array_elements_text(table_metadata->'allowed'));
   numeric_columns:=array(select jsonb_array_elements_text(table_metadata->'numeric'));
  end if;
  if (select count(*) from jsonb_object_keys(r))<>cardinality(allowed) or not r ?& allowed then raise exception 'DATASET_ROW_SHAPE_INVALID';end if;
  foreach k in array numeric_columns loop
`);
  await client.query(writer);
}

async function installReportWriteCleanup(client) {
  async function rewrite(signature,changes) {
    const {rows:[{definition}]}=await client.query("select pg_get_functiondef($1::regprocedure) definition",[signature]);
    let sql=definition;
    for(const [before,after] of changes) {
      assert.equal(sql.split(before).length,2,`report write cleanup anchor: ${signature}: ${before}`);
      sql=sql.replace(before,()=>after);
    }
    await client.query(sql);
  }
  const digest=expression=>`encode(sha256(convert_to(${expression},'UTF8')),'hex')`;
  await rewrite("analytics.stage_klaviyo_daily_report_package(jsonb,jsonb,jsonb,timestamptz,integer,integer)",[
    ["  package_digest text;","  package_digest text;\n  canonical_package text;"],
    ["  if row_count not between 1 and 200\n    or octet_length(analytics.dataset_json(jsonb_build_object('write',p,'context',c)))>1048576 then",
      `  if row_count between 1 and 200 then
    canonical_package:=analytics.dataset_json(jsonb_build_object('write',p,'context',c));
  end if;
  if row_count not between 1 and 200 or octet_length(canonical_package)>1048576 then`],
    ["package_digest:=analytics.dataset_digest(jsonb_build_object('write',p,'context',c));",
      `package_digest:=${digest("canonical_package")};`],
  ]);
  await rewrite("analytics.commit_dataset_storage(jsonb,jsonb)",[
    [" bulk_rows jsonb:='{}'; bulk_ids",` canonical_package text;
 bulk_table_names text[]:='{}'; bulk_row_values jsonb[]:='{}'; bulk_ids`],
    [" or octet_length(analytics.dataset_json(p))>1048576 then raise exception 'DATASET_INPUT_INVALID';end if;",
      ` then raise exception 'DATASET_INPUT_INVALID';end if;
 canonical_package:=analytics.dataset_json(p);
 if octet_length(canonical_package)>1048576 then raise exception 'DATASET_INPUT_INVALID';end if;`],
    [" h:=analytics.dataset_digest(p);",` h:=${digest("canonical_package")};`],
    ["   bulk_rows:=jsonb_set(bulk_rows,array[name],coalesce(bulk_rows->name,'[]')||jsonb_build_array(injected));",
      "   bulk_table_names:=array_append(bulk_table_names,name);\n   bulk_row_values:=array_append(bulk_row_values,injected);"],
    ["  for name in select jsonb_object_keys(bulk_rows) order by 1 loop\n   select string_agg(quote_ident(key),',' order by key) into cols from jsonb_object_keys(bulk_rows->name->0) key;",
      `  for grouped in
   select target_name,jsonb_agg(body order by ordinal) as payload
   from unnest(bulk_table_names,bulk_row_values) with ordinality as input(target_name,body,ordinal)
   group by target_name order by target_name
  loop
   name:=grouped.target_name;
   select string_agg(quote_ident(key),',' order by key) into cols from jsonb_object_keys(grouped.payload->0) key;`],
    ["using bulk_rows->name,p->'policy'","using grouped.payload,p->'policy'"],
  ]);
  await rewrite("analytics.validate_dataset_fact()",[
    [" permit jsonb;"," permit jsonb; expected_canonical text; source_state_for_ref text; retention_for_ref timestamptz;"],
    [`  if exists(select 1 from evidence.source_batches x where x.id=(ref->>'batch_id')::bigint and x.source_state<>'complete') then all_complete:=false;end if;
  if exists(select 1 from evidence.source_batches x where x.id=(ref->>'batch_id')::bigint and x.retain_until<new.retain_until) then raise exception 'DATASET_SOURCE_POLICY_INVALID';end if;`,
      `  select x.source_state,x.retain_until into strict source_state_for_ref,retention_for_ref
  from evidence.source_batches x where x.id=(ref->>'batch_id')::bigint;
  if source_state_for_ref<>'complete' then all_complete:=false;end if;
  if retention_for_ref<new.retain_until then raise exception 'DATASET_SOURCE_POLICY_INVALID';end if;`],
    [" if new.native_key_canonical is distinct from analytics.dataset_json(expected) or new.native_key_hash is distinct from analytics.dataset_digest(expected)",
      ` expected_canonical:=analytics.dataset_json(expected);
 if new.native_key_canonical is distinct from expected_canonical or new.native_key_hash is distinct from ${digest("expected_canonical")}`],
  ]);
}

async function installOrderedCanonicalJson(client) {
  const {rows:[{definition}]}=await client.query(
    "select pg_get_functiondef('analytics.dataset_json(jsonb,integer)'::regprocedure) definition");
  const start=definition.indexOf("declare result text;");
  const end=definition.indexOf(" if octet_length(result)>1048576",start);
  const keyCheck=definition.slice(start,end).match(/if (length\(k\)[^\n]+)\n   then raise exception 'DATASET_PRIVATE_FIELD'/)?.[1];
  assert.ok(start>=0&&end>start&&keyCheck);
  const candidate=definition.slice(0,start)+`declare result text;
begin
 if depth>32 then raise exception 'DATASET_JSON_BOUNDS';end if;
 if jsonb_typeof(p)='object' then
  if exists(select 1 from jsonb_object_keys(p) as keys(k) where ${keyCheck})
  then raise exception 'DATASET_PRIVATE_FIELD';end if;
  select '{'||coalesce(string_agg(to_jsonb(k)::text||':'||analytics.dataset_json(v,depth+1),',' order by k collate "C"),'')||'}'
   into result from jsonb_each(p) as entries(k,v);
 elsif jsonb_typeof(p)='array' then
  select '['||coalesce(string_agg(analytics.dataset_json(v,depth+1),',' order by ordinal),'')||']'
   into result from jsonb_array_elements(p) with ordinality as entries(v,ordinal);
 else result:=p::text;end if;
`+definition.slice(end);
  const select="select analytics.dataset_json($1::jsonb) as canonical, analytics.dataset_digest($1::jsonb) as digest";
  const corpus=["{}", "[]", "null", JSON.stringify({z:[],a:{z:[true,null,"é\n\""],a:{}}}),
    '{"number":9007199254740993,"decimal":1.2300}'];
  const baseline=[];
  for(const payload of corpus) baseline.push((await client.query(select,[payload])).rows[0]);
  await client.query(candidate);
  for(const [index,payload] of corpus.entries()) {
    assert.deepEqual((await client.query(select,[payload])).rows[0],baseline[index]);
  }
  for(const [payload,expected] of [
    ['{"outer":[{"Secret":"blocked"}]}',"DATASET_PRIVATE_FIELD"],
    [JSON.stringify({["x".repeat(513)]:true}),"DATASET_PRIVATE_FIELD"],
    ["[".repeat(33)+"0"+"]".repeat(33),"DATASET_JSON_BOUNDS"],
    [JSON.stringify("x".repeat(1048576)),"DATASET_JSON_BOUNDS"],
  ]) {
    await client.query("savepoint ordered_json_reject");
    let message;
    try {await client.query(select,[payload]);}
    catch(error) {
      if(error.code!=="P0001") throw error;
      message=error.message;
    } finally {
      await client.query("rollback to savepoint ordered_json_reject");
      await client.query("release savepoint ordered_json_reject");
    }
    assert.equal(message,expected);
  }
}

async function installTriggerSourceReuse(client) {
  async function definition(signature) {
    return (await client.query("select pg_get_functiondef($1::regprocedure) definition",[signature])).rows[0].definition;
  }
  function change(sql,anchor,replacement) {
    assert.equal(sql.split(anchor).length,2,`trigger source reuse anchor: ${anchor}`);
    return sql.replace(anchor,()=>replacement);
  }
  let helper=await definition("analytics.assert_dataset_source(jsonb,jsonb)");
  helper=change(helper,"analytics.assert_dataset_source(", "analytics.eo05_read_verified_source_batch(");
  helper=change(helper,"RETURNS void","RETURNS evidence.source_batches");
  helper=change(helper," SECURITY DEFINER"," SECURITY INVOKER");
  helper=change(helper,"\nend","\n return b;\nend");
  await client.query(helper);
  await client.query(`revoke all on function analytics.eo05_read_verified_source_batch(jsonb,jsonb)
    from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner`);

  let trigger=await definition("analytics.validate_dataset_fact()");
  trigger=change(trigger,"source_state_for_ref text; retention_for_ref timestamptz;",
    "verified_batch evidence.source_batches%rowtype;");
  const start=trigger.indexOf("  for ref in select value from jsonb_array_elements(new.provenance->'sources') loop");
  const end=trigger.indexOf("\n  end loop;",start);
  assert.ok(start>=0&&end>start);
  const contextLoop=trigger.slice(start,end+"\n  end loop;".length);
  assert.ok(contextLoop.includes("DATASET_CONTEXT_SOURCE_MISMATCH"));
  trigger=change(trigger,contextLoop,"");
  const lookupStart=trigger.indexOf("  perform analytics.assert_dataset_source(o,ref);");
  const lookupEnd=trigger.indexOf("\n end loop;",lookupStart);
  assert.ok(lookupStart>=0&&lookupEnd>lookupStart);
  trigger=change(trigger,trigger.slice(lookupStart,lookupEnd),`  verified_batch:=analytics.eo05_read_verified_source_batch(o,ref);
  if context is not null then
   native_read:=verified_batch.manifest->(case new.platform when 'google_ads' then 'googleDatasetRead' when 'meta' then 'metaDatasetRead' else 'klaviyoDatasetRead' end);
   if native_read is null or native_read->>'jobId' is distinct from context->>'job_id' or native_read->>'fence' is distinct from context->>'fence'
   or native_read->'window' is distinct from context->'window' then raise exception 'DATASET_CONTEXT_SOURCE_MISMATCH';end if;
  end if;
  if verified_batch.source_state<>'complete' then all_complete:=false;end if;
  if verified_batch.retain_until<new.retain_until then raise exception 'DATASET_SOURCE_POLICY_INVALID';end if;`);
  await client.query(trigger);
}

// Private transaction-local proof, active only during nested first-day writes.
async function installSharedDaySources(client) {
  await client.query([
    "create function analytics.eo05_active_day(o jsonb,c jsonb) returns jsonb",
    "language plpgsql security invoker set search_path='' as $fn$ declare m jsonb;begin",
    "if pg_catalog.to_regclass('pg_temp.eo05_day_meta') is null then return null;end if;",
    "if not exists(select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass('pg_temp.eo05_day_meta')",
    "and relnamespace=pg_catalog.pg_my_temp_schema() and relowner=current_user::regrole",
    "and relkind='r' and relpersistence='t') then raise exception 'EO05_DAY_PROOF_INVALID';end if;",
    "select body into m from pg_temp.eo05_day_meta;if not found then return null;end if;",
    "if (select count(*) from pg_temp.eo05_day_meta)<>1 or m->'owner' is distinct from o",
    "or m->'context' is distinct from c or m->>'transaction' is distinct from pg_catalog.txid_current()::text",
    "or m->'valid' is distinct from 'true'::jsonb or (m->>'deadline')::timestamptz<=clock_timestamp()",
    "then raise exception 'EO05_DAY_PROOF_INVALID';end if;return m;end $fn$;",
    "create function analytics.eo05_prepare_day(o jsonb,c jsonb,d timestamptz,op uuid,policy jsonb,digests jsonb)",
    "returns void language plpgsql security invoker set search_path='' as $fn$",
    "declare original jsonb;r jsonb;b evidence.source_batches%rowtype;p evidence.source_pages%rowtype;begin",
    "perform evidence.assert_source_owner(o);",
    "if o->>'provider' is distinct from 'klaviyo' or c->'expectedRevision' is distinct from '0'::jsonb",
    "or jsonb_array_length(c->'batchIds') not between 3 and 22 or jsonb_array_length(c->'sources') not between 1 and 300",
    "then raise exception 'EO05_DAY_PROOF_INVALID';end if;",
    "perform analytics.assert_klaviyo_daily_report_claim(o,c,d);",
    "if (select count(*) from pg_temp.adstable_klaviyo_daily_report_stage",
    "where daily_sources_verified and body->>'operationId'=op::text)<>jsonb_array_length(digests)",
    "or exists(select 1 from pg_temp.adstable_klaviyo_daily_report_stage where not daily_sources_verified",
    "or body->>'operationId' is distinct from op::text or digest is distinct from digests->>package_ordinal)",
    "then raise exception 'EO05_DAY_PROOF_INVALID';end if;",
    "if pg_catalog.to_regclass('pg_temp.eo05_day_meta') is null then",
    "create temp table pg_temp.eo05_day_meta(body jsonb not null) on commit drop;",
    "create temp table pg_temp.eo05_day_refs(page_id bigint primary key,source_ref jsonb not null,source_state text not null,",
    "batch_until timestamptz not null,page_until timestamptz not null) on commit drop;end if;",
    "if not exists(select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass('pg_temp.eo05_day_meta')",
    "and relowner=current_user::regrole and relnamespace=pg_catalog.pg_my_temp_schema() and relpersistence='t' and relkind='r')",
    "or not exists(select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass('pg_temp.eo05_day_refs')",
    "and relowner=current_user::regrole and relnamespace=pg_catalog.pg_my_temp_schema() and relpersistence='t' and relkind='r')",
    "then raise exception 'EO05_DAY_PROOF_INVALID';end if;",
    "if exists(select 1 from pg_temp.eo05_day_meta) then raise exception 'EO05_DAY_PROOF_INVALID';end if;",
    "truncate pg_temp.eo05_day_refs;",
    "select source into strict original from operations.refresh_work_bindings",
    "where workspace_id=(o->>'workspaceId')::uuid and install_generation=(o->>'generation')::bigint",
    "and provider='klaviyo' and account_id=o->>'accountId' and job_id=c->'sourceContext'->>'job_id'",
    "and fence=(c->'sourceContext'->>'fence')::bigint and from_date=(c->>'businessDate')::date and to_date=from_date for share;",
    "if original is distinct from c->'sourceContext'->'snapshot'",
    "or evidence.source_hash(original) is distinct from c->'sourceContext'->>'digest'",
    "then raise exception 'EO05_DAY_PROOF_INVALID';end if;",
    "for r in select value from jsonb_array_elements(c->'sources')",
    "order by (value->>'batch_id')::bigint,(value->>'page_id')::bigint loop",
    "perform analytics.assert_dataset_source(o,r);",
    "select * into strict b from evidence.source_batches where id=(r->>'batch_id')::bigint for share;",
    "select * into strict p from evidence.source_pages where id=(r->>'page_id')::bigint for share;",
    "if b.manifest->'privacyRedacted'='true'::jsonb",
    "or b.manifest->'klaviyoDatasetRead'->>'jobId' is distinct from c->'sourceContext'->>'job_id'",
    "or b.manifest->'klaviyoDatasetRead'->>'fence' is distinct from c->'sourceContext'->>'fence'",
    "or b.manifest->'klaviyoDatasetRead'->'window' is distinct from c->'sourceContext'->'window'",
    "then raise exception 'EO05_DAY_PROOF_INVALID';end if;",
    "insert into pg_temp.eo05_day_refs values(p.id,r,b.source_state,b.retain_until,p.retain_until);end loop;",
    "insert into pg_temp.eo05_day_meta values(jsonb_build_object('owner',o,'context',c->'sourceContext',",
    "'source',original,'operation',op,'transaction',pg_catalog.txid_current()::text,'valid',true,'deadline',d,'policy',policy));end $fn$;",
    "create function analytics.eo05_invalidate_day() returns trigger",
    "language plpgsql security invoker set search_path='' as $fn$ begin",
    "if pg_catalog.to_regclass('pg_temp.eo05_day_meta') is null then return null;end if;",
    "if exists(select 1 from pg_temp.eo05_day_meta) then",
    "if tg_op='DELETE' or tg_table_name<>'source_batches'",
    "or (to_jsonb(new)-'manifest') is distinct from (to_jsonb(old)-'manifest')",
    "or ((to_jsonb(new)->'manifest')-'datasetStorageReceipts') is distinct from ((to_jsonb(old)->'manifest')-'datasetStorageReceipts')",
    "then update pg_temp.eo05_day_meta set body=jsonb_set(body,'{valid}','false'::jsonb);end if;end if;return null;end $fn$;",
    ...["evidence.source_batches","evidence.source_pages","operations.refresh_work_bindings"].map(table=>
      "create trigger eo05_invalidate_day after update or delete on "+table+" for each row execute function analytics.eo05_invalidate_day();"),
    "revoke all on function analytics.eo05_active_day(jsonb,jsonb),analytics.eo05_prepare_day(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb),",
    "analytics.eo05_invalidate_day() from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;",
  ].join("\n"));
  const get=async signature=>(await client.query("select pg_get_functiondef($1::regprocedure) definition",[signature])).rows[0].definition;
  const change=(sql,from,to)=>{assert.equal(sql.split(from).length,2,"shared day anchor: "+from);return sql.replace(from,()=>to);};
  let writer=await get("analytics.write_klaviyo_staged_first_report_day_verified(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb,jsonb)");
  writer=change(writer,"analytics.write_klaviyo_staged_first_report_day_verified(","analytics.eo05_first_day_before_shared(");
  await client.query(writer);
  await client.query([
    "revoke all on function analytics.eo05_first_day_before_shared(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb,jsonb)",
    "from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;",
    "create or replace function analytics.write_klaviyo_staged_first_report_day_verified(",
    "o jsonb,c jsonb,d timestamptz,operation uuid,policy jsonb,digests jsonb,verified_summary jsonb)",
    "returns jsonb language plpgsql security invoker set search_path='' as $fn$ declare result jsonb;begin",
    "perform analytics.eo05_prepare_day(o,c,d,operation,policy,digests);",
    "result:=analytics.eo05_first_day_before_shared(o,c,d,operation,policy,digests,verified_summary);",
    "truncate pg_temp.eo05_day_meta,pg_temp.eo05_day_refs;return result;end $fn$;",
  ].join("\n"));
  // Exceptions unwind proof population and report rows with the same statement.
  let trigger=await get("analytics.validate_dataset_fact()");
  trigger=change(trigger," retention_for_ref timestamptz;"," retention_for_ref timestamptz; shared_day jsonb; shared_ref record;");
  trigger=change(trigger," o:=b.authority; perform evidence.assert_source_owner(o);",
    " o:=b.authority; perform evidence.assert_source_owner(o);\n shared_day:=analytics.eo05_active_day(o,new.provenance->'source_context');");
  const bindingStart=trigger.indexOf("  select source into original_source from operations.refresh_work_bindings");
  const bindingEnd=trigger.indexOf(" for share;",bindingStart)+" for share;".length;
  assert.ok(bindingStart>=0&&bindingEnd>bindingStart);
  const binding=trigger.slice(bindingStart,bindingEnd);
  trigger=change(trigger,binding,"  if shared_day is null then\n"+binding+"\n  else original_source:=shared_day->'source';end if;");
  trigger=change(trigger,"  if not found or original_source is distinct",
    "  if (shared_day is null and not found) or original_source is distinct");
  trigger=change(trigger,"evidence.source_hash(original_source) is distinct from context->>'digest'",
    "(case when shared_day is null then evidence.source_hash(original_source) else shared_day->'context'->>'digest' end) is distinct from context->>'digest'");
  const firstStart=trigger.indexOf("  for ref in select value from jsonb_array_elements(new.provenance->'sources') loop");
  const firstEnd=trigger.indexOf("\n  end loop;",firstStart)+"\n  end loop;".length;
  assert.ok(firstStart>=0&&firstEnd>firstStart);
  const first=trigger.slice(firstStart,firstEnd);
  trigger=change(trigger,first,"  if shared_day is null then\n"+first+"\n  end if;");
  const secondStart=trigger.indexOf("  perform analytics.assert_dataset_source(o,ref);");
  const secondEnd=trigger.indexOf("\n end loop;",secondStart);
  assert.ok(secondStart>=0&&secondEnd>secondStart);
  const second=trigger.slice(secondStart,secondEnd);
  trigger=change(trigger,second,[
    "  if shared_day is null then",second,"  else",
    "    select * into shared_ref from pg_temp.eo05_day_refs r where r.page_id=(ref->>'page_id')::bigint and r.source_ref=ref;",
    "    if not found or shared_ref.batch_until<=clock_timestamp() or shared_ref.page_until<=clock_timestamp()",
    "      then raise exception 'EO05_DAY_SOURCE_INVALID';end if;",
    "    if shared_ref.source_state<>'complete' then all_complete:=false;end if;",
    "    if shared_ref.batch_until<new.retain_until then raise exception 'DATASET_SOURCE_POLICY_INVALID';end if;",
    "  end if;",
  ].join("\n"));
  await client.query(trigger);
}

// Isolated protocol correction: never turn an individual partial batch into a
// complete one. Only the exact private, verified staged day may revise its rows.
async function installMultipartRevisionPermit(client,{verify=false}={}) {
  await client.query([
    "create function analytics.eo05_multipart_revision_allowed(o jsonb,p jsonb,j jsonb,t text) returns boolean",
    "language plpgsql security invoker set search_path='' as $fn$ declare b evidence.source_batches%rowtype;begin",
    "if o->>'provider' is distinct from 'klaviyo' or t is distinct from 'cpd_product_sales_facts'",
    "or j->>'platform' is distinct from 'klaviyo' or p->>'transactionId' is distinct from pg_catalog.txid_current()::text",
    "or p->>'table' is distinct from t or p->>'id' is distinct from j->>'id'",
    "or p->>'toRevision' is distinct from j->>'revision' or p->>'after' is distinct from j->>'payload_digest'",
    "or p->>'dailyOperation' is null or p->>'dailyBinding' is null",
    "or j->>'workspace_id' is distinct from o->>'workspaceId' or j->>'installation_id' is distinct from o->>'installationId'",
    "or j->>'installation_generation' is distinct from o->>'generation'",
    "or j->>'provider_connection_id' is distinct from o->>'connectionId'",
    "or j->>'platform_account_id' is distinct from o->>'accountId'",
    "or (j->>'retain_until')::timestamptz<=clock_timestamp() then return false;end if;",
    "if not exists(select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass('pg_temp.adstable_klaviyo_daily_report_stage')",
    "and relnamespace=pg_catalog.pg_my_temp_schema() and relowner=current_user::regrole and relpersistence='t' and relkind='r')",
    "then return false;end if;",
    "select * into b from evidence.source_batches where id=(j->>'source_batch_id')::bigint and authority=o",
    "and storage_state='committed' and source_state='partial' and handoff_state='pending'",
    "and retain_until>clock_timestamp() and manifest->'privacyRedacted' is distinct from 'true'::jsonb;",
    "if not found or b.manifest->'klaviyoDatasetRead'->>'dataset' is distinct from 'product_performance'",
    "or jsonb_typeof(b.manifest->'klaviyoDatasetRead'->'packageCount') is distinct from 'number'",
    "or (b.manifest->'klaviyoDatasetRead'->>'packageCount')::int not between 2 and 20",
    "or b.manifest->'klaviyoDatasetRead'->>'jobId' is distinct from j->'provenance'->'source_context'->>'job_id'",
    "or b.manifest->'klaviyoDatasetRead'->>'fence' is distinct from j->'provenance'->'source_context'->>'fence'",
    "or b.manifest->'klaviyoDatasetRead'->'window' is distinct from j->'provenance'->'source_context'->'window'",
    "then return false;end if;",
    "return exists(select 1 from pg_temp.adstable_klaviyo_daily_report_stage s",
    "cross join lateral jsonb_array_elements(s.body->'rows') e",
    "where s.daily_sources_verified and s.day_binding=p->>'dailyBinding'",
    "and s.body->>'operationId'=p->>'dailyOperation' and e->>'table'=t",
    "and e->'row'->>'native_key_hash'=j->>'native_key_hash' and e->'row'->>'payload_digest'=p->>'after'",
    "and e->'row'->'provenance'->'source_context'=j->'provenance'->'source_context'",
    "and analytics.klaviyo_report_fact_matches(t,j,e->'row'));end $fn$;",
    "revoke all on function analytics.eo05_multipart_revision_allowed(jsonb,jsonb,jsonb,text)",
    "from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;",
  ].join("\n"));
  const get=async signature=>(await client.query("select pg_get_functiondef($1::regprocedure) definition",[signature])).rows[0].definition;
  const change=(sql,a,b)=>{assert.equal(sql.split(a).length,2,"multipart revision anchor: "+a);return sql.replace(a,()=>b);};
  let replacement=await get("analytics.replace_klaviyo_staged_report_day(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)");
  replacement=change(replacement,"for s in select body from pg_temp.adstable_klaviyo_daily_report_stage",
    "for s in select body,day_binding from pg_temp.adstable_klaviyo_daily_report_stage");
  replacement=change(replacement,"'transactionId',pg_catalog.txid_current()::text,'table',table_name,'id',old_fact->>'id',",
    "'transactionId',pg_catalog.txid_current()::text,'dailyOperation',operation::text,'dailyBinding',s.day_binding,'table',table_name,'id',old_fact->>'id',");
  // The plan above validates the owned staged day before any replacement. Hold
  // each distinct source once, in deterministic order, inside this transaction;
  // the original hold still checks live expiry/privacy and locks the source.
  // Do not repeatedly UPDATE all source references for every product row.
  replacement=change(replacement,
    "  perform analytics.plan_klaviyo_staged_report_replacement(o,c,d,operation,policy,digests);",
    ["  perform analytics.plan_klaviyo_staged_report_replacement(o,c,d,operation,policy,digests);",
     "  for source_id in select distinct (ref->>'batch_id')::bigint",
     "    from pg_temp.adstable_klaviyo_daily_report_stage staged",
     "    cross join lateral jsonb_array_elements(staged.body->'rows') entry",
     "    cross join lateral jsonb_array_elements(entry->'row'->'provenance'->'sources') ref",
     "    order by 1 loop",
     "    perform analytics.hold_report_source_batch(o,source_id,(policy->>'until')::timestamptz);",
     ...verify?["    insert into pg_temp.eo05_revision_retention_holds values(source_id,policy);"]:[],
     "  end loop;"].join("\n"));
  replacement=change(replacement,
    "      for source_id in select distinct (ref->>'batch_id')::bigint from jsonb_array_elements(r->'provenance'->'sources') ref loop\n        perform analytics.hold_report_source_batch(o,source_id,(policy->>'until')::timestamptz);\n      end loop;",
    "      -- Source retention held once for this validated staged day above.");
  await client.query(replacement);
  let validator=await get("analytics.validate_dataset_fact()");
  validator=change(validator,"and storage_state='committed' and source_state='complete' and handoff_state='pending';",
    "and storage_state='committed' and (source_state='complete' or (source_state='partial' and analytics.eo05_multipart_revision_allowed(authority,manifest->'datasetRevisionPermit',to_jsonb(new),tg_table_name))) and handoff_state='pending';");
  await client.query(validator);
  if(verify) await installMultipartRevisionChecks(client);
}

async function installMultipartRevisionChecks(client) {
  await client.query([
    "create temp table eo05_revision_retention_holds(batch_id bigint primary key,policy jsonb not null) on commit drop;",
    "create temp table eo05_revision_checks(n integer not null) on commit drop;insert into eo05_revision_checks values(0);",
    "alter function analytics.eo05_multipart_revision_allowed(jsonb,jsonb,jsonb,text) rename to eo05_multipart_revision_unmetered;",
    "create function analytics.eo05_multipart_revision_allowed(o jsonb,p jsonb,j jsonb,t text) returns boolean",
    "language plpgsql security invoker set search_path='' as $fn$",
    "declare accepted boolean;v jsonb;ids jsonb;begin",
    "accepted:=analytics.eo05_multipart_revision_unmetered(o,p,j,t);",
    "if accepted and (select n=0 from pg_temp.eo05_revision_checks) then",
    "update pg_temp.eo05_revision_checks set n=1;",
    "for v in select value from jsonb_array_elements(jsonb_build_array(",
    "p-'dailyOperation',p-'dailyBinding',jsonb_set(p,'{transactionId}','\"stale\"'),",
    "jsonb_set(p,'{dailyOperation}','\"foreign\"'),jsonb_set(p,'{dailyBinding}','\"foreign\"'),",
    "jsonb_set(p,'{after}','\"foreign\"'),jsonb_set(p,'{toRevision}','\"999999\"'))) loop",
    "if analytics.eo05_multipart_revision_unmetered(o,v,j,t) then raise exception 'EO05_REVISION_NEGATIVE_FAILED';end if;",
    "update pg_temp.eo05_revision_checks set n=n+1;end loop;",
    "for v in select value from jsonb_array_elements(jsonb_build_array(",
    "jsonb_set(j,'{workspace_id}','\"00000000-0000-4000-8000-000000000000\"'),",
    "jsonb_set(j,'{native_key_hash}','\"foreign\"'),jsonb_set(j,'{sales_quantity}','999'),",
    "jsonb_set(j,'{provenance,source_context,fence}','\"999999\"'),",
    "jsonb_set(j,'{retain_until}',to_jsonb((clock_timestamp()-interval '1 day')::text)))) loop",
    "if analytics.eo05_multipart_revision_unmetered(o,p,v,t) then raise exception 'EO05_REVISION_NEGATIVE_FAILED';end if;",
    "update pg_temp.eo05_revision_checks set n=n+1;end loop;",
    "update pg_temp.adstable_klaviyo_daily_report_stage set daily_sources_verified=false;",
    "if analytics.eo05_multipart_revision_unmetered(o,p,j,t) then raise exception 'EO05_REVISION_NEGATIVE_FAILED';end if;",
    "update pg_temp.adstable_klaviyo_daily_report_stage set daily_sources_verified=true;",
    "update pg_temp.eo05_revision_checks set n=n+1;",
    "select jsonb_agg(id::text order by batch_ordinal) into ids from evidence.source_batches",
    "where authority=o and source_state='partial' and handoff_state='pending'",
    "and manifest->'klaviyoDatasetRead'->>'jobId'=j->'provenance'->'source_context'->>'job_id'",
    "and manifest->'klaviyoDatasetRead'->>'dataset'='product_performance';",
    "perform evidence.assert_klaviyo_daily_product_packages(o,j->'provenance'->'source_context'->>'job_id',",
    "(j->'provenance'->'source_context'->>'fence')::bigint,(j->>'business_date')::date,ids);",
    "begin",
    "perform evidence.assert_klaviyo_daily_product_packages(o,j->'provenance'->'source_context'->>'job_id',",
    "(j->'provenance'->'source_context'->>'fence')::bigint,(j->>'business_date')::date,ids-0);",
    "raise exception 'EO05_REVISION_NEGATIVE_FAILED';",
    "exception when raise_exception then",
    "if SQLERRM not like 'KLAVIYO_DAILY_SOURCE_%' then raise;end if;end;",
    "update pg_temp.eo05_revision_checks set n=n+1;",
    "end if;return accepted;end $fn$;",
    "revoke all on function analytics.eo05_multipart_revision_allowed(jsonb,jsonb,jsonb,text)",
    "from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;",
  ].join("\n"));
}

async function verifySharedDaySources(client,args) {
  const owner=JSON.parse(args[0]),context=JSON.parse(args[1]);
  const active="select analytics.eo05_active_day($1::jsonb,$2::jsonb) as result";
  const prepare="select analytics.eo05_prepare_day($1::jsonb,$2::jsonb,$3::timestamptz,$4::uuid,$5::jsonb,$6::jsonb)";
  assert.equal((await client.query(active,[owner,context.sourceContext])).rows[0].result,null);
  await client.query("savepoint shared_day_correctness");
  let checks=0;
  try {
    await client.query(prepare,args);
    assert.equal((await client.query(active,[owner,context.sourceContext])).rows[0].result.valid,true);
    const {rows:[{fact}]}=await client.query("select to_jsonb(x) fact from analytics.cpd_product_sales_facts x where installation_id=$1 limit 1",[owner.installationId]);
    const insert="insert into analytics.cpd_product_sales_facts overriding system value select * from jsonb_populate_record(null::analytics.cpd_product_sales_facts,$1::jsonb)";
    async function reject(run,expected) {
      await client.query("savepoint shared_day_negative");
      let message;
      try {await run();}
      catch(error) {if(error.code!=="P0001") throw error;message=error.message;}
      finally {
        await client.query("rollback to savepoint shared_day_negative");
        await client.query("release savepoint shared_day_negative");
      }
      assert.equal(message,expected);
      checks++;
    }
    for(const [key,value] of [["generation","999999"],["connectionVersion","999999"],["accountId","foreign"]]) {
      await reject(()=>client.query(active,[{...owner,[key]:value},context.sourceContext]),"EO05_DAY_PROOF_INVALID");
    }
    for(const [key,value] of [["job_id","foreign"],["fence","999999"],["window",{from:"1900-01-01",to:"1900-01-01"}]]) {
      await reject(()=>client.query(active,[owner,{...context.sourceContext,[key]:value}]),"EO05_DAY_PROOF_INVALID");
    }
    const altered=structuredClone(fact);
    altered.provenance.sources[0].payload_hash="0".repeat(64);
    await reject(()=>client.query(insert,[altered]),"EO05_DAY_SOURCE_INVALID");
    await reject(()=>client.query(insert,[{...fact,source_currency:"EUR"}]),"DATASET_CONTEXT_MISMATCH");
    await reject(()=>client.query(insert,[{...fact,provenance:{...fact.provenance,sources:[]}}]),"DATASET_PROVENANCE_INVALID");
    const ref=context.sources[0];
    await reject(()=>client.query("update evidence.source_pages set purged_at=clock_timestamp() where id=$1",[ref.page_id]),"DATASET_EVIDENCE_PINNED");
    for(const [sql,parameters] of [
      ["update evidence.source_pages set retain_until=retain_until+interval '1 second' where id=$1",[ref.page_id]],
      ["update evidence.source_batches set manifest=manifest||'{\"privacyRedacted\":true}'::jsonb where id=$1",[ref.batch_id]],
      ["update operations.refresh_work_bindings set source=source||'{\"timezone\":\"Europe/Paris\"}'::jsonb where workspace_id=$1 and job_id=$2",[owner.workspaceId,context.sourceContext.job_id]],
      ["update pg_temp.eo05_day_meta set body=jsonb_set(body,'{deadline}',to_jsonb((clock_timestamp()-interval '1 second')::text))",[]],
      ["update pg_temp.eo05_day_meta set body=jsonb_set(body,'{transaction}','\"not-current-transaction\"'::jsonb)",[]],
      ["alter table pg_temp.eo05_day_meta rename to eo05_real_day_meta; create temp view eo05_day_meta as select * from pg_temp.eo05_real_day_meta",[]],
    ]) {
      await reject(async()=>{await client.query(sql,parameters);await client.query(active,[owner,context.sourceContext]);},"EO05_DAY_PROOF_INVALID");
    }
    await client.query("truncate pg_temp.eo05_day_meta,pg_temp.eo05_day_refs");
    assert.equal((await client.query(active,[owner,context.sourceContext])).rows[0].result,null);
  } finally {
    await client.query("rollback to savepoint shared_day_correctness");
    await client.query("release savepoint shared_day_correctness");
  }
  assert.equal(checks,16);
  return checks;
}

async function installReadbackMetadataReuse(client) {
  const {rows:[{canonicalDefinition}]}=await client.query(
    "select pg_get_functiondef('analytics.dataset_json(jsonb,integer)'::regprocedure) as \"canonicalDefinition\"");
  let fastCanonical=canonicalDefinition.replaceAll("analytics.dataset_json","analytics.eo05_readback_json");
  assert.notEqual(fastCanonical,canonicalDefinition);
  const child="analytics.eo05_readback_json(v,depth+1)";
  assert.equal(fastCanonical.split(child).length,3);
  fastCanonical=fastCanonical.replaceAll(child,`(case when jsonb_typeof(v) in ('object','array')
    then analytics.eo05_readback_json(v,depth+1) else v::text end)`);
  const objectBranch=" if jsonb_typeof(p)='object' then";
  assert.equal(fastCanonical.split(objectBranch).length,2);
  fastCanonical=fastCanonical.replace(objectBranch,` if depth=32 and
   ((jsonb_typeof(p)='object' and p<>'{}'::jsonb) or (jsonb_typeof(p)='array' and p<>'[]'::jsonb))
 then raise exception 'DATASET_JSON_BOUNDS';end if;
${objectBranch}`);
  await client.query(fastCanonical);
  await client.query(`revoke all on function analytics.eo05_readback_json(jsonb,integer)
    from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner`);
  for(const [payload,depth] of [
    ["{}",0],["[]",0],["null",0],['{"a":[true,null,1.2300,{"b":"é"}],"z":9007199254740993}',0],
    [JSON.stringify({value:'line\nquote"slash\\'}),0],["0",32],["{}",32],["[]",32],
  ]) {
    const {rows:[{original,candidate}]}=await client.query(`select analytics.dataset_json($1::jsonb,$2) as original,
      analytics.eo05_readback_json($1::jsonb,$2) as candidate`,[payload,depth]);
    assert.equal(candidate,original);
  }
  for(const [payload,depth,expected] of [
    ['{"a":[{"secret":"blocked"}]}',0,"DATASET_PRIVATE_FIELD"],
    [JSON.stringify({["x".repeat(513)]:1}),0,"DATASET_PRIVATE_FIELD"],
    ['{"a":1}',32,"DATASET_JSON_BOUNDS"],["[0]",32,"DATASET_JSON_BOUNDS"],
    ["[".repeat(33)+"0"+"]".repeat(33),0,"DATASET_JSON_BOUNDS"],
    [JSON.stringify("x".repeat(1048576)),0,"DATASET_JSON_BOUNDS"],
  ]) {
    for(const name of ["dataset_json","eo05_readback_json"]) {
      await client.query("savepoint readback_json_reject");
      let failure;
      try {await client.query(`select analytics.${name}($1::jsonb,$2)`,[payload,depth]);}
      catch(error) {if(error.code!=="P0001") throw error;failure=error.message;}
      finally {
        await client.query("rollback to savepoint readback_json_reject");
        await client.query("release savepoint readback_json_reject");
      }
      assert.equal(failure,expected);
    }
  }
  const {rows:[{definition}]}=await client.query(
    "select pg_get_functiondef('analytics.reconciliation_fact_digest(text,jsonb)'::regprocedure) definition");
  let helper=definition.replace("analytics.reconciliation_fact_digest(t text, j jsonb)",
    "analytics.eo05_fact_digest_with_columns(t text, j jsonb, numeric_columns text[])");
  assert.notEqual(helper,definition);
  const catalog="for k in select attname::text from pg_catalog.pg_attribute where attrelid=('analytics.'||t)::regclass and atttypid in ('numeric'::regtype,'bigint'::regtype) and attnum>0 and not attisdropped loop";
  assert.equal(helper.split(catalog).length,2);
  helper=helper.replace(catalog,"foreach k in array numeric_columns loop");
  const payloadDigest="return analytics.dataset_digest(v);";
  assert.equal(helper.split(payloadDigest).length,2);
  helper=helper.replace(payloadDigest,"return encode(sha256(convert_to(analytics.eo05_readback_json(v),'UTF8')),'hex');");
  await client.query(helper);
  await client.query(`revoke all on function analytics.eo05_fact_digest_with_columns(text,jsonb,text[])
    from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner`);
  const {rows:[{sql}]}=await client.query(
    "select pg_get_functiondef('analytics.klaviyo_daily_report_fingerprint(jsonb,date,text,integer,boolean)'::regprocedure) sql");
  const loop="    for fact in execute format(";
  assert.equal(sql.split(loop).length,2);
  let fingerprint=sql.replace("  fact jsonb;","  fact jsonb; numeric_columns text[];");
  assert.notEqual(fingerprint,sql);
  fingerprint=fingerprint.replace(loop,`    select coalesce(array_agg(attname::text order by attnum),'{}') into numeric_columns
      from pg_catalog.pg_attribute where attrelid=('analytics.'||table_name)::regclass
      and atttypid in ('numeric'::regtype,'bigint'::regtype) and attnum>0 and not attisdropped;
${loop}`);
  const digest="analytics.reconciliation_fact_digest(table_name,fact)";
  assert.equal(fingerprint.split(digest).length,2);
  fingerprint=fingerprint.replace(digest,"analytics.eo05_fact_digest_with_columns(table_name,fact,numeric_columns)");
  const originalSignature="analytics.klaviyo_daily_report_fingerprint(o jsonb, d date, tz text, expected integer, verified_in_tx boolean DEFAULT false)";
  assert.equal(sql.split(originalSignature).length,2);
  await client.query(sql.replace(originalSignature,
    "analytics.eo05_original_report_fingerprint(o jsonb, d date, tz text, expected integer, verified_in_tx boolean DEFAULT false)"));
  await client.query(`revoke all on function analytics.eo05_original_report_fingerprint(jsonb,date,text,integer,boolean)
    from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner`);
  fingerprint=fingerprint.replace("  fact jsonb; numeric_columns text[];",
    "  fact jsonb; numeric_columns text[]; table_count integer; matched boolean; table_leaves text[];");
  const scanStart=fingerprint.indexOf("    for fact in execute format(");
  const scanEnd=fingerprint.indexOf("\n    end loop;",scanStart);
  assert.ok(scanStart>=0&&scanEnd>scanStart);
  fingerprint=fingerprint.slice(0,scanStart)+`    execute format($verify$
      with actual as materialized (
        select to_jsonb(x) fact from analytics.%I x
        where x.workspace_id=$1 and x.installation_id=$2 and x.installation_generation=$3
          and x.platform='klaviyo' and x.platform_account_id=$4 and x.business_date=$5
        order by x.native_key_hash collate "C" limit 4001
      ), digested as materialized (
        select fact,case when $8 then fact->>'payload_digest'
          else analytics.eo05_fact_digest_with_columns($6,fact,$9) end as payload from actual
      )
      select count(*)::int,coalesce(bool_and(
        fact->>'source_timezone' is not distinct from $7
        and fact->>'provider_connection_id' is not distinct from $10
        and (fact->>'retain_until')::timestamptz>clock_timestamp()
        and fact->>'payload_digest' is not distinct from payload),true),
        coalesce(array_agg(analytics.dataset_digest(jsonb_build_array($6,fact->>'native_key_hash',payload))
          order by fact->>'native_key_hash' collate "C"),'{}')
      from digested
    $verify$,table_name) into table_count,matched,table_leaves
      using w,i,g,o->>'accountId',d,table_name,tz,verified_in_tx,numeric_columns,o->>'connectionId';
    if matched is not true or cardinality(leaves)+table_count>expected then
      raise exception 'KLAVIYO_REPORT_FACT_READBACK_MISMATCH';
    end if;
    leaves:=leaves||table_leaves;`+fingerprint.slice(scanEnd+"\n    end loop;".length);
  await client.query(fingerprint);
}

async function installStagedCanonicalReuse(client) {
  async function rewrite(signature,changes) {
    const {rows:[{definition}]}=await client.query("select pg_get_functiondef($1::regprocedure) definition",[signature]);
    let sql=definition;
    for(const [before,after] of changes) {
      assert.equal(sql.split(before).length,2,`staged canonical reuse anchor: ${before}`);
      sql=sql.replace(before,()=>after);
    }
    await client.query(sql);
  }
  await rewrite("analytics.stage_klaviyo_daily_report_package(jsonb,jsonb,jsonb,timestamptz,integer,integer)",[
    ["      body jsonb not null,","      body jsonb not null,\n      canonical_payload text not null,"],
    ["(package_ordinal,day_binding,body,digest)","(package_ordinal,day_binding,body,canonical_payload,digest)"],
    ["values (ordinal,binding,p,package_digest);","values (ordinal,binding,p,canonical_package,package_digest);"],
  ]);
  await rewrite("analytics.verify_klaviyo_daily_report_stage(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)",[
    ["or s.digest is distinct from analytics.dataset_digest(jsonb_build_object('write',s.body,'context',c))",
      `or s.digest is distinct from encode(sha256(convert_to(s.canonical_payload,'UTF8')),'hex')
        or jsonb_send(s.canonical_payload::jsonb) is distinct from jsonb_send(jsonb_build_object('write',s.body,'context',c))`],
  ]);
}

async function installCanonicalRowsReuse(client) {
  await client.query(`create function analytics.eo05_package_from_rows(p jsonb, canonical_rows text, depth integer) returns text
    language sql immutable strict set search_path='' as $fn$
      select '{"operationId":'||analytics.dataset_json(p->'operationId',depth+1)||
        ',"policy":'||analytics.dataset_json(p->'policy',depth+1)||
        ',"rows":'||canonical_rows||
        ',"version":'||analytics.dataset_json(p->'version',depth+1)||'}'
    $fn$;
    revoke all on function analytics.eo05_package_from_rows(jsonb,text,integer)
      from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner`);
  async function rewrite(signature,changes) {
    const {rows:[{definition}]}=await client.query("select pg_get_functiondef($1::regprocedure) definition",[signature]);
    let sql=definition;
    for(const [before,after] of changes) {
      assert.equal(sql.split(before).length,2,`canonical row reuse anchor: ${before}`);
      sql=sql.replace(before,()=>after);
    }
    await client.query(sql);
  }
  const stagedEnvelope=(p,rows)=>`'{"context":'||analytics.dataset_json(c,1)||',"write":'||analytics.eo05_package_from_rows(${p},${rows},1)||'}'`;
  await rewrite("analytics.stage_klaviyo_daily_report_package(jsonb,jsonb,jsonb,timestamptz,integer,integer)",[
    ["  canonical_package text;","  canonical_package text;\n  canonical_rows text;"],
    ["    canonical_package:=analytics.dataset_json(jsonb_build_object('write',p,'context',c));",
      `    if p ?& array['operationId','policy','rows','version']
      and (select count(*) from jsonb_object_keys(p))=4 then
      canonical_rows:=analytics.dataset_json(p->'rows',2);
      canonical_package:=${stagedEnvelope("p","canonical_rows")};
      if octet_length(canonical_package)>1048576 then raise exception 'DATASET_JSON_BOUNDS';end if;
    else
      canonical_package:=analytics.dataset_json(jsonb_build_object('write',p,'context',c));
    end if;`],
    ["      canonical_payload text not null,","      canonical_payload text not null,\n      canonical_rows text,"],
    ["body,canonical_payload,digest)","body,canonical_payload,canonical_rows,digest)"],
    ["p,canonical_package,package_digest);","p,canonical_package,canonical_rows,package_digest);"],
  ]);
  await rewrite("analytics.verify_klaviyo_daily_report_stage(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)",[
    ["or jsonb_send(s.canonical_payload::jsonb) is distinct from jsonb_send(jsonb_build_object('write',s.body,'context',c)))",
      `or jsonb_send(s.canonical_payload::jsonb) is distinct from jsonb_send(jsonb_build_object('write',s.body,'context',c))
        or (s.canonical_rows is not null and s.canonical_payload collate "C" is distinct from
          (${stagedEnvelope("s.body","s.canonical_rows")}) collate "C"))`],
  ]);
  await rewrite("analytics.commit_dataset_storage(jsonb,jsonb)",[
    [" canonical_package text;"," canonical_package text; canonical_rows text;"],
    [" canonical_package:=analytics.dataset_json(p);",
      ` if o->>'provider'='klaviyo' and exists(select 1 from pg_catalog.pg_class
   where oid=pg_catalog.to_regclass('pg_temp.adstable_klaviyo_daily_report_stage')
     and relnamespace=pg_catalog.pg_my_temp_schema() and relowner=current_user::regrole
     and relpersistence='t' and relkind='r') then
   select s.canonical_rows into canonical_rows from pg_temp.adstable_klaviyo_daily_report_stage s
     where s.daily_sources_verified
       and jsonb_send(s.body-'operationId')=jsonb_send(p-'operationId')
     order by s.package_ordinal limit 1;
 end if;
 canonical_package:=case when canonical_rows is null then analytics.dataset_json(p)
   else analytics.eo05_package_from_rows(p,canonical_rows,0) end;
 if octet_length(canonical_package)>1048576 then raise exception 'DATASET_JSON_BOUNDS';end if;`],
  ]);
}

async function verifyStageTamperRejection(client,args,reuseCanonicalRows) {
  if(reuseCanonicalRows) {
    const {rows:[{verified}]}=await client.query(`with writer_packages as materialized (
      select body||jsonb_build_object('operationId',gen_random_uuid()) as body,canonical_rows
      from pg_temp.adstable_klaviyo_daily_report_stage
    )
    select count(*) filter(where analytics.eo05_package_from_rows(body,canonical_rows,0) collate "C"
      =analytics.dataset_json(body) collate "C")::int as verified from writer_packages`);
    assert.equal(verified,5);
  }
  const mutations=[
    "body=jsonb_set(body,'{operationId}',to_jsonb(gen_random_uuid()::text))",
    "digest=repeat('0',64)",
    "canonical_payload='{}'",
    ...(reuseCanonicalRows?["canonical_rows=' '||canonical_rows"]:[]),
  ];
  for(const mutation of mutations) {
    await client.query("savepoint stage_tamper_probe");
    let failure;
    try {
      const changed=await client.query(`update pg_temp.adstable_klaviyo_daily_report_stage set ${mutation} where package_ordinal=0`);
      assert.equal(changed.rowCount,1);
      await client.query("select analytics.verify_klaviyo_daily_report_stage($1,$2,$3,$4,$5,$6)",args);
    } catch(error) {
      if(error.code!=="P0001") throw error;
      failure=error.message;
    } finally {
      await client.query("rollback to savepoint stage_tamper_probe");
      await client.query("release savepoint stage_tamper_probe");
    }
    assert.equal(failure,"KLAVIYO_REPORT_PACKAGE_VERIFICATION_FAILED");
  }
}

const triggerPhases=["authority","rowJson","sourceContext","rowIdentity","mappingAndFx"];

async function installTriggerPhaseTimers(client) {
  const {rows:[{definition}]}=await client.query(
    "select pg_get_functiondef('analytics.validate_dataset_fact()'::regprocedure) definition");
  let sql=definition;
  function before(anchor,instrumentation) {
    assert.equal(sql.split(anchor).length,2,`trigger timing anchor: ${anchor}`);
    sql=sql.replace(anchor,()=>instrumentation+"\n"+anchor);
  }
  before("\nbegin\n",`\n eo05_phase_start timestamptz; eo05_phase_stop timestamptz;
  eo05_phase_totals double precision[];${triggerPhases.map(phase=>` eo05_${phase} double precision;`).join("")}`);
  before(" select * into strict b from evidence.source_batches"," eo05_phase_start:=clock_timestamp();");
  const checkpoints=[
    " if octet_length(analytics.dataset_json(j))",
    " if new.provenance ? 'source_context' then",
    " -- Registry changes replace this validator",
    " foreach k in array array['product_mapping_id'",
    " perform set_config('eo05.sales_trigger_ms'",
  ];
  for(const [index,anchor] of checkpoints.entries()) {
    before(anchor,` eo05_phase_stop:=clock_timestamp();
 eo05_${triggerPhases[index]}:=1000*extract(epoch from eo05_phase_stop-eo05_phase_start);
 eo05_phase_start:=eo05_phase_stop;`);
  }
  before(" return new;",` eo05_phase_totals:=string_to_array(current_setting('eo05.trigger_phase_ms'),',')::double precision[];
 perform set_config('eo05.trigger_phase_ms',array_to_string(array[${triggerPhases.map((phase,index)=>`eo05_phase_totals[${index+1}]+eo05_${phase}`).join(",")}],','),true);`);
  await client.query("set local eo05.trigger_phase_ms='0,0,0,0,0'");
  await client.query(sql);
}

const writerPhases=["lookupLock","packageValidation","packageHash","sourceRetention","rowValidation","rowHash","rowPreparation","bulkStatement","packageReceipt"];

async function installWriterTimers(client,{capturePlans,reportWriteCleanup=false,measureBulkPreparation=false,reuseCanonicalRows=false,google=false}) {
  if(capturePlans) await client.query(`create temp table eo05_bulk_plan_inputs (
    ordinal bigint generated always as identity, fact_table text, columns text,
    payload jsonb, check_retention boolean
  ) on commit drop`);
  else await installSalesTriggerTimer(client);
  await client.query(`create function analytics.eo05_timed_package_json(p jsonb) returns text
    language plpgsql set search_path='' as $measure$
    declare started timestamptz:=clock_timestamp(); canonical text;
    begin
      canonical:=analytics.${google?"google_daily_json":"dataset_json"}(p);
      raise notice 'EO05_WRITER_TIMING packageJsonSize %',1000*extract(epoch from clock_timestamp()-started);
      return canonical;
    end $measure$`);
  const {rows:[{definition}]}=await client.query(
    "select pg_get_functiondef($1::regprocedure) definition",
    [`analytics.${google?"commit_google_daily_package":"commit_dataset_storage"}(jsonb,jsonb)`]);
  let sql=definition;
  const serializer=google?"analytics.google_daily_json":"analytics.dataset_json";
  const packageSize=reportWriteCleanup?`canonical_package:=${serializer}(p)`:`octet_length(${serializer}(p))`;
  if(reuseCanonicalRows) {
    const fallback="case when canonical_rows is null then analytics.dataset_json(p)";
    assert.equal(sql.split(fallback).length,2);
    sql=sql.replace(fallback,fallback.replace("analytics.dataset_json","analytics.eo05_timed_package_json"));
    const reused="else analytics.eo05_package_from_rows(p,canonical_rows,0) end;";
    assert.equal(sql.split(reused).length,2);
    await client.query(`create function analytics.eo05_timed_reused_package(p jsonb, canonical_rows text) returns text
      language plpgsql set search_path='' as $measure$
      declare started timestamptz:=clock_timestamp(); canonical text;
      begin
        canonical:=analytics.eo05_package_from_rows(p,canonical_rows,0);
        raise notice 'EO05_WRITER_TIMING packageJsonSize %',1000*extract(epoch from clock_timestamp()-started);
        raise notice 'EO05_WRITER_TIMING reusedPackage 1';
        return canonical;
      end $measure$`);
    sql=sql.replace(reused,"else analytics.eo05_timed_reused_package(p,canonical_rows) end;");
  } else {
    assert.equal(sql.split(packageSize).length,2);
    sql=sql.replace(packageSize,packageSize.replace(serializer,"analytics.eo05_timed_package_json"));
  }
  function before(anchor,instrumentation) {
    assert.equal(sql.split(anchor).length,2,`writer timing anchor: ${anchor}`);
    sql=sql.replace(anchor,()=>instrumentation+"\n"+anchor);
  }
  function finish(phase) {
    return ` eo05_timing_${phase}:=eo05_timing_${phase}+1000*extract(epoch from clock_timestamp()-eo05_started);\n eo05_started:=clock_timestamp();`;
  }
  before("\nbegin\n",`\n eo05_started timestamptz; eo05_bulk_measured boolean;${measureBulkPreparation?" eo05_bulk_preparation_start timestamptz;":""}\n${writerPhases.map(phase=>` eo05_timing_${phase} double precision:=0;`).join("\n")}`);
  before(" perform 1 from operations.refresh_control", " eo05_started:=clock_timestamp();");
  before(" perform evidence.assert_source_owner", finish("lookupLock"));
  before(" select * into strict b from evidence.source_batches", finish("packageValidation"));
  before(" if b.authority is distinct", finish("lookupLock"));
  before(reportWriteCleanup?" h:=encode(sha256(convert_to(canonical_package":` h:=analytics.${google?"google_daily_digest":"dataset_digest"}(p)`, finish("packageValidation"));
  before(" if prior is not null then", finish("packageHash"));
  before(" if p->'policy'->>'version'='report-source-3y-v1' then",finish("packageValidation"));
  before(" if (select count(*) from jsonb_array_elements(p->'rows'))",finish("sourceRetention"));
  before("\n for item in select value from jsonb_array_elements(p->'rows') loop",`\n${finish("rowValidation")}`);
  before("  name:=item->>'table'", "  eo05_started:=clock_timestamp();");
  before("  row_input:=r-array",finish("rowValidation"));
  before("  injected:=r||jsonb_build_object",finish("rowHash"));
  before("   continue;",finish("rowPreparation"));
  const staged=google?"staged_google":"staged_klaviyo";
  if(measureBulkPreparation) {
    before(`\n if ${staged} then\n  -- Table names`, " eo05_bulk_preparation_start:=clock_timestamp();");
  }
  const capture=capturePlans?`   insert into pg_temp.eo05_bulk_plan_inputs(fact_table,columns,payload,check_retention)
     values(name,cols,bulk_rows->name,p->'policy'->>'version'='report-source-3y-v1');\n`:"";
  before("   for stored in execute format($bulk$",`${capture}   eo05_bulk_measured:=false; eo05_started:=clock_timestamp();`);
  before("    if stored.native_conflict",`    if not eo05_bulk_measured then\n${finish("bulkStatement")}\n     eo05_bulk_measured:=true;\n    end if;`);
  before(" result:=jsonb_build_object('status','stored'", `${measureBulkPreparation?`
 if ${staged} then
   eo05_timing_rowPreparation:=eo05_timing_rowPreparation+
     1000*extract(epoch from clock_timestamp()-eo05_bulk_preparation_start)-eo05_timing_bulkStatement;
 end if;`:""}
 eo05_started:=clock_timestamp();`);
  before(" return result;",`${finish("packageReceipt")}\n${writerPhases.map(phase=>` raise notice 'EO05_WRITER_TIMING ${phase} %',eo05_timing_${phase};`).join("\n")}`);
  await client.query(sql);
}

async function installSalesTriggerTimer(client) {
  const {rows:[{definition}]}=await client.query(
    "select pg_get_functiondef('analytics.validate_dataset_fact()'::regprocedure) definition");
  assert.equal(definition.split("\ndeclare ").length,2);
  assert.equal(definition.split("\n return new;").length,2);
  const sql=definition.replace("\ndeclare ","\ndeclare eo05_trigger_start timestamptz:=clock_timestamp(); ")
    .replace("\n return new;",`\n perform set_config('eo05.sales_trigger_ms',
      (current_setting('eo05.sales_trigger_ms')::double precision
        +1000*extract(epoch from clock_timestamp()-eo05_trigger_start))::text,true);
 return new;`);
  await client.query("set local eo05.sales_trigger_ms='0'");
  await client.query(sql);
}

const comparableReportPrefix=/^EO05_(WRITER_TIMING|REPORT_COMPARABLE) ([a-zA-Z]+) ([\d.eE+-]+)$/;

// These boundaries wrap the already installed, unchanged reference definitions.
export async function installComparableReportTiming(client,provider) {
  assert.equal(client.connectionParameters.host,"127.0.0.1");
  assert.equal(Number(client.connectionParameters.port),54322);
  assert.ok(["google","klaviyo"].includes(provider));
  const google=provider==="google",signature="jsonb,jsonb,timestamptz,uuid,jsonb,jsonb";
  const note=label=>`raise notice 'EO05_REPORT_COMPARABLE ${label} %',1000*extract(epoch from clock_timestamp()-report_comparison_started);`;
  const restart="report_comparison_started:=clock_timestamp();";
  const rewrite=async(name,args,transform)=>{
    const {rows:[{definition}]}=await client.query("select pg_get_functiondef($1::regprocedure) definition",[`analytics.${name}(${args})`]);
    let sql=definition;
    const change=(from,to)=>{
      assert.equal(sql.split(from).length,2,`report comparison anchor ${name}: ${from}`);
      sql=sql.replace(from,()=>to);
    };
    transform(change);
    await client.query(sql);
  };
  const start=(change,extra="")=>change("\nbegin\n",`\n report_comparison_started timestamptz;${extra}\nbegin\n ${restart}\n`);
  const mark=(change,anchor,label)=>change(anchor,`${note(label)}\n ${restart}\n ${anchor}`);
  await rewrite(`publish_${provider}_staged_report_day`,signature,change=>{
    start(change);
    mark(change,"perform analytics.assert_report_source_context","publisherAuthority");
    mark(change,google?"proof:=analytics.write_google_staged_first_report_day":"revision:=(c->>'expectedRevision')","publisherSources");
    mark(change,"receipt:=jsonb_build_object","publisherWriter");
    mark(change,"return receipt;","publisherReceipt");
  });
  await rewrite(`verify_${provider}_daily_report_stage`,signature,change=>{
    start(change);
    mark(change,"return summary||jsonb_build_object","stageValidation");
  });
  await rewrite(google?"write_google_staged_first_report_day":"eo05_first_day_before_shared",
    google?signature:signature+",jsonb",change=>{
      start(change," report_comparison_result jsonb;");
      mark(change,`for s in select body from pg_temp.adstable_${provider}_daily_report_stage`,"writerSetup");
      const readback=google?"analytics.check_google_daily_report_facts(o,c,d,operation,policy,digests)":
        "analytics.check_klaviyo_daily_report_facts_verified(o,c,d,operation,policy,digests,verified_summary)";
      change(`return ${readback};`,`${note("writerPackages")}
       ${restart}
       report_comparison_result:=${readback};
       ${note("physicalVerification")}
       return report_comparison_result;`);
  });
  if(!google)await rewrite("write_klaviyo_staged_first_report_day_verified",signature+",jsonb",change=>{
    change("declare result jsonb;begin","declare result jsonb; report_comparison_started timestamptz;begin "+restart);
    mark(change,"result:=analytics.eo05_first_day_before_shared","sharedWriterSources");
  });
  await installWriterTimers(client,{capturePlans:false,measureBulkPreparation:true,
    google,reportWriteCleanup:!google,reuseCanonicalRows:!google});
  await client.query(`revoke all on function analytics.eo05_timed_package_json(jsonb)${google?"":",analytics.eo05_timed_reused_package(jsonb,text)"}
    from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner`);
}

export function collectComparableReportTiming(client) {
  const phases={},counts={},stageChecks=[];
  const record=({message})=>{
    const match=comparableReportPrefix.exec(message);
    if(!match)return;
    const [,family,phase,duration]=match,key=family==="WRITER_TIMING"?`writer_${phase}`:phase;
    phases[key]=(phases[key]??0)+Number(duration);
    counts[key]=(counts[key]??0)+1;
    if(key==="stageValidation")stageChecks.push(Number(duration));
  };
  client.on("notice",record);
  return {
    stop(){client.off("notice",record);},
    async result(reportWriteMs,stageCallWallMs) {
      const {rows:[{triggerMs}]}=await client.query("select current_setting('eo05.sales_trigger_ms')::float8 as \"triggerMs\"");
      for(const key of ["publisherAuthority","publisherSources","publisherWriter","publisherReceipt","writerSetup","writerPackages","physicalVerification"])assert.equal(counts[key],1,key);
      for(const key of [...writerPhases,"packageJsonSize"])assert.equal(counts[`writer_${key}`],5,key);
      assert.ok(counts.stageValidation===1||counts.stageValidation===2);
      assert.ok(Object.values(phases).every(ms=>Number.isFinite(ms)&&ms>=0));
      assert.ok(Number.isFinite(triggerMs)&&triggerMs>=0&&triggerMs<=phases.writer_bulkStatement);
      const readbackStageMs=stageChecks[1]??0;
      const writerPackageValidationMs=phases.writer_packageValidation-phases.writer_packageJsonSize;
      const packageValidationMs=stageCallWallMs+phases.stageValidation+writerPackageValidationMs;
      const sharedSourcesMs=phases.publisherSources+(phases.sharedWriterSources??0)+phases.writer_sourceRetention;
      const authorityMs=phases.publisherAuthority-(phases.stageValidation-readbackStageMs)+phases.writerSetup+phases.writer_lookupLock;
      const physicalVerificationMs=phases.physicalVerification-readbackStageMs;
      const receiptMs=phases.publisherReceipt+phases.writer_packageReceipt;
      const writerMs=phases.writerPackages-phases.writer_lookupLock-writerPackageValidationMs-phases.writer_sourceRetention-phases.writer_packageReceipt;
      const rowChecksMs=phases.writer_rowValidation+phases.writer_rowPreparation;
      const jsonAndHashMs=phases.writer_packageJsonSize+phases.writer_packageHash+phases.writer_rowHash;
      const lookupAndInsertMs=phases.writer_bulkStatement-triggerMs;
      const writerRemainderMs=writerMs-rowChecksMs-jsonAndHashMs-lookupAndInsertMs-triggerMs;
      const remainderMs=reportWriteMs-authorityMs-packageValidationMs-sharedSourcesMs-writerMs-physicalVerificationMs-receiptMs;
      assert.ok(authorityMs>=0&&physicalVerificationMs>=0&&writerRemainderMs>=-0.01&&remainderMs>=-0.01);
      return {phases,counts,reportWriteMs,triggerMs,packageValidationMs,sharedSourcesMs,authorityMs,writerMs,
        rowChecksMs,jsonAndHashMs,lookupAndInsertMs,writerRemainderMs,physicalVerificationMs,receiptMs,remainderMs};
    },
  };
}

function explainBulkTiming(root) {
  const nodes=root.Plan.Plans;
  const lookup=nodes.find(node=>node["Subplan Name"]==="CTE existing");
  const insert=nodes.find(node=>node["Subplan Name"]==="CTE inserted");
  assert.ok(lookup&&insert&&Array.isArray(root.Triggers));
  const ms=node=>node["Actual Total Time"]*node["Actual Loops"];
  const triggers=root.Triggers.filter(trigger=>trigger["Trigger Name"]==="sales_validate");
  assert.equal(triggers.length,1);
  const triggerMs=triggers[0].Time;
  // BEFORE triggers are included in the INSERT node. Remove its input plan and
  // BEFORE validation to report the measured net INSERT node work separately.
  const inputMs=insert.Plans.reduce((sum,node)=>sum+ms(node),0);
  return {statementMs:root["Execution Time"],lookupMs:ms(lookup),triggerMs,triggerCalls:triggers[0].Calls,
    insertNodeNetMs:Math.max(0,ms(insert)-inputMs-triggerMs),insertInputMs:inputMs};
}

async function measureBulkPlans(client,installationId) {
  const fixture=readFileSync(new URL("../tests/fixtures/eo05-klaviyo-bulk-writer-378.sql",import.meta.url),"utf8");
  // Use the unmodified inner statement and its original inputs after measuring
  // the normal flow. Restore the published facts when the plan sample is done.
  const statement=fixture.split("$bulk$")[1];
  assert.ok(statement?.includes("with incoming as materialized"));
  const {rows:inputs}=await client.query(`select format($1,fact_table,columns) statement,
    payload::text payload,check_retention from pg_temp.eo05_bulk_plan_inputs order by ordinal`,[statement]);
  assert.equal(inputs.length,5);
  const plans=[];
  await client.query("savepoint eo05_bulk_plan_sample");
  try {
    const removed=await client.query("delete from analytics.cpd_product_sales_facts where installation_id=$1",[installationId]);
    assert.equal(removed.rowCount,productEvents);
    for (const input of inputs) {
      const {rows:[plan]}=await client.query("explain (analyze,timing on,format json) "+input.statement,
        [input.payload,input.check_retention]);
      plans.push(explainBulkTiming(plan["QUERY PLAN"][0]));
    }
  } finally {
    await client.query("rollback to savepoint eo05_bulk_plan_sample");
    await client.query("release savepoint eo05_bulk_plan_sample");
  }
  assert.equal(plans.reduce((sum,plan)=>sum+plan.triggerCalls,0),productEvents);
  return plans;
}

async function measurePlainSalesInserts(client,installationId) {
  // Keep WAL, indexes and declarative constraints on a disposable logged table.
  // LIKE does not copy foreign keys or AdsTable's application triggers.
  await client.query(`create table analytics.eo05_sales_insert_probe
    (like analytics.cpd_product_sales_facts including all)`);
  const {rows:[{foreignKeys,columns}]}=await client.query(`select
    (select array_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint
     where conrelid='analytics.cpd_product_sales_facts'::regclass and contype='f') "foreignKeys",
    (select string_agg(quote_ident(attname),',' order by attnum) from pg_attribute
     where attrelid='analytics.cpd_product_sales_facts'::regclass and attnum>0
       and not attisdropped and attidentity='' and attgenerated='' and attname<>'id') columns`);
  assert.ok(foreignKeys.length>0&&columns);
  for (const constraint of foreignKeys) {
    await client.query(`alter table analytics.eo05_sales_insert_probe add ${constraint}`);
  }
  await client.query(`create temp table eo05_prepared_insert_rows on commit drop as
    select row_number() over (order by id) ordinal,${columns}
    from analytics.cpd_product_sales_facts where installation_id=$1`,[installationId]);
  await client.query("create unique index on eo05_prepared_insert_rows(ordinal)");
  await client.query("analyze eo05_prepared_insert_rows");
  const packageMs=[];
  for(let offset=0;offset<productEvents;offset+=200) {
    const result=await client.query(`explain (analyze,buffers,wal,timing off,format json)
      insert into analytics.eo05_sales_insert_probe(${columns})
      select ${columns} from pg_temp.eo05_prepared_insert_rows
      where ordinal>$1 and ordinal<=$2 order by ordinal`,[offset,offset+200]);
    const plan=result.rows[0]["QUERY PLAN"][0];
    const executionMs=plan["Execution Time"];
    assert.ok(Number.isFinite(executionMs)&&executionMs>=0);
    packageMs.push(executionMs);
  }
  const {rows:[{count}]}=await client.query("select count(*)::int from analytics.eo05_sales_insert_probe");
  assert.equal(count,productEvents);
  return {rows:count,packageMs,executionMs:packageMs.reduce((total,ms)=>total+ms,0)};
}

async function installPublishTimers(client,{reportOnly,optimized=false}) {
  const args="jsonb,jsonb,timestamptz,uuid,jsonb,jsonb";
  const privateSuffix=optimized?"_verified":"";
  const anchors={
    publish_klaviyo_staged_report_day:[
      ["  perform 1 from operations.refresh_control",null],
      ...(optimized?[["  if not found then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'","publishLockAcquire"]]:[]),
      ...(reportOnly?[
        [optimized?"  verified_summary:=analytics.verify_klaviyo_daily_report_stage":"  perform analytics.verify_klaviyo_daily_report_stage",
          optimized?"publishAuthority":"publishLockAuthority"],
        ["  perform analytics.assert_report_source_context", "publishPackageValidation"],
      ]:[]),
      ["  revision:=(c->>'expectedRevision')","sharedSourceChecks"],
      ["  receipt:=jsonb_build_object('version','klaviyo-daily-receipt-v1'","writerAndVerification"],
      ["  return receipt;","receiptPersist"],
    ],
    [`write_klaviyo_staged_first_report_day${privateSuffix}`]:[
      [optimized?"  perform 1 from operations.refresh_control":"  for s in select body from pg_temp.adstable_klaviyo_daily_report_stage",null],
      ...(optimized?[["  for s in select body from pg_temp.adstable_klaviyo_daily_report_stage","beforeWriter"]]:[]),
      ["  return analytics.check_klaviyo_daily_report_facts","physicalWrite"],
    ],
    [`check_klaviyo_daily_report_facts${privateSuffix}`]:[
      [optimized?"  perform 1 from operations.refresh_control":"  summary:=analytics.verify_klaviyo_daily_report_stage",null],
      ...(optimized?[["  summary:=verified_summary","readbackAuthority"]]:[]),
      ["  return summary||jsonb_build_object('digest'","physicalVerification"],
    ],
  };
  for(const [name,points] of Object.entries(anchors)) {
    const signature=name.endsWith("_verified")?`${args},jsonb`:args;
    const {rows:[{definition}]}=await client.query("select pg_get_functiondef($1::regprocedure) definition",[`analytics.${name}(${signature})`]);
    let sql=definition.replace("declare\n","declare\n  probe_time timestamptz;\n");
    assert.notEqual(sql,definition);
    for(const [anchor,label] of points) {
      assert.equal(sql.split(anchor).length,2,`timing anchor ${name}: ${anchor}`);
      const notice=label?`  raise notice 'EO05_DAILY_PUBLISH_PHASE ${label} %',1000*extract(epoch from clock_timestamp()-probe_time);\n`:"";
      sql=sql.replace(anchor,()=>notice+"  probe_time:=clock_timestamp();\n"+anchor);
    }
    await client.query(sql);
  }
}

function syntheticResponse(endpoint,owner,day,changedEvents=0,shopifyMapping=false) {
  const url=new URL(endpoint);
  assert.equal(url.origin,"https://a.klaviyo.com");
  if (url.pathname.includes("/accounts")) return Response.json({data:[
    {type:"account",id:owner.accountId,attributes:{timezone:"UTC",preferred_currency:"USD"}},
  ]});
  if (url.pathname.includes("/metrics")) return Response.json({
    data:["Placed Order","Added to Cart","Checkout Started","Ordered Product"].map((name,i)=>({
      id:"m"+i,type:"metric",attributes:{name,integration:{name:"Shopify"}},
    })),links:{next:null},
  });
  if (url.pathname.includes("values-reports")) {
    const kind=url.pathname.includes("campaign")?"campaign":"flow";
    return Response.json({data:{type:kind+"-values-report",attributes:{results:[]}},links:{next:null}});
  }
  assert.equal(url.pathname,"/api/events");
  const offset=Number(url.searchParams.get("page[cursor]")??0);
  assert.ok(offset>=0&&offset<productEvents&&offset%pageSize===0);
  return Response.json({
    data:Array.from({length:pageSize},(_,i)=>({
      type:"event",id:"e"+(offset+i),attributes:{datetime:day+"T12:00:00Z",
        event_properties:{ProductID:shopifyMapping&&offset+i===0?"123":"p"+(offset+i),
          ...(shopifyMapping&&offset+i===0?{"Variant ID":"456"}:{}),Quantity:offset+i<changedEvents?2:1,$value:offset+i<changedEvents?"39.98":"19.99"}},
      relationships:{metric:{data:{type:"metric",id:"m3"}}},
    })),
    links:{next:offset+pageSize<productEvents?url.origin+url.pathname+"?page%5Bcursor%5D="+(offset+pageSize):null},
  });
}

async function prepareMatchedKlaviyoTransport(client,context,{fullAuthority,measureQuery=(sql,args)=>client.query(sql,args)}) {
  await client.query("set local role postgres");
  if (!(await client.query("select to_regrole('adstable_klaviyo_source_runner') is not null as present")).rows[0].present) {
    const sql=readFileSync(new URL("./sql/eo05-klaviyo-source-role-install.sql",import.meta.url),"utf8");
    await client.query(sql.trim().replace(/^begin;/,"").replace(/commit;$/,""));
  }
  await client.query("set local role postgres");
  await client.query("grant adstable_klaviyo_source_runner to adstable_owner with inherit false,set true,admin false");
  if(fullAuthority)await client.query("grant adstable_runtime to adstable_owner with inherit false,set true,admin false");
  await client.query("set local role adstable_owner");
  await client.query("set local statement_timeout='60s'");
  const policy=randomUUID();
  await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,'klaviyo')",[context.connectionScopeKey]);
  await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'klaviyo',60000,1000,0,5000,1)",[policy]);
  for (const family of ["account_discovery","metrics","campaign_values","flow_values","events"]) {
    const {routeKey}=quotaRouteIdentity(context,{provider:"klaviyo",family,accountId:null,organizationId:null,
      version:context.apiVersion,includes:family==="events"?["attributions","metric"]:[]});
    await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled,route_required) values($1,'klaviyo',true,true)",[routeKey]);
    await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[routeKey,policy]);
    await client.query("insert into operations.api_quota_failure_bindings values($1,$2)",[routeKey,context.connectionScopeKey]);
    await client.query("insert into operations.api_quota_route_profiles values($1,$2,operations.shared_api_quota_fingerprint($1),true)",[routeKey,context.connectionScopeKey]);
    await client.query("insert into operations.api_quota_routes values($1,$1,true)",[routeKey]);
  }
  // The production client performs the role/profile check and SQL for each RPC.
  // The injected pool binds it to the isolated outer rollback transaction.
  const database=createKlaviyoSourcePostgresClient({
    environment:{
      ADSTABLE_KLAVIYO_SOURCE_DATABASE_URL:`postgresql://adstable_klaviyo_source_runner.podpwkrpmjiksskxhwsu:${"x".repeat(32)}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require`,
      ADSTABLE_KLAVIYO_SOURCE_DB_TIMEOUT_MS:"5000",
    },
    poolFactory:()=>({on(){},async end(){},async connect(){return {release(){},async query(sql,args){
      if(sql==="begin"){
        await client.query("savepoint klaviyo_matched_source_rpc");
        return client.query("set local role adstable_klaviyo_source_runner");
      }
      if(sql==="commit"){
        await client.query("set local role adstable_owner");
        return client.query("release savepoint klaviyo_matched_source_rpc");
      }
      if(sql==="rollback"){
        await client.query("rollback to savepoint klaviyo_matched_source_rpc");
        return client.query("release savepoint klaviyo_matched_source_rpc");
      }
      return measureQuery(sql,args);
    }};}}),
  });
  return {database,policy};
}

async function prepareKlaviyoReadAuthority(client,owner,database,now) {
  const key=()=>randomBytes(32).toString("base64url");
  const environment={ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:key()};
  const scopes=(await client.query("select granted_scopes from integrations.provider_connections where id=$1",[owner.connectionId])).rows[0].granted_scopes;
  const versions=await client.query("select distinct key_version v from integrations.provider_credential_envelopes union select distinct key_version v from integrations.oauth_pkce_envelopes");
  for(const {v} of versions.rows) if(Number(v)!==1)environment[`ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V${v}`]=key();
  const token={access_token:"SYNTHETIC-ONLY",scopes,scope_verified_at:new Date(now()).toISOString(),expires_at:new Date(now()+3600000).toISOString()};
  const sealed=createTokenEnvelopeCipher({keyring:readProviderTokenKeyring(environment)}).seal({
    identity:{recordId:owner.credentialId,workspaceId:owner.workspaceId,installGeneration:Number(owner.generation),provider:"klaviyo",purpose:"provider_token_set"},
    secret:JSON.stringify(token),
  });
  await client.query("update integrations.provider_credential_envelopes set payload_ciphertext=$2,nonce=$3,auth_tag=$4,key_version=$5 where id=$1",
    [owner.credentialId,sealed.ciphertext,sealed.nonce,sealed.authTag,sealed.keyVersion]);
  const runtime={async query(sql,args){
    await client.query("set local role adstable_runtime");
    try{return await client.query(sql,args);}
    finally{await client.query("set local role adstable_owner");}
  }};
  const verified=await loadKlaviyoBackgroundOwner({database:runtime,owner:{
    workspaceId:owner.workspaceId,installGeneration:Number(owner.generation),shopId:owner.shopId,shopDomain:owner.shopDomain,
  }});
  const tokenVault=createTokenVault({database:runtime,environment});
  return signal=>createIdentityRuntimeAuthorityLoader({verified,database,tokenVault,provider:"klaviyo",signal,now:()=>new Date(now())});
}

/** Run within the existing F01 localhost rollback transaction. */
export async function klaviyoDailyTimingProbe(client,options) {
  const {connection,environment=process.env}=options;
  assert.equal(environment.GITHUB_ACTIONS,"true");assert.ok(environment.RUNNER_TEMP);
  assert.equal(connection.host,"127.0.0.1");assert.equal(connection.port,54322);
  return runKlaviyoDailyTimingProbe(client,options);
}

export async function klaviyoHostedReportProbe(client,{ownerFixture,connection,reduceReportRepeats=false,hostedDetail=false,reportWriteCleanup=false,phaseCandidate,reuseStagedCanonical=false,triggerPhaseDetail=false,reuseCanonicalRows=false,endToEnd=false,optimizeReadback=false,sharedDaySources=false,verifyDaySources=false,callBreakdown=false,reread,revisionPermit=false,verifyRevisionPermit=false}) {
  assert.equal(connection.host,"aws-1-eu-central-1.pooler.supabase.com");
  assert.equal(connection.port,5432);
  assert.equal(connection.database,"postgres");
  assert.equal(connection.user,"adstable_benchmark_session.lxphenczjmueblnonklm");
  const {rows:[identity]}=await client.query("select session_user as login,current_user as role");
  assert.deepEqual(identity,{login:"adstable_benchmark_session",role:"adstable_owner"});
  const options={ownerFixture,mode:"retention-boundary",retentionVariant:"cached",combinedVerification:true,reduceReportRepeats,hosted:true,hostedDetail,reportWriteCleanup,phaseCandidate,reuseStagedCanonical,triggerPhaseDetail,reuseCanonicalRows,endToEnd,optimizeReadback,sharedDaySources,verifyDaySources,callBreakdown,revisionPermit,verifyRevisionPermit};
  if(reread===undefined) return runKlaviyoDailyTimingProbe(client,options);
  assert.ok(["unchanged","five-changed"].includes(reread));
  assert.ok(endToEnd&&sharedDaySources&&optimizeReadback&&!hostedDetail&&!verifyDaySources&&!callBreakdown);
  const owner=await ownerFixture(client,"klaviyo");
  options.ownerFixture=async()=>owner;
  // Complete the original first-day flow before starting the measured reread.
  const seed=await runKlaviyoDailyTimingProbe(client,options);
  const readFacts=async()=>(await client.query(
    "select to_jsonb(x) fact from analytics.cpd_product_sales_facts x where installation_id=$1 order by provider_event_id",
    [owner.installationId])).rows.map(x=>x.fact);
  const old=await readFacts();
  assert.equal(old.length,productEvents);
  const {rows:[{receipt}]}=await client.query(
    "select manifest->'klaviyoDailyReceipt' receipt from evidence.source_batches where authority=$1::jsonb and manifest ? 'klaviyoDailyReceipt'",[owner]);
  assert.equal(receipt.revision,1);
  await client.query("drop table pg_temp.adstable_klaviyo_daily_report_stage");
  const result=await runKlaviyoDailyTimingProbe(client,{...options,repeat:{
    day:receipt.businessDate,changedEvents:reread==="five-changed"?5:0,previous:receipt,
  }});
  const current=await readFacts(),prior=new Map(old.map(x=>[x.provider_event_id,x]));
  let changed=0,rebound=0,revised=0;
  const business=fact=>Object.fromEntries(Object.entries(fact).filter(([key])=>
    !["updated_at","revision","payload_digest","provenance","source_batch_id"].includes(key)));
  for(const fact of current) {
    const before=prior.get(fact.provider_event_id);
    assert.ok(before);
    assert.equal(fact.id,before.id);
    assert.equal(fact.native_key_hash,before.native_key_hash);
    if(JSON.stringify(business(fact))!==JSON.stringify(business(before))) changed++;
    if(fact.source_batch_id!==before.source_batch_id) rebound++;
    if(Number(fact.revision)===Number(before.revision)+1) revised++;
    const index=Number(fact.provider_event_id.slice(1)),expected=reread==="five-changed"&&index<5;
    assert.equal(String(fact.sales_quantity),expected?"2":"1");
    assert.equal(String(fact.sales_value),expected?"39.98":"19.99");
  }
  assert.equal(current.length,productEvents);
  assert.equal(changed,reread==="five-changed"?5:0);
  assert.equal(rebound,productEvents);
  assert.equal(revised,productEvents);
  assert.equal((await client.query(KLAVIYO_DAILY_INSPECT_SQL,[owner,receipt.operationId])).rows[0].result.status,"superseded");
  let revisionPermitChecks;
  let revisionRetentionHolds;
  if(verifyRevisionPermit) {
    revisionPermitChecks=(await client.query("select n from pg_temp.eo05_revision_checks")).rows[0].n;
    assert.equal(revisionPermitChecks,15);
    const count=(await client.query("select count(*)::int n from pg_temp.eo05_revision_retention_holds")).rows[0].n;
    const expected=(await client.query("select count(distinct ref->>'batch_id')::int n from pg_temp.adstable_klaviyo_daily_report_stage s cross join lateral jsonb_array_elements(s.body->'rows') entry cross join lateral jsonb_array_elements(entry->'row'->'provenance'->'sources') ref")).rows[0].n;
    assert.equal(count,expected);
    revisionRetentionHolds={actual:count,expected};
  }
  return {...result,reread,businessRowsChanged:changed,rowsRebound:rebound,rowsRevisionAdvanced:revised,
    seed:{reportRows:seed.reportRows,requests:seed.requests,completed:true,excludedFromTiming:true},
    ...verifyRevisionPermit?{revisionPermitChecks,revisionRetentionHolds,correctnessOnly:true}: {}};
}

async function installHostedReportClocks(client) {
  await client.query(`create temp table eo05_clock_namespace (unused boolean) on commit drop;
    create function pg_temp.eo05_time_stage(o jsonb,p jsonb,c jsonb,d timestamptz,i integer,n integer)
    returns table(result jsonb, elapsed_ms double precision) language plpgsql as $clock$
    declare started timestamptz:=clock_timestamp();
    begin
      result:=analytics.stage_klaviyo_daily_report_package(o,p,c,d,i,n);
      elapsed_ms:=1000*extract(epoch from clock_timestamp()-started);
      return next;
    end $clock$;
    create function pg_temp.eo05_time_publish(o jsonb,c jsonb,d timestamptz,i uuid,p jsonb,g jsonb)
    returns table(result jsonb, elapsed_ms double precision) language plpgsql as $clock$
    declare started timestamptz:=clock_timestamp();
    begin
      result:=analytics.publish_klaviyo_staged_report_day(o,c,d,i,p,g);
      elapsed_ms:=1000*extract(epoch from clock_timestamp()-started);
      return next;
    end $clock$;`);
}

async function runKlaviyoDailyTimingProbe(client,{ownerFixture,mode="report",retentionVariant,combinedVerification=false,reduceReportRepeats=false,hosted=false,hostedDetail=false,reportWriteCleanup=false,phaseCandidate,reuseStagedCanonical=false,triggerPhaseDetail=false,reuseCanonicalRows=false,endToEnd=false,optimizeReadback=false,sharedDaySources=false,verifyDaySources=false,callBreakdown=false,repeat,revisionPermit=false,verifyRevisionPermit=false,matchedTransport,comparableReport=false,fourPhaseDiagnostics=false,singleReportClose=false,finalSynthetic=false,shopifyMapping=false,sharedRefresh}) {
  assert.ok(["report","wall","detailed","retention","retention-wall","retention-boundary"].includes(mode));
  const reportBoundary=mode==="retention-boundary";
  const retentionOnly=mode==="retention",retentionWall=mode==="retention-wall"||reportBoundary;
  const detailed=mode==="detailed",reportOnly=mode==="report",measureReport=detailed||reportOnly;
  if(matchedTransport!==undefined) assert.ok(["quota","direct","authority"].includes(matchedTransport)&&!hosted&&!repeat&&endToEnd&&reportBoundary);
  if(comparableReport)assert.ok(matchedTransport==="quota"&&sharedDaySources&&reuseCanonicalRows);
  const fullAuthority=matchedTransport==="authority";
  if(fourPhaseDiagnostics)assert.ok(fullAuthority&&!comparableReport&&!callBreakdown);
  if(singleReportClose)assert.ok(fullAuthority&&!comparableReport&&!fourPhaseDiagnostics&&!callBreakdown&&!optimizeReadback);
  assert.ok(!shopifyMapping||finalSynthetic);
  const runScheduled=singleReportClose?(await loadSingleReportCloseCandidate(client,"klaviyo",{shopifyMapping})).runScheduledRefreshCheck:runScheduledRefreshCheck;
  assert.ok(!finalSynthetic||singleReportClose);
  const rawStore=finalSynthetic?await loadKlaviyoRawHashCandidate():{storeKlaviyoRawDataset,storeKlaviyoRawProductPackages};
  if(finalSynthetic)await installKlaviyoQuotaCandidate(client);
  let closeArgs;
  if(retentionOnly||retentionWall) assert.ok(["current","cached"].includes(retentionVariant));
  if(!repeat) await installExactBulkWriter(client);
  // The enclosing rehearsal savepoint restores the inherited timeout.
  await client.query("set local statement_timeout='60s'");
  const owner=await ownerFixture(client,"klaviyo"),now=Date.now;
  const day=sharedRefresh?.day??repeat?.day??new Date(now()-86400000).toISOString().slice(0,10),window={from:day,to:day};
  const generation=sharedRefresh?.generation??randomUUID(),operationId=randomUUID(),hash=()=>randomBytes(32).toString("hex");
  const cipher=createSourceEvidenceCipher({keys:new Map([[1,randomBytes(32)]]),activeVersion:1,forbiddenKeys:[]});
  const mapping=shopifyMapping?await seedShopifyMappingTimingFixture(client,{owner,cipher,window}):null;
  const policy=sourceStoreFixture().input.policy;
  // The second pass reuses exactly the SQL installed for its seed.
  let matchedQuota,createReadAuthority,authorityChecks=0,fourPhase;
  let timingStep="queueEnqueue";
  const measureFourPhase=(phase,sql,args,run)=>fourPhase?fourPhase.query(phase,sql,args,run):run();
  if(!repeat) {
  // The enclosing savepoint is rolled back, including these diagnostics.
  if (measureReport) {
    await installPublishTimers(client,{reportOnly});
    await installWriterTimers(client,{capturePlans:detailed});
  }
  if(retentionOnly||retentionWall) await installRetentionComparison(client,retentionVariant,{measure:retentionOnly});
  if(combinedVerification) {
    assert.ok(reportBoundary&&retentionVariant==="cached");
    await installCombinedFactVerification(client);
  }
  if(reduceReportRepeats) {
    assert.ok(combinedVerification);
    await installReportRepeatReduction(client);
  }
  if(reportWriteCleanup) {
    assert.ok(reduceReportRepeats);
    await installReportWriteCleanup(client);
  }
  if(phaseCandidate) {
    assert.ok((hostedDetail||endToEnd)&&reportWriteCleanup);
    if(phaseCandidate==="ordered-json") await installOrderedCanonicalJson(client);
    else {
      assert.equal(phaseCandidate,"trigger-source");
      await installTriggerSourceReuse(client);
    }
  }
  if(reuseStagedCanonical) {
    assert.equal(phaseCandidate,"ordered-json");
    await installStagedCanonicalReuse(client);
  }
  if(reuseCanonicalRows) {
    assert.ok(reuseStagedCanonical&&(hostedDetail||endToEnd));
    await installCanonicalRowsReuse(client);
  }
  if(sharedDaySources) {
    assert.ok(endToEnd&&reuseCanonicalRows);
    await installSharedDaySources(client);
  }
  if(optimizeReadback) {
    assert.ok(endToEnd&&reuseCanonicalRows);
    await installReadbackMetadataReuse(client);
  }
  if(revisionPermit) {
    assert.ok(endToEnd&&sharedDaySources);
    await installMultipartRevisionPermit(client,{verify:verifyRevisionPermit});
  }
  if(comparableReport)await installComparableReportTiming(client,"klaviyo");
  if(hostedDetail) {
    assert.ok(hosted&&reduceReportRepeats);
    await installPublishTimers(client,{reportOnly:true,optimized:true});
    await installWriterTimers(client,{capturePlans:false,reportWriteCleanup,measureBulkPreparation:true,reuseCanonicalRows});
    if(triggerPhaseDetail) await installTriggerPhaseTimers(client);
  }
  if(hosted) await installHostedReportClocks(client);
  if(callBreakdown) {
    assert.ok(endToEnd);
    await client.query(`create function pg_temp.eo05_time_query(statement text, parameters jsonb)
      returns table(payload jsonb,elapsed_ms double precision)
      language plpgsql security invoker set search_path='' as $clock$
      declare started timestamptz;
      begin
        if statement !~* '^select ' then raise exception 'BENCHMARK_SELECT_REQUIRED';end if;
        started:=clock_timestamp();
        execute 'select coalesce(jsonb_agg(to_jsonb(output)),''[]''::jsonb) from ('||statement||') output'
          into payload using parameters;
        elapsed_ms:=1000*extract(epoch from clock_timestamp()-started);
        return next;
      end $clock$`);
  }
  await client.query("update integrations.provider_connections set connected_at=clock_timestamp()-interval '3 days' where id=$1",[owner.connectionId]);
  const context={provider:"klaviyo",clientScopeKey:hash(),connectionScopeKey:hash(),connectionEpoch:1,accountId:owner.accountId,organizationId:null,apiVersion:"2026-10-15"};
  await client.query(`insert into operations.refresh_quota_contexts
    (workspace_id,install_generation,provider,installation_id,connection_id,connection_version,account_id,client_scope_key,connection_scope_key,connection_epoch,api_version,enabled)
    values ($1,$2,'klaviyo',$3,$4,$5,$6,$7,$8,1,'2026-10-15',true)`,
  [owner.workspaceId,owner.generation,owner.installationId,owner.connectionId,owner.connectionVersion,owner.accountId,context.clientScopeKey,context.connectionScopeKey]);
  if(matchedTransport==="quota"||fullAuthority) matchedQuota=await prepareMatchedKlaviyoTransport(client,context,{fullAuthority,
    measureQuery:(sql,args)=>measureFourPhase(timingStep,sql,args,()=>client.query(sql,args)),
  });
  if(fullAuthority)createReadAuthority=await prepareKlaviyoReadAuthority(client,owner,matchedQuota.database,now);
  }
  const cost={requests:21,dbWrites:4000,connections:3,rows:2000,bytes:4000000};
  if(!sharedRefresh){
  await client.query("update operations.refresh_control set budget=$1,bounds=$2 where singleton",[
    {global:cost,interactiveReserve:{requests:0,dbWrites:0,connections:0,rows:0,bytes:0},
      providers:[{provider:"klaviyo",limit:cost}],workspaces:[{workspaceId:owner.workspaceId,limit:cost}],
      accounts:[{provider:"klaviyo",accountId:owner.accountId,limit:cost}]},
    {maxWorkspaces:8,maxCandidates:8,maxClaims:1,maxAdmissions:1},
  ]);
  await client.query("update operations.refresh_tick_control set enabled=true,generation=$1,last_minute=null,last_checked_at_ms=null,queue_revision=null where singleton",[generation]);
  await client.query("update operations.refresh_queue_control set max_workspaces=8,max_accounts=8,max_snapshot_bytes=100000,max_snapshot_age_ms=60000 where singleton");
  }

  const databaseTimings={queue:0,rawWrite:0,rawReadback:0,reportSourceRead:0,reportStage:0,reportPublish:0,reportReadback:0,jobClose:0};
  const publishPhasesMs={},writerPhasesMs={},writerPhaseCounts={};
  const retentionPackagesMs=[];
  let bulkPlans;
  const onNotice=({message})=>{
    const retention=/^EO05_RETENTION_COMPARISON ([\d.eE+-]+)$/.exec(message);
    if(retention) retentionPackagesMs.push(Number(retention[1]));
    const match=/^EO05_DAILY_PUBLISH_PHASE ([a-zA-Z]+) ([0-9.]+)$/.exec(message);
    if(match)publishPhasesMs[match[1]]=Number(match[2]);
    const writer=/^EO05_WRITER_TIMING ([a-zA-Z]+) ([\d.eE+-]+)$/.exec(message);
    if(writer) {
      writerPhasesMs[writer[1]]=(writerPhasesMs[writer[1]]??0)+Number(writer[2]);
      writerPhaseCounts[writer[1]]=(writerPhaseCounts[writer[1]]??0)+1;
    }
  };
  let failed,phase="start",requests=0,claimId,reportReceipt,reportWriteMs,reportCpuStart,sharedDayChecks=0;
  let comparableStageMs=0,comparableStageCalls=0;
  let reportQueueCallsMs=0;
  const callTimings=[];
  async function executeMeasured(sql,args=[],bucket) {
    if(!callBreakdown) return client.query(sql,args);
    const step=timingStep==="reportPreparation"&&bucket!=="queue"?bucket:timingStep;
    const started=performance.now();
    if(!/^select /i.test(sql)) {
      assert.match(sql,/^(savepoint|release savepoint) daily_timing_report$/);
      const result=await client.query(sql,args);
      callTimings.push({step,bucket,wallMs:performance.now()-started,sqlMs:null});
      return result;
    }
    const parameters=args.map(value=>{
      if(value===null||value===undefined) return null;
      if(Buffer.isBuffer(value)) return "\\x"+value.toString("hex");
      if(value instanceof Date) return value.toISOString();
      if(typeof value==="object") return JSON.stringify(value);
      return String(value);
    });
    const statement=sql.replace(/\$(\d+)/g,(_match,index)=>`($1->>${Number(index)-1})`);
    const {rows:[measurement]}=await client.query("select * from pg_temp.eo05_time_query($1,$2)",[statement,JSON.stringify(parameters)]);
    assert.ok(Number.isFinite(measurement.elapsed_ms)&&measurement.elapsed_ms>=0);
    assert.ok(Array.isArray(measurement.payload));
    callTimings.push({step,bucket,wallMs:performance.now()-started,sqlMs:measurement.elapsed_ms,
      operation:sql.match(/(?:operations|evidence|analytics|pg_temp)\.[a-z_]+/)?.[0]??"select"});
    return {rows:measurement.payload,rowCount:measurement.payload.length};
  }
  const hostedReportMs=[];
  const durations={queueEnqueue:0,queueAndAdmission:0,providerCollection:0,providerFixture:0,rawStore:0,handoff:0,reportFlow:0};
  async function timedQuery(bucket,sql,args,diagnosticPhase=null) {
    if (!endToEnd&&!detailed&&(!reportOnly||!["reportStage","reportPublish"].includes(bucket))) return client.query(sql,args);
    const start=performance.now();
    try {return await measureFourPhase(diagnosticPhase,sql,args,()=>executeMeasured(sql,args,bucket));}
    catch(error) {failed??=error;throw error;}
    finally {
      const elapsed=performance.now()-start;
      databaseTimings[bucket]+=elapsed;
      if(endToEnd&&phase==="report"&&bucket==="queue") reportQueueCallsMs+=elapsed;
    }
  }
  let store=createRefreshWorkRepository({query:(sql,args)=>timedQuery("queue",sql,args)});
  const quotaWorkStore=matchedQuota?createRefreshWorkRepository(matchedQuota.database):store;
  const rawDatabase={query:(sql,args)=>measureFourPhase("rawStore",sql,args,()=>
    timedQuery(sql.includes("commit_klaviyo_dataset_source(")?"rawWrite":"rawReadback",sql,args))};
  const reportDatabase={
    async query(sql,args) {
      if(hosted&&(sql===KLAVIYO_DAILY_STAGE_SQL||sql===KLAVIYO_DAILY_PUBLISH_SQL)) {
        const timedSql=sql===KLAVIYO_DAILY_STAGE_SQL
          ?"select * from pg_temp.eo05_time_stage($1::jsonb,$2::jsonb,$3::jsonb,$4::timestamptz,$5::integer,$6::integer)"
          :"select * from pg_temp.eo05_time_publish($1::jsonb,$2::jsonb,$3::timestamptz,$4::uuid,$5::jsonb,$6::jsonb)";
        try {
          if(!endToEnd&&reuseStagedCanonical&&sql===KLAVIYO_DAILY_PUBLISH_SQL) await verifyStageTamperRejection(client,args,reuseCanonicalRows);
          const callStart=performance.now();
          const result=await executeMeasured(timedSql,args,sql===KLAVIYO_DAILY_STAGE_SQL?"reportStage":"reportPublish");
          if(endToEnd) databaseTimings[sql===KLAVIYO_DAILY_STAGE_SQL?"reportStage":"reportPublish"]+=performance.now()-callStart;
          hostedReportMs.push(result.rows[0].elapsed_ms);
          if(verifyDaySources&&sql===KLAVIYO_DAILY_PUBLISH_SQL) sharedDayChecks=await verifySharedDaySources(client,args);
          return result;
        } catch(error) {failed??=error;throw error;}
      }
      const bucket=sql===KLAVIYO_DAILY_STAGE_SQL?"reportStage":sql===KLAVIYO_DAILY_PUBLISH_SQL?"reportPublish":
        sql===KLAVIYO_DAILY_INSPECT_SQL?"reportReadback":sql===KLAVIYO_DAILY_FINISH_SQL?"jobClose":"reportSourceRead";
      if(comparableReport&&sql===KLAVIYO_DAILY_STAGE_SQL){
        const started=performance.now();
        const result=await timedQuery(bucket,sql,args);
        comparableStageMs+=performance.now()-started;
        comparableStageCalls++;
        return result;
      }
      const measuredPhase=bucket==="reportReadback"?"receiptReadback":bucket==="jobClose"?"jobClose":null;
      if(singleReportClose&&!sharedRefresh&&bucket==="jobClose"){
        closeArgs=args;
        await client.query("savepoint eo05_single_close_proof");
      }
      return timedQuery(bucket,sql,args,measuredPhase);
    },
    async transaction(run) {
      const reportStart=reportBoundary?performance.now():null;
      await timedQuery("reportStage","savepoint daily_timing_report");
      try {
        reportReceipt=await run(reportDatabase);
        await timedQuery("reportPublish","release savepoint daily_timing_report");
        if(reportBoundary) reportWriteMs=performance.now()-reportStart;
        return reportReceipt;
      } catch(error) {
        failed??=error;
        await client.query("rollback to savepoint daily_timing_report");
        await client.query("release savepoint daily_timing_report");
        throw error;
      }
    },
  };
  if(fourPhaseDiagnostics)fourPhase=await createFourPhaseDiagnostics(client,"klaviyo");
  if(sharedRefresh)store=await sharedRefresh.beforeWork({owner,cost,store});
  const start=reportOnly||retentionOnly?null:performance.now();
  const comparable=comparableReport?collectComparableReportTiming(client):null;
  if (measureReport||retentionOnly||hostedDetail) client.on("notice",onNotice);
  try {
    if(!sharedRefresh)await store.checkQueueFromAuthority({expectedRevision:(await store.readQueueCheck()).revision});
    if (detailed||endToEnd) durations.queueEnqueue=performance.now()-start;
    timingStep="queueAndAdmission";
    const limits={deadlineAt:now()+120000,requestTimeoutMs:100000,finishReserveMs:2000,maxRows:2000,maxBytes:4000000};
    const appId="gid://shopify/App/456";
    const entitlementVerifier=sharedRefresh?.partnerVerifier({store,owner,limits,now})??createRefreshEntitlementVerifier({store,appId,now,limits,authorizeRead:async()=>true,
      partnerApi:{appId,activeSubscription:async()=>({data:{activeSubscription:{
        shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},billingPeriod:"EVERY_30_DAYS",
        cancelAtEndOfCycle:false,trialEndsAt:null,currentBillingCycle:{
          startTime:new Date(now()-86400000).toISOString(),endTime:new Date(now()+86400000).toISOString()},
        items:[{handle:"monthly",price:{active:true}}],
      }}})},
    });
    const batches=[];
    let collectedAt,reportAt;
    phase="admission";
    const run=await runScheduled({store,generation,work:{
      now,entitlementVerifier,
      buildWorkPlan:async candidate=>candidate.workspaceId===owner.workspaceId&&candidate.provider==="klaviyo"
        ? {window,partitionId:"synthetic-daily-timing:"+day+(repeat?":reread":""),workClass:"deep_reconciliation",cost,limits}:null,
      async readPage({claim,entitlementReceipt,signal}) {
        try {
          claimId=claim.id;
          const execution={claim,window,entitlementReceipt};
          const loadContext=()=>quotaWorkStore.loadQuotaContext({...execution,provider:"klaviyo"});
          let quotaContext;
          if(!matchedTransport){quotaContext=await loadContext();assert.ok(quotaContext);}
          const beforeCollect=detailed||endToEnd?performance.now():0;
          if (detailed||endToEnd) durations.queueAndAdmission=beforeCollect-start-durations.queueEnqueue;
          phase="collection";
          timingStep="providerCollection";
          const loader=createReadAuthority?.(signal);
          const current=await loader?.loadCurrent();
          if(matchedTransport)quotaContext=await loadContext();
          assert.ok(quotaContext);
          if(loader){
            assert.equal(current.account.id,claim.accountId);
            assert.equal(quotaContext.accountId,current.account.id);
            assert.equal(quotaContext.apiVersion,"2026-10-15");
          }
          const guard=loader?async()=>{
            if(signal.aborted)throw Error("read_aborted");
            await loader.loadCurrent();
            assert.deepEqual(await loadContext(),quotaContext);
            if(signal.aborted)throw Error("read_aborted");
            authorityChecks++;
          }:async()=>assert.equal(await store.isClaimCurrent({claim}),true);
          const fixtureFetch=async endpoint=>{
            requests++;
            if (!detailed&&!endToEnd) return syntheticResponse(endpoint,owner,day,repeat?.changedEvents??0);
            const before=performance.now();
            try {
              const response=syntheticResponse(endpoint,owner,day,repeat?.changedEvents??0,shopifyMapping);
              if(matchedTransport){
                response.headers.set("ratelimit-limit","1000");
                response.headers.set("ratelimit-remaining",String(1000-requests));
                response.headers.set("ratelimit-reset","60");
              }
              return response;
            }
            finally {durations.providerFixture+=performance.now()-before;}
          };
          const transport=matchedQuota?createRefreshKlaviyoRawTransport({
            ...execution,workStore:quotaWorkStore,quotaStore:createSharedQuotaRepository(matchedQuota.database),now,fetchFn:fixtureFetch,
          }):fixtureFetch;
          await collectKlaviyoRawDatasets({
            accessToken:current?.tokenSet.access_token??"synthetic-only",accountId:owner.accountId,source:{timezone:"UTC",currency:"USD"},
            window,limits:{...limits,maxPages:10,maxBytes:1048576},signal,now,guard,transport,pacerFactory:()=>async()=>{},
            async onDataset({dataset,pages,complete,coverage}) {
              timingStep="rawStore";
              assert.equal(complete,true);
              const begin=detailed||endToEnd?performance.now():0,attemptId=randomUUID(),stamp=new Date(now()).toISOString();
              const read={jobId:claim.id,fence:String(claim.fence),window,operationId,quotaContext,
                observedAt:entitlementReceipt.observedAt,completedAt:stamp,deadlineAt:new Date(limits.deadlineAt).toISOString(),coverage};
              if (dataset==="product_performance") {
                const stored=await rawStore.storeKlaviyoRawProductPackages({database:rawDatabase,owner,attemptId,pages,read,cipher,
                  policy,limits:storageLimits,now:stamp,maxPackages:20,guard});
                batches.push(...stored.map(({ordinal})=>({attemptId,ordinal})));
              } else {
                const stored=await rawStore.storeKlaviyoRawDataset({database:rawDatabase,owner,attemptId,dataset,pages,complete,
                  read,cipher,policy,limits:storageLimits,now:stamp});
                assert.equal(stored.contentVerified,true);
                batches.push({attemptId,ordinal:0});
              }
              if (detailed||endToEnd) durations.rawStore+=performance.now()-begin;
              timingStep="providerCollection";
            },
          });
          if (detailed||endToEnd) {
            collectedAt=performance.now();
            durations.providerCollection=collectedAt-beforeCollect-durations.rawStore;
          }
          timingStep="handoff";
          return {kind:"complete",payload:{batchCount:batches.length}};
        } catch(error) {failed??=error;throw error;}
      },
      validatePage:({payload})=>({complete:payload.batchCount>3,rows:[]}),
      async loadDatasetInputs({claim,deadlineAt}) {
        assert.equal(claim.id,claimId);
        phase="report";
        timingStep="reportPreparation";
        if (detailed||endToEnd) {
          reportAt=performance.now();
          if(endToEnd) reportCpuStart=process.cpuUsage();
          durations.handoff=reportAt-collectedAt;
        }
        if(shopifyMapping){
          // Releasing the raw adapter savepoint leaves SET LOCAL active in
          // this rollback transaction. The normal report connection has its own bound.
          const reportTimeout=Math.min(30000,deadlineAt-now());
          assert.ok(reportTimeout>0);
          await client.query("select pg_catalog.set_config('statement_timeout',$1,true),pg_catalog.set_config('lock_timeout',$1,true)",
            [`${reportTimeout}ms`]);
        }
        return {owner,batches,cipher,expectedRevision:repeat?1:0,database:reportDatabase,
          ...(mapping?{bindSyntheticMappings:mapping.bindSyntheticMappings}:{})};
      },
    }});
    if (failed) throw failed;
    const ended=reportOnly||retentionOnly?null:performance.now();
    const reportCpu=endToEnd?process.cpuUsage(reportCpuStart):null;
    if(sharedRefresh)await sharedRefresh.afterClose(owner,run);
    if(optimizeReadback) {
      const {rows:[{count,matches}]}=await client.query(`with columns as (
        select array_agg(attname::text order by attnum) as names from pg_catalog.pg_attribute
        where attrelid='analytics.cpd_product_sales_facts'::regclass
        and atttypid in ('numeric'::regtype,'bigint'::regtype) and attnum>0 and not attisdropped
      )
      select count(*)::int as count,bool_and(
        analytics.reconciliation_fact_digest('cpd_product_sales_facts',to_jsonb(x))=
        analytics.eo05_fact_digest_with_columns('cpd_product_sales_facts',to_jsonb(x),columns.names)
      ) as matches from analytics.cpd_product_sales_facts x cross join columns where installation_id=$1`,[owner.installationId]);
      assert.equal(count,productEvents);
      assert.equal(matches,true);
      const {rows:[proof]}=await client.query(`select
        analytics.eo05_original_report_fingerprint($1,$2,'UTC',1000,false) as original,
        analytics.klaviyo_daily_report_fingerprint($1,$2,'UTC',1000,false) as candidate`,[owner,day]);
      assert.equal(proof.candidate,proof.original);
    }
    if (detailed||endToEnd) durations.reportFlow=ended-reportAt;
    assert.equal(run.work?.status,"completed",JSON.stringify(run));
    assert.equal(reportReceipt?.rowCount,productEvents);
    assert.equal(reportReceipt?.revision,repeat?2:1);
    if(repeat) assert.notEqual(reportReceipt.operationId,repeat.previous.operationId);
    assert.deepEqual(reportReceipt.packages.map(part=>part.rowCount),[200,200,200,200,200]);
    assert.equal(requests,15);
    const status=(await client.query("select status from operations.refresh_runs where workspace_id=$1 and job_id=$2",
      [owner.workspaceId,claimId])).rows[0]?.status;
    assert.equal(status,"completed");
    const sales=(await client.query("select count(*)::int n from analytics.cpd_product_sales_facts where installation_id=$1 and platform='klaviyo'",
      [owner.installationId])).rows[0].n;
    assert.equal(sales,productEvents);
    let shopifyMappingMeasurement;
    if(mapping){
      const {rows:[linked]}=await client.query(`select count(*)::int sales,min(m.shopify_product_id) product
        from analytics.cpd_product_sales_facts f join identity.product_identity_mappings m on m.id=f.sold_product_mapping_id
        where f.installation_id=$1 and m.id=$2`,[owner.installationId,mapping.mappingId]);
      assert.deepEqual(linked,{sales:1,product:mapping.productId});
      shopifyMappingMeasurement={...mapping.summary(),mappedRows:1};
      assert.equal(shopifyMappingMeasurement.reads,1);
    }
    const receipts=(await client.query(`select count(*)::int n from evidence.source_batches
      where authority=$1::jsonb and manifest->'klaviyoDailyReceipt'->>'jobId'=$2`,
      [JSON.stringify(owner),claimId])).rows[0].n;
    assert.equal(receipts,1);
    const summary={provider:"klaviyo",synthetic:true,rollbackOnly:true,writerCommit:bulkWriterCommit,
      queueMode:sharedRefresh?"shared_serial_rehearsal":"isolated_no_backlog",productEvents,reportRows:reportReceipt.rowCount,rawPackages:batches.length,
      reportPackages:reportReceipt.packages.length,receipts,requests,...verifyDaySources?{sharedDayChecks,correctnessOnly:true}: {}};
    if (matchedTransport) {
      const quotaDebits=matchedQuota?(await client.query(`select count(*)::int as reserved,
        count(*) filter(where settled)::int as settled from operations.api_quota_debits where policy_id=$1`,[matchedQuota.policy])).rows[0]:null;
      if(matchedQuota) assert.deepEqual(quotaDebits,{reserved:requests,settled:requests});
      if(fullAuthority) assert.ok(authorityChecks>=2*requests);
      if(comparable)assert.equal(comparableStageCalls,5);
      const reportComparison=comparable?await comparable.result(reportWriteMs,comparableStageMs):undefined;
      const reportSourceRead=databaseTimings.reportSourceRead,receiptReadback=databaseTimings.reportReadback,jobClose=databaseTimings.jobClose;
      const durationsMs={
        queueEnqueue:durations.queueEnqueue,queueAndAdmission:durations.queueAndAdmission,
        providerCollection:durations.providerCollection,rawStore:durations.rawStore,handoff:durations.handoff,
        reportSourceRead,reportPreparation:durations.reportFlow-reportSourceRead-reportWriteMs-receiptReadback-jobClose,
        reportWrite:reportWriteMs,receiptReadback,jobClose,
      };
      if(singleReportClose&&!sharedRefresh){
        assert.ok(closeArgs);
        await client.query("rollback to savepoint eo05_single_close_proof");
        await verifySingleReportCloseRejections(client,"klaviyo",KLAVIYO_DAILY_FINISH_SQL,closeArgs);
        await client.query("release savepoint eo05_single_close_proof");
      }
      return {...summary,matchedTransport,quotaDebits,authorityChecks,reportComparison,totalMs:ended-start,durationsMs,
        ...(shopifyMappingMeasurement?{shopifyMappingMeasurement}:{}),
        ...(fourPhase?{fourPhaseDiagnostics:fourPhase.result(durationsMs,requests)}:{})};
    }
    if(retentionOnly) {
      const {rows:[{calls}]}=await client.query("select current_setting('eo05.retention_calls')::int calls");
      assert.equal(calls,retentionVariant==="cached"?1:productEvents);
      assert.equal(retentionPackagesMs.length,5);
      return {...summary,variant:retentionVariant,calls,retentionPackagesMs,
        retentionMs:retentionPackagesMs.reduce((sum,ms)=>sum+ms,0)};
    }
    if(retentionWall) {
      const totalMs=ended-start;
      if(reportBoundary) assert.ok(reportWriteMs>0&&reportWriteMs<totalMs);
      if(hosted) {
        assert.equal(hostedReportMs.length,6);
        assert.ok(hostedReportMs.every(value=>Number.isFinite(value)&&value>0));
        const reportWriteMs=hostedReportMs.reduce((sum,ms)=>sum+ms,0);
        if(endToEnd) return {...summary,totalMs:ended-start,reportWriteMs,durationsMs:durations,
          databaseCallsMs:databaseTimings,reportQueueCallsMs,
          reportCpuMs:(reportCpu.user+reportCpu.system)/1000,callTimings:callBreakdown?callTimings:undefined,
          detailsMeasured:false,providerNetworkMeasured:false};
        if(!hostedDetail) return {...summary,reportWriteMs};
        for(const name of ["publishLockAcquire","publishAuthority","publishPackageValidation","sharedSourceChecks",
          "beforeWriter","physicalWrite","readbackAuthority","physicalVerification","writerAndVerification","receiptPersist"]) {
          assert.ok(Number.isFinite(publishPhasesMs[name]),`missing SQL timing ${name}`);
        }
        for(const name of [...writerPhases,"packageJsonSize"]) {
          assert.equal(writerPhaseCounts[name],5,`expected five package timings for ${name}`);
        }
        if(reuseCanonicalRows) assert.equal(writerPhaseCounts.reusedPackage,5);
        const {rows:[{triggerMs}]}=await client.query("select current_setting('eo05.sales_trigger_ms')::double precision \"triggerMs\"");
        assert.ok(triggerMs>0&&triggerMs<=writerPhasesMs.bulkStatement);
        let triggerDetailMs;
        if(triggerPhaseDetail) {
          const {rows:[{timings}]}=await client.query("select string_to_array(current_setting('eo05.trigger_phase_ms'),',')::float8[] as timings");
          assert.equal(timings.length,triggerPhases.length);
          assert.ok(timings.every(value=>Number.isFinite(value)&&value>=0));
          triggerDetailMs=Object.fromEntries(triggerPhases.map((phase,index)=>[phase,timings[index]]));
        }
        return {...summary,reportWriteMs,stageMs:hostedReportMs.slice(0,5).reduce((sum,ms)=>sum+ms,0),
          publishMs:hostedReportMs[5],publishPhasesMs,writerPhasesMs,triggerMs,triggerDetailMs,detailsMeasured:true};
      }
      return {...summary,variant:retentionVariant,totalMs,reportWriteMs,combinedVerification,reduceReportRepeats,detailsMeasured:false};
    }
    if (!measureReport) {
      console.log("EO05_KLAVIYO_WALL_TIME_PASS "+JSON.stringify({...summary,totalMs:ended-start,detailsMeasured:false}));
      return;
    }
    for (const name of ["sharedSourceChecks","physicalWrite","physicalVerification","receiptPersist"]) {
      assert.ok(Number.isFinite(publishPhasesMs[name]),`missing SQL timing ${name}`);
    }
    for (const name of [...writerPhases,"packageJsonSize"]) {
      assert.equal(writerPhaseCounts[name],5,`expected five package timings for ${name}`);
      assert.ok(Number.isFinite(writerPhasesMs[name]),`missing writer timing ${name}`);
    }
    if (reportOnly) {
      const {rows:[{triggerMs}]}=await client.query("select current_setting('eo05.sales_trigger_ms')::double precision \"triggerMs\"");
      assert.ok(triggerMs>0&&triggerMs<=writerPhasesMs.bulkStatement);
      assert.ok(Number.isFinite(publishPhasesMs.publishLockAuthority));
      assert.ok(Number.isFinite(publishPhasesMs.publishPackageValidation));
      console.log("EO05_KLAVIYO_REPORT_ONLY_PASS "+JSON.stringify({
        ...summary,totalMs:databaseTimings.reportStage+databaseTimings.reportPublish,reportStageMs:databaseTimings.reportStage,
        reportPublishMs:databaseTimings.reportPublish,publishPhasesMs,writerPhasesMs,triggerMs,
      }));
      return;
    }
    const postgresqlMs=Object.values(databaseTimings).reduce((sum,ms)=>sum+ms,0);
    phase="plain_insert";
    const plainInsert=await measurePlainSalesInserts(client,owner.installationId);
    phase="bulk_plan_sample";
    bulkPlans=await measureBulkPlans(client,owner.installationId);
    console.log("EO05_KLAVIYO_DAILY_TIMING_PASS "+JSON.stringify({
      ...summary,totalMs:ended-start,durationsMs:durations,postgresqlMsByPhase:databaseTimings,publishPhasesMs,writerPhasesMs,bulkPlans,postgresqlMs,
      adsTableAndFixtureOverheadMs:ended-start-postgresqlMs-durations.providerFixture,plainInsert,
    }));
  } catch(error) {
    console.error("EO05_KLAVIYO_DAILY_TIMING_STOP "+JSON.stringify({
      phase,code:error.code,message:error.message,where:error.where,requests,
      elapsedBeforeStopMs:start===null?undefined:performance.now()-start,durationsMs:durations,postgresqlMsByPhase:databaseTimings,publishPhasesMs,writerPhasesMs,bulkPlans,
    }));
    throw error;
  } finally {
    if (measureReport||retentionOnly||hostedDetail) client.off("notice",onNotice);
    comparable?.stop();
    fourPhase?.close();
    await matchedQuota?.database.close();
  }
}
