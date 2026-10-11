import type {ActionFunctionArgs, LoaderFunctionArgs} from "react-router";
import {
  useActionData,
  useLoaderData,
  useNavigation,
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
import {
  createGoogleOAuthRuntime,
} from "../lib/oauth/google-oauth-runtime.server.js";
import {
  buildGoogleAdsAuthorizationUrl,
} from "../lib/providers/google-ads-rest.server.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Advertiser = {
  id: string;
  name: string;
  status: string | null;
  currency: string | null;
  timezone: string | null;
};

type SettingsState =
  | {view: "empty"}
  | {view: "cancelled"}
  | {view: "expired"}
  | {view: "reauthorization"}
  | {view: "error"; code: string}
  | {view: "resume"; transactionId: string; advertisers: Advertiser[]}
  | {
      view: "connected";
      count: number;
      accounts: Advertiser[];
      reportingAccountId: string;
      reportingAccountName: string;
    };

type ActionData =
  | {ok: false; code: string}
  | {ok: true; intent: "begin"; authorizationUrl: string}
  | undefined;

function safeLogValue(value: unknown, maximum = 120) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && /^[A-Za-z0-9_.:-]+$/.test(value)
      ? value
      : null;
}

function publicErrorCode(error: unknown) {
  const source = error && typeof error === "object"
    ? error as {code?: unknown; details?: Record<string, unknown>}
    : null;
  const providerCode = safeLogValue(source?.details?.provider_error_code);
  const providerStatus = safeLogValue(source?.details?.provider_status);
  if (providerCode && /^[A-Z0-9_]{1,100}$/.test(providerCode)) {
    return `GOOGLE_ADS_PROVIDER_${providerCode}`;
  }
  if (providerStatus === "invalid_grant") {
    return "GOOGLE_REAUTHORIZATION_REQUIRED";
  }
  const candidate =
    source && "code" in source
      ? String(source.code)
      : error instanceof Error
        ? error.message
        : "";
  const allowed = new Set([
    "GOOGLE_ACCOUNT_SELECTION_INVALID",
    "GOOGLE_ACCOUNT_SELECTION_NOT_VERIFIED_OR_INELIGIBLE",
    "GOOGLE_ACCESSIBLE_CUSTOMERS_EMPTY",
    "GOOGLE_ADS_ENABLED_CUSTOMERS_EMPTY",
    "GOOGLE_ADS_DEVELOPER_TOKEN_REQUIRED",
    "GOOGLE_REAUTHORIZATION_REQUIRED",
    "GOOGLE_REVOKE_FAILED",
    "GOOGLE_REPORTING_ACCOUNT_NOT_VERIFIED",
  ]);
  return allowed.has(candidate) ? candidate : "GOOGLE_SETUP_FAILED";
}

async function authority(request: Request) {
  return resolveShopifyRouteAuthority({
    request,
    authenticateAdmin: authenticate.admin,
    database,
  });
}

function advertiserView(account: Record<string, unknown>): Advertiser {
  return {
    id: String(account.id),
    name: String(account.name),
    status: typeof account.status === "string" ? account.status : null,
    currency: typeof account.currency === "string" ? account.currency : null,
    timezone: typeof account.timezone === "string" ? account.timezone : null,
  };
}

export const loader = async ({request}: LoaderFunctionArgs): Promise<SettingsState> => {
  const verified = await authority(request);
  const runtime = createGoogleOAuthRuntime({
    database,
    tokenVault: providerTokenVault,
  });
  const url = new URL(request.url);
  const transactionId = url.searchParams.get("google_setup");
  const status = url.searchParams.get("google_status");

  if (transactionId !== null) {
    if (!UUID_PATTERN.test(transactionId)) {
      return {view: "error", code: "GOOGLE_SETUP_REFERENCE_INVALID"};
    }
    try {
      const result = await runtime.handoff.discover({
        transactionId,
        installationAuthority: verified.installationAuthority,
      });
      const advertisers = result.accounts
        .filter((account: Record<string, unknown>) =>
          account.kind === "advertiser"
        )
        .map(advertiserView);
      if (advertisers.length === 0) {
        const statusCounts: Record<string, number> = {};
        for (const account of result.accounts as Array<Record<string, unknown>>) {
          const status = safeLogValue(account.status) ?? "missing";
          statusCounts[status] = (statusCounts[status] ?? 0) + 1;
        }
        console.warn("[google-ads-no-eligible-advertiser]", {
          account_count: result.accounts.length,
          manager_count: result.accounts.filter(
            (account: Record<string, unknown>) => account.kind === "manager"
          ).length,
          advertiser_count: result.accounts.filter(
            (account: Record<string, unknown>) => account.kind === "advertiser"
          ).length,
          reporting_eligible_count: result.accounts.filter(
            (account: Record<string, unknown>) => account.reportingEligible === true
          ).length,
          status_counts: statusCounts,
        });
      }
      return {view: "resume", transactionId, advertisers};
    } catch (error) {
      const providerStatus =
        error && typeof error === "object" && "details" in error
          ? safeLogValue(
              (error as {details?: Record<string, unknown>}).details?.provider_status,
            )
          : null;
      if (providerStatus === "invalid_grant") {
        await runtime.handoff.cancel({
          transactionId,
          installationAuthority: verified.installationAuthority,
        }).catch(() => undefined);
        return {view: "reauthorization"};
      }
      if (
        error instanceof Error
        && /HANDOFF_UNAVAILABLE|TRANSACTION_EXPIRED/.test(error.message)
      ) {
        return {view: "error", code: "GOOGLE_SETUP_REFERENCE_INVALID"};
      }
      const source = error && typeof error === "object"
        ? error as {code?: unknown; details?: Record<string, unknown>}
        : null;
      console.error("[google-ads-account-discovery-failed]", {
        code: safeLogValue(source?.code),
        provider_status: safeLogValue(source?.details?.provider_status),
        provider_error_code: safeLogValue(source?.details?.provider_error_code),
        request_id: safeLogValue(source?.details?.request_id, 256),
      });
      return {view: "error", code: publicErrorCode(error)};
    }
  }

  const inspected = await runtime.googleConnection.inspect({
    installationAuthority: verified.installationAuthority,
  });
  if (inspected.status === "reauthorization_required") {
    return {view: "reauthorization"};
  }
  if (inspected.status === "connected") {
    const connected = inspected.connection;
    const reporting = connected.accounts.find(
      (account: Record<string, unknown>) =>
        account.id === connected.reportingAccountId
    );
    return {
      view: "connected",
      count: connected.accounts.length,
      accounts: connected.accounts.map(advertiserView),
      reportingAccountId: String(connected.reportingAccountId),
      reportingAccountName:
        typeof reporting?.name === "string"
          ? reporting.name
          : String(connected.reportingAccountId),
    };
  }
  if (status === "cancelled") return {view: "cancelled"};
  if (status === "expired") return {view: "expired"};
  if (status === "error") {
    return {
      view: "error",
      code: url.searchParams.get("google_error") ?? "GOOGLE_SETUP_FAILED",
    };
  }
  return {view: "empty"};
};

export const action = async ({request}: ActionFunctionArgs) => {
  const verified = await authority(request);
  const runtime = createGoogleOAuthRuntime({
    database,
    tokenVault: providerTokenVault,
  });
  const form = await request.formData();
  const intent = form.get("intent");

  try {
    if (intent === "begin") {
      const started = await runtime.oauthBoundary.begin({
        installationAuthority: verified.installationAuthority,
        provider: "google_ads",
      });
      const authorizationUrl = buildGoogleAdsAuthorizationUrl({
        config: runtime.config,
        state: started.state,
        pkceChallenge: started.pkceChallenge,
      });
      return {ok: true, intent: "begin", authorizationUrl} satisfies ActionData;
    }

    if (intent === "reporting") {
      const providerAccountId = form.get("reportingAccountId");
      if (typeof providerAccountId !== "string") {
        return {ok: false, code: "GOOGLE_REPORTING_ACCOUNT_INVALID"} satisfies ActionData;
      }
      await runtime.googleConnection.changeReportingAccount({
        installationAuthority: verified.installationAuthority,
        providerAccountId,
      });
      return verified.context.redirect("/settings?google_status=connected");
    }

    if (intent === "disconnect") {
      await runtime.googleConnection.disconnect({
        installationAuthority: verified.installationAuthority,
      });
      return verified.context.redirect("/settings?google_status=disconnected");
    }

    const transactionId = form.get("transactionId");
    if (typeof transactionId !== "string" || !UUID_PATTERN.test(transactionId)) {
      return {ok: false, code: "GOOGLE_SETUP_REFERENCE_INVALID"} satisfies ActionData;
    }

    if (intent === "cancel") {
      await runtime.handoff.cancel({
        transactionId,
        installationAuthority: verified.installationAuthority,
      });
      return verified.context.redirect("/settings?google_status=cancelled");
    }

    if (intent === "select") {
      const selectedAccountIds = form
        .getAll("connectedAccountIds")
        .filter((value): value is string => typeof value === "string");
      await runtime.handoff.select({
        transactionId,
        installationAuthority: verified.installationAuthority,
        selectedAccountIds,
        reportingAccountId: selectedAccountIds[0] ?? "",
      });
      return verified.context.redirect("/settings?google_status=connected");
    }

    return {ok: false, code: "GOOGLE_SETUP_ACTION_INVALID"} satisfies ActionData;
  } catch (error) {
    if (error instanceof Response) throw error;
    return {ok: false, code: publicErrorCode(error)} satisfies ActionData;
  }
};

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

function SafeError({code}: {code: string}) {
  if (code === "GOOGLE_ADS_ENABLED_CUSTOMERS_EMPTY") {
    return (
      <s-banner tone="warning">
        Google authorization succeeded, but no Google Ads advertiser account was
        found. Manager accounts cannot be selected. Check account access in Google
        Ads, then try again.
      </s-banner>
    );
  }
  return (
    <s-banner tone="critical">
      Google Ads could not be connected. Try again. If the problem continues,
      share error code {code}.
    </s-banner>
  );
}

export default function Settings() {
  const state = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ActionData;
  const submit = useSubmit();
  const navigation = useNavigation();
  const connectedChoices = useRef<any>(null);
  const reportingChoice = useRef<any>(null);
  const selectionModal = useRef<any>(null);
  const pending = navigation.state !== "idle";

  useEffect(() => {
    if (actionData?.ok !== true || actionData.intent !== "begin") return;
    const authorizationUrl = new URL(actionData.authorizationUrl);
    if (
      authorizationUrl.origin !== "https://accounts.google.com"
      || authorizationUrl.pathname !== "/o/oauth2/v2/auth"
    ) {
      return;
    }
    globalThis.open(authorizationUrl.toString(), "_top");
  }, [actionData]);

  useEffect(() => {
    if (state.view !== "resume" || state.advertisers.length === 0) return;
    selectionModal.current?.showOverlay?.();
  }, [state]);

  const begin = () => {
    const form = new FormData();
    form.set("intent", "begin");
    submit(form, {method: "post"});
  };
  const cancel = (transactionId: string) => {
    const form = new FormData();
    form.set("intent", "cancel");
    form.set("transactionId", transactionId);
    submit(form, {method: "post"});
  };
  const select = (transactionId: string) => {
    const form = new FormData();
    form.set("intent", "select");
    form.set("transactionId", transactionId);
    for (const value of connectedChoices.current?.values ?? []) {
      form.append("connectedAccountIds", value);
    }
    submit(form, {method: "post"});
  };
  const updateReporting = () => {
    const form = new FormData();
    form.set("intent", "reporting");
    const reporting = reportingChoice.current?.values?.[0];
    if (reporting) form.set("reportingAccountId", reporting);
    submit(form, {method: "post"});
  };
  const disconnect = () => {
    const form = new FormData();
    form.set("intent", "disconnect");
    submit(form, {method: "post"});
  };

  return (
    <s-page heading="Settings">
      <Navigation />
      <s-section heading="Google Ads">
        <s-stack direction="block" gap="base">
          {actionData?.ok === false ? <SafeError code={actionData.code} /> : null}

          {pending ? (
            <>
              <s-badge tone="info">Connecting</s-badge>
              <s-paragraph>Connecting to Google Ads…</s-paragraph>
              <s-button variant="primary" loading disabled>
                Connect Google Ads
              </s-button>
            </>
          ) : null}

          {!pending && state.view === "empty" ? (
            <>
              <s-badge>Not connected</s-badge>
              <s-paragraph>
                Google Ads is not connected. Connect one to three advertiser
                accounts. Manager accounts are used only when Google requires an
                access path.
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

          {!pending && state.view === "cancelled" ? (
            <>
              <s-badge tone="warning">Cancelled</s-badge>
              <s-paragraph>
                Google Ads connection was cancelled. No reporting account was connected.
              </s-paragraph>
              <s-button
                variant="primary"
                commandFor="google-connect-modal"
                command="--show"
              >
                Try again
              </s-button>
            </>
          ) : null}

          {!pending && state.view === "reauthorization" ? (
            <>
              <s-badge tone="warning">Reauthorization required</s-badge>
              <s-paragraph>
                Google Ads authorization is no longer valid. Reconnect Google Ads
                to continue reporting.
              </s-paragraph>
              <s-button
                variant="primary"
                commandFor="google-connect-modal"
                command="--show"
              >
                Reconnect Google Ads
              </s-button>
            </>
          ) : null}

          {!pending && state.view === "expired" ? (
            <>
              <s-badge tone="warning">Expired</s-badge>
              <s-paragraph>
                This Google Ads setup session expired. Start again to load a fresh
                account list.
              </s-paragraph>
              <s-button
                variant="primary"
                commandFor="google-connect-modal"
                command="--show"
              >
                Start again
              </s-button>
            </>
          ) : null}

          {!pending && state.view === "error" ? (
            <>
              <SafeError code={state.code} />
              <s-button
                variant="primary"
                commandFor="google-connect-modal"
                command="--show"
              >
                Try again
              </s-button>
            </>
          ) : null}

          {!pending && state.view === "connected" ? (
            <>
              <s-badge tone="success">Connected</s-badge>
              <s-paragraph>
                Google Ads connected. {state.count} advertiser account(s) connected.
                {" "}{state.reportingAccountName} is used for reporting.
              </s-paragraph>
              <s-button
                commandFor="google-reporting-account-modal"
                command="--show"
              >
                Reporting account
              </s-button>
              <s-button
                tone="critical"
                commandFor="google-disconnect-modal"
                command="--show"
              >
                Disconnect
              </s-button>
              <s-modal
                id="google-disconnect-modal"
                heading="Disconnect Google Ads?"
              >
                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    AdsTable will revoke Google authorization, remove the encrypted
                    credential and stop future Google Ads refreshes. Historical
                    reporting data will be preserved.
                  </s-paragraph>
                </s-stack>
                <s-button
                  slot="primary-action"
                  tone="critical"
                  onClick={disconnect}
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
              <s-modal
                id="google-reporting-account-modal"
                heading="Google Ads reporting account"
              >
                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Choose the single connected account AdsTable will use for
                    reporting. This does not reconnect Google Ads.
                  </s-paragraph>
                  <s-choice-list
                    ref={reportingChoice}
                    label="Reporting account"
                    name="reportingAccountId"
                  >
                    {state.accounts.map((account) => (
                      <s-choice
                        key={account.id}
                        value={account.id}
                        defaultSelected={account.id === state.reportingAccountId}
                      >
                        {account.name} ({account.id})
                      </s-choice>
                    ))}
                  </s-choice-list>
                </s-stack>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  onClick={updateReporting}
                >
                  Save reporting account
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="google-reporting-account-modal"
                  command="--hide"
                >
                  Cancel
                </s-button>
              </s-modal>
            </>
          ) : null}

          {!pending && state.view === "resume" && state.advertisers.length === 0 ? (
            <>
              <s-badge tone="warning">No advertiser</s-badge>
              <s-paragraph>
                No eligible advertiser account was found. Manager accounts cannot
                be reporting accounts.
              </s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button
                  variant="primary"
                  commandFor="google-connect-modal"
                  command="--show"
                >
                  Try Google Ads again
                </s-button>
                <s-button onClick={() => cancel(state.transactionId)}>
                  Cancel setup
                </s-button>
              </s-stack>
            </>
          ) : null}

          {!pending && state.view === "resume" && state.advertisers.length > 0 ? (
            <>
              <s-badge tone="info">Setup pending</s-badge>
              <s-paragraph>
                Google authorization is complete. Resume setup to select between
                one and three advertiser accounts.
              </s-paragraph>
              <s-button
                variant="primary"
                commandFor="google-account-selection-modal"
                command="--show"
              >
                Resume setup
              </s-button>
              <s-modal
                ref={selectionModal}
                id="google-account-selection-modal"
                heading="Select Google Ads account"
              >
                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Select between 1 and 3 accounts returned by Google Ads.
                  </s-paragraph>
                  <s-paragraph>You can connect up to 3 accounts.</s-paragraph>
                  <s-choice-list
                    ref={connectedChoices}
                    label="Google Ads accounts"
                    name="connectedAccountIds"
                    multiple
                  >
                    {state.advertisers.map((account) => (
                      <s-choice key={account.id} value={account.id}>
                        {account.name} ({account.id})
                      </s-choice>
                    ))}
                  </s-choice-list>
                </s-stack>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  onClick={() => select(state.transactionId)}
                >
                  Save and connect
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor="google-account-selection-modal"
                  command="--hide"
                >
                  Cancel
                </s-button>
              </s-modal>
            </>
          ) : null}
        </s-stack>
        <s-modal id="google-connect-modal" heading="Connect Google Ads">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Continue with a Google account that can access the Google Ads
              advertiser accounts you intend to connect. AdsTable uses this
              connection only to read approved Google Ads reporting data.
            </s-paragraph>
            <s-paragraph>
              Authorization does not complete the connection. After Google
              authorization, choose one to three advertiser accounts. Manager
              accounts are never selectable.
            </s-paragraph>
          </s-stack>
          <s-button
            slot="primary-action"
            variant="primary"
            commandFor="google-connect-modal"
            command="--hide"
            onClick={begin}
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
