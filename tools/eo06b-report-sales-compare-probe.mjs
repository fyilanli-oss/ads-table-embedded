import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {handleCompareRequest} from "../app/lib/reporting/compare-request.server.js";

// Run with the absolute URL of a PGlite module installed outside this repository.
const {PGlite} = await import(process.argv[2]);
const db = await PGlite.create();
const hasRefreshRunner = process.argv[3] !== "--without-refresh-runner";
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const shopA = {id: "gid://shopify/Shop/111", myshopifyDomain: "compare-a.myshopify.com"};
const shopB = {id: "gid://shopify/Shop/222", myshopifyDomain: "compare-b.myshopify.com"};
const product1 = "gid://shopify/Product/111";
const product2 = "gid://shopify/Product/222";
const call = "select * from analytics.read_report_sales_compare($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)";
const args = [a, 1, 1, "daily", "2026-10-01", "2026-10-07", "2026-09-24", "2026-09-30",
  "google_ads", "account-1", "campaign-1", "channel-1", product1];

async function compareFromFixture(shop, extraParams = {}) {
  const url = new URL("https://compare.example/api/reports/compare");
  url.search = new URLSearchParams({
    view: "daily", startDate: "2026-10-01", endDate: "2026-10-07", mode: "previous-period",
    platform: "google_ads", account: "account-1", campaign: "campaign-1", channel: "channel-1",
    product: product1, ...extraParams,
  });
  const authenticateAdmin = async () => ({
    sessionToken: {dest: `https://${shop.myshopifyDomain}`},
    admin: {graphql: async () => Response.json({data: {shop}})},
  });
  return handleCompareRequest(new Request(url, {headers: {authorization: "Bearer synthetic-compare-session"}}),
    {authenticateAdmin, database: db});
}

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
    grant usage on schema shopify to adstable_runtime;
    ${hasRefreshRunner ? "grant usage on schema analytics to adstable_refresh_dataset_runner;" : ""}
  `);
  for (const migration of [
    "20261006140517_eo02b_workspace_installation_authority.sql",
    "20261028185046_eo05a_shopify_installation_owner_read.sql",
  ]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  }
  await db.exec(`
    set role adstable_owner;
    ${hasRefreshRunner ? "alter default privileges in schema analytics grant execute on functions to adstable_refresh_dataset_runner;" : ""}
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
    insert into app.workspaces (id) values ('${a}'), ('${b}');
    insert into shopify.installations (id, workspace_id, shop_id, shop_domain) overriding system value values
      (1, '${a}', '${shopA.id}', '${shopA.myshopifyDomain}'),
      (2, '${b}', '${shopB.id}', '${shopB.myshopifyDomain}');
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
    alter table analytics.cpd_product_sales_facts add column provider_connection_id uuid,
      add column campaign_type text, add column target_currency text, add column fx_state text,
      add column fx_rate_id bigint, add column reporting_scope jsonb;
    update analytics.cpd_product_sales_facts set provider_connection_id = '${a}', campaign_type = 'SHOPPING',
      reporting_scope = '{"time_basis":"native_query_business_date","conversion_scope":"normal","units":"native_count_and_source_currency"}';
    create table app.workspace_settings (workspace_id uuid, installation_id bigint, installation_generation bigint, reporting_currency text);
    create table analytics.fx_rates (id bigint, source_currency text, target_currency text, fx_rate numeric);
    create table analytics.pd_facts (workspace_id uuid, installation_id bigint, installation_generation bigint,
      provider_connection_id uuid, platform text, platform_account_id text, business_date date, source_timezone text,
      root_entity_type text, root_entity_id text, root_entity_name text, entity_type text, entity_id text, entity_name text,
      source_batch_id bigint, retain_until timestamptz);
    create table analytics.cpd_product_performance_facts (workspace_id uuid, installation_id bigint, installation_generation bigint,
      provider_connection_id uuid, platform text, platform_account_id text, business_date date, source_timezone text,
      root_entity_type text, root_entity_id text, channel_type text, channel_id text, channel_resolution text,
      source_batch_id bigint, retain_until timestamptz, product_mapping_id bigint, reporting_scope jsonb);
    insert into analytics.pd_facts values ('${a}',1,1,'${a}','google_ads','account-1','2026-10-02','Europe/Istanbul',
      'campaign','campaign-1','Campaign','ad_group','channel-1','Verified channel',100,'2099-01-01');
    insert into analytics.cpd_product_performance_facts values ('${a}',1,1,'${a}','google_ads','account-1','2026-10-02','Europe/Istanbul',
      'campaign','campaign-1','ad_group','channel-1','verified',100,'2099-01-01',20,'{"time_basis":"native_query_business_date"}');
    reset role;
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/20261125093522_eo06b_report_sales_compare.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/20261126083358_eo06bc_v1_report_read.sql", import.meta.url), "utf8"));
  await db.exec("set role adstable_runtime");
  const {rows} = await db.query(call, args);
  assert.deepEqual(rows.map(row => [row.period, row.day_offset, row.advertised_product_id, row.sold_product_id,
    row.sales_quantity, row.sales_value, row.source_completeness, row.value_observation]), [
    ["comparison", 1, product2, product1, "0", "0", "complete", "present"],
    ["primary", 1, product1, product2, "2", "36.75", "complete", "present"],
    ["primary", 2, product1, product1, "1", null, "partial", "missing"],
  ]);

  const responseA = await compareFromFixture(shopA);
  assert.equal(responseA.status, 200);
  assert.equal(responseA.headers.get("cache-control"), "no-store");
  const payloadA = await responseA.json();
  assert.deepEqual([payloadA.version, payloadA.mode, payloadA.dayCount,
    payloadA.primary.startDate, payloadA.primary.endDate, payloadA.comparison.startDate, payloadA.comparison.endDate],
  ["compare-v1", "previous-period", 7, "2026-10-01", "2026-10-07", "2026-09-24", "2026-09-30"]);
  const sales = ({date, dayOffset, advertisedProductId, soldProductId, salesQuantity,
    salesValue, sourceCompleteness, valueObservation}) =>
    [date, dayOffset, advertisedProductId, soldProductId, salesQuantity, salesValue, sourceCompleteness, valueObservation];
  assert.deepEqual(payloadA.primary.rows.map(sales), [
    ["2026-10-02", 1, product1, product2, "2", "36.75", "complete", "present"],
    ["2026-10-03", 2, product1, product1, "1", null, "partial", "missing"],
  ]);
  assert.deepEqual(payloadA.comparison.rows.map(sales), [
    ["2026-09-25", 1, product2, product1, "0", "0", "complete", "present"],
  ]);

  // Same filters and Shopify Product ID, but the installed shop supplies a distinct scope.
  const responseB = await compareFromFixture(shopB);
  assert.equal(responseB.status, 200);
  const payloadB = await responseB.json();
  assert.deepEqual(payloadB.primary.rows.map(sales), [
    ["2026-10-02", 1, product1, product1, "1", "99", "complete", "present"],
  ]);
  assert.deepEqual(payloadB.comparison.rows, []);
  const suppliedScope = await compareFromFixture(shopA, {workspaceId: b});
  assert.equal(suppliedScope.status, 400);
  assert.deepEqual(await suppliedScope.json(), {code: "COMPARE_REQUEST_INVALID"});

  const reportArgs = {grain: "channel", bucket: "daily"};
  const reportA = await compareFromFixture(shopA, reportArgs);
  const reportDataA = await reportA.json();
  assert.equal(reportA.status, 200, JSON.stringify(reportDataA));
  assert.equal(reportDataA.primary.groups[0].channelName, "Verified channel");
  assert.deepEqual(reportDataA.primary.channelLinks.map(link => [link.category, link.advertisedProductId, link.soldProductId]),
    [["Same Channel", product1, product2]]);
  assert.equal(reportDataA.primary.scopes[0].sales.value, "36.75");
  const reportB = await compareFromFixture(shopB, reportArgs);
  const reportDataB = await reportB.json();
  assert.equal(reportB.status, 200, JSON.stringify(reportDataB));
  assert.equal(reportDataB.primary.scopes[0].sales.value, "99");
  assert.equal(reportDataB.primary.groups[0].channelName, null);
  assert.deepEqual(reportDataB.primary.channelLinks, []);
  const v1Call = "select * from analytics.read_v1_report_sales($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)";
  const v1Args = Object.assign([...args], {8: ["google_ads"], 12: [product1, product2]});
  assert.equal((await db.query(v1Call, v1Args)).rows.length, 4);
  await assert.rejects(db.query(v1Call, Object.assign([...v1Args], {1: 2})), /REPORT_COMPARE_SCOPE_UNAVAILABLE/);

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
    await assert.rejects(db.query(v1Call, v1Args), /permission denied/);
  }
  await db.exec(`reset role; insert into privacy.deletion_runs values ('${a}', 1, 'pending'); set role adstable_runtime`);
  await assert.rejects(db.query(call, args), /REPORT_COMPARE_SCOPE_UNAVAILABLE/);
  await assert.rejects(db.query(v1Call, v1Args), /REPORT_COMPARE_SCOPE_UNAVAILABLE/);
  const version = (await db.query("show server_version")).rows[0].server_version;
  console.log(`Compare API and SQL probe passed on PostgreSQL ${version} (${hasRefreshRunner ? "with" : "without"} refresh runner): two shops, equal periods, filters, absent days, real zero, partial values, and role isolation.`);
} finally {
  await db.close();
}
