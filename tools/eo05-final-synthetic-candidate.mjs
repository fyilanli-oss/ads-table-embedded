import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";

function replaceOnce(source, search, replacement) {
  assert.equal(source.split(search).length, 2, search);
  return source.replace(search, () => replacement);
}

export function reuseGoogleProfileOids(sql) {
  const required = "select 1 from unnest($1::text[]) s(signature) where to_regprocedure(s.signature) is null\n   or not coalesce(has_function_privilege(current_user,to_regprocedure(s.signature)::oid,'EXECUTE'),false)";
  if (!sql.includes(required)) return sql;
  let checked = replaceOnce(sql, required,
    "select 1 from required_rpc s where s.oid is null or not coalesce(has_function_privilege(current_user,s.oid,'EXECUTE'),false)");
  const allowed = "select to_regprocedure(s.signature)::oid from unnest($1::text[]) s(signature)";
  if (checked.includes(allowed)) checked = replaceOnce(checked, allowed, "select oid from required_rpc");
  return `select * from (with required_rpc as materialized (
    select to_regprocedure(s.signature)::oid as oid from unnest($1::text[]) s(signature)
  ) ${checked}) verified_profile`;
}

export function klaviyoQuotaContextSource(sql) {
  const installation = "  installation:=operations.load_refresh_entitlement_installation(p_workspace,p_generation,p_provider,p_account,p_job,p_fence);\n  if authority is null or installation is null then return null; end if;";
  // For the matching Klaviyo job the later entitlement query already rechecks
  // the active workspace, active installation, current claim and subscription.
  // The request-intent row is the installation lookup's remaining predicate.
  return replaceOnce(sql, installation, `  if p_target='klaviyo' and p_provider='klaviyo' then
    if authority is null or not exists(select 1 from operations.refresh_work_progress p
      where p.workspace_id=p_workspace and p.install_generation=p_generation and p.provider=p_provider
        and p.account_id=p_account and p.job_id=p_job and p.fence=p_fence and p.stage='request_intent') then return null; end if;
  else
    installation:=operations.load_refresh_entitlement_installation(p_workspace,p_generation,p_provider,p_account,p_job,p_fence);
    if authority is null or installation is null then return null; end if;
  end if;`);
}

export function klaviyoQuotaProfileSource(sql, fingerprint) {
  const old = `      and p.quota_fingerprint=operations.shared_api_quota_fingerprint(p_operation)
      and (select count(*) from operations.api_quota_bindings qb where qb.operation_key=p_operation) between 1 and 16
      and not exists(select 1 from operations.api_quota_bindings qb join operations.api_quota_policies q on q.id=qb.policy_id
        where qb.operation_key=p_operation and q.provider<>op.provider)`;
  const expression = /\bselect (encode\(sha256\(convert_to\(string_agg\([\s\S]+?\),'UTF8'\)\),'hex'\))\s+from operations\.api_quota_bindings/.exec(fingerprint)?.[1];
  assert.ok(expression, "canonical quota fingerprint");
  return replaceOnce(sql, old, `      and exists(select 1 from operations.api_quota_bindings b
        join operations.api_quota_policies q on q.id=b.policy_id where b.operation_key=p_operation
        having count(*) between 1 and 16 and bool_and(q.provider=op.provider)
          and p.quota_fingerprint=${expression})`);
}

export async function installKlaviyoQuotaCandidate(client) {
  assert.equal(client.connectionParameters.host, "127.0.0.1");
  assert.equal(Number(client.connectionParameters.port), 54322);
  async function definition(signature) {
    return (await client.query("select pg_get_functiondef($1::regprocedure) definition", [signature])).rows[0].definition;
  }
  const context = await definition("operations.load_refresh_quota_context_before_merchant(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz)");
  const profile = await definition("operations.shared_api_quota_profile_valid(text)");
  const fingerprint = await definition("operations.shared_api_quota_fingerprint(text)");
  await client.query(klaviyoQuotaContextSource(context));
  await client.query(klaviyoQuotaProfileSource(profile, fingerprint));
}

export function reuseVerifiedRawHash(source) {
  // Existing page equality binds the sealed hash. The genuine cipher still
  // authenticates/decrypts and validates both the raw SHA-256 and JSON encoding.
  return replaceOnce(source.replaceAll("\r\n", "\n"),
    "   const payload=cipher.open({owner,attemptId,ordinal,page});\n   if(sourcePayloadHash(payload)!==sourcePayloadHash(plain))fail();",
    "   cipher.open({owner,attemptId,ordinal,page});\n   if(expected.payloadHash!==sourcePayloadHash(plain))fail();");
}

export async function loadKlaviyoRawHashCandidate() {
  const url = new URL("../app/lib/database/klaviyo-dataset-source-store.server.js", import.meta.url);
  const candidateUrl = `${url.href}?eo05VerifiedRawHash`;
  const source = reuseVerifiedRawHash(readFileSync(url, "utf8"));
  const hooks = registerHooks({load(href, context, next) {
    if (href === candidateUrl) return {format: "module", source, shortCircuit: true};
    return next(href, context);
  }});
  try {
    return await import(candidateUrl);
  } finally {
    hooks.deregister();
  }
}
