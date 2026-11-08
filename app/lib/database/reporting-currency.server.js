import {randomUUID} from "node:crypto";
import {canonicalSourceJson} from "./source-evidence-store.server.js";
import {REPORTING_CURRENCIES} from "./dataset-fx-policy.server.js";
const prepared = new WeakMap();
const keys = ["workspaceId", "installationId", "generation", "shopId", "shopDomain"];
const id = v => typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const fail = code => {throw Error("REPORTING_CURRENCY_" + code);};
export function reportingCurrencyScope(installation) {
  if (!installation || Object.getPrototypeOf(installation) !== Object.prototype || Object.keys(installation).sort().join() !== keys.slice().sort().join()
    || !uuid(installation.workspaceId) || !id(installation.installationId) || !id(installation.generation)
    || !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(installation.shopId) || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(installation.shopDomain)) fail("OWNER_REQUIRED");
  return Object.freeze({...installation});
}
export function reportingCurrencyInstallation(owner) {return reportingCurrencyScope(Object.fromEntries(keys.map(k => [k, owner?.[k]])));}
export function prepareReportingCurrencySelection({installation, currency} = {}) {
  installation = reportingCurrencyScope(installation);
  if (!REPORTING_CURRENCIES.includes(currency)) fail("UNSUPPORTED");
  const value = Object.freeze({installation, currency, operationId: randomUUID()}); prepared.set(value, {used: false}); return value;
}
function validateProof(proof, scope) {
  if (!proof || Object.keys(proof).sort().join() !== "currency,currencyVersion,generation,installationId,selectionOperationId,source,version,workspaceId"
    || proof.version !== "reporting-currency-v1" || proof.source !== "merchant_selected" || proof.currencyVersion !== "1" || !uuid(proof.selectionOperationId)
    || !REPORTING_CURRENCIES.includes(proof.currency) || ["workspaceId", "installationId", "generation"].some(k => proof[k] !== scope[k])) fail("PROOF_INVALID");
  return Object.freeze({...proof});
}
export function createReportingCurrencyRepository(database) {
  if (typeof database?.query !== "function") fail("DATABASE_REQUIRED");
  async function read(installation) {
      const scope = reportingCurrencyScope(installation);
      try {
        const r = await database.query("select app.read_reporting_currency($1::jsonb) as result", [JSON.stringify(scope)]);
        if (r.rows?.length !== 1) fail("READ_INVALID");
        return r.rows[0].result === null ? null : validateProof(r.rows[0].result, scope);
      } catch {fail("READ_UNCONFIRMED");}
  }
  return Object.freeze({
    read,
    async select(value) {
      const state = prepared.get(value); if (!state || state.used) fail("CAPABILITY_REQUIRED"); state.used = true;
      let proof;
      try {
        const r = await database.query("select app.select_reporting_currency($1::jsonb,$2::text,$3::uuid) as result", [JSON.stringify(value.installation), value.currency, value.operationId]);
        if (r.rows?.length !== 1) fail("RESULT_INVALID");
        proof = validateProof(r.rows[0].result, value.installation);
        if (proof.currency !== value.currency || proof.selectionOperationId !== value.operationId) fail("RESULT_INVALID");
      } catch {fail("WRITE_UNCONFIRMED");}
      const back = await read(value.installation);
      if (canonicalSourceJson(back) !== canonicalSourceJson(proof)) fail("READBACK_UNCONFIRMED");
      return proof;
    },
  });
}
