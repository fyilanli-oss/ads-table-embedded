import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {storedBindingFixture} from "./eo05b-source-dataset-binding-probe.mjs";
import {maturityObservationFixture} from "../tests/fixtures/maturity-fixture.js";
import {storeMaturityConfiguration, recordMaturityDecision, inspectMaturityDecision} from "../app/lib/database/maturity-store.server.js";
import {bindStoredDatasetSources} from "../app/lib/database/dataset-source-binding.server.js";
import {deriveMaturityPolicy} from "../app/lib/refresh/maturity-policy.server.js";
import {canonicalSourceJson} from "../app/lib/database/source-evidence-store.server.js";

async function rejected(client, action) {
  await client.query("savepoint maturity_expected_failure"); let error;
  try {await action();} catch (caught) {error = caught;}
  await client.query("rollback to savepoint maturity_expected_failure"); await client.query("release savepoint maturity_expected_failure");
  assert.ok(error, "invalid maturity operation must be rejected");
}

/** Existing F01 localhost/CI transaction only. All native HTTP, owners and keys
 * are synthetic; actual AEAD, source/readback, SQL/CAS/ACL/retention are exercised. */
export async function maturityProbe(client, {ownerFixture}) {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  const database = {async query(sql, args) {
    try {return await client.query(sql, args);} catch (error) {
      if (/evidence\.(register_maturity_configuration|commit_maturity_decision|read_maturity_decision)/.test(sql)) {
        console.error("EO05C_SQL_DIAGNOSTIC", JSON.stringify({code: error.code, message: error.message, where: error.where}));
      }
      throw error;
    }
  }};
  let scenarios = 0;
  for (const provider of ["google_ads", "meta", "klaviyo"]) {
    const owner = await ownerFixture(client, provider), source = await storedBindingFixture(client, owner, {nonempty: false});
    const limits = {maxBytes: 1000000, maxRows: 1000, deadlineAt: Date.now() + 60000, maxObservationAgeMs: 60000};
    const configuration = async setting => {
      const f = maturityObservationFixture(provider, {owner, setting, clickDays: "0"});
      return storeMaturityConfiguration({database, cipher: source.cipher, owner, observation: await f.read(),
        policy: source.envelopes.values().next().value.sourceWrite.body.policy, limits: {...limits, deadlineAt: Date.now() + 60000}});
    };
    const config = await configuration("1d_click");
    assert.equal(config.policy.state, provider === "klaviyo" ? "unknown" : "known");
    assert.equal(config.policy.horizonDays, provider === "google_ads" ? 0 : provider === "meta" ? 1 : null);
    const anchorAttemptId = source.batches[0].attemptId;
    const input = {database, cipher: source.cipher, owner, configurationAttemptId: config.attemptId, anchorAttemptId,
      batches: source.batches, expectedRevision: 0, limits: {...source.limits, deadlineAt: Date.now() + 60000}};
    const pending = await recordMaturityDecision(input);
    assert.equal(pending.state, provider === "klaviyo" ? "unknown" : "provisional");
    assert.equal(pending.reportValuesChanged, false); assert.equal(pending.consumerReceipt, false);
    assert.equal(pending.revision, 1); scenarios++;
    await rejected(client, () => recordMaturityDecision(input)); scenarios++;
    // Fictional successful reread of the SAME provider business date after the
    // window. Only test metadata clocks change; no claimed real provider read.
    const stamp = new Date().toISOString(), key = provider === "google_ads" ? "googleDatasetRead" : provider === "meta" ? "metaDatasetRead" : "klaviyoDatasetRead";
    for (const batch of source.batches) await client.query(`update evidence.source_batches set manifest=jsonb_set(jsonb_set(manifest,$3::text[],to_jsonb($4::text)),$5::text[],to_jsonb($4::text)) where authority=$1::jsonb and attempt_id=$2::uuid`,
      [JSON.stringify(owner), batch.attemptId, [key, "observedAt"], stamp, [key, "completedAt"]]);
    const written = await bindStoredDatasetSources({...source, database: client, limits: {...source.limits, deadlineAt: Date.now() + 60000}});
    assert.equal(written.status, "empty");
    const recordInput = {...input, expectedRevision: 1, reportOperationId: written.retentionReceipt.operationId, limits: {...source.limits, deadlineAt: Date.now() + 60000}};
    const final = await recordMaturityDecision(recordInput);
    assert.equal(final.state, provider === "klaviyo" ? "unknown" : provider === "meta" ? "provisional" : "final");
    assert.equal(final.reportVerified, true); assert.equal(final.revision, 2); scenarios++;
    assert.equal((await inspectMaturityDecision({database: client, owner, anchorAttemptId})).digest, final.digest);
    const cfgRow = (await client.query("select retain_until,manifest from evidence.source_batches where id=$1", [config.batchId])).rows[0];
    const reportRow = (await client.query("select retain_until,manifest from evidence.source_batches where authority=$1::jsonb and attempt_id=$2", [JSON.stringify(owner), anchorAttemptId])).rows[0];
    assert.ok(cfgRow.retain_until >= reportRow.retain_until, "configuration proof follows synchronized report lifetime");
    const oldAuthority = {...owner, generation: String(Number(owner.generation) + 1)};
    await rejected(client, () => inspectMaturityDecision({database: client, owner: oldAuthority, anchorAttemptId})); scenarios++;
    await client.query("savepoint maturity_privacy");
    await client.query("update evidence.source_batches set manifest=manifest||'{\"privacyRedacted\":true}'::jsonb where authority=$1::jsonb and attempt_id=$2", [JSON.stringify(owner), anchorAttemptId]);
    await rejected(client, () => inspectMaturityDecision({database: client, owner, anchorAttemptId}));
    await client.query("rollback to savepoint maturity_privacy"); await client.query("release savepoint maturity_privacy"); scenarios++;
    if (provider === "meta") {
      const changed = await configuration("7d_click");
      assert.notEqual(changed.fingerprint, config.fingerprint);
      const reopened = await inspectMaturityDecision({database: client, owner, anchorAttemptId});
      assert.equal(reopened.state, "provisional"); assert.equal(reopened.reason, "configuration_changed");
      assert.equal(reopened.inspectionOnly, true);
      await rejected(client, () => recordMaturityDecision({...recordInput, expectedRevision: 2})); scenarios++;
      const next = await recordMaturityDecision({...recordInput, expectedRevision: 2, configurationAttemptId: changed.attemptId});
      assert.equal(next.revision, 3); assert.equal(next.policyFingerprint, changed.fingerprint); scenarios++;
    }
    // Unknown registration acknowledgement cannot trigger any automatic query.
    let lost = false, after = 0;
    const ambiguous = {async query(sql, args) {if (lost) after++; const r = await client.query(sql, args);
      if (sql.includes("commit_maturity_decision")) {lost = true; throw Error("SYNTHETIC_LOST_ACK");} return r;}};
    await assert.rejects(recordMaturityDecision({...recordInput, database: ambiguous, expectedRevision: provider === "meta" ? 3 : 2,
      configurationAttemptId: provider === "meta" ? (await configuration("7d_click")).attemptId : config.attemptId}), /WRITE_UNCONFIRMED/);
    assert.equal(after, 0); scenarios++;
  }
  const payload = {version: "eo05c-maturity-v1", provider: "meta", timeZone: "UTC", native: {complete: true, settings: [{ad_id: "123", setting: "7d_click,1d_view"}]}};
  assert.equal(canonicalSourceJson((await client.query("select evidence.maturity_policy($1::jsonb) as p", [JSON.stringify(payload)])).rows[0].p), canonicalSourceJson(deriveMaturityPolicy(payload)));
  for (const role of ["anon", "authenticated", "service_role", "adstable_runtime", "adstable_refresh_coordinator"]) {
    const r = await client.query("select has_function_privilege($1,'evidence.commit_maturity_decision(jsonb,jsonb,timestamptz)','EXECUTE') allowed", [role]);
    assert.equal(r.rows[0].allowed, false); scenarios++;
  }
  console.log("EO05C_MATURITY_PROBE", JSON.stringify({synthetic: true, rollbackOnly: true, scenarios, sourceReadback: true, currentConfiguration: true, finality: true, privacy: true, liveAcceptance: false}));
}
