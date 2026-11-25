import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

// Run with the absolute URL of a PGlite module installed outside this repository.
const {PGlite} = await import(process.argv[2]);
const db = await PGlite.create();
const hasRefreshRunner = process.argv[3] !== "--without-refresh-runner";
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const product1 = "gid://shopify/Product/111";
const product2 = "gid://shopify/Product/222";
const call = "select * from analytics.read_report_sales_compare($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)";
const args = [a, 1, 1, "daily", "2026-10-01", "2026-10-07", "2026-09-24", "2026-09-30",
  "google_ads", "account-1", "campaign-1", "channel-1", product1];

try {
  await db.exec(`
    create role adstable_owner;
    create role adstable_runtime;
    create role adstable_refresh_coordinator;
    ${hasRefreshRunner ? "create role adstable_refresh_dataset_runner;" : ""}
    create role anon;
    create role authenticated;
    create role service_role;
    create schema app authorization adstable_owner;
    create schema shopify authorization adstable_owner;
    create schema privacy authorization adstable_owner;
    create schema evidence authorization adstable_owner;
    create schema analytics authorization adstable_owner;
    create schema identity authorization adstable_owner;
    grant usage on schema analytics to adstable_runtime, anon;
    ${hasRefreshRunner ? "grant usage on schema analytics to adstable_refresh_dataset_runner;" : ""}
    set role adstable_owner;
    ${hasRefreshRunner ? "alter default privileges in schema analytics grant execute on functions to adstable_refresh_dataset_runner;" : ""}
    create table app.workspaces (id uuid, status text);
    create table shopify.installations (workspace_id uuid, id bigint, install_generation bigint, status text);
    create table privacy.deletion_runs (workspace_id uuid, install_generation bigint, status text);
    create table evidence.source_batches (workspace_id uuid, installation_id bigint,
      installation_generation bigint, id bigint, storage_state text, handoff_state text,
      retain_until timestamptz, manifest jsonb);
    create table identity.product_identity_mappings (workspace_id uuid, installation_id bigint,
      installation_generation bigint, id bigint, shopify_product_id text, mapping_state text, retain_until timestamptz);
    create table analytics.cpd_product_sales_facts (id bigint, workspace_id uuid, installation_id bigint,
      installation_generation bigint, business_date date, source_timezone text, platform text,
      platform_account_id text, root_entity_type text, root_entity_id text, root_entity_name text,
      channel_type text, channel_id text, channel_resolution text, advertised_product_mapping_id bigint,
      sold_product_mapping_id bigint, sales_role text, sales_quantity numeric, sales_value numeric,
      source_currency text, source_completeness text, metric_support jsonb, observation_state jsonb,
      source_batch_id bigint, retain_until timestamptz);
    alter table analytics.cpd_product_sales_facts enable row level security;
    alter table analytics.cpd_product_sales_facts force row level security;
    create policy owner_only on analytics.cpd_product_sales_facts to adstable_owner using (true);
    insert into app.workspaces values ('${a}', 'active'), ('${b}', 'active');
    insert into shopify.installations values ('${a}', 1, 1, 'active'), ('${b}', 2, 1, 'active');
    insert into evidence.source_batches values
      ('${a}', 1, 1, 100, 'committed', 'consumed', '2099-01-01', '{}'),
      ('${a}', 1, 1, 101, 'committed', 'pending', '2099-01-01', '{}'),
      ('${a}', 1, 1, 102, 'committed', 'consumed', '2099-01-01', '{"privacyRedacted":true}'),
      ('${b}', 2, 1, 100, 'committed', 'consumed', '2099-01-01', '{}');
    insert into identity.product_identity_mappings values
      ('${a}', 1, 1, 10, '${product1}', 'verified', '2099-01-01'),
      ('${a}', 1, 1, 20, '${product2}', 'verified', '2099-01-01'),
      ('${b}', 2, 1, 10, '${product1}', 'verified', '2099-01-01');
    insert into analytics.cpd_product_sales_facts
    select id, workspace::uuid, installation, 1, day::date, 'Europe/Istanbul', 'google_ads',
      account, 'campaign', campaign, 'Campaign', 'ad_group', channel, 'verified',
      advertised, sold, case when advertised = sold then 'Advertised' else 'Cross-sell' end,
      quantity, amount, 'TRY', completeness,
      '{"sales_quantity":"supported","sales_value":"supported"}',
      jsonb_build_object('sales_quantity', 'present', 'sales_value', case when amount is null then 'missing' else 'present' end),
      batch, '2099-01-01'
    from (values
      (1, '${a}', 1, '2026-10-02', 'account-1','campaign-1','channel-1',10,20,2,36.75,'complete',100),
      (2, '${a}', 1, '2026-09-25', 'account-1','campaign-1','channel-1',20,10,0,0,'complete',100),
      (3, '${a}', 1, '2026-10-03', 'account-1','campaign-1','channel-1',10,10,1,null,'partial',100),
      (4, '${a}', 1, '2026-10-02', 'account-2','campaign-1','channel-1',10,20,1,99,'complete',100),
      (5, '${a}', 1, '2026-09-25', 'account-1','campaign-2','channel-1',10,20,1,99,'complete',100),
      (6, '${a}', 1, '2026-09-25', 'account-1','campaign-1','channel-2',10,20,1,99,'complete',100),
      (7, '${a}', 1, '2026-10-02', 'account-1','campaign-1','channel-1',20,20,1,99,'complete',100),
      (8, '${a}', 1, '2026-10-02', 'account-1','campaign-1','channel-1',10,20,1,99,'complete',101),
      (9, '${a}', 1, '2026-10-02', 'account-1','campaign-1','channel-1',10,20,1,99,'complete',102),
      (10,'${b}', 2, '2026-10-02', 'account-1','campaign-1','channel-1',10,10,1,99,'complete',100)
    ) v(id, workspace, installation, day, account, campaign, channel, advertised, sold, quantity, amount, completeness, batch);
    reset role;
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/20261125093522_eo06b_report_sales_compare.sql", import.meta.url), "utf8"));
  await db.exec("set role adstable_runtime");
  const {rows} = await db.query(call, args);
  assert.deepEqual(rows.map(row => [row.period, row.day_offset, row.advertised_product_id, row.sold_product_id,
    row.sales_quantity, row.sales_value, row.source_completeness, row.value_observation]), [
    ["comparison", 1, product2, product1, "0", "0", "complete", "present"],
    ["primary", 1, product1, product2, "2", "36.75", "complete", "present"],
    ["primary", 2, product1, product1, "1", null, "partial", "missing"],
  ]);

  const withChanges = (changes) => Object.assign([...args], changes);
  assert.equal((await db.query(call, withChanges({6: null, 7: null}))).rows.length, 2);
  const overlapping = await db.query(call, withChanges({6: "2026-10-01", 7: "2026-10-07"}));
  assert.deepEqual(overlapping.rows.map(row => [row.period, row.day_offset]), [
    ["comparison", 1], ["comparison", 2], ["primary", 1], ["primary", 2],
  ]);
  assert.equal((await db.query(call, withChanges({8: "meta"}))).rows.length, 0);
  await assert.rejects(db.query(call, withChanges({1: 2})), /REPORT_COMPARE_SCOPE_UNAVAILABLE/);
  await assert.rejects(db.query(call, withChanges({2: 2})), /REPORT_COMPARE_SCOPE_UNAVAILABLE/);
  await assert.rejects(db.query(call, withChanges({7: "2026-09-29"})), /REPORT_COMPARE_RANGE_INVALID/);
  await assert.rejects(db.query(call, withChanges({5: "2026-11-01", 6: null, 7: null})), /REPORT_COMPARE_RANGE_INVALID/);
  await assert.rejects(db.query(call, withChanges({9: null})), /REPORT_COMPARE_FILTER_INVALID/);
  await assert.rejects(db.query("select * from analytics.cpd_product_sales_facts"), /permission denied/);

  const deniedRoles = ["anon", "authenticated", "service_role", "adstable_refresh_coordinator"];
  if (hasRefreshRunner) deniedRoles.push("adstable_refresh_dataset_runner");
  for (const role of deniedRoles) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(db.query(call, args), /permission denied/);
  }
  await db.exec(`reset role; insert into privacy.deletion_runs values ('${a}', 1, 'pending'); set role adstable_runtime`);
  await assert.rejects(db.query(call, args), /REPORT_COMPARE_SCOPE_UNAVAILABLE/);
  const version = (await db.query("show server_version")).rows[0].server_version;
  console.log(`Compare SQL probe passed on PostgreSQL ${version} (${hasRefreshRunner ? "with" : "without"} refresh runner): equal periods, filters, metric states, shop and role isolation.`);
} finally {
  await db.close();
}
