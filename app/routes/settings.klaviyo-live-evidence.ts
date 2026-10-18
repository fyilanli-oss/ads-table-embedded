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
  createKlaviyoReportingAuthorityRuntime,
} from "../lib/providers/klaviyo-reporting-authority.server.js";
import {
  buildKlaviyoLiveEvidenceSafeFailureLog,
  buildKlaviyoLiveEvidenceSafeLog,
  classifyKlaviyoLiveEvidenceError,
  createKlaviyoLiveEvidenceRuntime,
  KLAVIYO_LIVE_EVIDENCE_SAFE_LOG_PREFIX,
} from "../lib/providers/klaviyo-live-evidence.server.js";

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
      code: "KLAVIYO_LIVE_EVIDENCE_CONTENT_TYPE_INVALID",
      class: "request_contract_invalid",
      provider_retry_performed: false,
      next_query_family_started: false,
    }, 415);
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({
      status: "failed",
      code: "KLAVIYO_LIVE_EVIDENCE_JSON_INVALID",
      class: "request_contract_invalid",
      provider_retry_performed: false,
      next_query_family_started: false,
    }, 400);
  }

  let failureStage = "runtime_initialization";
  try {
    const runtime = createKlaviyoLiveEvidenceRuntime({
      klaviyoRuntime: createKlaviyoReportingAuthorityRuntime({
        database,
        tokenVault: providerTokenVault,
      }),
    });
    failureStage = "execution";
    const result = await runtime.execute({
      installationAuthority: verified.installationAuthority,
      input,
    });
    console.info(
      KLAVIYO_LIVE_EVIDENCE_SAFE_LOG_PREFIX,
      JSON.stringify(buildKlaviyoLiveEvidenceSafeLog(result)),
    );
    return json(result);
  } catch (error) {
    if (error instanceof Response) throw error;
    const failure = classifyKlaviyoLiveEvidenceError(error);
    console.info(
      KLAVIYO_LIVE_EVIDENCE_SAFE_LOG_PREFIX,
      JSON.stringify(buildKlaviyoLiveEvidenceSafeFailureLog(failure, failureStage)),
    );
    return json({
      status: "failed",
      code: failure.code,
      class: failure.class,
      completed_families: failure.completed_families,
      provider_retry_performed: false,
      next_query_family_started: false,
    }, failure.status);
  }
};
