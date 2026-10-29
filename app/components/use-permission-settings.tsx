import {useCallback, useEffect, useRef, useState} from "react";
import {useFetcher} from "react-router";
import {PermissionExplanation} from "./permission-explanation";
import {createPermissionExplanationFlow, permissionResumeTarget, type PermissionFeature} from "../lib/ui/permission-explanation-flow.js";
import {permissionAuthorizationTarget, permissionResponseMatches} from "../lib/ui/permission-settings-response.js";
import type {PermissionSettingsResult} from "../lib/shopify/permission-settings.server.js";

type Reply = PermissionSettingsResult & {requestId: string};
type Props = {
  availability: Readonly<Record<PermissionFeature, boolean>>;
  onResume(feature: PermissionFeature, stage: string): void;
};

// One host handles all five explanations. No mount effect starts a permission
// request or status read. A status check must be explicitly chosen by the user.
export function usePermissionSettings({availability, onResume}: Props) {
  const fetcher = useFetcher<Reply>();
  const callbacks = useRef({availability, onResume, submit: fetcher.submit});
  callbacks.current = {availability, onResume, submit: fetcher.submit};
  const pending = useRef<{
    requestId: string; feature: PermissionFeature;
    resolve(reply: Reply): void; reject(): void;
  } | null>(null);
  const [feedback, setFeedback] = useState<PermissionSettingsResult | null>(null);
  const connectReply = useRef<Reply | null>(null);
  const [checking, setChecking] = useState(false);
  const execute = useCallback((intent: "permission_connect" | "permission_status", feature: PermissionFeature) => {
    if (pending.current) return Promise.reject(new Error("PERMISSION_ACTION_PENDING"));
    return new Promise<Reply>((resolve, reject) => {
      const requestId = crypto.randomUUID();
      pending.current = {requestId, feature, resolve, reject: () => reject(new Error("PERMISSION_RESULT_UNKNOWN"))};
      const failed = () => {
        if (pending.current?.requestId === requestId) {
          pending.current.reject(); pending.current = null;
        }
      };
      try {
        Promise.resolve(callbacks.current.submit({intent, feature, requestId}, {method: "post"})).catch(failed);
      } catch { failed(); }
    });
  }, []);
  useEffect(() => {
    if (!fetcher.data || !pending.current || fetcher.state !== "idle") return;
    const active = pending.current;
    pending.current = null;
    if (permissionResponseMatches(fetcher.data, active)) active.resolve(fetcher.data);
    else active.reject();
  }, [fetcher.data, fetcher.state]);
  useEffect(() => () => {
    pending.current?.reject(); pending.current = null;
  }, []);

  const flow = useRef<ReturnType<typeof createPermissionExplanationFlow> | null>(null);
  if (!flow.current) flow.current = createPermissionExplanationFlow({
    canRequest: feature => callbacks.current.availability[feature] === true,
    request: async feature => {
      const reply = await execute("permission_connect", feature);
      connectReply.current = reply;
      setFeedback(reply);
      if (reply.kind === "authorization") {
        const target = permissionAuthorizationTarget(feature, reply.authorizationUrl);
        if (!target) throw new Error("PERMISSION_TARGET_INVALID");
        globalThis.open(target, "_top");
      } else if (reply.kind === "unknown" || reply.kind === "unavailable") {
        throw new Error("PERMISSION_RESULT_UNKNOWN");
      }
    },
  });
  const controller = flow.current;
  const [snapshot, setSnapshot] = useState(controller.snapshot);
  const open = (feature: PermissionFeature) => {
    if (pending.current || checking) return;
    const next = controller.open(feature);
    if (next) { setFeedback(null); setSnapshot(next); }
  };
  const connect = useCallback((session: number, hide: () => void) => {
    controller.connect(session, hide);
    setSnapshot(controller.snapshot);
  }, [controller]);
  const hide = useCallback((session: number) => {
    controller.hide(session); setSnapshot(controller.snapshot);
  }, [controller]);
  const afterHide = useCallback(async (session: number) => {
    const completion = controller.afterHide(session);
    setSnapshot(controller.snapshot);
    await completion;
    const reply = connectReply.current;
    if (reply?.kind === "status") controller.statusObserved(session, reply.feature);
    connectReply.current = null;
    setSnapshot(controller.snapshot);
  }, [controller]);
  const checkStatus = async (feature: PermissionFeature) => {
    if (pending.current || ["explaining", "hiding_for_cancel", "hiding_for_connect", "starting"].includes(controller.snapshot.phase)) return;
    setChecking(true);
    try {
      const reply = await execute("permission_status", feature);
      setFeedback(reply);
      if (reply.kind === "status" || reply.kind === "unavailable") {
        controller.statusObserved(controller.snapshot.session, reply.feature);
        setSnapshot(controller.snapshot);
      }
    } catch { setFeedback({kind: "unknown", feature}); }
    finally { setChecking(false); }
  };
  const busy = checking || ["hiding_for_connect", "starting"].includes(snapshot.phase);
  const resume = () => {
    if (feedback?.kind !== "status") return;
    if (feedback.stage === "products_required") open("shopify_products");
    else if (permissionResumeTarget(feedback.stage) === "explanation") open(feedback.feature);
    else callbacks.current.onResume(feedback.feature, feedback.stage);
  };
  const status = feedback?.kind === "unavailable" ? (
    <s-banner tone="warning" heading="Connection setup is not available yet." />
  ) : feedback?.kind === "unknown" || snapshot.phase === "unknown" ? (
    <s-banner tone="critical" heading="We could not confirm the result. Check the connection status before starting again." />
  ) : feedback?.kind === "status" && feedback.stage === "existing_reporting_connection" ? null
    : feedback?.kind === "status" ? (
    <s-stack direction="block" gap="base">
      <s-banner tone="info" heading={feedback.stage === "review_setup"
        ? "Access verified. Setup is awaiting activation."
        : feedback.stage === "products_required" ? "Product access is still missing. Resume setup when you are ready."
        : feedback.stage === "verify_assets" ? "Select the account or catalog needed to continue setup."
        : feedback.stage === "select_account" || feedback.stage === "select_reporting_account"
          ? "Choose the account to use for reporting." : "Resume setup"} />
      {feedback.stage === "request_permissions" || feedback.stage === "products_required" || feedback.feature === "klaviyo"
        ? <s-button onClick={resume}>Resume setup</s-button> : null}
    </s-stack>
  ) : busy || snapshot.phase === "awaiting_status" ? (
    <s-banner tone="info" heading={checking ? "Checking connection status…" : "Starting connection…"} />
  ) : null;
  return {
    open, checkStatus, busy, snapshot,
    content: <>
      {status}
      {snapshot.feature && snapshot.phase !== "explaining" ? (
        <s-button disabled={busy ? true : undefined} onClick={() => checkStatus(snapshot.feature!)}>Check status</s-button>
      ) : null}
      <PermissionExplanation snapshot={snapshot} requestsAvailable={snapshot.feature ? availability[snapshot.feature] : false}
        onConnect={connect} onHide={hide} onAfterHide={afterHide} />
    </>,
  };
}
