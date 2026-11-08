import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {datasetSourceBindingFixture} from "./fixtures/dataset-source-binding-fixture.js";
import {DATASET_FX_PROVIDER, DATASET_FX_SCHEMA, datasetFxPublicationDate, datasetFxUrl} from "../app/lib/database/dataset-fx-policy.server.js";
import {createDatasetFxResolver} from "../app/lib/database/dataset-fx-resolver.server.js";
import {createReportingCurrencyRepository, prepareReportingCurrencySelection, reportingCurrencyInstallation} from "../app/lib/database/reporting-currency.server.js";
import {bindStoredDatasetSources} from "../app/lib/database/dataset-source-binding.server.js";
import {readStoredDatasetSources} from "../app/lib/database/dataset-source-reader.server.js";
import {projectStoredGoogleDataset} from "../app/lib/providers/stored-dataset-projection.server.js";
import {prepareDatasetWrite} from "../app/lib/database/dataset-storage.server.js";

async function fixture(provider = "google_ads", target = "TRY") {
  const f = await datasetSourceBindingFixture(provider), rates = new Map(), calls = [];
  let configuration = target ? {version: "reporting-currency-v1", workspaceId: f.owner.workspaceId, installationId: f.owner.installationId,
    generation: f.owner.generation, currency: target, currencyVersion: "1", selectionOperationId: randomUUID(), source: "merchant_selected"} : null;
  const input = {date: "2026-10-30", base: "USD", quote: target, rate: "1.234567890123456789"};
  const hooks = {};
  f.hooks.query = async (sql, args) => {
    if (sql.includes("app.read_reporting_currency")) return {rows: [{result: structuredClone(configuration)}]};
    if (sql.includes("app.select_reporting_currency")) {
      if (configuration) throw Error("synthetic already configured");
      const o = JSON.parse(args[0]); configuration = {version: "reporting-currency-v1", workspaceId: o.workspaceId, installationId: o.installationId,
        generation: o.generation, currency: args[1], currencyVersion: "1", selectionOperationId: args[2], source: "merchant_selected"};
      if (hooks.lostSelection) throw Error("synthetic lost reply"); return {rows: [{result: structuredClone(configuration)}]};
    }
    if (sql.includes("lookup_dataset_fx")) return {rows: [{result: structuredClone(rates.get(args.join(":")) ?? null)}]};
    if (sql.includes("record_dataset_fx")) {
      const body = JSON.parse(args[0]), row = {...body, id: "777"}; rates.set([row.source_currency, row.target_currency, row.fx_rate_date].join(":"), row);
      if (hooks.lostFx) throw Error("synthetic lost reply"); return {rows: [{result: structuredClone(row)}]};
    }
  };
  const fetchImpl = async (url, options) => {
    calls.push({url, options}); if (hooks.fetch) return hooks.fetch(url, options);
    return new Response(JSON.stringify({...input, ...hooks.body}).replace('"1.234567890123456789"', "1.234567890123456789"), {headers: {"content-type": "application/json"}});
  };
  return {...f, rates, calls, fxHooks: hooks, resolver: () => createDatasetFxResolver({database: f.database, fetchImpl})};
}

test("the accepted weekend rule maps only Saturday/Sunday to Friday and never guesses a weekday quote", () => {
  for (const [day, expected] of [["2026-11-06", "2026-11-06"], ["2026-11-07", "2026-11-06"], ["2026-11-08", "2026-11-06"], ["2026-11-09", "2026-11-09"], ["2024-03-31", "2024-03-29"]])
    assert.equal(datasetFxPublicationDate(day), expected);
  for (const day of [null, "2026-02-30", "2026-1-1", "infinity"]) assert.throws(() => datasetFxPublicationDate(day));
  assert.throws(() => datasetFxUrl("USD", "USD", "2026-11-06"));
});

for (const provider of ["google_ads", "meta", "klaviyo"]) test(provider + ": physical source + merchant currency + exact Friday rate bind without changing native amounts", async () => {
  const f = await fixture(provider), result = await bindStoredDatasetSources({...f, fxResolver: f.resolver()});
  assert.equal(result.consumerReceipt, false); assert.equal(result.publishable, false); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://api.frankfurter.dev/v2/providers/ECB/rate/USD/TRY?date=2026-10-30");
  assert.equal(f.calls[0].options.redirect, "manual");
  const rate = [...f.rates.values()][0]; assert.equal(rate.fx_rate, "1.234567890123456789"); assert.equal(rate.fx_provider, DATASET_FX_PROVIDER); assert.equal(rate.fx_schema_version, DATASET_FX_SCHEMA);
  for (const {row} of f.writes[0].rows) {
    assert.equal(row.fx_state, "verified"); assert.equal(row.fx_rate_id, "777"); assert.equal(row.target_currency, "TRY");
    assert.equal(row.provenance.fx_policy.businessDate, "2026-11-01"); assert.equal(row.provenance.fx_policy.rateDate, "2026-10-30");
    assert.equal(row.provenance.reporting_currency.source, "merchant_selected");
  }
  assert.equal(f.writes[0].rows[0].row.spend_value, provider === "google_ads" ? "1.234567" : provider === "meta" ? "1.234567890123456789" : null);
});

test("reporting currency and FX proof do not change native identity or duplicate the native observation", async () => {
  const f = await fixture(), source = await readStoredDatasetSources(f), projection = projectStoredGoogleDataset(source);
  const original = prepareDatasetWrite({owner: f.owner, rows: projection.rows, policy: f.policy, now: new Date().toISOString()});
  await bindStoredDatasetSources({...f, fxResolver: f.resolver()});
  assert.deepEqual(f.writes[0].rows.map(x => x.row.native_key_hash), original.body.rows.map(x => x.row.native_key_hash));
});

test("same currency needs no remote rate or fabricated FX table row", async () => {
  const f = await fixture("google_ads", "USD"); await bindStoredDatasetSources({...f, fxResolver: f.resolver()});
  assert.equal(f.calls.length, 0); assert.equal(f.rates.size, 0);
  assert.ok(f.writes[0].rows.every(({row}) => row.fx_state === "identity" && row.fx_rate_id === null && row.target_currency === "USD"));
});

test("a retained immutable cached rate is reused with no new HTTP request", async () => {
  const f = await fixture(); await bindStoredDatasetSources({...f, fxResolver: f.resolver()});
  f.calls.length = 0; await bindStoredDatasetSources({...f, fxResolver: f.resolver()}); assert.equal(f.calls.length, 0); assert.equal(f.rates.size, 1);
});

test("missing merchant choice holds conversion instead of guessing Shopify/account/default TRY", async () => {
  const f = await fixture("google_ads", null), r = await bindStoredDatasetSources({...f, fxResolver: f.resolver()});
  assert.equal(r.status, "partially_stored"); assert.ok(r.holds.some(h => h.reason === "reporting_currency_required")); assert.equal(f.calls.length, 0);
  assert.ok(f.writes[0].rows.every(({row}) => row.fx_state === "missing" && row.target_currency === null));
});

for (const [name, body] of [["future", {date: "2026-11-02"}], ["holiday/older Friday", {date: "2026-10-29"}], ["wrong pair", {base: "EUR"}], ["zero", {rate: 0}], ["string-shaped native number", {rate: "2"}], ["extra native field", {token: "synthetic-private"}]])
  test(name + " response stops the fixed reader before facts and never retries", async () => {
    const f = await fixture(); f.fxHooks.body = body;
    await assert.rejects(bindStoredDatasetSources({...f, fxResolver: f.resolver()}), /PROVIDER_UNCONFIRMED/); assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 0);
  });

for (const mode of ["HTTP", "redirect", "oversize"]) test(mode + " stops before FX/fact writes", async () => {
  const f = await fixture(); f.fxHooks.fetch = async () => mode === "HTTP" ? new Response("synthetic", {status: 403})
    : mode === "redirect" ? new Response(null, {status: 302, headers: {location: "https://other.invalid"}})
      : new Response(" ".repeat(16385), {headers: {"content-type": "application/json"}});
  await assert.rejects(bindStoredDatasetSources({...f, fxResolver: f.resolver()}), /PROVIDER_UNCONFIRMED/); assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 0); assert.equal(f.rates.size, 0);
});

test("an ignored transport abort still stops at the deadline without a later fact write", async () => {
  const f = await fixture(); f.fxHooks.fetch = () => new Promise(() => {}); f.limits.deadlineAt = Date.now() + 1000;
  await assert.rejects(bindStoredDatasetSources({...f, fxResolver: f.resolver()}), /PROVIDER_UNCONFIRMED|STOPPED/); assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 1);
});

test("lost FX acknowledgement does not inspect or retry the write", async () => {
  const f = await fixture(); f.fxHooks.lostFx = true;
  await assert.rejects(bindStoredDatasetSources({...f, fxResolver: f.resolver()}), /WRITE_UNCONFIRMED/);
  assert.equal(f.queries.filter(q => q.includes("lookup_dataset_fx")).length, 1); assert.equal(f.queries.filter(q => q.includes("record_dataset_fx")).length, 1); assert.equal(f.writes.length, 0);
});

test("resolver is bound to its real database and cannot be cloned or reused", async () => {
  const f = await fixture(), resolver = f.resolver();
  await assert.rejects(bindStoredDatasetSources({...f, fxResolver: structuredClone(resolver)}), /CAPABILITY_REQUIRED/);
  await bindStoredDatasetSources({...f, fxResolver: resolver}); await assert.rejects(bindStoredDatasetSources({...f, fxResolver: resolver}), /CAPABILITY_REQUIRED/);
});

test("explicit reporting-currency selection is owner-bound, read back and locked", async () => {
  const f = await fixture("google_ads", null), repository = createReportingCurrencyRepository(f.database), installation = reportingCurrencyInstallation(f.owner);
  const selection = prepareReportingCurrencySelection({installation, currency: "TRY"}), result = await repository.select(selection);
  assert.equal(result.currency, "TRY"); assert.equal(result.currencyVersion, "1");
  await assert.rejects(repository.select(selection), /CAPABILITY_REQUIRED/);
  await assert.rejects(repository.select(prepareReportingCurrencySelection({installation, currency: "USD"})), /WRITE_UNCONFIRMED/);
  assert.throws(() => prepareReportingCurrencySelection({installation, currency: "BTC"}), /UNSUPPORTED/);
});

test("lost currency selection acknowledgement cannot trigger readback", async () => {
  const f = await fixture("google_ads", null); f.fxHooks.lostSelection = true;
  await assert.rejects(createReportingCurrencyRepository(f.database).select(prepareReportingCurrencySelection({installation: reportingCurrencyInstallation(f.owner), currency: "TRY"})), /WRITE_UNCONFIRMED/);
  assert.equal(f.queries.filter(q => q.includes("app.read_reporting_currency")).length, 0);
});
