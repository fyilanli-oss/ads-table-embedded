import assert from "node:assert/strict";

export const privacyIndexTargets = Object.freeze([
  {table: "deletion_runs", index: "deletion_runs_workspace_fk_idx"},
  {table: "deletion_manifests", index: "deletion_manifests_workspace_fk_idx"},
]);

export function assertIndexPlan(plan, name) {
  const nodes = [plan, ...(plan.Plans ?? []).flatMap(flattenPlan)];
  assert.ok(nodes.some(node => node["Index Name"] === name), `expected index missing: ${name}`);
}
function flattenPlan(plan) { return [plan, ...(plan.Plans ?? []).flatMap(flattenPlan)]; }

export async function assertPrivacyIndexes(client) {
  const rows = (await client.query(`select t.relname as table_name, c.relname as index_name,
    i.indisvalid, i.indisready, i.indisunique, am.amname,
    pg_get_indexdef(i.indexrelid,1,true) as first_key, i.indnkeyatts,
    i.indpred is null as non_partial, i.indexprs is null as non_expression
    from pg_index i join pg_class c on c.oid=i.indexrelid
    join pg_class t on t.oid=i.indrelid join pg_namespace n on n.oid=t.relnamespace
    join pg_am am on am.oid=c.relam where n.nspname='privacy'
    and c.relname in ('deletion_runs_workspace_fk_idx','deletion_manifests_workspace_fk_idx')
    order by t.relname`)).rows;
  assert.equal(rows.length, 2);
  for (const target of privacyIndexTargets) {
    const row = rows.find(item => item.table_name === target.table && item.index_name === target.index);
    assert.ok(row);
    assert.equal(row.indisvalid && row.indisready && row.non_partial && row.non_expression, true);
    assert.equal(row.indisunique, false);
    assert.equal(row.amname, "btree");
    assert.equal(row.first_key, "workspace_id");
    assert.equal(row.indnkeyatts, 1);
  }
}

// Called only by the existing loopback-only ephemeral replay runner, never live.
export async function privacyIndexPlanProbe(client, migrationSql, environment = process.env) {
  assert.equal(environment.GITHUB_ACTIONS, "true", "F08 probe requires ephemeral GitHub runner");
  assert.ok(environment.RUNNER_TEMP);
  await client.query("begin");
  try {
    await client.query("set local role adstable_owner");
    assert.deepEqual((await client.query(`select
      (select count(*)::int from privacy.deletion_runs) as runs,
      (select count(*)::int from privacy.deletion_manifests) as manifests`)).rows[0], {runs: 0, manifests: 0});
    await client.query(`insert into app.workspaces(id)
      select md5('f08-workspace-'||g)::uuid from generate_series(1,2000) g`);
    await client.query(`insert into privacy.deletion_runs
      (id,request_key,workspace_id,install_generation,shop_identity_sha256,kind,status,requested_at,deadline_at,completed_at)
      select md5('f08-run-'||g)::uuid,'f08-synthetic-'||g,md5('f08-workspace-'||((g-1)%2000+1))::uuid,
        1,decode(repeat('ab',32),'hex'),'customer_data_request','completed',statement_timestamp(),statement_timestamp(),statement_timestamp()
      from generate_series(1,20000) g`);
    await client.query(`insert into privacy.deletion_manifests
      (id,deletion_run_id,workspace_id,install_generation,shop_identity_sha256,kind,result,completed_at)
      select md5('f08-manifest-'||g)::uuid,md5('f08-run-'||g)::uuid,md5('f08-workspace-'||((g-1)%2000+1))::uuid,
        1,decode(repeat('ab',32),'hex'),'customer_data_request','no_customer_data',statement_timestamp()
      from generate_series(1,20000) g`);
    for (const target of privacyIndexTargets) await client.query(`analyze privacy.${target.table}`);
    const queryPlan = async table => (await client.query(`explain (format json)
      select id from privacy.${table} where workspace_id=md5('f08-workspace-1000')::uuid`)).rows[0]["QUERY PLAN"][0].Plan;
    const before = await Promise.all(privacyIndexTargets.map(target => queryPlan(target.table)));
    for (const plan of before) assert.equal(plan["Node Type"], "Seq Scan");
    const securityMetadata = async () => (await client.query(`select c.relname, c.relowner::regrole::text as owner,
      c.relrowsecurity,c.relforcerowsecurity,c.relacl::text as acl,
      (select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid) as constraints,
      (select jsonb_agg(row_to_json(p) order by p.policyname) from pg_policies p where p.schemaname='privacy' and p.tablename=c.relname) as policies
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='privacy'
      and c.relname in ('deletion_runs','deletion_manifests') order by c.relname`)).rows;
    const securityBefore = await securityMetadata();
    // Strip only transaction delimiters to keep the actual migration body in the rollback-only fixture.
    await client.query(migrationSql.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, ""));
    await assertPrivacyIndexes(client);
    assert.deepEqual(await securityMetadata(), securityBefore, "owner/RLS/ACL/FK/policies must not change");
    const after = await Promise.all(privacyIndexTargets.map(target => queryPlan(target.table)));
    after.forEach((plan, index) => assertIndexPlan(plan, privacyIndexTargets[index].index));
    const counts = (await client.query(`select
      (select count(*)::int from privacy.deletion_runs) as runs,
      (select count(*)::int from privacy.deletion_manifests) as manifests`)).rows[0];
    assert.deepEqual(counts, {runs: 20000, manifests: 20000});
    console.log(`F08_INDEX_PLAN_PASS ${JSON.stringify({synthetic_only:true,workspaces:2000,
      rows_per_table:20000,before:before.map(p=>p["Node Type"]),after:after.map(p=>p["Node Type"]),
      matching_indexes:privacyIndexTargets.map(t=>t.index),forced_planner_flags:false,production_mutation:false})}`);
  } finally { await client.query("rollback"); }
  assert.deepEqual((await client.query(`select
    (select count(*)::int from privacy.deletion_runs) as runs,
    (select count(*)::int from privacy.deletion_manifests) as manifests`)).rows[0], {runs:0,manifests:0});
}
