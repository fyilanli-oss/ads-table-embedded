import assert from "node:assert/strict";

function replaceOnce(source, search, replacement) {
  assert.equal(source.split(search).length, 2, search);
  return source.replace(search, () => replacement);
}

// Adapt the existing report write/readback in the rollback database. Preserve
// its fenced entry point, source checks, retention, per-row write/verification,
// and same-receipt closure. Only the isolated adapter supplies package arrays.
export function metaDailyWriterSql(sql) {
  sql=replaceOnce(sql,"begin\n perform 1",`extra_packages jsonb; pack jsonb; pack_summary jsonb:='[]'; combined_rows jsonb:='[]';
begin
 perform 1`);
  sql=replaceOnce(sql," perform evidence.assert_source_owner(o);",` perform evidence.assert_source_owner(o);
 if jsonb_typeof(p)='array' then
  if o->>'provider' is distinct from 'meta' or c->>'expectedRevision' is distinct from '0'
   or jsonb_array_length(p)<>5 then raise exception 'META_REPORT_PACKAGE_COUNT';end if;
  extra_packages:=p;
  for pack in select value from jsonb_array_elements(extra_packages) with ordinality t(value,n) order by n loop
   if jsonb_typeof(pack) is distinct from 'object' or (select count(*) from jsonb_object_keys(pack))<>4
    or not pack ?& array['version','operationId','policy','rows'] or pack->>'version' is distinct from 'eo05b-storage-v1'
    or pack-'rows' is distinct from (extra_packages->0)-'rows'
    or jsonb_typeof(pack->'rows') is distinct from 'array' or jsonb_array_length(pack->'rows')<>200
    or octet_length(analytics.dataset_json(jsonb_build_object('write',pack,'context',c)))>1048576
    then raise exception 'META_REPORT_PACKAGE_INVALID';end if;
   pack_summary:=pack_summary||jsonb_build_array(jsonb_build_object('ordinal',jsonb_array_length(pack_summary),
    'rowCount',200,'digest',analytics.dataset_digest(jsonb_build_object('write',pack,'context',c))));
   combined_rows:=combined_rows||(pack->'rows');
  end loop;
  h:=analytics.dataset_digest(jsonb_build_object('packages',pack_summary));
  p:=jsonb_set(extra_packages->0,'{rows}',combined_rows);
 end if;`);
  sql=replaceOnce(sql,"jsonb_array_length(p->'rows') not between 0 and 200\n or octet_length(analytics.dataset_json(p))>1048576",
    "jsonb_array_length(p->'rows') not between 0 and (case when extra_packages is null then 200 else 1000 end)\n or (extra_packages is null and octet_length(analytics.dataset_json(p))>1048576)");
  sql=replaceOnce(sql," h:=analytics.dataset_digest(jsonb_build_object('write',p,'context',c));\n if jsonb_typeof(c)",
    " if extra_packages is null then h:=analytics.dataset_digest(jsonb_build_object('write',p,'context',c));end if;\n if jsonb_typeof(c)");
  sql=replaceOnce(sql," or octet_length(analytics.dataset_json(jsonb_build_object('write',p,'context',c)))>1048576",
    " or (extra_packages is null and octet_length(analytics.dataset_json(jsonb_build_object('write',p,'context',c)))>1048576)");
  // Keep replacement out of this first-publication-only rehearsal.
  sql=replaceOnce(sql,"old_count:=old_count+1;if old_count>200", "old_count:=old_count+1;if extra_packages is not null or old_count>200");
  sql=replaceOnce(sql," limit 201) x',name)"," limit %s) x',name,case when extra_packages is null then 201 else 1001 end)");
  // The report holds every eligible batch before this loop. Every row still
  // proves its references belong to that same locked, verified day and floor.
  sql=replaceOnce(sql,`   for k in select distinct x->>'batch_id' from jsonb_array_elements(r->'provenance'->'sources') x loop
    perform analytics.hold_report_source_batch(o,k::bigint,(p->'policy'->>'until')::timestamptz);
   end loop;`,`   if extra_packages is null then
    for k in select distinct x->>'batch_id' from jsonb_array_elements(r->'provenance'->'sources') x loop
     perform analytics.hold_report_source_batch(o,k::bigint,(p->'policy'->>'until')::timestamptz);
    end loop;
   end if;`);
  sql=replaceOnce(sql," for item in select value from jsonb_array_elements(p->'rows') loop\n  name:=item->>'table';",` for item in
  select entries.value from jsonb_array_elements(coalesce(extra_packages,jsonb_build_array(p))) with ordinality packages(body,n)
  cross join lateral jsonb_array_elements(packages.body->'rows') with ordinality entries(value,n)
  order by packages.n,entries.n
 loop
  name:=item->>'table';`);
  // Keep the existing 256 KiB receipt bound and the full row evidence required
  // by inspect. Initial inserts already have the same digests in receipt.rows.
  sql=replaceOnce(sql,"   changes:=changes||jsonb_build_array(jsonb_build_object('table',name,'id',rid::text,'before',null,'after',r->>'payload_digest','action','inserted'));",
    "   if extra_packages is null then changes:=changes||jsonb_build_array(jsonb_build_object('table',name,'id',rid::text,'before',null,'after',r->>'payload_digest','action','inserted'));end if;");
  return replaceOnce(sql," result:=result||jsonb_build_object('digest',analytics.dataset_digest(result));",
    " if extra_packages is not null then result:=result||jsonb_build_object('packages',pack_summary);end if;\n result:=result||jsonb_build_object('digest',analytics.dataset_digest(result));");
}

export function metaDailyInspectorSql(sql) {
  return replaceOnce(sql," limit 201) x',t)"," limit %s) x',t,case when o->>'provider'='meta' and r ? 'packages' then 1001 else 201 end)");
}

export async function installMetaDailyReportRehearsal(client) {
  assert.equal(client.connectionParameters.host,"127.0.0.1");
  assert.equal(Number(client.connectionParameters.port),54322);
  for(const [signature,adapt] of [["analytics._commit_dataset_reconciliation(jsonb,jsonb,jsonb,timestamptz)",metaDailyWriterSql],
    ["analytics.inspect_dataset_reconciliation(jsonb,uuid)",metaDailyInspectorSql]]){
    const {rows:[{definition}]}=await client.query("select pg_get_functiondef($1::regprocedure) definition",[signature]);
    await client.query(adapt(definition));
  }
}

export function metaDailyReconciliationSource(source) {
  source=replaceOnce(source,'["klaviyo","google_ads"].includes(owner.provider)', '["klaviyo","google_ads","meta"].includes(owner.provider)');
  source=replaceOnce(source,'  if (!dailyPackages && !googleDaily && projection.rows.length > 200)',
    '  const metaDaily=bound.provider==="meta" && scheduled && expectedRevision===0;\n  if (!metaDaily && !dailyPackages && !googleDaily && projection.rows.length > 200)');
  source=replaceOnce(source,'  const [write]=prepareDailyDatasetPackages({owner:bound,rows:projection.rows,policy,operationId,now:new Date(now()).toISOString(),context});',
    `  const prepared=prepareDailyDatasetPackages({owner:bound,rows:projection.rows,policy,operationId,now:new Date(now()).toISOString(),context,maxPackages:metaDaily?5:1});
  if(metaDaily && (prepared.length!==5 || prepared.some(p=>p.rows.length!==200))) fail("META_PACKAGE_COVERAGE");
  const write=metaDaily?prepared:prepared[0];
  const expectedPackages=metaDaily?prepared.map((pack,ordinal)=>({ordinal,rowCount:pack.rows.length,digest:sourcePayloadHash({write:pack,context})})):null;`);
  source=replaceOnce(source,'  const requestDigest = sourcePayloadHash({write, context});',
    '  const requestDigest = metaDaily ? sourcePayloadHash({packages:expectedPackages}) : sourcePayloadHash({write, context});');
  return replaceOnce(source,'      || receipt.rowCount !== write.rows.length || receipt.comparison !== "matched") fail("RESULT_INVALID");',
    '      || receipt.rowCount !== projection.rows.length || receipt.comparison !== "matched"\n      || metaDaily && canonicalSourceJson(receipt.packages??null)!==canonicalSourceJson(expectedPackages)) fail("RESULT_INVALID");')
    .replace('reportValuesChanged: receipt.changes?.length > 0','reportValuesChanged: metaDaily ? receipt.rowCount > 0 : receipt.changes?.length > 0');
}
