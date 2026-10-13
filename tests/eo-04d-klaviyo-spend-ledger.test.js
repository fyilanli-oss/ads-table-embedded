import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createKlaviyoSpendRepository} from "../app/lib/database/klaviyo-spend-repository.server.js";
import {normalizeKlaviyoEstimatedSpend} from "../app/lib/oauth/klaviyo-oauth-runtime.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const originalMigration = "supabase/migrations/20261013170000_eo04d_klaviyo_spend_ledger.sql";
const sameDayMigration = "supabase/migrations/20261013223000_eo04d_klaviyo_same_day_spend_updates.sql";

test("Klaviyo spend accepts explicit zero and exact bounded decimals only", () => {
  assert.equal(normalizeKlaviyoEstimatedSpend("0"), "0.00");
  assert.equal(normalizeKlaviyoEstimatedSpend("24.99"), "24.99");
  assert.equal(normalizeKlaviyoEstimatedSpend("99999999.99"), "99999999.99");
  for (const invalid of [
    "", "-1", "+1", "01", ".5", "1.", "1.001", "1,00", "1e2",
    "999999999", "NaN", "Infinity", " 1",
  ]) {
    assert.throws(
      () => normalizeKlaviyoEstimatedSpend(invalid),
      /KLAVIYO_ESTIMATED_SPEND_INVALID/,
    );
  }
});

test("private spend ledger is forced-RLS and runtime function-only", () => {
  const sql = read(originalMigration);
  const correctiveSql = read(sameDayMigration);
  assert.match(sql, /create table integrations\.klaviyo_email_spend_periods/);
  assert.match(sql, /numeric\(10, 2\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /from public, anon, authenticated, service_role, adstable_runtime/);
  assert.match(sql, /grant execute on function integrations\.complete_klaviyo_setup_with_spend/);
  assert.match(sql, /grant execute on function integrations\.append_klaviyo_spend_period/);
  assert.match(sql, /grant execute on function integrations\.correct_klaviyo_spend_period/);
  assert.match(sql, /grant execute on function integrations\.load_klaviyo_spend_configuration/);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete).*adstable_runtime/i);
  assert.doesNotMatch(sql, /grant .*service_role/i);
  assert.match(
    correctiveSql,
    /revoke all on function integrations\.correct_klaviyo_spend_period\(\s*uuid, uuid, bigint, uuid, bigint, numeric/,
  );
  assert.match(
    correctiveSql,
    /grant execute on function integrations\.correct_klaviyo_spend_period\(\s*uuid, uuid, bigint, uuid, bigint, numeric\s*\) to adstable_runtime/,
  );
});

test("Save and connect is one database function with provider-owned account fields", async () => {
  const calls = [];
  const repository = createKlaviyoSpendRepository({
    query: async (sql, values) => {
      calls.push({sql, values});
      return {rows: [{
        connection_id: "00000000-0000-4000-8000-000000000001",
        lifecycle_status: "connected",
        connection_version: 2,
        spend_period_id: "00000000-0000-4000-8000-000000000002",
        effective_from: "2026-10-13",
        correction_version: 1,
      }]};
    },
  });
  const result = await repository.complete({
    connectionId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000003",
    installGeneration: 1,
    expectedVersion: 1,
    account: {
      id: "account-1",
      name: "AdsTable Demo",
      status: "active",
      currency: "USD",
      timezone: "Europe/Istanbul",
    },
    amount: "24.99",
    verifiedAt: "2026-10-13T10:00:00.000Z",
  });
  assert.match(calls[0].sql, /complete_klaviyo_setup_with_spend/);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].values[4]), {
    id: "account-1",
    name: "AdsTable Demo",
    kind: "account",
    reporting_eligible: true,
    status: "active",
    currency: "USD",
    timezone: "Europe/Istanbul",
  });
  assert.equal(result.spendPeriod.amount, "24.99");
  assert.equal(result.spendPeriod.currency, "USD");
});

test("same-day Update spend entries remain separate and Change value targets an immutable id", () => {
  const sql = read(sameDayMigration);
  assert.match(sql, /drop constraint if exists klaviyo_email_spend_periods_effective_start_unique/);
  assert.doesNotMatch(sql, /raise exception 'DUPLICATE_EFFECTIVE_START'/);
  assert.match(sql, /create or replace function integrations\.append_klaviyo_spend_period/);
  assert.match(sql, /create or replace function integrations\.correct_klaviyo_spend_period/);
  assert.match(sql, /p_spend_period_id uuid/);
  assert.match(sql, /where period\.id = p_spend_period_id/);
  assert.match(sql, /order by period\.effective_from desc, period\.created_at desc, period\.id desc/);
  assert.match(sql, /set estimated_30_day_email_spend = p_estimated_spend,/);
  assert.match(sql, /correction_version = period\.correction_version \+ 1/);
  const correction = sql.slice(sql.indexOf("create or replace function integrations.correct_klaviyo_spend_period"));
  assert.doesNotMatch(correction, /set effective_from =/);
  assert.doesNotMatch(correction, /set source_currency =/);
  assert.doesNotMatch(correction, /set account_id =/);
});

test("repository corrects the exact selected spend event instead of a shared date", async () => {
  const calls = [];
  const repository = createKlaviyoSpendRepository({
    query: async (sql, values) => {
      calls.push({sql, values});
      return {rows: [{
        spend_period_id: "00000000-0000-4000-8000-000000000010",
        effective_from: "2026-10-13",
        correction_version: 2,
        amount: "32.00",
        currency: "USD",
      }]};
    },
  });
  await repository.correct({
    connectionId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000003",
    installGeneration: 1,
    periodId: "00000000-0000-4000-8000-000000000010",
    expectedCorrectionVersion: 1,
    amount: "32.00",
  });
  assert.match(calls[0].sql, /\$4::uuid/);
  assert.equal(calls[0].values[3], "00000000-0000-4000-8000-000000000010");
});

test("Settings uses accepted Shopify components and keeps Resume separate from OAuth", () => {
  const route = read("app/routes/_admin.settings.tsx");
  const klaviyo = route.slice(route.indexOf('<s-section heading="Klaviyo">'));
  assert.match(klaviyo, /commandFor="klaviyo-connect-modal"/);
  assert.match(klaviyo, /id="klaviyo-setup-modal"/);
  assert.match(klaviyo, /ref=\{klaviyoSetupModal\}/);
  assert.match(klaviyo, /<s-choice-list/);
  assert.match(klaviyo, /Select Klaviyo account/);
  assert.match(klaviyo, /Continue/);
  assert.match(klaviyo, /<s-number-field/);
  assert.match(klaviyo, /Save and connect/);
  assert.match(klaviyo, /Update spend/);
  assert.match(klaviyo, /Change value/);
  assert.match(klaviyo, /heading="Update Klaviyo email spend"/);
  assert.match(klaviyo, /Save new value/);
  assert.match(klaviyo, /heading="Change Klaviyo email spend"/);
  assert.match(klaviyo, /label="Saved period"/);
  assert.match(klaviyo, /Updated 30-Day Klaviyo Email Spend/);
  assert.match(klaviyo, /Save change/);
  assert.match(klaviyo, /value=\{period\.id\}/);
  assert.match(klaviyo, /Superseded same day/);
  assert.doesNotMatch(
    klaviyo,
    /Spend history — choose Change value beside the period/,
  );
  assert.doesNotMatch(klaviyo, /<input|<button|<style|style=/i);
  assert.match(klaviyo, /onClick=\{resumeKlaviyoSetup\}/);
  assert.match(route, /setKlaviyoSetupStep\("account"\)/);
  assert.match(route, /form\.set\("accountId", selectedKlaviyoAccountId\)/);
  assert.match(
    klaviyo,
    /commandFor="klaviyo-change-value-modal"[\s\S]*onClick=\{prepareKlaviyoCorrection\}/,
  );
  assert.doesNotMatch(klaviyo, /Reporting Account|Ad Account/);
});

test("disconnect revokes before local lifecycle authority is removed", () => {
  const runtime = read("app/lib/oauth/klaviyo-oauth-runtime.server.js");
  const method = runtime.slice(runtime.indexOf("async disconnect"));
  assert.ok(method.indexOf("revokeKlaviyoAuthorization") < method.indexOf("requestDisconnect"));
  assert.ok(method.indexOf("requestDisconnect") < method.indexOf("finalizeDisconnect"));
  assert.doesNotMatch(method, /klaviyo_email_spend_periods/);
});

test("Klaviyo spend slice does not invent reporting facts or Channel behavior", () => {
  const files = [
    "app/lib/oauth/klaviyo-oauth-runtime.server.js",
    "app/lib/database/klaviyo-spend-repository.server.js",
    "supabase/migrations/20261013170000_eo04d_klaviyo_spend_ledger.sql",
  ].map(read).join("\n");
  assert.doesNotMatch(files, /channel_hierarchy|dataset_v2|reporting_fact|allocated_spend/i);
});
