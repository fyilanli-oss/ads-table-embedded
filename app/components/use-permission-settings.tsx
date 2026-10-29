import {useCallback, useEffect, useRef, useState} from "react";
import {useFetcher} from "react-router";
import {PermissionExplanation} from "./permission-explanation";
import {PermissionSetupSelection, type SelectionModel, type SelectionInput} from "./permission-setup-selection";
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
  const [selectionModel, setSelectionModel] = useState<SelectionModel | null>(null);
  const selectionIntent = useRef<{model: SelectionModel; input: SelectionInput | null; failed: boolean} | null>(null);
  const [selectionActivity, setSelectionActivity] = useState<string | null>(null);
  const execute = useCallback((intent: "permission_connect" | "permission_status" | "permission_select_accounts" | "permission_select_reporting", feature: PermissionFeature, fields: Record<string, string> = {}) => {
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
        Promise.resolve(callbacks.current.submit({...fields, intent, feature, requestId}, {method: "post"})).catch(failed);
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
    if (pending.current || checking || selectionIntent.current) return;
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
  const openSelection = useCallback((reply: PermissionSettingsResult) => {
    if (pending.current || selectionIntent.current || controller.snapshot.phase !== "idle" || reply.kind !== "status" || !reply.selection
      || (reply.feature !== "google_ads" && reply.feature !== "meta")
      || !["select_account", "select_reporting_account"].includes(reply.stage)) return;
    const model: SelectionModel = {key: crypto.randomUUID(), feature: reply.feature,
      stage: reply.stage as SelectionModel["stage"], selection: reply.selection};
    selectionIntent.current = {model, input: null, failed: false};
    setSelectionModel(model);
  }, [controller]);
  const checkStatus = async (feature: PermissionFeature, openNext = false) => {
    if (pending.current || selectionIntent.current || ["explaining", "hiding_for_cancel", "hiding_for_connect", "starting"].includes(controller.snapshot.phase)) return;
    setChecking(true);
    try {
      const reply = await execute("permission_status", feature);
      setFeedback(reply);
      if (reply.kind === "status" || reply.kind === "unavailable") {
        controller.statusObserved(controller.snapshot.session, reply.feature);
        setSnapshot(controller.snapshot);
        if (openNext) {
          if (reply.kind === "status" && reply.stage === "reporting_selected") callbacks.current.onResume(reply.feature, reply.stage);
          else openSelection(reply);
        }
      }
    } catch { setFeedback({kind: "unknown", feature}); }
    finally { setChecking(false); }
  };
  const confirmSelection = useCallback((key: string, input: SelectionInput, hide: () => void) => {
    const active = selectionIntent.current;
    if (!active || active.model.key !== key || active.input || active.failed || pending.current) return;
    active.input = {...input, ...(input.accountIds ? {accountIds: [...input.accountIds]} : {})};
    setChecking(true);
    setSelectionActivity("Saving selection…");
    try { hide(); } catch {
      active.failed = true;
      setChecking(true);
      setFeedback({kind: "unknown", feature: active.model.feature});
    }
  }, []);
  const afterSelectionHide = useCallback(async (key: string) => {
    const active = selectionIntent.current;
    if (!active || active.model.key !== key) return;
    selectionIntent.current = null;
    setSelectionModel(null);
    if (!active.input || active.failed) { setChecking(false); setSelectionActivity(null); return; }
    const {model, input} = active;
    setChecking(true);
    setSelectionActivity("Saving selection…");
    try {
      const intent = model.stage === "select_account" ? "permission_select_accounts" : "permission_select_reporting";
      const fields: Record<string, string> = {connectionId: model.selection.connectionId, version: String(model.selection.version)};
      if (model.stage === "select_account") fields.selectedAccountIds = JSON.stringify(input.accountIds ?? []);
      else fields.reportingAccountId = input.accountIds[0] ?? "";
      const reply = await execute(intent, model.feature, fields);
      setFeedback(reply);
      if (reply.kind === "status" && reply.stage === "reporting_selected") callbacks.current.onResume(reply.feature, reply.stage);
    } catch { setFeedback({kind: "unknown", feature: model.feature}); }
    finally { setChecking(false); setSelectionActivity(null); }
  }, [execute]);
  const busy = checking || ["hiding_for_connect", "starting"].includes(snapshot.phase);
  const resume = () => {
    if (feedback?.kind !== "status") return;
    if (feedback.stage === "products_required") open("shopify_products");
    else if (permissionResumeTarget(feedback.stage) === "explanation") open(feedback.feature);
    else if (feedback.feature === "google_ads" || feedback.feature === "meta") {
      if (feedback.selection) openSelection(feedback);
      else void checkStatus(feedback.feature, true);
    } else callbacks.current.onResume(feedback.feature, feedback.stage);
  };
  const status = checking ? <s-banner tone="info" heading={selectionActivity ?? "Checking connection status…"} />
    : feedback?.kind === "unavailable" ? (
    <s-banner tone="warning" heading="Connection setup is not available yet." />
  ) : feedback?.kind === "unknown" || snapshot.phase === "unknown" ? (
    <s-banner tone="critical" heading="We could not confirm the result. Check the connection status before starting again." />
  ) : feedback?.kind === "status" && (feedback.stage === "existing_reporting_connection" || feedback.stage === "reporting_selected") ? null
    : feedback?.kind === "status" ? (
    <s-stack direction="block" gap="base">
      <s-banner tone="info" heading={feedback.stage === "review_setup"
        ? "Access verified. Setup is awaiting activation."
        : feedback.stage === "products_required" ? "Product access is still missing. Resume setup when you are ready."
        : feedback.stage === "select_account" || feedback.stage === "select_reporting_account"
          ? "Choose the account to use for reporting." : "Resume setup"} />
      {feedback.stage === "request_permissions" || feedback.stage === "products_required" || feedback.feature === "klaviyo"
        || ["select_account", "select_reporting_account"].includes(feedback.stage)
        ? <s-button disabled={busy ? true : undefined} onClick={resume}>Resume setup</s-button> : null}
    </s-stack>
  ) : busy || snapshot.phase === "awaiting_status" ? (
    <s-banner tone="info" heading={checking ? "Checking connection status…" : "Starting connection…"} />
  ) : null;
  return {
    open, checkStatus, busy, snapshot,
    content: <>
      {status}
      {(snapshot.feature ?? feedback?.feature) && snapshot.phase !== "explaining" ? (
        <s-button disabled={busy || selectionModel ? true : undefined} onClick={() => checkStatus((snapshot.feature ?? feedback?.feature)!)}>Check status</s-button>
      ) : null}
      {selectionModel ? <PermissionSetupSelection model={selectionModel} busy={busy} onConfirm={confirmSelection} onAfterHide={afterSelectionHide} /> : null}
      <PermissionExplanation snapshot={snapshot} requestsAvailable={snapshot.feature ? availability[snapshot.feature] : false}
        onConnect={connect} onHide={hide} onAfterHide={afterHide} />
    </>,
  };
}
