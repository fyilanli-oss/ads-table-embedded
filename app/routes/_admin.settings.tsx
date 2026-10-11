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
import {createGoogleOAuthRuntime} from "../lib/oauth/google-oauth-runtime.server.js";
import {
  buildGoogleAdsAuthorizationUrl,
} from "../lib/providers/google-ads-rest.server.js";

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
  | {view: "connected"; accounts: Advertiser[]}
  | {view: "reauthorization"}
  | {view: "error"; code: string};

type ActionData =
  | {ok: true; intent: "begin"; authorizationUrl: string}
  | {ok: false; code: string}
  | undefined;

function codeOf(error: unknown) {
  const source = error && typeof error === "object"
    ? error as {code?: unknown; details?: Record<string, unknown>}
    : null;
  const providerCode = source?.details?.provider_error_code;
  if (
    typeof providerCode === "string"
    && /^[A-Z0-9_]{1,80}$/.test(providerCode)
  ) return "GOOGLE_ADS_PROVIDER_" + providerCode;
  const status = source?.details?.provider_status;
  if (status === "invalid_grant") return "GOOGLE_REAUTHORIZATION_REQUIRED";
  const candidate = source?.code ?? (error instanceof Error ? error.message : "");
  return typeof candidate === "string" && /^[A-Z0-9_]{1,80}$/.test(candidate)
    ? candidate
    : "GOOGLE_SETUP_FAILED";
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

async function routeAuthority(request: Request) {
  return resolveShopifyRouteAuthority({
    request,
    authenticateAdmin: authenticate.admin,
    database,
  });
}

export const loader = async ({request}: LoaderFunctionArgs): Promise<State> => {
  const verified = await routeAuthority(request);
  const runtime = createGoogleOAuthRuntime({
    database,
    tokenVault: providerTokenVault,
  });
  const url = new URL(request.url);
  try {
    const inspected = await runtime.inspect({
      installationAuthority: verified.installationAuthority,
    });
    if (inspected.state === "connected") {
      return {
        view: "connected",
        accounts: inspected.connection.accounts.map(view),
      };
    }
    if (inspected.state === "pending_account_selection") {
      return {
        view: "pending",
        accounts: inspected.accounts.map(view),
      };
    }
    const status = url.searchParams.get("google_status");
    return {
      view: "disconnected",
      notice: status === "cancelled"
        ? "cancelled"
        : status === "disconnected"
          ? "disconnected"
          : null,
    };
  } catch (error) {
    const code = codeOf(error);
    if (code === "GOOGLE_REAUTHORIZATION_REQUIRED") {
      return {view: "reauthorization"};
    }
    return {view: "error", code};
  }
};

export const action = async ({request}: ActionFunctionArgs) => {
  const verified = await routeAuthority(request);
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
      return {
        ok: true,
        intent: "begin",
        authorizationUrl: buildGoogleAdsAuthorizationUrl({
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
        reportingAccountId: selected[0] ?? "",
      });
      return verified.context.redirect("/settings");
    }

    if (intent === "cancel") {
      await runtime.cancel({
        installationAuthority: verified.installationAuthority,
      });
      return verified.context.redirect("/settings?google_status=cancelled");
    }

    if (intent === "disconnect") {
      await runtime.disconnect({
        installationAuthority: verified.installationAuthority,
      });
      return verified.context.redirect("/settings?google_status=disconnected");
    }

    return {ok: false, code: "GOOGLE_SETUP_ACTION_INVALID"} satisfies ActionData;
  } catch (error) {
    if (error instanceof Response) throw error;
    return {ok: false, code: codeOf(error)} satisfies ActionData;
  }
};

function ErrorBanner({code}: {code: string}) {
  return (
    <s-banner tone="critical">
      Google Ads could not be connected. Try again. If the problem continues,
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
  const choices = useRef<any>(null);
  const pending = navigation.state !== "idle";

  useEffect(() => {
    if (actionData?.ok !== true || actionData.intent !== "begin") return;
    const target = new URL(actionData.authorizationUrl);
    if (
      target.origin === "https://accounts.google.com"
      && target.pathname === "/o/oauth2/v2/auth"
    ) globalThis.open(target.toString(), "_top");
  }, [actionData]);

  const send = (intent: string) => {
    const form = new FormData();
    form.set("intent", intent);
    submit(form, {method: "post"});
  };

  const select = () => {
    const form = new FormData();
    form.set("intent", "select");
    for (const id of choices.current?.values ?? []) {
      form.append("accountIds", id);
    }
    submit(form, {method: "post"});
  };

  return (
    <s-page heading="Settings">
      <Navigation />
      <s-section heading="Google Ads">
        <s-stack direction="block" gap="base">
          {actionData?.ok === false ? <ErrorBanner code={actionData.code} /> : null}

          {pending ? (
            <>
              <s-badge tone="info">Working</s-badge>
              <s-paragraph>Google Ads setup is being updated…</s-paragraph>
            </>
          ) : null}

          {!pending && state.view === "error" ? (
            <>
              <ErrorBanner code={state.code} />
              <s-button variant="primary" onClick={() => send("begin")}>
                Try again
              </s-button>
            </>
          ) : null}

          {!pending && state.view === "reauthorization" ? (
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

          {!pending && state.view === "disconnected" ? (
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

          {!pending && state.view === "pending" ? (
            <>
              <s-badge tone="info">Select accounts</s-badge>
              <s-paragraph>
                Google authorization is complete. Select one to three advertiser
                accounts to finish setup.
              </s-paragraph>
              <s-button
                variant="primary"
                commandFor="google-account-modal"
                command="--show"
              >
                Select advertiser accounts
              </s-button>
              <s-button onClick={() => send("cancel")}>Cancel setup</s-button>
              <s-modal id="google-account-modal" heading="Google Ads accounts">
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

          {!pending && state.view === "connected" ? (
            <>
              <s-badge tone="success">Connected</s-badge>
              <s-paragraph>
                {state.accounts.length} Google Ads advertiser account(s) connected.
              </s-paragraph>
              <s-unordered-list>
                {state.accounts.map((account) => (
                  <s-list-item key={account.id}>
                    {account.name} ({account.id})
                  </s-list-item>
                ))}
              </s-unordered-list>
              <s-button
                tone="critical"
                commandFor="google-disconnect-modal"
                command="--show"
              >
                Disconnect
              </s-button>
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
