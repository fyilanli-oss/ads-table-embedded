import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {storedBindingFixture} from "./eo05b-source-dataset-binding-probe.mjs";
import {createDatasetFxResolver} from "../app/lib/database/dataset-fx-resolver.server.js";
import {bindStoredDatasetSources} from "../app/lib/database/dataset-source-binding.server.js";
import {prepareReportingCurrencySelection, reportingCurrencyInstallation, createReportingCurrencyRepository} from "../app/lib/database/reporting-currency.server.js";
import {datasetFxPublicationDate} from "../app/lib/database/dataset-fx-policy.server.js";
import {prepareDatasetWrite, prepareDatasetFx, createDatasetStorageRepository} from "../app/lib/database/dataset-storage.server.js";
import {sourcePayloadHash} from "../app/lib/database/source-evidence-store.server.js";
import {readStoredDatasetSources} from "../app/lib/database/dataset-source-reader.server.js";
import {projectStoredGoogleDataset} from "../app/lib/providers/stored-dataset-projection.server.js";

async function rejected(client, action, pattern) {
  await client.query("savepoint fx_expected_failure"); let error;
  try {await action();} catch (caught) {error = caught;}
  await client.query("rollback to savepoint fx_expected_failure"); await client.query("release savepoint fx_expected_failure");
  assert.ok(error); if (pattern) assert.match(error.message, pattern);
}

/** Inside the existing F01 localhost rollback transaction. Actual SQL/AEAD,
 * synthetic owners/rate HTTP only. No actual merchant/provider/live call. */
export async function fxReportingCurrencyProbe(client, {ownerFixture}) {
  await client.query("savepoint fx_reporting_fixture");
  try {
    const raw = client;
    client = {async query(sql, args) {try {return await raw.query(sql, args);} catch (e) {
      console.error("EO05B_FX_SQL_DIAGNOSTIC", JSON.stringify({code: e.code, message: e.message, where: e.where})); throw e;
    }}};
    for (const day of ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2024-03-31"])
      assert.equal((await client.query("select analytics.dataset_fx_publication_date($1::date)::text result", [day])).rows[0].result, datasetFxPublicationDate(day));
    let requests = 0;
    const fetchImpl = async (url, options) => {
      requests++; assert.equal(url, "https://api.frankfurter.dev/v2/providers/ECB/rate/USD/TRY?date=2026-10-30"); assert.equal(options.redirect, "manual");
      return new Response('{"date":"2026-10-30","base":"USD","quote":"TRY","rate":1.234567890123456789}', {headers: {"content-type": "application/json"}});
    };
    const owners = [];
    for (const provider of ["google_ads", "meta", "klaviyo"]) {
      const owner = await ownerFixture(client, provider), input = await storedBindingFixture(client, owner), installation = reportingCurrencyInstallation(owner);
      const settings = createReportingCurrencyRepository(client); assert.equal(await settings.read(installation), null);
      const selected = prepareReportingCurrencySelection({installation, currency: "TRY"}), proof = await settings.select(selected);
      assert.equal(proof.source, "merchant_selected"); assert.equal(proof.currencyVersion, "1");
      await rejected(client, () => settings.select(prepareReportingCurrencySelection({installation, currency: "USD"})), /WRITE_UNCONFIRMED/);
      await rejected(client, () => client.query("update app.workspace_settings set reporting_currency='USD' where installation_id=$1", [owner.installationId]), /REPROCESSING_DECISION/);
      await rejected(client, () => settings.read({...installation, generation: String(BigInt(owner.generation) + 1n)}), /READ_UNCONFIRMED/);
      const result = await bindStoredDatasetSources({...input, fxResolver: createDatasetFxResolver({database: client, fetchImpl})});
      assert.equal(result.consumerReceipt, false); assert.equal(result.publishable, false);
      const fact = (await client.query("select business_date::text,source_currency,target_currency,spend_value::text,fx_state,fx_rate_id::text,provenance from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows[0];
      assert.equal(fact.business_date, "2026-11-01"); assert.equal(fact.source_currency, "USD"); assert.equal(fact.target_currency, "TRY"); assert.equal(fact.fx_state, "verified");
      assert.equal(fact.provenance.fx_policy.rateDate, "2026-10-30"); assert.equal(fact.provenance.reporting_currency.selectionOperationId, proof.selectionOperationId);
      if (provider === "google_ads") {
        assert.equal(fact.spend_value, "1.234567");
        const projection = structuredClone(projectStoredGoogleDataset(await readStoredDatasetSources(input)));
        const row = projection.rows[0].row;
        row.entity_id = "wrong-currency-proof"; row.source_identity.native.entity_id = row.entity_id;
        Object.assign(row, {target_currency: "TRY", fx_state: "verified", fx_rate_id: fact.fx_rate_id, fx_engine_version: "frankfurter-ecb-weekend-v1"});
        row.provenance.reporting_currency = {...proof, selectionOperationId: randomUUID()};
        row.provenance.fx_policy = {version: "frankfurter-ecb-weekend-v1", businessDate: "2026-11-01", rateDate: "2026-10-30"};
        const write = prepareDatasetWrite({owner, rows: [projection.rows[0]], policy: input.policy, now: new Date().toISOString()});
        await rejected(client, () => createDatasetStorageRepository(client).commit(write), /WRITE_UNCONFIRMED/);
        assert.equal((await client.query("select count(*)::int n from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows[0].n, 1);
      }
      owners.push(owner);
    }
    assert.equal(requests, 1, "all three providers share the same immutable public pair/date proof");
    const rate = (await client.query("select analytics.lookup_dataset_fx('USD','TRY','2026-10-30') result")).rows[0].result;
    assert.equal(rate.fx_rate, "1.234567890123456789");
    await rejected(client, () => client.query("delete from analytics.fx_rates where id=$1", [rate.id]));
    await rejected(client, () => client.query("update analytics.fx_rates set fx_rate=2 where id=$1", [rate.id]), /FX_IMMUTABLE/);
    const bad = {...rate}; delete bad.id; bad.source_reference.body.rate = "2";
    await rejected(client, () => createDatasetStorageRepository(client).recordFx(prepareDatasetFx(bad)), /WRITE_UNCONFIRMED/);
    // A different valid native revision is not silently selected as the latest.
    await client.query("savepoint fx_revision_case");
    const revised = structuredClone(rate); delete revised.id; revised.fx_rate = revised.source_reference.body.rate = "2";
    revised.rate_version = revised.source_reference.digest = sourcePayloadHash(revised.source_reference.body);
    await createDatasetStorageRepository(client).recordFx(prepareDatasetFx(revised));
    await rejected(client, () => client.query("select analytics.lookup_dataset_fx('USD','TRY','2026-10-30')"), /REVISION_REQUIRES_REVIEW/);
    await client.query("rollback to savepoint fx_revision_case"); await client.query("release savepoint fx_revision_case");
    const sameOwner = await ownerFixture(client), sameInput = await storedBindingFixture(client, sameOwner);
    await createReportingCurrencyRepository(client).select(prepareReportingCurrencySelection({installation: reportingCurrencyInstallation(sameOwner), currency: "USD"}));
    await bindStoredDatasetSources({...sameInput, fxResolver: createDatasetFxResolver({database: client, fetchImpl})});
    assert.equal(requests, 1);
    assert.equal((await client.query("select fx_state from analytics.pd_facts where installation_id=$1", [sameOwner.installationId])).rows[0].fx_state, "identity");
    await client.query("select evidence.delete_installation_sources($1::bigint)", [owners[0].installationId]);
    assert.equal((await client.query("select count(*)::int n from app.workspace_settings where installation_id=$1", [owners[0].installationId])).rows[0].n, 0);
    assert.equal((await client.query("select count(*)::int n from analytics.pd_facts where installation_id=$1", [owners[0].installationId])).rows[0].n, 0);
    assert.equal((await client.query("select count(*)::int n from analytics.pd_facts where installation_id=$1", [owners[1].installationId])).rows[0].n, 1);
    assert.ok((await client.query("select analytics.lookup_dataset_fx('USD','TRY','2026-10-30') result")).rows[0].result);
    for (const role of ["anon", "authenticated", "service_role", "adstable_runtime", "adstable_refresh_coordinator"]) {
      assert.equal((await client.query("select has_table_privilege($1,'app.workspace_settings','SELECT,INSERT,UPDATE,DELETE') ok", [role])).rows[0].ok, false);
      for (const signature of ["app.select_reporting_currency(jsonb,text,uuid)", "app.read_reporting_currency(jsonb)", "analytics.lookup_dataset_fx(text,text,date)"])
        assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') ok", [role, signature])).rows[0].ok, false);
    }
    console.log("EO05B_FX_REPORTING_CURRENCY_PASS three_provider_synthetic=true exact_decimal=true weekend_actual_date=true owner_currency_lock=true immutable_cache=true mandatory_erase=true no_native_HTTP=true live_mutation=false");
  } finally {await client.query("rollback to savepoint fx_reporting_fixture"); await client.query("release savepoint fx_reporting_fixture");}
}
