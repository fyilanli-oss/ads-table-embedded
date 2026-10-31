import {usePermissionSettings} from "../components/use-permission-settings";
import {logPermissionFailure} from "../lib/server-error-log.server.js";
import {createPermissionSettings, PERMISSION_SETTINGS_AVAILABILITY} from "../lib/shopify/permission-settings.server.js";
import type {PermissionFeature} from "../lib/ui/permission-explanation-flow.js";
import type {ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs, ShouldRevalidateFunctionArgs} from "react-router";
import {boundary} from "@shopify/shopify-app-react-router/server";
import {readShopifyPermissionStatuses, type ProductPermissionStatus} from "../lib/shopify/product-permission-status.server.js";
import {ProductAccessRemoval} from "../components/product-access-removal";
import {OrderAccessRemoval} from "../components/order-access-removal";
import {
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSubmit,
} from "react-router";
import {useEffect, useRef, useState} from "react";
import {createMetaProbeButtonRunner, type MetaProbeButtonResult} from "../lib/providers/meta-probe-button.js";
import {
  authenticate,
  database,
  providerTokenVault,
  permissionSetup,
  permissionRelease,
} from "../shopify.server";
import {
  resolveShopifyRouteAuthority,
} from "../lib/shopify/shopify-route-authority.server.js";
import {createGoogleOAuthRuntime} from "../lib/oauth/google-oauth-runtime.server.js";
import {createMetaOAuthRuntime} from "../lib/oauth/meta-oauth-runtime.server.js";
import {createKlaviyoOAuthRuntime, normalizeKlaviyoEstimatedSpend} from "../lib/oauth/klaviyo-oauth-runtime.server.js";
import {klaviyoSetupAccount, klaviyoSpendError, KLAVIYO_SPEND_ERROR} from "../lib/ui/klaviyo-setup-state.js";
import {
  buildGoogleAdsAuthorizationUrl,
} from "../lib/providers/google-ads-rest.server.js";
import {buildMetaAuthorizationUrl} from "../lib/providers/meta-graph.server.js";
import {buildKlaviyoAuthorizationUrl} from "../lib/providers/klaviyo-api.server.js";

type Advertiser = {
  id: string;
  name: string;
  status: string | null;
  currency: string | null;
  timezone: string | null;
};

type State =
  | {view: "combined"}
  | {view: "permissions_incomplete"}
  | {view: "disconnected"; notice: "cancelled" | "disconnected" | null}
  | {view: "pending"; accounts: Advertiser[]}
  | {view: "pending_reporting"; accounts: Advertiser[]}
  | {view: "connected"; accounts: Advertiser[]; reportingAccountId: string}
  | {view: "reauthorization"}
  | {view: "error"; code: string; retry: "oauth" | "reload"};

type ActionData =
  | {ok: true; intent: "begin"; provider: Provider; authorizationUrl: string}
  | {ok: false; provider: Provider; code: string; fieldError?: string}
  | undefined;

type Provider = "google_ads" | "meta" | "klaviyo";

type GoogleEvidenceResult = {
  status: "complete";
  observation_state: "present" | "not_observed_in_this_execution";
  account: {
    account_type_state: "test_observed" | "production_observed" | "not_observed";
    production_performance_evidence_eligible: boolean;
    campaign_context_row_count: number;
  };
  cart_data_sales: {
    row_count: number;
    sales_role_counts: Record<"Advertised" | "Cross-sell" | "Assisted" | "Unclassified", number>;
  };
  product_performance: {row_count: number};
  current_listing_tree: {row_count: number};
  pmax_asset_group_performance: {row_count: number};
};

type KlaviyoEvidenceResult = {
  status: "complete";
  observation_state: "present" | "not_observed_in_this_execution";
  business_date: string;
  campaign_messages: {row_count: number};
  flow_messages: {row_count: number};
  ordered_product_events: {row_count: number};
  resolved_product_sales: {
    row_count: number;
    channel_resolution_counts: {exact: number; unclassified: number};
    sales_role_counts: Record<
      "Advertised" | "Cross-sell" | "Assisted" | "Triggered" | "Unclassified",
      number
    >;
  };
};

type KlaviyoAccount = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
};

type KlaviyoSpendPeriod = {
  id: string;
  amount: string;
  currency: string;
  effectiveFrom: string;
  correctionVersion: number;
};

type KlaviyoState =
  | {view: "disconnected"; notice: "cancelled" | "disconnected" | null}
  | {view: "pending"; accounts: KlaviyoAccount[]}
  | {
      view: "connected";
      account: KlaviyoAccount;
      current: KlaviyoSpendPeriod;
      periods: KlaviyoSpendPeriod[];
    }
  | {view: "reauthorization"}
  | {view: "error"; code: string; retry: "oauth" | "reload"};

type LoaderData = State & {meta: State; klaviyo: KlaviyoState; permissionAvailability: typeof PERMISSION_SETTINGS_AVAILABILITY;
  shopifyProductAccess: ProductPermissionStatus; shopifyOrderAccess: ProductPermissionStatus; shopifyPermissionOwner: string | null;
  permissionUnavailableReasons?: Partial<Record<PermissionFeature, string>>};

function providerCodeOf(provider: Provider, error: unknown) {
  const prefix = provider === "meta"
    ? "META"
    : provider === "klaviyo" ? "KLAVIYO" : "GOOGLE_ADS";
  const source = error && typeof error === "object"
    ? error as {code?: unknown; message?: unknown; details?: Record<string, unknown>}
    : null;
  const providerCode = source?.details?.provider_error_code;
  if (
    typeof providerCode === "string"
    && /^[A-Z0-9_]{1,80}$/.test(providerCode)
  ) return prefix + "_PROVIDER_" + providerCode;
  const status = source?.details?.provider_status;
  if (status === "invalid_grant") return prefix + "_REAUTHORIZATION_REQUIRED";
  const semanticMessage = source?.message ?? (error instanceof Error ? error.message : "");
  if (
    typeof semanticMessage === "string"
    && /^[A-Z][A-Z0-9_]{2,79}$/.test(semanticMessage)
  ) return semanticMessage;
  const candidate = source?.code;
  return typeof candidate === "string"
    && /^[A-Z0-9_]{1,80}$/.test(candidate)
    && !/^[0-9A-Z]{5}$/.test(candidate)
    ? candidate
    : prefix + "_SETUP_FAILED";
}

function klaviyoAccount(value: Record<string, unknown>): KlaviyoAccount {
  return {
    id: String(value.id),
    name: String(value.name),
    currency: String(value.currency),
    timezone: String(value.timezone),
  };
}

function klaviyoPeriod(value: Record<string, unknown>): KlaviyoSpendPeriod {
  return {
    id: String(value.id),
    amount: String(value.amount),
    currency: String(value.currency),
    effectiveFrom: String(value.effectiveFrom),
    correctionVersion: Number(value.correctionVersion),
  };
}

function view(account: Record<string, unknown>): Advertiser {
  return {
    id: String(account.id),
    name: String(account.name),
    status: typeof account.status === "string" ? account.status : null,
    currency: typeof account.currency === "string" ? account.currency : null,
    timezone: typeof account.timezone === "string" ? account.timezone : null,
  };
}

function reportingAccountName(state: State) {
  if (state.view !== "connected") return "";
  return state.accounts.find(
    (account) => account.id === state.reportingAccountId,
  )?.name ?? state.reportingAccountId;
}

async function routeAuthority(request: Request) {
  return resolveShopifyRouteAuthority({
    request,
    authenticateAdmin: authenticate.admin,
    database,
  });
}

// Pending broader grants require bound account selection. A connected reporting
// account returns to its existing view without a catalog-selection prerequisite.
function requiresCombinedSelection(inspected: any) {
  if (inspected?.state === "connected") return false;
  const scopes = inspected?.pending?.scopes;
  return Array.isArray(scopes) && scopes.some(scope => scope === "https://www.googleapis.com/auth/content" || scope === "catalog_management");
}

async function loadGoogleState(
  verified: Awaited<ReturnType<typeof routeAuthority>>,
  url: URL,
): Promise<State> {
  const runtime = createGoogleOAuthRuntime({
    database,
    tokenVault: providerTokenVault,
    identityAuthorizationEnabled: permissionRelease?.availability.google_ads === true,
  });
  try {
    const inspected = await runtime.inspect({
      installationAuthority: verified.installationAuthority,
    });
    if (requiresCombinedSelection(inspected)) return {view: "combined"};
    if (inspected.state === "connected") {
      if (!inspected.connection.reportingAccountId) {
        throw new Error("GOOGLE_REPORTING_ACCOUNT_REQUIRED");
      }
      return {
        view: "connected",
        accounts: inspected.connection.accounts.map(view),
        reportingAccountId: inspected.connection.reportingAccountId,
      };
    }
    if (inspected.state === "pending_reporting_account_selection") {
      return {
        view: "pending_reporting",
        accounts: inspected.accounts.map(view),
      };
    }
    if (inspected.state === "pending_account_selection") {
      return {
        view: "pending",
        accounts: inspected.accounts.map(view),
      };
    }
    const status = url.searchParams.get("google_status");
    // This return hint only explains an unfinished setup. Existing server-read
    // connected/account-selection authority above always takes precedence.
    if (status === "permissions_incomplete") return {view: "permissions_incomplete"};
    if (status === "error") {
      const callbackCode = url.searchParams.get("google_error");
      return {
        view: "error",
        code: callbackCode && /^[A-Z0-9_]{1,80}$/.test(callbackCode)
          ? callbackCode
          : "GOOGLE_CALLBACK_FAILED",
        retry: "oauth",
      };
    }
    return {
      view: "disconnected",
      notice: status === "cancelled"
        ? "cancelled"
        : status === "disconnected"
          ? "disconnected"
          : null,
    };
  } catch (error) {
    const code = providerCodeOf("google_ads", error);
    if (code === "GOOGLE_REAUTHORIZATION_REQUIRED") {
      return {view: "reauthorization"};
    }
    return {view: "error", code, retry: "reload"};
  }
}

async function loadMetaState(
  verified: Awaited<ReturnType<typeof routeAuthority>>,
  url: URL,
): Promise<State> {
  try {
    const runtime = createMetaOAuthRuntime({
      database,
      tokenVault: providerTokenVault,
    identityAuthorizationEnabled: permissionRelease?.availability.meta === true,
    });
    const inspected = await runtime.inspect({
      installationAuthority: verified.installationAuthority,
    });
    if (requiresCombinedSelection(inspected)) return {view: "combined"};
    if (inspected.state === "connected") {
      if (!inspected.connection.reportingAccountId) {
        throw new Error("META_REPORTING_ACCOUNT_REQUIRED");
      }
      return {
        view: "connected",
        accounts: inspected.connection.accounts.map(view),
        reportingAccountId: inspected.connection.reportingAccountId,
      };
    }
    if (inspected.state === "pending_reporting_account_selection") {
      return {view: "pending_reporting", accounts: inspected.accounts.map(view)};
    }
    if (inspected.state === "pending_account_selection") {
      return {view: "pending", accounts: inspected.accounts.map(view)};
    }
    const status = url.searchParams.get("meta_status");
    if (status === "error") {
      const callbackCode = url.searchParams.get("meta_error");
      return {
        view: "error",
        code: callbackCode && /^[A-Z0-9_]{1,80}$/.test(callbackCode)
          ? callbackCode
          : "META_CALLBACK_FAILED",
        retry: "oauth",
      };
    }
    return {
      view: "disconnected",
      notice: status === "cancelled"
        ? "cancelled"
        : status === "disconnected"
          ? "disconnected"
          : null,
    };
  } catch (error) {
    const code = providerCodeOf("meta", error);
    if (code === "META_REAUTHORIZATION_REQUIRED") {
      return {view: "reauthorization"};
    }
    return {view: "error", code, retry: "reload"};
  }
}

async function loadKlaviyoState(
  verified: Awaited<ReturnType<typeof routeAuthority>>,
  url: URL,
): Promise<KlaviyoState> {
  try {
    const runtime = createKlaviyoOAuthRuntime({
      database,
      tokenVault: providerTokenVault,
    });
    const inspected = await runtime.inspect({
      installationAuthority: verified.installationAuthority,
    });
    if (inspected.state === "connected") {
      return {
        view: "connected",
        account: klaviyoAccount(inspected.spend.account),
        current: klaviyoPeriod(inspected.spend.current),
        periods: inspected.spend.periods.map(klaviyoPeriod),
      };
    }
    if (inspected.state === "pending_account_selection") {
      return {
        view: "pending",
        accounts: inspected.accounts.map(klaviyoAccount),
      };
    }
    if (inspected.state === "reauthorization_required") {
      return {view: "reauthorization"};
    }
    const status = url.searchParams.get("klaviyo_status");
    if (status === "error") {
      const callbackCode = url.searchParams.get("klaviyo_error");
      return {
        view: "error",
        code: callbackCode && /^[A-Z0-9_]{1,80}$/.test(callbackCode)
          ? callbackCode
          : "KLAVIYO_CALLBACK_FAILED",
        retry: "oauth",
      };
    }
    return {
      view: "disconnected",
      notice: status === "cancelled"
        ? "cancelled"
        : status === "disconnected" ? "disconnected" : null,
    };
  } catch (error) {
    const code = providerCodeOf("klaviyo", error);
    if (code === "KLAVIYO_REAUTHORIZATION_REQUIRED") {
      return {view: "reauthorization"};
    }
    return {view: "error", code, retry: "reload"};
  }
}

export const loader = async ({request}: LoaderFunctionArgs): Promise<LoaderData> => {
  const verified = await routeAuthority(request);
  const url = new URL(request.url);
  const [google, meta, klaviyo, shopifyAccess] = await Promise.all([
    loadGoogleState(verified, url),
    loadMetaState(verified, url),
    loadKlaviyoState(verified, url),
    readShopifyPermissionStatuses({verified, setup: permissionSetup,
      productsAvailable: permissionRelease?.availability.shopify_products === true,
      ordersAvailable: permissionRelease?.availability.shopify_orders === true}),
  ]);
  return {...google, meta, klaviyo, shopifyProductAccess: shopifyAccess.products, shopifyOrderAccess: shopifyAccess.orders,
    shopifyPermissionOwner: verified.identity?.shop?.shopId ?? null,
    permissionAvailability: permissionRelease?.availability ?? PERMISSION_SETTINGS_AVAILABILITY,
    permissionUnavailableReasons: permissionRelease?.unavailableReasons};
};

// Single Fetch aggregates thrown action headers at the leaf route. The layout's
// headers export alone cannot forward the SDK reauthorization header on .data.
export const headers: HeadersFunction = (args) => boundary.headers(args);

const permissionIntents = new Set(["permission_connect", "permission_status", "permission_revoke_products", "permission_revoke_orders", "permission_select_accounts", "permission_select_reporting"]);

export function shouldRevalidate({formData, actionResult, defaultShouldRevalidate}: ShouldRevalidateFunctionArgs) {
  const intent = formData?.get("intent");
  // Permission status reads are explicit; do not implicitly rerun provider loaders.
  if (typeof intent === "string" && permissionIntents.has(intent)) return false;
  // A field error or unconfirmed save is not permission to reread providers.
  if (intent === "complete_klaviyo" && actionResult?.ok === false) return false;
  return defaultShouldRevalidate;
}

export const action = async ({request}: ActionFunctionArgs) => {
  const verified = await routeAuthority(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (typeof intent === "string" && permissionIntents.has(intent)) {
    const featureValue = form.get("feature");
    const requestId = form.get("requestId");
    if (typeof featureValue !== "string" || !Object.hasOwn(PERMISSION_SETTINGS_AVAILABILITY, featureValue)
      || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/.test(requestId)) {
      return new Response("Invalid permission action.", {status: 400});
    }
    const feature = featureValue as PermissionFeature;
    const settings = createPermissionSettings({shopify: permissionSetup,
      availability: permissionRelease?.availability ?? PERMISSION_SETTINGS_AVAILABILITY,
      providerRuntime: (provider) => provider === "meta"
        ? createMetaOAuthRuntime({database, tokenVault: providerTokenVault,
          identityAuthorizationEnabled: permissionRelease?.availability.meta === true})
        : provider === "klaviyo" ? createKlaviyoOAuthRuntime({database, tokenVault: providerTokenVault})
        : createGoogleOAuthRuntime({database, tokenVault: providerTokenVault,
          identityAuthorizationEnabled: permissionRelease?.availability.google_ads === true}),
    });
    try {
      let result;
      if (intent === "permission_connect") result = await settings.connect({feature, verified, action: "connect"});
      else if (intent === "permission_status") {
        const encoded = form.get("expectedScopeBinding");
        if (encoded !== null && (typeof encoded !== "string" || encoded.length > 512)) throw new Error("PERMISSION_SETTINGS_SCOPE_BINDING_INVALID");
        result = await settings.status({feature, verified, ...(typeof encoded === "string" ? {expectedScopeBinding: JSON.parse(encoded)} : {})});
      }
      else if (intent === "permission_revoke_products") {
        if (feature !== "shopify_products") throw new Error("PERMISSION_SETTINGS_FEATURE_INVALID");
        result = await settings.revokeProducts({feature, verified, action: "revoke"});
      }
      else if (intent === "permission_revoke_orders") {
        if (feature !== "shopify_orders") throw new Error("PERMISSION_SETTINGS_FEATURE_INVALID");
        result = await settings.revokeOrders({feature, verified, action: "revoke"});
      }
      else {
        const expected = {connectionId: String(form.get("connectionId") ?? ""), version: Number(form.get("version"))};
        const encoded = String(form.get("selectedAccountIds") ?? "[]");
        if (encoded.length > 1024) throw new Error("PERMISSION_SETTINGS_ACCOUNTS_INVALID");
        result = await settings.select({feature, verified, expected,
          operation: intent === "permission_select_accounts" ? "accounts" : "reporting",
          selectedAccountIds: JSON.parse(encoded), reportingAccountId: String(form.get("reportingAccountId") ?? "")});
      }
      return {...result, requestId};
    } catch (error) {
      if (error instanceof Response) throw error;
      logPermissionFailure({feature, intent, requestId, error});
      return {kind: "unknown" as const, feature, requestId};
    }
  }
  if (typeof intent === "string" && intent.startsWith("permission_")) {
    return new Response("Invalid permission action.", {status: 400});
  }
  const providerValue = form.get("provider");
  const provider: Provider = providerValue === "meta" || providerValue === "klaviyo"
    ? providerValue
    : "google_ads";

  if (provider === "klaviyo" && intent === "complete_klaviyo") {
    try {
      normalizeKlaviyoEstimatedSpend(String(form.get("estimatedSpend") ?? ""));
    } catch {
      return {ok: false, provider, code: "KLAVIYO_ESTIMATED_SPEND_INVALID",
        fieldError: KLAVIYO_SPEND_ERROR} satisfies ActionData;
    }
  }

  try {
    const runtime = provider === "meta"
      ? createMetaOAuthRuntime({database, tokenVault: providerTokenVault,
        identityAuthorizationEnabled: permissionRelease?.availability.meta === true})
      : provider === "klaviyo"
        ? createKlaviyoOAuthRuntime({database, tokenVault: providerTokenVault})
        : createGoogleOAuthRuntime({database, tokenVault: providerTokenVault,
          identityAuthorizationEnabled: permissionRelease?.availability.google_ads === true});
    if (intent === "begin") {
      const started = await runtime.oauthBoundary.begin({
        installationAuthority: verified.installationAuthority,
        provider,
      });
      return {
        ok: true,
        intent: "begin",
        provider,
        authorizationUrl: provider === "meta"
          ? buildMetaAuthorizationUrl({
            config: runtime.config,
            state: started.state,
          })
          : provider === "klaviyo"
            ? buildKlaviyoAuthorizationUrl({
              config: runtime.config,
              state: started.state,
              pkceChallenge: started.pkceChallenge,
            })
          : buildGoogleAdsAuthorizationUrl({
            config: runtime.config,
            state: started.state,
            pkceChallenge: started.pkceChallenge,
          }),
      } satisfies ActionData;
    }

    if (provider === "klaviyo" && intent === "complete_klaviyo") {
      await runtime.complete({
        installationAuthority: verified.installationAuthority,
        accountId: String(form.get("accountId") ?? ""),
        estimatedSpend: String(form.get("estimatedSpend") ?? ""),
      });
      return verified.context.redirect("/settings");
    }

    if (provider === "klaviyo" && intent === "update_klaviyo_spend") {
      await runtime.updateSpend({
        installationAuthority: verified.installationAuthority,
        estimatedSpend: String(form.get("estimatedSpend") ?? ""),
      });
      return verified.context.redirect("/settings");
    }

    if (provider === "klaviyo" && intent === "change_klaviyo_value") {
      await runtime.changeValue({
        installationAuthority: verified.installationAuthority,
        periodId: String(form.get("periodId") ?? ""),
        expectedCorrectionVersion: Number(form.get("correctionVersion")),
        estimatedSpend: String(form.get("estimatedSpend") ?? ""),
      });
      return verified.context.redirect("/settings");
    }

    if (intent === "select") {
      const selected = form.getAll("accountIds")
        .filter((value): value is string => typeof value === "string");
      await runtime.select({
        installationAuthority: verified.installationAuthority,
        selectedAccountIds: selected,
      });
      return verified.context.redirect("/settings");
    }

    if (intent === "finish_reporting") {
      const reportingAccountId = form.get("reportingAccountId");
      await runtime.finishReporting({
        installationAuthority: verified.installationAuthority,
        reportingAccountId: typeof reportingAccountId === "string"
          ? reportingAccountId
          : "",
      });
      return verified.context.redirect("/settings");
    }

    if (intent === "change_reporting") {
      const reportingAccountId = form.get("reportingAccountId");
      await runtime.changeReporting({
        installationAuthority: verified.installationAuthority,
        reportingAccountId: typeof reportingAccountId === "string"
          ? reportingAccountId
          : "",
      });
      return verified.context.redirect("/settings");
    }

    if (intent === "disconnect") {
      await runtime.disconnect({
        installationAuthority: verified.installationAuthority,
      });
      return verified.context.redirect(
        provider === "meta"
          ? "/settings?meta_status=disconnected"
          : provider === "klaviyo"
            ? "/settings?klaviyo_status=disconnected"
          : "/settings?google_status=disconnected",
      );
    }

    return {
      ok: false,
      provider,
      code: provider === "meta"
        ? "META_SETUP_ACTION_INVALID"
        : provider === "klaviyo"
          ? "KLAVIYO_SETUP_ACTION_INVALID"
        : "GOOGLE_SETUP_ACTION_INVALID",
    } satisfies ActionData;
  } catch (error) {
    if (error instanceof Response) throw error;
    return {ok: false, provider, code: providerCodeOf(provider, error)} satisfies ActionData;
  }
};

function ErrorBanner({provider, code}: {provider: Provider; code: string}) {
  const label = provider === "meta"
    ? "Meta"
    : provider === "klaviyo" ? "Klaviyo" : "Google Ads";
  return (
    <s-banner tone="critical">
      {label} could not be connected. Try again. If the problem continues,
      share error code {code}.
    </s-banner>
  );
}

function Navigation() {
  return (
    <s-section heading="Navigation">
      <s-stack direction="inline" gap="base">
        <s-link href="/">Funnel</s-link>
        <s-link href="/ad-analysis">Ad Analysis</s-link>
        <s-link href="/settings">Settings</s-link>
      </s-stack>
    </s-section>
  );
}

export default function Settings() {
  const state = useLoaderData<typeof loader>();
  const [productOverride, setProductOverride] = useState<{source: LoaderData; value: ProductPermissionStatus} | null>(null);
  const productAccess = productOverride?.source === state ? productOverride.value : state.shopifyProductAccess ?? "unknown";
  const [orderOverride, setOrderOverride] = useState<{source: LoaderData; value: ProductPermissionStatus} | null>(null);
  const orderAccess = orderOverride?.source === state ? orderOverride.value : state.shopifyOrderAccess ?? "unknown";
  const actionData = useActionData<typeof action>() as ActionData;
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [refreshProvider, setRefreshProvider] = useState<Provider | null>(null);
  const initialSpendFetcher = useFetcher<ActionData>();
  const initialSpendInFlight = useRef(false);
  const [initialSpendValue, setInitialSpendValue] = useState("");
  const [initialSpendError, setInitialSpendError] = useState("");
  const [initialSpendUnknown, setInitialSpendUnknown] = useState(false);
  const choices = useRef<any>(null);
  const reportingChoice = useRef<any>(null);
  const accountModal = useRef<any>(null);
  const reportingModal = useRef<any>(null);
  const openedSetupView = useRef<"pending" | "pending_reporting" | null>(null);
  const resumeRequested = useRef(false);
  const googleEvidenceAttempted = useRef(false);
  const [googleEvidenceStatus, setGoogleEvidenceStatus] =
    useState<"idle" | "loading" | "complete" | "failed">("idle");
  const [googleEvidenceResult, setGoogleEvidenceResult] =
    useState<GoogleEvidenceResult | null>(null);
  const [googleEvidenceError, setGoogleEvidenceError] = useState<string | null>(null);
  const klaviyoEvidenceAttempted = useRef(false);
  const [klaviyoEvidenceStatus, setKlaviyoEvidenceStatus] =
    useState<"idle" | "loading" | "complete" | "failed">("idle");
  const [klaviyoEvidenceResult, setKlaviyoEvidenceResult] =
    useState<KlaviyoEvidenceResult | null>(null);
  const [klaviyoEvidenceError, setKlaviyoEvidenceError] = useState<string | null>(null);
  const metaChoices = useRef<any>(null);
  const metaReportingChoice = useRef<any>(null);
  const metaAccountModal = useRef<any>(null);
  const metaReportingModal = useRef<any>(null);
  const openedMetaSetupView = useRef<"pending" | "pending_reporting" | null>(null);
  const metaResumeRequested = useRef(false);
  const metaProbeRunner = useRef<ReturnType<typeof createMetaProbeButtonRunner> | null>(null);
  if (!metaProbeRunner.current) metaProbeRunner.current = createMetaProbeButtonRunner();
  const [metaProbeStatus, setMetaProbeStatus] = useState<"idle" | "loading" | "complete" | "failed">("idle");
  const [metaProbeResult, setMetaProbeResult] = useState<MetaProbeButtonResult | null>(null);
  const klaviyoInitialSpend = useRef<any>(null);
  const klaviyoAccountChoice = useRef<any>(null);
  const klaviyoSetupModal = useRef<any>(null);
  const klaviyoSpendModal = useRef<any>(null);
  const klaviyoAccountTransition = useRef<string | null>(null);
  const klaviyoShowSpend = useRef(false);
  const [klaviyoAccountError, setKlaviyoAccountError] = useState("");
  const openedKlaviyoSetup = useRef(false);
  const klaviyoResumeRequested = useRef(false);
  const [selectedKlaviyoAccountId, setSelectedKlaviyoAccountId] =
    useState<string | null>(null);
  const klaviyoUpdatedSpend = useRef<any>(null);
  const klaviyoCorrectedSpend = useRef<any>(null);
  const klaviyoSpendHistoryChoice = useRef<any>(null);
  const [selectedKlaviyoPeriod, setSelectedKlaviyoPeriod] =
    useState<KlaviyoSpendPeriod | null>(null);
  const pending = navigation.state !== "idle";
  const actionProvider = navigation.formData?.get("provider");
  const revalidating = revalidator.state !== "idle";
  const googleWorking = (revalidating && refreshProvider === "google_ads") || (pending && actionProvider === "google_ads");
  const metaWorking = (revalidating && refreshProvider === "meta") || (pending && actionProvider === "meta");
  const klaviyoWorking = (revalidating && refreshProvider === "klaviyo") || (pending && actionProvider === "klaviyo");
  const initialSpendSaving = initialSpendFetcher.state !== "idle";
  const pendingKlaviyoAccount = state.klaviyo.view === "pending"
    ? klaviyoSetupAccount(state.klaviyo.accounts, selectedKlaviyoAccountId) : null;
  const klaviyoPeriods = state.klaviyo.view === "connected"
    ? state.klaviyo.periods
    : [];

  const refreshConnection = (provider: Provider) => {
    if (revalidator.state !== "idle") return;
    setRefreshProvider(provider);
    revalidator.revalidate();
  };

  useEffect(() => {
    if (!revalidating) setRefreshProvider(null);
  }, [revalidating]);

  useEffect(() => {
    if (initialSpendFetcher.state !== "idle" || !initialSpendInFlight.current) return;
    initialSpendInFlight.current = false;
    const reply = initialSpendFetcher.data;
    if (reply?.ok === false && reply.fieldError) {
      setInitialSpendError(reply.fieldError);
    } else if (state.klaviyo.view === "pending") {
      setInitialSpendUnknown(true);
    }
  }, [initialSpendFetcher.state, initialSpendFetcher.data, state.klaviyo.view]);

  useEffect(() => {
    const url = new URL(globalThis.location.href);
    const hasMetaCallbackState = url.searchParams.has("meta_status")
      || url.searchParams.has("meta_error");
    const hasMetaCallbackFragment = url.hash === "#_=_";
    if (!hasMetaCallbackState && !hasMetaCallbackFragment) return;

    url.searchParams.delete("meta_status");
    url.searchParams.delete("meta_error");
    if (hasMetaCallbackFragment) url.hash = "";
    globalThis.history.replaceState(
      globalThis.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  useEffect(() => {
    const url = new URL(globalThis.location.href);
    const hasKlaviyoCallbackState = url.searchParams.has("klaviyo_status")
      || url.searchParams.has("klaviyo_error");
    if (!hasKlaviyoCallbackState) return;
    url.searchParams.delete("klaviyo_status");
    url.searchParams.delete("klaviyo_error");
    globalThis.history.replaceState(
      globalThis.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  useEffect(() => {
    if (actionData?.ok !== true || actionData.intent !== "begin") return;
    const target = new URL(actionData.authorizationUrl);
    const googleTarget =
      target.origin === "https://accounts.google.com"
      && target.pathname === "/o/oauth2/v2/auth";
    const metaTarget =
      target.origin === "https://www.facebook.com"
      && target.pathname === "/v26.0/dialog/oauth";
    const klaviyoTarget =
      target.origin === "https://www.klaviyo.com"
      && target.pathname === "/oauth/authorize";
    if (googleTarget || metaTarget || klaviyoTarget) {
      globalThis.open(target.toString(), "_top");
    }
  }, [actionData]);

  useEffect(() => {
    const setupView = state.view === "pending" || state.view === "pending_reporting"
      ? state.view
      : null;
    if (!setupView) {
      openedSetupView.current = null;
      resumeRequested.current = false;
      return;
    }
    if (googleWorking) return;
    if (openedSetupView.current === setupView && !resumeRequested.current) return;
    openedSetupView.current = setupView;
    resumeRequested.current = false;
    if (setupView === "pending") accountModal.current?.showOverlay?.();
    else reportingModal.current?.showOverlay?.();
  }, [state.view, googleWorking]);

  useEffect(() => {
    const setupView = state.meta.view === "pending" || state.meta.view === "pending_reporting"
      ? state.meta.view
      : null;
    if (!setupView) {
      openedMetaSetupView.current = null;
      metaResumeRequested.current = false;
      return;
    }
    if (metaWorking) return;
    if (openedMetaSetupView.current === setupView && !metaResumeRequested.current) return;
    openedMetaSetupView.current = setupView;
    metaResumeRequested.current = false;
    if (setupView === "pending") metaAccountModal.current?.showOverlay?.();
    else metaReportingModal.current?.showOverlay?.();
  }, [state.meta.view, metaWorking]);

  useEffect(() => {
    if (state.klaviyo.view !== "pending") {
      openedKlaviyoSetup.current = false;
      klaviyoResumeRequested.current = false;
      setSelectedKlaviyoAccountId(null);
      setInitialSpendValue("");
      setInitialSpendError("");
      setInitialSpendUnknown(false);
      setKlaviyoAccountError("");
      klaviyoAccountTransition.current = null;
      klaviyoShowSpend.current = false;
      return;
    }
    if (klaviyoWorking) return;
    if (openedKlaviyoSetup.current && !klaviyoResumeRequested.current && !klaviyoShowSpend.current) return;
    if (klaviyoResumeRequested.current) setInitialSpendUnknown(false);
    openedKlaviyoSetup.current = true;
    klaviyoResumeRequested.current = false;
    const account = klaviyoSetupAccount(state.klaviyo.accounts, selectedKlaviyoAccountId);
    if (account) {
      setSelectedKlaviyoAccountId(account.id);
    } else {
      setSelectedKlaviyoAccountId(null);
    }
    klaviyoShowSpend.current = false;
    if (account) klaviyoSpendModal.current?.showOverlay?.();
    else klaviyoSetupModal.current?.showOverlay?.();
  }, [state.klaviyo, klaviyoWorking, selectedKlaviyoAccountId]);

  useEffect(() => {
    const element = klaviyoSetupModal.current;
    if (!element || state.klaviyo.view !== "pending") return;
    const accounts = state.klaviyo.accounts;
    const afterHide = (event: Event) => {
      if (event.target !== element) return;
      const id = klaviyoAccountTransition.current;
      klaviyoAccountTransition.current = null;
      if (!id) return; // Cancel/Escape/close never advances the flow.
      const account = klaviyoSetupAccount(accounts, id);
      if (!account) { setKlaviyoAccountError("Select one Klaviyo account to continue."); return; }
      klaviyoShowSpend.current = true;
      setSelectedKlaviyoAccountId(account.id);
    };
    element.addEventListener("afterhide", afterHide);
    return () => element.removeEventListener("afterhide", afterHide);
  }, [state.klaviyo]);

  const permissions = usePermissionSettings({availability: state.permissionAvailability,
    unavailableReasons: state.permissionUnavailableReasons,
    productOwner: state.shopifyPermissionOwner,
    onProductStatus(value) {setProductOverride({source: state, value});},
    onOrderStatus(value) {setOrderOverride({source: state, value});},
    onResume(feature, stage) {
      if (feature === "klaviyo") {
        klaviyoResumeRequested.current = true;
        refreshConnection("klaviyo");
      }
      if ((feature === "google_ads" || feature === "meta") && stage === "reporting_selected") {
        refreshConnection(feature);
      }
      // Re-read the normal reporting view after explicit account selection only.
    },
  });

  const send = (intent: string, provider: Provider = "google_ads") => {
    const form = new FormData();
    form.set("intent", intent);
    form.set("provider", provider);
    submit(form, {method: "post"});
  };

  const resumeAccountSelection = () => {
    resumeRequested.current = true;
    refreshConnection("google_ads");
  };

  const select = () => {
    const form = new FormData();
    form.set("intent", "select");
    form.set("provider", "google_ads");
    for (const id of choices.current?.values ?? []) {
      form.append("accountIds", id);
    }
    submit(form, {method: "post"});
  };

  const saveReporting = (intent: "finish_reporting" | "change_reporting") => {
    const [reportingAccountId] = reportingChoice.current?.values ?? [];
    const form = new FormData();
    form.set("intent", intent);
    form.set("provider", "google_ads");
    if (reportingAccountId) form.set("reportingAccountId", reportingAccountId);
    submit(form, {method: "post"});
  };

  const runMetaProductProbe = async () => {
    const runner = metaProbeRunner.current;
    if (!runner || runner.attempted) return;
    setMetaProbeStatus("loading");
    const result = await runner.run();
    if (!result) return;
    setMetaProbeResult(result);
    setMetaProbeStatus(result.status);
  };

  const runGoogleEvidence = async () => {
    if (googleEvidenceAttempted.current) return;
    googleEvidenceAttempted.current = true;
    setGoogleEvidenceStatus("loading");
    try {
      const response = await fetch("/settings/google-live-evidence", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({provider: "google_ads"}),
      });
      const result = await response.json();
      if (!response.ok || result?.status !== "complete") {
        setGoogleEvidenceError(
          typeof result?.code === "string" && /^[A-Z0-9_]{1,100}$/.test(result.code)
            ? result.code
            : "GOOGLE_LIVE_EVIDENCE_FAILED",
        );
        setGoogleEvidenceStatus("failed");
        return;
      }
      setGoogleEvidenceResult(result as GoogleEvidenceResult);
      setGoogleEvidenceStatus("complete");
    } catch {
      setGoogleEvidenceError("GOOGLE_LIVE_EVIDENCE_REQUEST_FAILED");
      setGoogleEvidenceStatus("failed");
    }
  };

  const runKlaviyoEvidence = async () => {
    if (klaviyoEvidenceAttempted.current) return;
    klaviyoEvidenceAttempted.current = true;
    setKlaviyoEvidenceStatus("loading");
    try {
      const response = await fetch("/settings/klaviyo-live-evidence", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({provider: "klaviyo"}),
      });
      const result = await response.json();
      if (!response.ok || result?.status !== "complete") {
        setKlaviyoEvidenceError(
          typeof result?.code === "string" && /^KLAVIYO_[A-Z0-9_]{1,100}$/.test(result.code)
            ? result.code
            : "KLAVIYO_LIVE_EVIDENCE_FAILED",
        );
        setKlaviyoEvidenceStatus("failed");
        return;
      }
      setKlaviyoEvidenceResult(result as KlaviyoEvidenceResult);
      setKlaviyoEvidenceStatus("complete");
    } catch {
      setKlaviyoEvidenceError("KLAVIYO_LIVE_EVIDENCE_REQUEST_FAILED");
      setKlaviyoEvidenceStatus("failed");
    }
  };

  const resumeMetaAccountSelection = () => {
    metaResumeRequested.current = true;
    refreshConnection("meta");
  };

  const selectMeta = () => {
    const form = new FormData();
    form.set("intent", "select");
    form.set("provider", "meta");
    for (const id of metaChoices.current?.values ?? []) {
      form.append("accountIds", id);
    }
    submit(form, {method: "post"});
  };

  const saveMetaReporting = (intent: "finish_reporting" | "change_reporting") => {
    const [reportingAccountId] = metaReportingChoice.current?.values ?? [];
    const form = new FormData();
    form.set("intent", intent);
    form.set("provider", "meta");
    if (reportingAccountId) form.set("reportingAccountId", reportingAccountId);
    submit(form, {method: "post"});
  };

  const submitKlaviyoSpend = (
    intent: "complete_klaviyo" | "update_klaviyo_spend",
  ) => {
    if (intent === "complete_klaviyo") {
      if (initialSpendInFlight.current || initialSpendSaving || initialSpendUnknown || !pendingKlaviyoAccount) return;
      const error = klaviyoSpendError(initialSpendValue);
      setInitialSpendError(error);
      setInitialSpendUnknown(false);
      if (error) return;
      const form = new FormData();
      form.set("intent", intent);
      form.set("provider", "klaviyo");
      form.set("accountId", pendingKlaviyoAccount.id);
      form.set("estimatedSpend", initialSpendValue);
      initialSpendInFlight.current = true;
      initialSpendFetcher.submit(form, {method: "post"});
      return;
    }
    const input = klaviyoUpdatedSpend.current;
    const form = new FormData();
    form.set("intent", intent);
    form.set("provider", "klaviyo");
    form.set("estimatedSpend", String(input?.value ?? ""));
    submit(form, {method: "post"});
  };

  const resumeKlaviyoSetup = () => {
    klaviyoResumeRequested.current = true;
    refreshConnection("klaviyo");
  };

  const continueKlaviyoSetup = () => {
    if (klaviyoAccountTransition.current || state.klaviyo.view !== "pending") return;
    const ids = klaviyoAccountChoice.current?.values ?? [];
    const account = ids.length === 1 ? klaviyoSetupAccount(state.klaviyo.accounts, ids[0]) : null;
    if (!account) { setKlaviyoAccountError("Select one Klaviyo account to continue."); return; }
    setKlaviyoAccountError("");
    klaviyoAccountTransition.current = account.id;
    try { klaviyoSetupModal.current.hideOverlay(); }
    catch {
      klaviyoAccountTransition.current = null;
      setKlaviyoAccountError("Select one Klaviyo account to continue.");
    }
  };

  const correctKlaviyoSpend = () => {
    const form = new FormData();
    form.set("intent", "change_klaviyo_value");
    form.set("provider", "klaviyo");
    form.set("periodId", selectedKlaviyoPeriod?.id ?? "");
    form.set(
      "correctionVersion",
      String(selectedKlaviyoPeriod?.correctionVersion ?? ""),
    );
    form.set("estimatedSpend", String(klaviyoCorrectedSpend.current?.value ?? ""));
    submit(form, {method: "post"});
  };

  const selectKlaviyoPeriod = (periodId: string) => {
    if (state.klaviyo.view !== "connected") return;
    const period = state.klaviyo.periods.find(
      (candidate) => candidate.id === periodId,
    ) ?? null;
    setSelectedKlaviyoPeriod(period);
    globalThis.queueMicrotask(() => {
      if (klaviyoCorrectedSpend.current) {
        klaviyoCorrectedSpend.current.value = period?.amount ?? "";
      }
    });
  };

  const prepareKlaviyoCorrection = () => {
    const [period] = klaviyoPeriods;
    if (period) selectKlaviyoPeriod(period.id);
  };

  return (
    <s-page heading="Settings">
      <Navigation />
      <s-section heading="Shopify">
        <s-stack direction="block" gap="base">
          {permissions.removingProduct ? <s-banner tone="info" heading="Removing product access…" />
            : permissions.checkingProduct ? <s-banner tone="info" heading="Checking product access…" />
            : productAccess === "ready" ? <s-badge tone="success">Product access approved</s-badge>
            : productAccess === "unknown" ? <s-banner tone="critical" heading={permissions.productRemovalResult === "unknown" ? "Could not verify that product access was removed. Check status to continue." : "Could not verify product access. Check status to continue."} />
            : productAccess === "missing" && permissions.productRemovalResult === "removed" ? <s-banner tone="success" heading="Product access removed." />
            : <s-paragraph>{productAccess === "missing" ? "Product access is not connected." : "Product connection is currently unavailable."}</s-paragraph>}
          <ProductAccessRemoval owner={state.shopifyPermissionOwner} ready={productAccess === "ready"} busy={permissions.busy}
            onConfirm={() => {void permissions.removeProductAccess();}} onUnknown={permissions.productRemovalUnknown} />
          {productAccess === "missing" || productAccess === "unavailable" ?
            <s-button disabled={permissions.busy ? true : undefined} onClick={() => permissions.open("shopify_products")}>Connect Shopify products</s-button> : null}
          {productAccess === "unknown" ? <s-button disabled={permissions.busy ? true : undefined} onClick={() => permissions.checkStatus("shopify_products")}>Check status</s-button> : null}
          {permissions.removingOrder ? <s-banner tone="info" heading="Removing order access…" />
            : permissions.checkingOrder ? <s-banner tone="info" heading="Checking order access…" />
            : orderAccess === "ready" ? <s-badge tone="success">Order access approved</s-badge>
            : orderAccess === "unknown" ? <s-banner tone="critical" heading={permissions.orderRemovalResult === "unknown" ? "Could not verify that order access was removed. Check status to continue." : "Could not verify order access. Check status to continue."} />
            : orderAccess === "missing" && permissions.orderRemovalResult === "removed" ? <s-banner tone="success" heading="Order access removed." />
            : <s-paragraph>{orderAccess === "missing" ? "Order access is not connected." : "Order connection is currently unavailable."}</s-paragraph>}
          <OrderAccessRemoval owner={state.shopifyPermissionOwner} ready={orderAccess === "ready"} busy={permissions.busy}
            onConfirm={() => {void permissions.removeOrderAccess();}} onUnknown={permissions.orderRemovalUnknown} />
          {orderAccess === "missing" || orderAccess === "unavailable" ? <>
            {productAccess !== "ready" ? <s-paragraph>Product access is required to connect orders.</s-paragraph> : null}
            <s-button disabled={permissions.busy || productAccess !== "ready" ? true : undefined} onClick={() => permissions.open("shopify_orders")}>Connect Shopify orders</s-button>
          </> : null}
          {orderAccess === "unknown" ? <s-button disabled={permissions.busy ? true : undefined} onClick={() => permissions.checkStatus("shopify_orders")}>Check status</s-button> : null}
        </s-stack>
      </s-section>
      {permissions.content}
      <s-section heading="Meta">
        <s-stack direction="block" gap="base">
          {permissions.providerContent("meta")}
          {state.meta.view === "combined" ? <>
            <s-badge tone="warning">Resume setup</s-badge>
            <s-button onClick={() => permissions.checkStatus("meta", true)}>Resume setup</s-button>
            <s-button onClick={() => permissions.open("meta")}>Reconnect Meta</s-button>
          </> : null}
          {actionData?.ok === false && actionData.provider === "meta"
            ? <ErrorBanner provider="meta" code={actionData.code} />
            : null}

          {metaWorking ? (
            <>
              <s-badge tone="info">Working</s-badge>
              <s-paragraph>Meta setup is being updated…</s-paragraph>
            </>
          ) : null}

          {!metaWorking && state.meta.view === "error" ? (
            <>
              <ErrorBanner provider="meta" code={state.meta.code} />
              <s-button
                variant="primary"
                onClick={() => {
                  permissions.checkStatus("meta");
                }}
              >
                Check status
              </s-button>
            </>
          ) : null}

          {!metaWorking && state.meta.view === "reauthorization" ? (
            <>
              <s-badge tone="warning">Reauthorization required</s-badge>
              <s-paragraph>
                Meta authorization is no longer valid. Reconnect to continue.
              </s-paragraph>
              <s-button variant="primary" onClick={() => permissions.open("meta")}>
                Reconnect Meta
              </s-button>
            </>
          ) : null}

          {!metaWorking && state.meta.view === "disconnected" ? (
            <>
              <s-badge>Not connected</s-badge>
              {state.meta.notice === "cancelled" ? (
                <s-banner tone="warning">
                  Setup was not completed. Review the connection status before continuing.
                </s-banner>
              ) : null}
              {state.meta.notice === "disconnected" ? (
                <s-banner tone="success">Meta was disconnected.</s-banner>
              ) : null}
              <s-paragraph>
                Connect Meta, then select one to three advertiser accounts.
              </s-paragraph>
              <s-button
                variant="primary"
                onClick={() => permissions.open("meta")}
              >
                Connect Meta
              </s-button>
            </>
          ) : null}

          {!metaWorking && state.meta.view === "pending" ? (
            <>
              <s-badge tone="info">Select accounts</s-badge>
              <s-paragraph>
                Meta authorization is complete. Select one to three advertiser
                accounts to finish setup.
              </s-paragraph>
              <s-button variant="primary" onClick={resumeMetaAccountSelection}>
                Resume setup
              </s-button>
              <s-modal
                ref={metaAccountModal}
                id="meta-account-modal"
                heading="Meta advertiser accounts"
              >
                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Choose between one and three advertiser accounts.
                  </s-paragraph>
                  <s-choice-list
                    ref={metaChoices}
                    label="Advertiser accounts"
                    name="accountIds"
                    multiple
                  >
                    {state.meta.accounts.map((account) => (
                      <s-choice key={account.id} value={account.id}>
                        {account.name} ({account.id})
                      </s-choice>
                    ))}
                  </s-choice-list>
                </s-stack>
                <s-button slot="primary-action" variant="primary" onClick={selectMeta}>
                  Save and connect
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="meta-account-modal"
                  command="--hide"
                >
                  Cancel
                </s-button>
              </s-modal>
            </>
          ) : null}

          {!metaWorking && state.meta.view === "pending_reporting" ? (
            <>
              <s-badge tone="info">Choose Reporting Account</s-badge>
              <s-paragraph>
                Choose the single connected advertiser account AdsTable will use
                in reporting.
              </s-paragraph>
              <s-button variant="primary" onClick={resumeMetaAccountSelection}>
                Resume setup
              </s-button>
              <s-modal
                ref={metaReportingModal}
                id="meta-reporting-modal"
                heading="Meta Reporting Account"
              >
                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Select exactly one account from the connected account set.
                  </s-paragraph>
                  <s-choice-list
                    ref={metaReportingChoice}
                    label="Reporting Account"
                    name="reportingAccountId"
                  >
                    {state.meta.accounts.map((account) => (
                      <s-choice key={account.id} value={account.id}>
                        {account.name} ({account.id})
                      </s-choice>
                    ))}
                  </s-choice-list>
                </s-stack>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  onClick={() => saveMetaReporting("finish_reporting")}
                >
                  Save and finish
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="meta-reporting-modal"
                  command="--hide"
                >
                  Cancel
                </s-button>
              </s-modal>
            </>
          ) : null}

          {!metaWorking && state.meta.view === "connected" ? (
            <>
              <s-badge tone="success">Connected</s-badge>
              <s-paragraph>
                {state.meta.accounts.length} Meta advertiser account(s) connected.
              </s-paragraph>
              <s-paragraph>
                Reporting Account: {reportingAccountName(state.meta)}
              </s-paragraph>
              <s-stack direction="block" gap="small">
                {state.meta.accounts.map((account) => (
                  <s-paragraph key={account.id}>
                    {account.name} ({account.id})
                  </s-paragraph>
                ))}
              </s-stack>
              <s-button
                variant="secondary"
                loading={metaProbeStatus === "loading"}
                disabled={metaProbeStatus !== "idle"}
                onClick={runMetaProductProbe}
              >
                {metaProbeStatus === "loading"
                  ? "Reading Meta product evidence…"
                  : metaProbeStatus === "complete"
                    ? "Meta product evidence received"
                    : metaProbeStatus === "failed"
                      ? "Meta product test stopped"
                      : "Run Meta product test (2026-10-01)"}
              </s-button>
              {metaProbeResult?.status === "complete" ? (
                <s-paragraph>
                  Meta product evidence received for 2026-10-01.
                  {" Channel rows: "}{metaProbeResult.channelRows}
                  {"; product rows: "}{metaProbeResult.productRows}
                  {". No Dataset write was performed."}
                  {metaProbeResult.productRows === 0
                    ? " Meta returned no product rows. This is not evidence of zero sales or global lack of support."
                    : " Product semantics remain pending review."}
                </s-paragraph>
              ) : null}
              {metaProbeResult?.status === "failed" ? (
                <s-paragraph>
                  Meta product test stopped. No retry was performed. Error code: {metaProbeResult.code}.
                </s-paragraph>
              ) : null}
              <s-button commandFor="meta-reporting-modal" command="--show">
                Reporting Account
              </s-button>
              <s-button
                tone="critical"
                commandFor="meta-disconnect-modal"
                command="--show"
              >
                Disconnect
              </s-button>
              <s-modal
                ref={metaReportingModal}
                id="meta-reporting-modal"
                heading="Meta Reporting Account"
              >
                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Choose the single connected account AdsTable will show in
                    reporting. Meta OAuth will not restart.
                  </s-paragraph>
                  <s-choice-list
                    ref={metaReportingChoice}
                    label="Reporting Account"
                    name="reportingAccountId"
                  >
                    {state.meta.accounts.map((account) => (
                      <s-choice key={account.id} value={account.id}>
                        {account.name} ({account.id})
                      </s-choice>
                    ))}
                  </s-choice-list>
                </s-stack>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  onClick={() => saveMetaReporting("change_reporting")}
                >
                  Save Reporting Account
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="meta-reporting-modal"
                  command="--hide"
                >
                  Cancel
                </s-button>
              </s-modal>
              <s-modal id="meta-disconnect-modal" heading="Disconnect Meta?">
                <s-paragraph>
                  AdsTable will revoke Meta authorization and remove Meta
                  reporting authority, selected accounts and the encrypted
                  credential. Historical data remains.
                </s-paragraph>
                <s-button
                  slot="primary-action"
                  tone="critical"
                  onClick={() => send("disconnect", "meta")}
                >
                  Disconnect Meta
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="meta-disconnect-modal"
                  command="--hide"
                >
                  Keep connected
                </s-button>
              </s-modal>
            </>
          ) : null}
        </s-stack>


      </s-section>
      <s-section heading="Google Ads">
        <s-stack direction="block" gap="base">
          {permissions.providerContent("google_ads")}
          {!googleWorking && state.view === "permissions_incomplete" ? <>
            <s-banner tone="warning" heading="Google setup is incomplete">
              <s-paragraph>Both Google Ads and Merchant Center access are required. Resume setup and allow both permissions to finish connecting.</s-paragraph>
            </s-banner>
            <s-button disabled={permissions.busy || state.permissionAvailability.google_ads !== true ? true : undefined}
              onClick={() => permissions.open("google_ads")}>Resume setup</s-button>
          </> : null}
          {state.view === "combined" ? <>
            <s-badge tone="warning">Resume setup</s-badge>
            <s-button onClick={() => permissions.checkStatus("google_ads", true)}>Resume setup</s-button>
            <s-button onClick={() => permissions.open("google_ads")}>Reconnect Google Ads</s-button>
          </> : null}
          {actionData?.ok === false && actionData.provider === "google_ads"
            ? <ErrorBanner provider="google_ads" code={actionData.code} />
            : null}

          {googleWorking ? (
            <>
              <s-badge tone="info">Working</s-badge>
              <s-paragraph>Google Ads setup is being updated…</s-paragraph>
            </>
          ) : null}

          {!googleWorking && state.view === "error" ? (
            <>
              <ErrorBanner provider="google_ads" code={state.code} />
              <s-button
                variant="primary"
                onClick={() => {
                  permissions.checkStatus("google_ads");
                }}
              >
                Check status
              </s-button>
            </>
          ) : null}

          {!googleWorking && state.view === "reauthorization" ? (
            <>
              <s-badge tone="warning">Reauthorization required</s-badge>
              <s-paragraph>
                Google authorization is no longer valid. Reconnect to continue.
              </s-paragraph>
              <s-button variant="primary" onClick={() => permissions.open("google_ads")}>
                Reconnect Google Ads
              </s-button>
            </>
          ) : null}

          {!googleWorking && state.view === "disconnected" ? (
            <>
              <s-badge>Not connected</s-badge>
              {state.notice === "cancelled" ? (
                <s-banner tone="warning">
                  Setup was not completed. Review the connection status before continuing.
                </s-banner>
              ) : null}
              {state.notice === "disconnected" ? (
                <s-banner tone="success">Google Ads was disconnected.</s-banner>
              ) : null}
              <s-paragraph>
                Connect Google Ads, then select one to three advertiser accounts.
                Manager accounts are never selectable.
              </s-paragraph>
              <s-button
                variant="primary"
                onClick={() => permissions.open("google_ads")}
              >
                Connect Google Ads
              </s-button>
            </>
          ) : null}

          {!googleWorking && state.view === "pending" ? (
            <>
              <s-badge tone="info">Select accounts</s-badge>
              <s-paragraph>
                Google authorization is complete. Select one to three advertiser
                accounts to finish setup.
              </s-paragraph>
              <s-button variant="primary" onClick={resumeAccountSelection}>
                Resume setup
              </s-button>
              <s-modal
                ref={accountModal}
                id="google-account-modal"
                heading="Google Ads accounts"
              >
                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Choose between one and three advertiser accounts.
                  </s-paragraph>
                  <s-choice-list
                    ref={choices}
                    label="Advertiser accounts"
                    name="accountIds"
                    multiple
                  >
                    {state.accounts.map((account) => (
                      <s-choice key={account.id} value={account.id}>
                        {account.name} ({account.id})
                      </s-choice>
                    ))}
                  </s-choice-list>
                </s-stack>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  onClick={select}
                >
                  Save and connect
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="google-account-modal"
                  command="--hide"
                >
                  Cancel
                </s-button>
              </s-modal>
            </>
          ) : null}

          {!googleWorking && state.view === "pending_reporting" ? (
            <>
              <s-badge tone="info">Choose Reporting Account</s-badge>
              <s-paragraph>
                Choose the single connected advertiser account AdsTable will use
                in reporting.
              </s-paragraph>
              <s-button variant="primary" onClick={resumeAccountSelection}>
                Resume setup
              </s-button>
              <s-modal
                ref={reportingModal}
                id="google-reporting-modal"
                heading="Google Ads Reporting Account"
              >
                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Select exactly one account from the connected account set.
                  </s-paragraph>
                  <s-choice-list
                    ref={reportingChoice}
                    label="Reporting Account"
                    name="reportingAccountId"
                  >
                    {state.accounts.map((account) => (
                      <s-choice key={account.id} value={account.id}>
                        {account.name} ({account.id})
                      </s-choice>
                    ))}
                  </s-choice-list>
                </s-stack>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  onClick={() => saveReporting("finish_reporting")}
                >
                  Save and finish
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="google-reporting-modal"
                  command="--hide"
                >
                  Cancel
                </s-button>
              </s-modal>
            </>
          ) : null}

          {!googleWorking && state.view === "connected" ? (
            <>
              <s-badge tone="success">Connected</s-badge>
              <s-paragraph>
                {state.accounts.length} Google Ads advertiser account(s) connected.
              </s-paragraph>
              <s-paragraph>
                Reporting Account: {state.accounts.find(
                  (account) => account.id === state.reportingAccountId,
                )?.name ?? state.reportingAccountId}
              </s-paragraph>
              <s-stack direction="block" gap="small">
                {state.accounts.map((account) => (
                  <s-paragraph key={account.id}>
                    {account.name} ({account.id})
                  </s-paragraph>
                ))}
              </s-stack>
              <s-button
                loading={googleEvidenceStatus === "loading"}
                disabled={googleEvidenceStatus === "complete" || googleEvidenceStatus === "failed"}
                onClick={runGoogleEvidence}
              >
                {googleEvidenceStatus === "loading"
                  ? "Reading Google evidence…"
                  : googleEvidenceStatus === "complete"
                    ? googleEvidenceResult?.account.account_type_state === "test_observed"
                      ? "Google test account checked"
                      : "Google evidence received"
                    : googleEvidenceStatus === "failed"
                      ? "Google evidence stopped"
                      : "Run Google evidence"}
              </s-button>
              {googleEvidenceStatus === "complete" && googleEvidenceResult ? (
                googleEvidenceResult.account.account_type_state === "test_observed" ? (
                  <s-banner tone="info">
                    Google test account verified. Read-only reporting queries completed:
                    {" campaign context "}{googleEvidenceResult.account.campaign_context_row_count}
                    {" rows; Cart Data "}{googleEvidenceResult.cart_data_sales.row_count}
                    {" rows; product performance "}{googleEvidenceResult.product_performance.row_count}
                    {" rows; current listing tree "}{googleEvidenceResult.current_listing_tree.row_count}
                    {" rows; PMax Asset Group performance "}
                    {googleEvidenceResult.pmax_asset_group_performance.row_count}
                    {" rows. Test accounts do not serve ads, so these results are not production performance evidence. Production validation remains pending Google Ads API Explorer access."}
                  </s-banner>
                ) : googleEvidenceResult.observation_state === "present" ? (
                  <s-banner tone="success">
                    Google evidence received. Cart Data: {googleEvidenceResult.cart_data_sales.row_count}
                    {" rows; product performance: "}{googleEvidenceResult.product_performance.row_count}
                    {" rows; current listing tree: "}{googleEvidenceResult.current_listing_tree.row_count}
                    {" rows; PMax Asset Group performance: "}
                    {googleEvidenceResult.pmax_asset_group_performance.row_count}{" rows. Sales Role: Advertised "}
                    {googleEvidenceResult.cart_data_sales.sales_role_counts.Advertised}
                    {", Cross-sell "}{googleEvidenceResult.cart_data_sales.sales_role_counts["Cross-sell"]}
                    {", Assisted "}{googleEvidenceResult.cart_data_sales.sales_role_counts.Assisted}
                    {", Unclassified "}{googleEvidenceResult.cart_data_sales.sales_role_counts.Unclassified}
                    {". Historical PMax Channel was not resolved from the current listing tree."}
                  </s-banner>
                ) : (
                  <s-banner tone="warning">
                    Google returned no product or PMax evidence in this execution.
                    This is not zero or unsupported.
                  </s-banner>
                )
              ) : null}
              {googleEvidenceStatus === "failed" ? (
                <s-banner tone="critical">
                  Google evidence stopped. No retry was performed. Error code: {googleEvidenceError}.
                </s-banner>
              ) : null}
              <s-button
                commandFor="google-reporting-modal"
                command="--show"
              >
                Reporting Account
              </s-button>
              <s-button
                tone="critical"
                commandFor="google-disconnect-modal"
                command="--show"
              >
                Disconnect
              </s-button>
              <s-modal
                ref={reportingModal}
                id="google-reporting-modal"
                heading="Google Ads Reporting Account"
              >
                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Choose the single connected account AdsTable will show in
                    reporting. Google OAuth will not restart.
                  </s-paragraph>
                  <s-choice-list
                    ref={reportingChoice}
                    label="Reporting Account"
                    name="reportingAccountId"
                  >
                    {state.accounts.map((account) => (
                      <s-choice key={account.id} value={account.id}>
                        {account.name} ({account.id})
                      </s-choice>
                    ))}
                  </s-choice-list>
                </s-stack>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  onClick={() => saveReporting("change_reporting")}
                >
                  Save Reporting Account
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="google-reporting-modal"
                  command="--hide"
                >
                  Cancel
                </s-button>
              </s-modal>
              <s-modal id="google-disconnect-modal" heading="Disconnect Google Ads?">
                <s-paragraph>
                  AdsTable will remove Google reporting authority, selected
                  accounts and the encrypted credential. Historical data remains.
                </s-paragraph>
                <s-button
                  slot="primary-action"
                  tone="critical"
                  onClick={() => send("disconnect")}
                >
                  Disconnect Google Ads
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="google-disconnect-modal"
                  command="--hide"
                >
                  Keep connected
                </s-button>
              </s-modal>
            </>
          ) : null}
        </s-stack>


      </s-section>
      <s-section heading="Klaviyo">
        <s-stack direction="block" gap="base">
          {permissions.providerContent("klaviyo")}
          {actionData?.ok === false && actionData.provider === "klaviyo"
            ? <ErrorBanner provider="klaviyo" code={actionData.code} />
            : null}

          {klaviyoWorking ? (
            <>
              <s-badge tone="info">Working</s-badge>
              <s-paragraph>Klaviyo setup is being updated…</s-paragraph>
            </>
          ) : null}

          {!klaviyoWorking && state.klaviyo.view === "error" ? (
            <>
              <ErrorBanner provider="klaviyo" code={state.klaviyo.code} />
              <s-button
                variant="primary"
                onClick={() => {
                  permissions.checkStatus("klaviyo");
                }}
              >
                Check status
              </s-button>
            </>
          ) : null}

          {!klaviyoWorking && state.klaviyo.view === "reauthorization" ? (
            <>
              <s-badge tone="warning">Reauthorization required</s-badge>
              <s-paragraph>
                Klaviyo authorization is no longer valid. Reconnect to continue.
              </s-paragraph>
              <s-button variant="primary" onClick={() => permissions.open("klaviyo")}>
                Reconnect Klaviyo
              </s-button>
            </>
          ) : null}

          {!klaviyoWorking && state.klaviyo.view === "disconnected" ? (
            <>
              <s-badge>Not connected</s-badge>
              {state.klaviyo.notice === "cancelled" ? (
                <s-banner tone="warning">
                  Setup was not completed. Review the connection status before continuing.
                </s-banner>
              ) : null}
              {state.klaviyo.notice === "disconnected" ? (
                <s-banner tone="success">Klaviyo was disconnected.</s-banner>
              ) : null}
              <s-paragraph>
                Connect one Klaviyo account and enter its estimated 30-day
                email spend.
              </s-paragraph>
              <s-button
                variant="primary"
                onClick={() => permissions.open("klaviyo")}
              >
                Connect Klaviyo
              </s-button>
            </>
          ) : null}

          {state.klaviyo.view === "pending" ? (
            <>
              <s-badge tone="info">{pendingKlaviyoAccount ? "Estimated spend required" : "Account selection required"}</s-badge>
              <s-paragraph>
                {pendingKlaviyoAccount
                  ? "Add the estimated 30-day email spend to finish setup. Enter 0 if there is no cost."
                  : "Klaviyo authorization is complete. Select the account, then add its estimated 30-day email spend to finish setup."}
              </s-paragraph>
              <s-button variant="primary" disabled={klaviyoWorking || initialSpendSaving} onClick={resumeKlaviyoSetup}>
                Resume setup
              </s-button>
              <s-modal
                ref={klaviyoSetupModal}
                id="klaviyo-setup-modal"
                heading="Select Klaviyo account"
              >
                  <s-stack direction="block" gap="base">
                    <s-paragraph>
                      Select the Klaviyo account to connect.
                    </s-paragraph>
                    <s-choice-list
                      ref={klaviyoAccountChoice}
                      error={klaviyoAccountError}
                      label="Klaviyo accounts"
                      name="klaviyoAccountId"
                    >
                      {state.klaviyo.accounts.map((account) => (
                        <s-choice key={account.id} value={account.id}>
                          {account.name} ({account.id})
                        </s-choice>
                      ))}
                    </s-choice-list>
                  </s-stack>
                <s-button slot="primary-action" variant="primary" onClick={continueKlaviyoSetup}>
                  Continue
                </s-button>
                <s-button slot="secondary-actions" commandFor="klaviyo-setup-modal" command="--hide">
                  Cancel
                </s-button>
              </s-modal>
              <s-modal
                ref={klaviyoSpendModal}
                id="klaviyo-initial-spend-modal"
                heading="Add estimated email spend"
              >
                {(() => {
                  const account = state.klaviyo.accounts.find(
                    (candidate) => candidate.id === selectedKlaviyoAccountId,
                  );
                  return account ? (
                    <s-stack direction="block" gap="base">
                      <s-paragraph>
                        Account: {account.name} ({account.id})
                      </s-paragraph>
                      <s-paragraph>
                        Currency: {account.currency} · Timezone: {account.timezone}
                      </s-paragraph>
                      <s-number-field
                        ref={klaviyoInitialSpend}
                        value={initialSpendValue}
                        error={initialSpendError}
                        disabled={initialSpendSaving}
                        onInput={(event) => {
                          setInitialSpendValue(event.currentTarget.value);
                          setInitialSpendError("");
                        }}
                        label="Estimated 30-day Klaviyo email spend"
                        min={0}
                        max={99999999.99}
                        step={0.01}
                        suffix={account.currency}
                        required
                      />
                    </s-stack>
                  ) : null;
                })()}
                {initialSpendUnknown ? (
                  <s-banner tone="critical">
                    The save could not be confirmed. Check the connection status before continuing.
                    <s-button disabled={klaviyoWorking} onClick={resumeKlaviyoSetup}>
                      Check status
                    </s-button>
                  </s-banner>
                ) : null}
                  <s-button
                    slot="primary-action"
                    variant="primary"
                    loading={initialSpendSaving}
                    disabled={initialSpendUnknown || !pendingKlaviyoAccount}
                    onClick={() => submitKlaviyoSpend("complete_klaviyo")}
                  >
                    Save and connect
                  </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="klaviyo-initial-spend-modal"
                  command="--hide"
                  disabled={initialSpendSaving}
                >
                  Cancel
                </s-button>
              </s-modal>
            </>
          ) : null}

          {!klaviyoWorking && state.klaviyo.view === "connected" ? (
            <>
              <s-badge tone="success">Connected</s-badge>
              <s-paragraph>
                {state.klaviyo.account.name} ({state.klaviyo.account.id})
              </s-paragraph>
              <s-paragraph>
                Current estimated 30-day email spend: {state.klaviyo.current.amount}
                {" "}{state.klaviyo.current.currency} · Effective {state.klaviyo.current.effectiveFrom}
              </s-paragraph>
              <s-paragraph>
                Currency: {state.klaviyo.account.currency} · Timezone: {state.klaviyo.account.timezone}
              </s-paragraph>
              <s-button
                loading={klaviyoEvidenceStatus === "loading"}
                disabled={klaviyoEvidenceStatus === "complete" || klaviyoEvidenceStatus === "failed"}
                onClick={runKlaviyoEvidence}
              >
                {klaviyoEvidenceStatus === "loading"
                  ? "Reading Klaviyo evidence…"
                  : klaviyoEvidenceStatus === "complete"
                    ? "Klaviyo evidence received"
                    : klaviyoEvidenceStatus === "failed"
                      ? "Klaviyo evidence stopped"
                      : "Run Klaviyo evidence"}
              </s-button>
              {klaviyoEvidenceStatus === "complete" && klaviyoEvidenceResult ? (
                klaviyoEvidenceResult.observation_state === "present" ? (
                  <s-banner tone="success">
                    Klaviyo evidence received for {klaviyoEvidenceResult.business_date}.
                    {" Campaign Message "}{klaviyoEvidenceResult.campaign_messages.row_count}
                    {" rows; Flow Message "}{klaviyoEvidenceResult.flow_messages.row_count}
                    {" rows; Ordered Product "}{klaviyoEvidenceResult.ordered_product_events.row_count}
                    {" rows; resolved product sales "}{klaviyoEvidenceResult.resolved_product_sales.row_count}
                    {" rows; exact Channel "}
                    {klaviyoEvidenceResult.resolved_product_sales.channel_resolution_counts.exact}
                    {"; Unclassified Channel "}
                    {klaviyoEvidenceResult.resolved_product_sales.channel_resolution_counts.unclassified}
                    {". No raw rows, profiles, identifiers or commercial values were retained."}
                  </s-banner>
                ) : (
                  <s-banner tone="warning">
                    Klaviyo completed the read-only evidence run but returned no Campaign,
                    Flow or Ordered Product rows for {klaviyoEvidenceResult.business_date}.
                    This is not zero or unsupported.
                  </s-banner>
                )
              ) : null}
              {klaviyoEvidenceStatus === "failed" ? (
                <s-banner tone="critical">
                  Klaviyo evidence stopped. No retry was performed. Error code: {klaviyoEvidenceError}.
                </s-banner>
              ) : null}
              <s-stack direction="inline" gap="base">
                <s-button
                  variant="secondary"
                  tone="critical"
                  commandFor="klaviyo-disconnect-modal"
                  command="--show"
                >
                  Disconnect
                </s-button>
                <s-button
                  variant="secondary"
                  commandFor="klaviyo-update-spend-modal"
                  command="--show"
                >
                  Update spend
                </s-button>
                <s-button
                  variant="secondary"
                  commandFor="klaviyo-change-value-modal"
                  command="--show"
                  onClick={prepareKlaviyoCorrection}
                  disabled={klaviyoPeriods.length === 0}
                >
                  Change value
                </s-button>
              </s-stack>

              <s-modal
                id="klaviyo-update-spend-modal"
                heading="Update Klaviyo email spend"
                size="small-100"
              >
                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Enter the new estimated Klaviyo email cost for the next 30-day
                    period starting today. SMS costs are not included.
                  </s-paragraph>
                  <s-number-field
                    ref={klaviyoUpdatedSpend}
                    label="Estimated 30-Day Klaviyo Email Spend"
                    min={0}
                    max={99999999.99}
                    step={0.01}
                    required
                  />
                </s-stack>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  onClick={() => submitKlaviyoSpend("update_klaviyo_spend")}
                >
                  Save new value
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="klaviyo-update-spend-modal"
                  command="--hide"
                >
                  Cancel
                </s-button>
              </s-modal>

              <s-modal
                id="klaviyo-change-value-modal"
                heading="Change Klaviyo email spend"
                size="small-100"
              >
                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Change a previously saved amount. Its original start date will
                    not change.
                  </s-paragraph>
                  <s-select
                    ref={klaviyoSpendHistoryChoice}
                    label="Saved period"
                    value={selectedKlaviyoPeriod?.id ?? ""}
                    onChange={(event: any) => selectKlaviyoPeriod(event.currentTarget.value)}
                  >
                    {klaviyoPeriods.map((period, index) => {
                      const sameDateWasSuperseded = klaviyoPeriods
                        .slice(0, index)
                        .some((candidate) => candidate.effectiveFrom === period.effectiveFrom);
                      const nextPeriod = klaviyoPeriods
                        .slice(0, index)
                        .find((candidate) => candidate.effectiveFrom > period.effectiveFrom) ?? null;
                      const effectiveTo = nextPeriod
                        ? new Date(`${nextPeriod.effectiveFrom}T00:00:00.000Z`)
                        : null;
                      if (effectiveTo) effectiveTo.setUTCDate(effectiveTo.getUTCDate() - 1);
                      return (
                        <s-option key={period.id} value={period.id}>
                          {period.effectiveFrom} / {sameDateWasSuperseded
                            ? "Superseded same day"
                            : effectiveTo
                            ? effectiveTo.toISOString().slice(0, 10)
                            : "Present"} · {period.amount} {period.currency}
                        </s-option>
                      );
                    })}
                  </s-select>
                  <s-number-field
                    ref={klaviyoCorrectedSpend}
                    label="Updated 30-Day Klaviyo Email Spend"
                    min={0}
                    max={99999999.99}
                    step={0.01}
                    required
                  />
                </s-stack>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  onClick={correctKlaviyoSpend}
                  disabled={!selectedKlaviyoPeriod}
                >
                  Save change
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="klaviyo-change-value-modal"
                  command="--hide"
                >
                  Cancel
                </s-button>
              </s-modal>

              <s-modal id="klaviyo-disconnect-modal" heading="Disconnect Klaviyo?">
                <s-paragraph>
                  AdsTable will revoke Klaviyo authorization and remove the
                  encrypted credential. Historical spend periods remain.
                </s-paragraph>
                <s-button
                  slot="primary-action"
                  tone="critical"
                  onClick={() => send("disconnect", "klaviyo")}
                >
                  Disconnect Klaviyo
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="klaviyo-disconnect-modal"
                  command="--hide"
                >
                  Keep connected
                </s-button>
              </s-modal>
            </>
          ) : null}
        </s-stack>


      </s-section>
    </s-page>
  );
}

