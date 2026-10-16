import type {ActionFunctionArgs, LoaderFunctionArgs} from "react-router";
import {
  authenticate,
  database,
  providerTokenVault,
} from "../shopify.server";
import {
  resolveReadOnlyShopifyRouteAuthority,
} from "../lib/shopify/shopify-route-authority.server.js";
import {
  createMetaReportingAuthorityRuntime,
} from "../lib/providers/meta-reporting-authority.server.js";
import {
  buildProviderLiveEvidenceSafeLog,
  classifyProviderLiveEvidenceError,
  createProviderLiveEvidenceRuntime,
  PROVIDER_LIVE_EVIDENCE_SAFE_LOG_PREFIX,
} from "../lib/providers/provider-live-evidence.server.js";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {status, headers: JSON_HEADERS});
}

function methodNotAllowed() {
  return new Response(null, {
    status: 405,
    headers: {allow: "POST", "cache-control": "no-store"},
  });
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return methodNotAllowed();
};

export const action = async ({request}: ActionFunctionArgs) => {
  if (request.method !== "POST") return methodNotAllowed();

  const verified = await resolveReadOnlyShopifyRouteAuthority({
    request,
    authenticateAdmin: authenticate.admin,
    database,
  });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({
      status: "failed",
      code: "LIVE_EVIDENCE_CONTENT_TYPE_INVALID",
      class: "request_contract_invalid",
      provider_retry_performed: false,
      next_provider_started: false,
    }, 415);
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({
      status: "failed",
      code: "LIVE_EVIDENCE_JSON_INVALID",
      class: "request_contract_invalid",
      provider_retry_performed: false,
      next_provider_started: false,
    }, 400);
  }

  try {
    const runtime = createProviderLiveEvidenceRuntime({
      metaRuntime: createMetaReportingAuthorityRuntime({
        database,
        tokenVault: providerTokenVault,
      }),
    });
    const result = await runtime.execute({
      installationAuthority: verified.installationAuthority,
      input,
    });
    console.info(
      PROVIDER_LIVE_EVIDENCE_SAFE_LOG_PREFIX,
      JSON.stringify(buildProviderLiveEvidenceSafeLog(result)),
    );
    return json(result);
  } catch (error) {
    if (error instanceof Response) throw error;
    const failure = classifyProviderLiveEvidenceError(error);
    return json({
      status: "failed",
      code: failure.code,
      class: failure.class,
      provider_request_id: failure.provider_request_id,
      provider_retry_performed: false,
      next_provider_started: false,
    }, failure.status);
  }
};
