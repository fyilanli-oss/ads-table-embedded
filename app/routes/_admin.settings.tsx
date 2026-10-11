import type {ActionFunctionArgs, LoaderFunctionArgs} from "react-router";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import {useRef} from "react";
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
  | {view: "error"; code: string}
  | {view: "resume"; transactionId: string; advertisers: Advertiser[]}
  | {
      view: "connected";
      count: number;
      reportingAccountName: string;
    };

type ActionData = {ok: false; code: string} | undefined;

function publicErrorCode(error: unknown) {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? String((error as {code?: unknown}).code)
      : error instanceof Error
        ? error.message
        : "";
  const allowed = new Set([
    "GOOGLE_ACCOUNT_SELECTION_INVALID",
    "GOOGLE_ACCOUNT_SELECTION_NOT_VERIFIED_OR_INELIGIBLE",
    "GOOGLE_ACCESSIBLE_CUSTOMERS_EMPTY",
    "GOOGLE_ADS_DEVELOPER_TOKEN_REQUIRED",
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
          account.kind === "advertiser" && account.reportingEligible === true
        )
        .map(advertiserView);
      return {view: "resume", transactionId, advertisers};
    } catch (error) {
      if (
        error instanceof Error
        && /HANDOFF_UNAVAILABLE|TRANSACTION_EXPIRED/.test(error.message)
      ) {
        return {view: "expired"};
      }
      return {view: "error", code: publicErrorCode(error)};
    }
  }

  const connected = await runtime.accountAuthority.load({
    workspaceId: verified.installationAuthority.workspaceId,
    installGeneration: verified.installationAuthority.installGeneration,
    provider: "google_ads",
  });
  if (connected) {
    const reporting = connected.accounts.find(
      (account: Record<string, unknown>) =>
        account.id === connected.reportingAccountId
    );
    return {
      view: "connected",
      count: connected.accounts.length,
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
      return verified.context.redirect(authorizationUrl, {target: "_top"});
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
      const reportingAccountId = form.get("reportingAccountId");
      await runtime.handoff.select({
        transactionId,
        installationAuthority: verified.installationAuthority,
        selectedAccountIds,
        reportingAccountId:
          typeof reportingAccountId === "string" ? reportingAccountId : "",
      });
      return verified.context.redirect("/settings?google_status=connected");
    }

    return {ok: false, code: "GOOGLE_SETUP_ACTION_INVALID"} satisfies ActionData;
  } catch (error) {
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
  const pending = navigation.state !== "idle";

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
    const reporting = reportingChoice.current?.values?.[0];
    if (reporting) form.set("reportingAccountId", reporting);
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
              <s-button variant="primary" onClick={begin}>
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
              <s-button variant="primary" onClick={begin}>Try again</s-button>
            </>
          ) : null}

          {!pending && state.view === "expired" ? (
            <>
              <s-badge tone="warning">Expired</s-badge>
              <s-paragraph>
                This Google Ads setup session expired. Start again to load a fresh
                account list.
              </s-paragraph>
              <s-button variant="primary" onClick={begin}>Start again</s-button>
            </>
          ) : null}

          {!pending && state.view === "error" ? (
            <>
              <SafeError code={state.code} />
              <s-button variant="primary" onClick={begin}>Try again</s-button>
            </>
          ) : null}

          {!pending && state.view === "connected" ? (
            <>
              <s-badge tone="success">Connected</s-badge>
              <s-paragraph>
                Google Ads connected. {state.count} advertiser account(s) connected.
                {" "}{state.reportingAccountName} is used for reporting.
              </s-paragraph>
              <s-button onClick={begin}>Manage Google Ads connection</s-button>
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
                <s-button variant="primary" onClick={begin}>Try Google Ads again</s-button>
                <s-button onClick={() => cancel(state.transactionId)}>
                  Cancel setup
                </s-button>
              </s-stack>
            </>
          ) : null}

          {!pending && state.view === "resume" && state.advertisers.length > 0 ? (
            <>
              <s-badge tone="info">Choose accounts</s-badge>
              <s-paragraph>
                Choose Google Ads accounts. Select up to three advertiser accounts,
                then choose which account AdsTable uses for reporting.
              </s-paragraph>
              <s-choice-list
                ref={connectedChoices}
                label="Connected advertiser accounts"
                name="connectedAccountIds"
                multiple
              >
                {state.advertisers.map((account) => (
                  <s-choice key={account.id} value={account.id}>
                    {account.name} ({account.id})
                  </s-choice>
                ))}
              </s-choice-list>
              <s-choice-list
                ref={reportingChoice}
                label="Reporting account"
                name="reportingAccountId"
              >
                {state.advertisers.map((account) => (
                  <s-choice key={account.id} value={account.id}>
                    {account.name} ({account.id})
                  </s-choice>
                ))}
              </s-choice-list>
              <s-stack direction="inline" gap="base">
                <s-button
                  variant="primary"
                  onClick={() => select(state.transactionId)}
                >
                  Connect selected accounts
                </s-button>
                <s-button onClick={() => cancel(state.transactionId)}>
                  Cancel setup
                </s-button>
              </s-stack>
            </>
          ) : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}
