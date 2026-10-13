import type {ActionFunctionArgs, LoaderFunctionArgs} from "react-router";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSubmit,
} from "react-router";
import {useEffect, useRef} from "react";
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
import {
  buildGoogleAdsAuthorizationUrl,
} from "../lib/providers/google-ads-rest.server.js";
import {buildMetaAuthorizationUrl} from "../lib/providers/meta-graph.server.js";

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

type Provider = "google_ads" | "meta";
type LoaderData = State & {meta: State};

function providerCodeOf(provider: Provider, error: unknown) {
  const prefix = provider === "meta" ? "META" : "GOOGLE_ADS";
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

export const loader = async ({request}: LoaderFunctionArgs): Promise<LoaderData> => {
  const verified = await routeAuthority(request);
  const url = new URL(request.url);
  const [google, meta] = await Promise.all([
    loadGoogleState(verified, url),
    loadMetaState(verified, url),
  ]);
  return {...google, meta};
};

export const action = async ({request}: ActionFunctionArgs) => {
  const verified = await routeAuthority(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const provider: Provider = form.get("provider") === "meta" ? "meta" : "google_ads";

  try {
    const runtime = provider === "meta"
      ? createMetaOAuthRuntime({database, tokenVault: providerTokenVault})
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
          : buildGoogleAdsAuthorizationUrl({
            config: runtime.config,
            state: started.state,
            pkceChallenge: started.pkceChallenge,
          }),
      } satisfies ActionData;
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
          : "/settings?google_status=disconnected",
      );
    }

    return {
      ok: false,
      provider,
      code: provider === "meta"
        ? "META_SETUP_ACTION_INVALID"
        : "GOOGLE_SETUP_ACTION_INVALID",
    } satisfies ActionData;
  } catch (error) {
    if (error instanceof Response) throw error;
    return {ok: false, provider, code: providerCodeOf(provider, error)} satisfies ActionData;
  }
};

function ErrorBanner({provider, code}: {provider: Provider; code: string}) {
  const label = provider === "meta" ? "Meta" : "Google Ads";
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
  const pending = navigation.state !== "idle";
  const actionProvider = navigation.formData?.get("provider");
  const revalidating = revalidator.state !== "idle";
  const googleWorking = revalidating || (pending && actionProvider !== "meta");
  const metaWorking = revalidating || (pending && actionProvider === "meta");

  useEffect(() => {
    if (actionData?.ok !== true || actionData.intent !== "begin") return;
    const target = new URL(actionData.authorizationUrl);
    const googleTarget =
      target.origin === "https://accounts.google.com"
      && target.pathname === "/o/oauth2/v2/auth";
    const metaTarget =
      target.origin === "https://www.facebook.com"
      && target.pathname === "/v26.0/dialog/oauth";
    if (googleTarget || metaTarget) globalThis.open(target.toString(), "_top");
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
    </s-page>
  );
}
