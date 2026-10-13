import type {ActionFunctionArgs, LoaderFunctionArgs} from "react-router";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSubmit,
} from "react-router";
import {useEffect, useRef, useState} from "react";
import {
  authenticate,
  database,
  providerTokenVault,
} from "../shopify.server";
import {
  resolveShopifyRouteAuthority,
} from "../lib/shopify/shopify-route-authority.server.js";
import {createGoogleOAuthRuntime} from "../lib/oauth/google-oauth-runtime.server.js";
import {createMetaOAuthRuntime} from "../lib/oauth/meta-oauth-runtime.server.js";
import {createKlaviyoOAuthRuntime} from "../lib/oauth/klaviyo-oauth-runtime.server.js";
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
  | {view: "disconnected"; notice: "cancelled" | "disconnected" | null}
  | {view: "pending"; accounts: Advertiser[]}
  | {view: "pending_reporting"; accounts: Advertiser[]}
  | {view: "connected"; accounts: Advertiser[]; reportingAccountId: string}
  | {view: "reauthorization"}
  | {view: "error"; code: string; retry: "oauth" | "reload"};

type ActionData =
  | {ok: true; intent: "begin"; provider: Provider; authorizationUrl: string}
  | {ok: false; provider: Provider; code: string}
  | undefined;

type Provider = "google_ads" | "meta" | "klaviyo";

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

type LoaderData = State & {meta: State; klaviyo: KlaviyoState};

function providerCodeOf(provider: Provider, error: unknown) {
  const prefix = provider === "meta"
    ? "META"
    : provider === "klaviyo" ? "KLAVIYO" : "GOOGLE_ADS";
  const source = error && typeof error === "object"
    ? error as {code?: unknown; details?: Record<string, unknown>}
    : null;
  const providerCode = source?.details?.provider_error_code;
  if (
    typeof providerCode === "string"
    && /^[A-Z0-9_]{1,80}$/.test(providerCode)
  ) return prefix + "_PROVIDER_" + providerCode;
  const status = source?.details?.provider_status;
  if (status === "invalid_grant") return prefix + "_REAUTHORIZATION_REQUIRED";
  const candidate = source?.code ?? (error instanceof Error ? error.message : "");
  return typeof candidate === "string" && /^[A-Z0-9_]{1,80}$/.test(candidate)
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

async function loadGoogleState(
  verified: Awaited<ReturnType<typeof routeAuthority>>,
  url: URL,
): Promise<State> {
  const runtime = createGoogleOAuthRuntime({
    database,
    tokenVault: providerTokenVault,
  });
  try {
    const inspected = await runtime.inspect({
      installationAuthority: verified.installationAuthority,
    });
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
    });
    const inspected = await runtime.inspect({
      installationAuthority: verified.installationAuthority,
    });
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
  const [google, meta, klaviyo] = await Promise.all([
    loadGoogleState(verified, url),
    loadMetaState(verified, url),
    loadKlaviyoState(verified, url),
  ]);
  return {...google, meta, klaviyo};
};

export const action = async ({request}: ActionFunctionArgs) => {
  const verified = await routeAuthority(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const providerValue = form.get("provider");
  const provider: Provider = providerValue === "meta" || providerValue === "klaviyo"
    ? providerValue
    : "google_ads";

  try {
    const runtime = provider === "meta"
      ? createMetaOAuthRuntime({database, tokenVault: providerTokenVault})
      : provider === "klaviyo"
        ? createKlaviyoOAuthRuntime({database, tokenVault: providerTokenVault})
        : createGoogleOAuthRuntime({database, tokenVault: providerTokenVault});
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
        effectiveFrom: String(form.get("effectiveFrom") ?? ""),
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
  const actionData = useActionData<typeof action>() as ActionData;
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const choices = useRef<any>(null);
  const reportingChoice = useRef<any>(null);
  const accountModal = useRef<any>(null);
  const reportingModal = useRef<any>(null);
  const openedSetupView = useRef<"pending" | "pending_reporting" | null>(null);
  const resumeRequested = useRef(false);
  const metaChoices = useRef<any>(null);
  const metaReportingChoice = useRef<any>(null);
  const metaAccountModal = useRef<any>(null);
  const metaReportingModal = useRef<any>(null);
  const openedMetaSetupView = useRef<"pending" | "pending_reporting" | null>(null);
  const metaResumeRequested = useRef(false);
  const klaviyoInitialSpend = useRef<any>(null);
  const klaviyoAccountChoice = useRef<any>(null);
  const klaviyoSetupModal = useRef<any>(null);
  const openedKlaviyoSetup = useRef(false);
  const klaviyoResumeRequested = useRef(false);
  const [klaviyoSetupStep, setKlaviyoSetupStep] =
    useState<"account" | "spend">("account");
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
  const googleWorking = revalidating || (pending && actionProvider === "google_ads");
  const metaWorking = revalidating || (pending && actionProvider === "meta");
  const klaviyoWorking = revalidating || (pending && actionProvider === "klaviyo");
  const klaviyoPeriods = state.klaviyo.view === "connected"
    ? state.klaviyo.periods
    : [];

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
      setKlaviyoSetupStep("account");
      setSelectedKlaviyoAccountId(null);
      return;
    }
    if (klaviyoWorking) return;
    if (openedKlaviyoSetup.current && !klaviyoResumeRequested.current) return;
    openedKlaviyoSetup.current = true;
    klaviyoResumeRequested.current = false;
    setKlaviyoSetupStep("account");
    setSelectedKlaviyoAccountId(null);
    klaviyoSetupModal.current?.showOverlay?.();
  }, [state.klaviyo.view, klaviyoWorking]);

  const send = (intent: string, provider: Provider = "google_ads") => {
    const form = new FormData();
    form.set("intent", intent);
    form.set("provider", provider);
    submit(form, {method: "post"});
  };

  const resumeAccountSelection = () => {
    resumeRequested.current = true;
    revalidator.revalidate();
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

  const resumeMetaAccountSelection = () => {
    metaResumeRequested.current = true;
    revalidator.revalidate();
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
    const input = intent === "complete_klaviyo"
      ? klaviyoInitialSpend.current
      : klaviyoUpdatedSpend.current;
    const form = new FormData();
    form.set("intent", intent);
    form.set("provider", "klaviyo");
    if (intent === "complete_klaviyo" && selectedKlaviyoAccountId) {
      form.set("accountId", selectedKlaviyoAccountId);
    }
    form.set("estimatedSpend", String(input?.value ?? ""));
    submit(form, {method: "post"});
  };

  const resumeKlaviyoSetup = () => {
    klaviyoResumeRequested.current = true;
    revalidator.revalidate();
  };

  const continueKlaviyoSetup = () => {
    const [accountId] = klaviyoAccountChoice.current?.values ?? [];
    if (!accountId) return;
    setSelectedKlaviyoAccountId(accountId);
    setKlaviyoSetupStep("spend");
  };

  const correctKlaviyoSpend = () => {
    const form = new FormData();
    form.set("intent", "change_klaviyo_value");
    form.set("provider", "klaviyo");
    form.set("effectiveFrom", selectedKlaviyoPeriod?.effectiveFrom ?? "");
    form.set(
      "correctionVersion",
      String(selectedKlaviyoPeriod?.correctionVersion ?? ""),
    );
    form.set("estimatedSpend", String(klaviyoCorrectedSpend.current?.value ?? ""));
    submit(form, {method: "post"});
  };

  const selectKlaviyoPeriod = (effectiveFrom: string) => {
    if (state.klaviyo.view !== "connected") return;
    const period = state.klaviyo.periods.find(
      (candidate) => candidate.effectiveFrom === effectiveFrom,
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
    if (period) selectKlaviyoPeriod(period.effectiveFrom);
  };

  return (
    <s-page heading="Settings">
      <Navigation />
      <s-section heading="Meta">
        <s-stack direction="block" gap="base">
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
                  if (state.meta.view === "error" && state.meta.retry === "oauth") {
                    send("begin", "meta");
                  } else {
                    revalidator.revalidate();
                  }
                }}
              >
                {state.meta.retry === "oauth" ? "Restart Meta setup" : "Try loading accounts again"}
              </s-button>
            </>
          ) : null}

          {!metaWorking && state.meta.view === "reauthorization" ? (
            <>
              <s-badge tone="warning">Reauthorization required</s-badge>
              <s-paragraph>
                Meta authorization is no longer valid. Reconnect to continue.
              </s-paragraph>
              <s-button variant="primary" onClick={() => send("begin", "meta")}>
                Reconnect Meta
              </s-button>
            </>
          ) : null}

          {!metaWorking && state.meta.view === "disconnected" ? (
            <>
              <s-badge>Not connected</s-badge>
              {state.meta.notice === "cancelled" ? (
                <s-banner tone="warning">
                  Meta setup was cancelled. No advertiser account was connected.
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
                commandFor="meta-connect-modal"
                command="--show"
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

        <s-modal id="meta-connect-modal" heading="Connect Meta">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Continue with a Facebook account that can access the Meta
              advertiser accounts you want to report. AdsTable requests read-only
              advertising access.
            </s-paragraph>
            <s-paragraph>
              If this browser is not signed in, Meta will ask you to sign in and
              complete any required verification before returning to AdsTable.
            </s-paragraph>
          </s-stack>
          <s-button
            slot="primary-action"
            variant="primary"
            commandFor="meta-connect-modal"
            command="--hide"
            onClick={() => send("begin", "meta")}
          >
            Continue to Meta
          </s-button>
          <s-button
            slot="secondary-actions"
            commandFor="meta-connect-modal"
            command="--hide"
          >
            Cancel
          </s-button>
        </s-modal>
      </s-section>
      <s-section heading="Google Ads">
        <s-stack direction="block" gap="base">
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
                  if (state.retry === "oauth") send("begin");
                  else revalidator.revalidate();
                }}
              >
                {state.retry === "oauth" ? "Restart Google Ads setup" : "Try loading accounts again"}
              </s-button>
            </>
          ) : null}

          {!googleWorking && state.view === "reauthorization" ? (
            <>
              <s-badge tone="warning">Reauthorization required</s-badge>
              <s-paragraph>
                Google authorization is no longer valid. Reconnect to continue.
              </s-paragraph>
              <s-button variant="primary" onClick={() => send("begin")}>
                Reconnect Google Ads
              </s-button>
            </>
          ) : null}

          {!googleWorking && state.view === "disconnected" ? (
            <>
              <s-badge>Not connected</s-badge>
              {state.notice === "cancelled" ? (
                <s-banner tone="warning">
                  Google Ads setup was cancelled. No advertiser account was connected.
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
                commandFor="google-connect-modal"
                command="--show"
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

        <s-modal id="google-connect-modal" heading="Connect Google Ads">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Continue with a Google account that can access the advertiser
              accounts you want to report. AdsTable requests read-only Google Ads
              reporting access.
            </s-paragraph>
            <s-paragraph>
              After authorization, AdsTable will show advertiser accounts only.
            </s-paragraph>
          </s-stack>
          <s-button
            slot="primary-action"
            variant="primary"
            commandFor="google-connect-modal"
            command="--hide"
            onClick={() => send("begin")}
          >
            Continue to Google
          </s-button>
          <s-button
            slot="secondary-actions"
            commandFor="google-connect-modal"
            command="--hide"
          >
            Cancel
          </s-button>
        </s-modal>
      </s-section>
      <s-section heading="Klaviyo">
        <s-stack direction="block" gap="base">
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
                  if (state.klaviyo.view === "error" && state.klaviyo.retry === "oauth") {
                    send("begin", "klaviyo");
                  } else {
                    revalidator.revalidate();
                  }
                }}
              >
                {state.klaviyo.retry === "oauth"
                  ? "Restart Klaviyo setup"
                  : "Try loading Klaviyo again"}
              </s-button>
            </>
          ) : null}

          {!klaviyoWorking && state.klaviyo.view === "reauthorization" ? (
            <>
              <s-badge tone="warning">Reauthorization required</s-badge>
              <s-paragraph>
                Klaviyo authorization is no longer valid. Reconnect to continue.
              </s-paragraph>
              <s-button variant="primary" onClick={() => send("begin", "klaviyo")}>
                Reconnect Klaviyo
              </s-button>
            </>
          ) : null}

          {!klaviyoWorking && state.klaviyo.view === "disconnected" ? (
            <>
              <s-badge>Not connected</s-badge>
              {state.klaviyo.notice === "cancelled" ? (
                <s-banner tone="warning">
                  Klaviyo setup was cancelled. No account was connected.
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
                commandFor="klaviyo-connect-modal"
                command="--show"
              >
                Connect Klaviyo
              </s-button>
            </>
          ) : null}

          {!klaviyoWorking && state.klaviyo.view === "pending" ? (
            <>
              <s-badge tone="info">Account selection required</s-badge>
              <s-paragraph>
                Klaviyo authorization is complete. Select the account, then add
                its estimated 30-day email spend to finish setup.
              </s-paragraph>
              <s-button variant="primary" onClick={resumeKlaviyoSetup}>
                Resume setup
              </s-button>
              <s-modal
                ref={klaviyoSetupModal}
                id="klaviyo-setup-modal"
                heading={klaviyoSetupStep === "account"
                  ? "Select Klaviyo account"
                  : "Add estimated email spend"}
              >
                {klaviyoSetupStep === "account" ? (
                  <s-stack direction="block" gap="base">
                    <s-paragraph>
                      Select the Klaviyo account to connect.
                    </s-paragraph>
                    <s-choice-list
                      ref={klaviyoAccountChoice}
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
                ) : (() => {
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
                {klaviyoSetupStep === "account" ? (
                  <s-button
                    slot="primary-action"
                    variant="primary"
                    onClick={continueKlaviyoSetup}
                  >
                    Continue
                  </s-button>
                ) : (
                  <s-button
                    slot="primary-action"
                    variant="primary"
                    onClick={() => submitKlaviyoSpend("complete_klaviyo")}
                  >
                    Save and connect
                  </s-button>
                )}
                <s-button
                  slot="secondary-actions"
                  commandFor="klaviyo-setup-modal"
                  command="--hide"
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
                    value={selectedKlaviyoPeriod?.effectiveFrom ?? ""}
                    onChange={(event: any) => selectKlaviyoPeriod(event.currentTarget.value)}
                  >
                    {klaviyoPeriods.map((period, index) => {
                      const nextPeriod = index > 0
                        ? klaviyoPeriods[index - 1]
                        : null;
                      const effectiveTo = nextPeriod
                        ? new Date(`${nextPeriod.effectiveFrom}T00:00:00.000Z`)
                        : null;
                      if (effectiveTo) effectiveTo.setUTCDate(effectiveTo.getUTCDate() - 1);
                      return (
                        <s-option key={period.id} value={period.effectiveFrom}>
                          {period.effectiveFrom} / {effectiveTo
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

        <s-modal id="klaviyo-connect-modal" heading="Connect Klaviyo">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Continue to Klaviyo to authorize one account. AdsTable requests
              the read-only scopes required for account and reporting access.
            </s-paragraph>
            <s-paragraph>
              After authorization, AdsTable will ask for the estimated 30-day
              email spend before the connection is completed.
            </s-paragraph>
          </s-stack>
          <s-button
            slot="primary-action"
            variant="primary"
            commandFor="klaviyo-connect-modal"
            command="--hide"
            onClick={() => send("begin", "klaviyo")}
          >
            Continue to Klaviyo
          </s-button>
          <s-button
            slot="secondary-actions"
            commandFor="klaviyo-connect-modal"
            command="--hide"
          >
            Cancel
          </s-button>
        </s-modal>
      </s-section>
    </s-page>
  );
}


