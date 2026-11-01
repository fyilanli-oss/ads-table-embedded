import {useCallback, useEffect, useRef, useState} from "react";
import {useFetcher} from "react-router";
import {PermissionProviderDisconnect} from "./permission-provider-disconnect";
import {PermissionExplanation} from "./permission-explanation";
import {PermissionSetupSelection, type SelectionModel, type SelectionInput} from "./permission-setup-selection";
import {createPermissionExplanationFlow, permissionResumeTarget, type PermissionFeature} from "../lib/ui/permission-explanation-flow.js";
import {permissionAuthorizationTarget, permissionResponseMatches} from "../lib/ui/permission-settings-response.js";
import type {PermissionSettingsResult} from "../lib/shopify/permission-settings.server.js";
import {requestShopifyScopeWindow} from "../lib/ui/shopify-scope-window.js";
import type {ProductPermissionStatus} from "../lib/shopify/product-permission-status.server.js";

type DisconnectModel = {key: string; feature: "google_ads" | "meta"; expected: {connectionId: string; version: number}; owner: string | null | undefined};
type Reply = PermissionSettingsResult & {requestId: string};
type Props = {
  availability: Readonly<Record<PermissionFeature, boolean>>;
  unavailableReasons?: Readonly<Partial<Record<PermissionFeature, string>>>;
  externalBusy?: boolean;
  externalLock?: {current: string | null};
  productOwner?: string | null;
  shopifyShopId?: string | null;
  onProductStatus?(value: ProductPermissionStatus): void;
  onOrderStatus?(value: ProductPermissionStatus): void;
  initialProviders?: Partial<Record<"google_ads" | "meta", {view: string; notice?: string | null; permission?: PermissionSettingsResult; connectionBinding?: {connectionId: string; version: number}}>>;
  onDisconnected?(feature: "google_ads" | "meta"): void;
  onConnection?(feature: "google_ads" | "meta", connection: import("../lib/shopify/permission-settings.server.js").PermissionSelection): void;
  onResume(feature: PermissionFeature, stage: string): void;
};

// One host handles all five explanations. No mount effect starts a permission
// request. Shopify consent stays in Settings through App Bridge; the server
// prepares a fixed scope and verifies actual grants after the native window.
const isShopifyPermission = (feature: unknown) => feature === "shopify_products" || feature === "shopify_orders";
export function usePermissionSettings({availability, unavailableReasons, onResume, productOwner, shopifyShopId, onProductStatus, onOrderStatus, initialProviders, onConnection, onDisconnected, externalBusy = false, externalLock}: Props) {
  const fetcher = useFetcher<Reply>();
  const activeView = useRef(true);
  const callbacks = useRef({availability, onResume, productOwner, shopifyShopId, onProductStatus, onOrderStatus, onConnection, onDisconnected, initialProviders, externalBusy, externalLock, submit: fetcher.submit});
  callbacks.current = {availability, onResume, productOwner, shopifyShopId, onProductStatus, onOrderStatus, onConnection, onDisconnected, initialProviders, externalBusy, externalLock, submit: fetcher.submit};
  const pending = useRef<{
    requestId: string; feature: PermissionFeature;
    resolve(reply: Reply): void; reject(): void;
  } | null>(null);
  const [feedback, setFeedbackValue] = useState<PermissionSettingsResult | null>(null);
  const [providerFeedback, setProviderFeedback] = useState<Partial<Record<PermissionFeature, PermissionSettingsResult>>>({});
  const setFeedback = useCallback((reply: PermissionSettingsResult | null) => {
    setFeedbackValue(reply);
    if (reply) setProviderFeedback(previous => ({...previous, [reply.feature]: reply}));
  }, []);
  const clearProviderFeedback = useCallback((feature: PermissionFeature) => {
    setFeedbackValue(current => current?.feature === feature ? null : current);
    setProviderFeedback(current => {const next = {...current}; delete next[feature]; return next;});
  }, []);
  const hasUnknownResult = Object.values(providerFeedback).some(reply => reply?.kind === "unknown");
  const [shopifyFailure, setShopifyFailure] = useState<{owner: string | null | undefined; feature: PermissionFeature; code: string} | null>(null);
  const shopifyFailureCode = (feature: PermissionFeature) => shopifyFailure && shopifyFailure.owner === productOwner && shopifyFailure.feature === feature ? shopifyFailure.code : null;
  const connectReply = useRef<Reply | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkingFeature, setCheckingFeature] = useState<PermissionFeature | null>(null);
  const [removingProduct, setRemovingProduct] = useState(false);
  const [removalNotice, setRemovalNotice] = useState<{owner: string | null | undefined; kind: "removed" | "unknown"} | null>(null);
  const productRemovalResult = removalNotice?.owner === productOwner ? removalNotice?.kind ?? null : null;
  const setProductRemovalResult = (kind: "removed" | "unknown" | null) => setRemovalNotice(kind ? {owner: callbacks.current.productOwner, kind} : null);
  const [removingOrder, setRemovingOrder] = useState(false);
  const [orderNotice, setOrderNotice] = useState<{owner: string | null | undefined; kind: "removed" | "unknown"} | null>(null);
  const orderRemovalResult = orderNotice?.owner === productOwner ? orderNotice?.kind ?? null : null;
  const setOrderRemovalResult = (kind: "removed" | "unknown" | null) => setOrderNotice(kind ? {owner: callbacks.current.productOwner, kind} : null);
  const productReply = useCallback((reply: PermissionSettingsResult) => {
    if (reply.feature !== "shopify_products") return;
    const value = reply.kind === "unavailable" ? "unavailable"
      : reply.kind === "status" && reply.stage === "review_setup" ? "ready"
      : reply.kind === "status" && reply.stage === "request_permissions" ? "missing" : "unknown";
    callbacks.current.onProductStatus?.(value);
    if (value !== "unknown") setShopifyFailure(null);
    setProductRemovalResult(null);
  }, []);
  const orderReply = useCallback((reply: PermissionSettingsResult) => {
    if (reply.feature !== "shopify_orders") return;
    const value = reply.kind === "unavailable" ? "unavailable"
      : reply.kind === "status" && reply.stage === "review_setup" ? "ready"
      : reply.kind === "status" && ["request_permissions", "products_required"].includes(reply.stage) ? "missing" : "unknown";
    callbacks.current.onOrderStatus?.(value);
    if (value !== "unknown") setShopifyFailure(null);
    setOrderRemovalResult(null);
  }, []);
  const [selectionModel, setSelectionModel] = useState<SelectionModel | null>(null);
  const [disconnectModel, setDisconnectModel] = useState<DisconnectModel | null>(null);
  const disconnectSession = useRef<DisconnectModel | null>(null);
  const disconnectIntent = useRef(false);
  const selectionIntent = useRef<{owner: string | null | undefined; model: SelectionModel; input: SelectionInput | null; failed: boolean} | null>(null);
  const [selectionActivity, setSelectionActivity] = useState<string | null>(null);
  const execute = useCallback((intent: "permission_connect" | "permission_status" | "permission_reconcile" | "permission_change_reporting" | "permission_disconnect" | "permission_revoke_products" | "permission_revoke_orders" | "permission_select_accounts" | "permission_select_reporting", feature: PermissionFeature, fields: Record<string, string> = {}) => {
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
  useEffect(() => {
    activeView.current = true;
    return () => {activeView.current = false; pending.current?.reject(); pending.current = null;};
  }, []);

  const flow = useRef<ReturnType<typeof createPermissionExplanationFlow> | null>(null);
  if (!flow.current) flow.current = createPermissionExplanationFlow({
    canRequest: feature => callbacks.current.availability[feature] === true,
    request: async feature => {
      const requestOwner = callbacks.current.productOwner;
      const requestShopId = callbacks.current.shopifyShopId;
      const current = () => activeView.current && requestOwner === callbacks.current.productOwner
        && (!isShopifyPermission(feature) || requestShopId === callbacks.current.shopifyShopId);
      connectReply.current = null;
      let observed = false;
      let failureCode = "SHOPIFY_CONNECT_PREPARATION_UNCONFIRMED";
      if (isShopifyPermission(feature)) setShopifyFailure(null);
      try {
        let reply = await execute("permission_connect", feature);
        if (!current()) throw new Error("PERMISSION_VIEW_CHANGED");
        if (reply.kind === "scope_request") {
          const binding = {...reply.binding};
          failureCode = "SHOPIFY_SCOPE_WINDOW_UNKNOWN";
          try { await requestShopifyScopeWindow({preparation: reply, owner: requestShopId, isCurrent: current}); }
          catch (error) {
            const code = error instanceof Error ? Object.getOwnPropertyDescriptor(error, "message")?.value : null;
            if (["SHOPIFY_SCOPE_WINDOW_BINDING_INVALID", "SHOPIFY_SCOPE_WINDOW_UNAVAILABLE", "SHOPIFY_SCOPE_WINDOW_UNKNOWN"].includes(code)) failureCode = code;
            throw error;
          }
          failureCode = "SHOPIFY_CONNECT_READBACK_UNCONFIRMED";
          reply = await execute("permission_status", feature, {expectedScopeBinding: JSON.stringify(binding)});
          if (!current()) throw new Error("PERMISSION_VIEW_CHANGED");
        }
        if (isShopifyPermission(feature) && !["status", "unknown", "unavailable"].includes(reply.kind)) throw new Error("PERMISSION_READBACK_INVALID");
        productReply(reply);
        orderReply(reply);
        observed = true;
        connectReply.current = reply;
        setFeedback(reply);
        if (reply.kind === "authorization") {
          const target = permissionAuthorizationTarget(feature, reply.authorizationUrl);
          if (!target) throw new Error("PERMISSION_TARGET_INVALID");
          if (feature === "google_ads" || feature === "meta") {
            try { sessionStorage.setItem("adstable-permission-return", JSON.stringify({feature, owner: requestOwner, until: Date.now() + 600000})); } catch { /* Resume remains available if storage is disabled. */ }
          }
          globalThis.open(target, "_top");
        } else if (reply.kind === "unknown" || reply.kind === "unavailable") {
          throw new Error("PERMISSION_RESULT_UNKNOWN");
        }
      } catch (error) {
        if (isShopifyPermission(feature) && current()) setShopifyFailure({owner: requestOwner, feature, code: failureCode});
        if (isShopifyPermission(feature) && current() && !observed) {
          (feature === "shopify_products" ? callbacks.current.onProductStatus : callbacks.current.onOrderStatus)?.("unknown");
        }
        throw error;
      }
    },
  });
  const controller = flow.current;
  const [snapshot, setSnapshot] = useState(controller.snapshot);
  const open = (feature: PermissionFeature) => {
    if (hasUnknownResult || (callbacks.current.externalBusy || callbacks.current.externalLock?.current) || pending.current || checking || selectionIntent.current || selectionModel || disconnectSession.current) return;
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
  const lastSelection = useRef<Partial<Record<"google_ads" | "meta", import("../lib/shopify/permission-settings.server.js").PermissionSelection>>>({});
  const openSelection = useCallback((reply: PermissionSettingsResult) => {
    if ((callbacks.current.externalBusy || callbacks.current.externalLock?.current) || pending.current || selectionIntent.current || controller.snapshot.phase !== "idle" || reply.kind !== "status" || !reply.selection
      || (reply.feature !== "google_ads" && reply.feature !== "meta")
      || !["select_account", "select_reporting_account"].includes(reply.stage)) return;
    lastSelection.current[reply.feature] = reply.selection;
    const model: SelectionModel = {key: crypto.randomUUID(), feature: reply.feature,
      stage: reply.stage as SelectionModel["stage"], selection: reply.selection};
    selectionIntent.current = {owner: callbacks.current.productOwner, model, input: null, failed: false};
    setSelectionModel(model);
  }, [controller]);
  useEffect(() => {
    // The marker records an explicit Connect in this browser, never a grant.
    // Only the authenticated loader's version-bound pending inventory can open.
    let marker;
    try { marker = JSON.parse(sessionStorage.getItem("adstable-permission-return") ?? "null"); } catch { return; }
    if (!marker || availability[marker.feature as PermissionFeature] !== true || (callbacks.current.externalBusy || callbacks.current.externalLock?.current) || marker.owner !== productOwner || !Number.isSafeInteger(marker.until) || marker.until < Date.now() || marker.until > Date.now() + 600000 || !["google_ads", "meta"].includes(marker.feature)) return;
    const reply = initialProviders?.[marker.feature as "google_ads" | "meta"]?.permission;
    if (reply?.kind !== "status" || !reply.selection) return;
    if (pending.current || selectionIntent.current || controller.snapshot.phase !== "idle") return;
    try { sessionStorage.removeItem("adstable-permission-return"); } catch { return; }
    openSelection(reply);
  }, [initialProviders?.google_ads?.permission, initialProviders?.meta?.permission, productOwner, externalBusy, controller, openSelection]);
  const viewOwner = useRef(productOwner);
  useEffect(() => {
    if (viewOwner.current === productOwner) return;
    viewOwner.current = productOwner;
    setShopifyFailure(null);
    pending.current?.reject(); pending.current = null;
    selectionIntent.current = null; disconnectSession.current = null; disconnectIntent.current = false;
    lastSelection.current = {}; connectReply.current = null; setProviderFeedback({});
    setSelectionModel(null); setDisconnectModel(null); setFeedback(null);
    setChecking(false); setCheckingFeature(null); setSelectionActivity(null);
    setSnapshot(controller.invalidate());
  }, [productOwner, controller]);
  const checkStatus = async (feature: PermissionFeature, openNext = false) => {
    if (pending.current || selectionIntent.current || disconnectSession.current || ["explaining", "hiding_for_cancel", "hiding_for_connect", "starting"].includes(controller.snapshot.phase)) return;
    setChecking(true);
    setCheckingFeature(feature);
    const requestOwner = callbacks.current.productOwner;
    try {
      const reply = await execute("permission_status", feature);
      if (!activeView.current || requestOwner !== callbacks.current.productOwner) return;
      productReply(reply);
      orderReply(reply);
      setFeedback(reply);
      if (reply.kind === "status" || reply.kind === "unavailable") {
        controller.statusObserved(controller.snapshot.session, reply.feature);
        setSnapshot(controller.snapshot);
        if (openNext) {
          if (reply.kind === "status" && reply.stage === "reporting_selected") callbacks.current.onResume(reply.feature, reply.stage);
          else openSelection(reply);
        }
      }
    } catch {
      if (activeView.current && requestOwner === callbacks.current.productOwner) setFeedback({kind: "unknown", feature});
      if (isShopifyPermission(feature) && requestOwner === callbacks.current.productOwner) {
        (feature === "shopify_products" ? callbacks.current.onProductStatus : callbacks.current.onOrderStatus)?.("unknown");
      }
    }
    finally { setChecking(false); setCheckingFeature(null); }
  };
  const confirmSelection = useCallback((key: string, input: SelectionInput, hide: () => void) => {
    const active = selectionIntent.current;
    if (!active || active.owner !== callbacks.current.productOwner || active.model.key !== key || active.input || active.failed || pending.current) return;
    active.input = {...input, ...(input.accountIds ? {accountIds: [...input.accountIds]} : {})};
    setChecking(true);
    setCheckingFeature(active.model.feature);
    setSelectionActivity("Saving selection…");
    try { hide(); } catch {
      active.failed = true;
      setChecking(true);
      setFeedback({kind: "unknown", feature: active.model.feature});
    }
  }, []);
  const afterSelectionHide = useCallback(async (key: string) => {
    const active = selectionIntent.current;
    if (!active || active.owner !== callbacks.current.productOwner || active.model.key !== key) return;
    selectionIntent.current = null;
    setSelectionModel(null);
    if (!active.input || active.failed) { setCheckingFeature(null); setChecking(false); setSelectionActivity(null); return; }
    const {model, input} = active;
    const owner = active.owner;
    setChecking(true);
    setSelectionActivity("Saving selection…");
    try {
      const intent = model.stage === "select_account" ? "permission_select_accounts" : model.stage === "change_reporting" ? "permission_change_reporting" : "permission_select_reporting";
      const fields: Record<string, string> = {connectionId: model.selection.connectionId, version: String(model.selection.version)};
      if (model.stage === "select_account") fields.selectedAccountIds = JSON.stringify(input.accountIds ?? []);
      else fields.reportingAccountId = input.accountIds[0] ?? "";
      const reply = await execute(intent, model.feature, fields);
      if (!activeView.current || owner !== callbacks.current.productOwner) return;
      setFeedback(reply);
      if (reply.kind === "status" && reply.stage === "reporting_selected" && reply.connection) callbacks.current.onConnection?.(model.feature, reply.connection);
      else openSelection(reply);
    } catch { if (activeView.current && owner === callbacks.current.productOwner) setFeedback({kind: "unknown", feature: model.feature}); }
    finally { setChecking(false); setCheckingFeature(null); setSelectionActivity(null); }
  }, [execute, openSelection]);
  const busy = externalBusy || checking || selectionModel !== null || disconnectModel !== null || ["explaining", "hiding_for_cancel", "hiding_for_connect", "starting"].includes(snapshot.phase);
  const productRemovalUnknown = () => {
    callbacks.current.onProductStatus?.("unknown");
    setProductRemovalResult("unknown");
  };
  const removeProductAccess = async () => {
    if (hasUnknownResult || pending.current || busy || removingProduct || selectionIntent.current || controller.snapshot.phase === "explaining") return;
    const owner = callbacks.current.productOwner;
    if (!owner) return;
    setRemovingProduct(true); setChecking(true); setCheckingFeature("shopify_products");
    setProductRemovalResult(null);
    try {
      const reply = await execute("permission_revoke_products", "shopify_products");
      if (owner !== callbacks.current.productOwner) return;
      if (reply.kind === "status" && reply.stage === "request_permissions") {
        productReply(reply); setProductRemovalResult("removed");
        setFeedback(reply);
      } else productRemovalUnknown();
    } catch {if (owner === callbacks.current.productOwner) productRemovalUnknown();}
    finally {setRemovingProduct(false); setChecking(false); setCheckingFeature(null);}
  };
  const orderRemovalUnknown = () => {
    callbacks.current.onOrderStatus?.("unknown"); setOrderRemovalResult("unknown");
  };
  const removeOrderAccess = async () => {
    if (hasUnknownResult || pending.current || busy || removingOrder || selectionIntent.current || controller.snapshot.phase === "explaining") return;
    const owner = callbacks.current.productOwner;
    if (!owner) return;
    setRemovingOrder(true); setChecking(true); setCheckingFeature("shopify_orders"); setOrderRemovalResult(null);
    try {
      const reply = await execute("permission_revoke_orders", "shopify_orders");
      if (owner !== callbacks.current.productOwner) return;
      if (reply.kind === "status" && reply.stage === "request_permissions") {
        orderReply(reply); setOrderRemovalResult("removed"); setFeedback(reply);
      } else orderRemovalUnknown();
    } catch {if (owner === callbacks.current.productOwner) orderRemovalUnknown();}
    finally {setRemovingOrder(false); setChecking(false); setCheckingFeature(null);}
  };
  const resume = () => {
    if (feedback?.kind !== "status") return;
    if (feedback.stage === "products_required") open("shopify_products");
    else if (permissionResumeTarget(feedback.stage) === "explanation") open(feedback.feature);
    else if (feedback.feature === "google_ads" || feedback.feature === "meta") {
      if (feedback.selection) openSelection(feedback);
      else void checkStatus(feedback.feature, true);
    } else callbacks.current.onResume(feedback.feature, feedback.stage);
  };
  // Resume reconciles uncertain results using only existing durable records.
  // Pending inventory may be reused only with the identical server-read binding.
  const resumeProvider = async (feature: "google_ads" | "meta") => {
    if ((callbacks.current.externalBusy || callbacks.current.externalLock?.current) || pending.current || checking || selectionIntent.current || disconnectModel || controller.snapshot.phase === "explaining") return;
    const owner = callbacks.current.productOwner;
    const previous = providerFeedback[feature] ?? callbacks.current.initialProviders?.[feature]?.permission;
    const uncertain = previous?.kind === "unknown" || controller.snapshot.feature === feature && controller.snapshot.phase === "unknown"
      || callbacks.current.initialProviders?.[feature]?.view === "error";
    setChecking(true); setCheckingFeature(feature);
    try {
      let reply = await execute(uncertain ? "permission_reconcile" : "permission_status", feature);
      if (!activeView.current || owner !== callbacks.current.productOwner) return;
      controller.statusObserved(controller.snapshot.session, feature); setSnapshot(controller.snapshot);
      if (reply.kind === "status" && reply.stage === "reporting_selected" && reply.connection) {
        callbacks.current.onConnection?.(feature, reply.connection);
      } else if (reply.kind === "status" && reply.stage === "request_permissions") {
        callbacks.current.onDisconnected?.(feature);
        // A confirmed missing grant opens the explanation, never native consent.
        setChecking(false); setCheckingFeature(null);
        const next = controller.open(feature); if (next) setSnapshot(next);
      } else if (reply.kind === "status" && reply.selection) {
        if (uncertain && reply.stage === "select_account" && reply.selection.accounts.length === 0) {
          const old = previous?.kind === "status" ? previous.selection : lastSelection.current[feature];
          if (old && old.connectionId === reply.selection.connectionId && old.version === reply.selection.version) reply = {...reply, selection: old};
          else { setFeedback({kind: "unknown", feature}); return; }
        }
        openSelection(reply);
      }
      if (reply.kind === "unavailable") {const next = controller.open(feature); if (next) setSnapshot(next);}
      setFeedback(reply);
    } catch { if (activeView.current && owner === callbacks.current.productOwner) setFeedback({kind: "unknown", feature}); }
    finally { setChecking(false); setCheckingFeature(null); }
  };
  const manageProvider = async (feature: "google_ads" | "meta", operation: "reporting" | "disconnect") => {
    if (callbacks.current.externalLock?.current || hasUnknownResult || pending.current || busy || selectionIntent.current || disconnectSession.current) return;
    const owner = callbacks.current.productOwner;
    if (operation === "disconnect") {
      const current = providerFeedback[feature];
      const expected = current?.kind === "status" && current.stage === "reporting_selected" && current.connection
        ? current.connection : callbacks.current.initialProviders?.[feature]?.connectionBinding;
      if (!expected || !expected.connectionId || !Number.isSafeInteger(expected.version) || expected.version < 1) {
        setFeedback({kind: "unknown", feature}); return;
      }
      const model: DisconnectModel = {key: crypto.randomUUID(), feature, owner,
        expected: {connectionId: expected.connectionId, version: expected.version}};
      disconnectIntent.current = false; disconnectSession.current = model; setDisconnectModel(model);
      return; // Opening and cancelling confirmation perform no I/O.
    }
    setChecking(true); setCheckingFeature(feature);
    try {
      const reply = await execute("permission_reconcile", feature);
      if (!activeView.current || owner !== callbacks.current.productOwner) return;
      setFeedback(reply);
      if (reply.kind !== "status" || reply.stage !== "reporting_selected" || !reply.connection) return;
      const model: SelectionModel = {key: crypto.randomUUID(), feature, stage: "change_reporting", selection: reply.connection};
      selectionIntent.current = {owner, model, input: null, failed: false}; setSelectionModel(model);
    } catch {if (activeView.current && owner === callbacks.current.productOwner) setFeedback({kind: "unknown", feature});}
    finally {setChecking(false); setCheckingFeature(null);}
  };
  const confirmDisconnect = (hide: () => void) => {
    if (!disconnectModel || disconnectSession.current?.key !== disconnectModel.key || disconnectModel.owner !== callbacks.current.productOwner || disconnectIntent.current || pending.current) return;
    disconnectIntent.current = true;
    try {hide();} catch {disconnectIntent.current = false; disconnectSession.current = null; setDisconnectModel(null); setFeedback({kind: "unknown", feature: disconnectModel.feature});}
  };
  const afterDisconnectHide = useCallback(async () => {
    const model = disconnectModel;
    if (!model || disconnectSession.current?.key !== model.key) return;
    disconnectSession.current = null; setDisconnectModel(null);
    const confirmed = disconnectIntent.current; disconnectIntent.current = false;
    if (!confirmed || model.owner !== callbacks.current.productOwner) return;
    setChecking(true); setCheckingFeature(model.feature); setSelectionActivity("Disconnecting…");
    try {
      const reply = await execute("permission_disconnect", model.feature, {connectionId: model.expected.connectionId, version: String(model.expected.version)});
      if (!activeView.current || model.owner !== callbacks.current.productOwner) return;
      setFeedback(reply);
      if (reply.kind === "status" && reply.stage === "request_permissions") {
        delete lastSelection.current[model.feature];
        clearProviderFeedback(model.feature); callbacks.current.onDisconnected?.(model.feature);
      }
    } catch {if (activeView.current && model.owner === callbacks.current.productOwner) setFeedback({kind: "unknown", feature: model.feature});}
    finally {if (activeView.current && model.owner === callbacks.current.productOwner) {setChecking(false); setCheckingFeature(null); setSelectionActivity(null);}}
  }, [disconnectModel, execute, clearProviderFeedback]);
  const providerContent = (feature: "meta" | "google_ads" | "klaviyo") => {
    const reply = providerFeedback[feature] ?? null;
    if (feature !== "klaviyo") {
      const phase = snapshot.feature === feature ? snapshot.phase : "idle";
      const base = callbacks.current.initialProviders?.[feature];
      if (!base && !reply && phase === "idle") return null;
      const ownBusy = checkingFeature === feature && checking || ["starting", "hiding_for_connect", "awaiting_status"].includes(phase);
      if (ownBusy) return <s-banner tone="info" heading={selectionActivity ?? "Verifying access…"} />;
      if (phase === "explaining" || selectionModel?.feature === feature) return null;
      if (reply?.kind === "unavailable") return <s-banner tone="warning" heading="Connection setup is not available yet." />;
      const unknown = reply?.kind === "unknown" || phase === "unknown" || base?.view === "error" && !reply;
      const connected = reply?.kind === "status" && reply.stage === "reporting_selected" || !reply && base?.view === "connected";
      if (connected && !unknown) return null;
      const disconnected = !reply && base?.view === "disconnected";
      const stage = reply?.kind === "status" ? reply.stage
        : base?.permission?.kind === "status" ? base.permission.stage
        : base?.view === "pending_reporting" ? "select_reporting_account"
        : base?.view === "pending" ? "select_account" : null;
      const explanation = unknown || disconnected ? null
        : stage === "select_reporting_account" ? "Select your reporting account to finish setup."
        : stage === "select_account" ? "Select your advertiser accounts to finish setup."
        : stage === "request_permissions" || base?.view === "permissions_incomplete" ? "Complete your permissions to finish setup." : null;
      return <s-stack direction="block" gap="base">
        {unknown ? <s-banner tone="warning" heading="We could not confirm the result. Resume setup to check the current connection status." />
          : <s-badge tone={disconnected ? undefined : "warning"}>{disconnected ? "Not connected" : "Resume setup"}</s-badge>}
        {explanation ? <s-paragraph>{explanation}</s-paragraph> : null}
        {disconnected && base?.notice === "disconnected" ? <s-banner tone="success">{feature === "meta" ? "Meta was disconnected." : "Google Ads was disconnected."}</s-banner> : null}
        <s-button disabled={busy ? true : undefined} onClick={() => disconnected ? open(feature) : void resumeProvider(feature)}>
          {disconnected ? feature === "meta" ? "Connect Meta" : "Connect Google Ads" : "Resume setup"}
        </s-button>
      </s-stack>;
    }
    const phase = snapshot.feature === feature ? snapshot.phase : "idle";
    const ownChecking = checking && checkingFeature === feature;
    if (!reply && snapshot.feature !== feature && !ownChecking) return null;
    const status = ownChecking ? <s-banner tone="info" heading={selectionActivity ?? "Checking connection status…"} />
    : reply?.kind === "unavailable" ? (
    <s-banner tone="warning" heading="Connection setup is not available yet." />
  ) : reply?.kind === "unknown" || phase === "unknown" ? (
    <s-banner tone="critical" heading="We could not confirm the result. Check the connection status before starting again." />
  ) : reply?.kind === "status" && (reply.stage === "existing_reporting_connection" || reply.stage === "reporting_selected") ? null
    : reply?.kind === "status" ? (
    <s-stack direction="block" gap="base">
      <s-banner tone="info" heading={reply.stage === "review_setup"
        ? "Access verified. Setup is awaiting activation."
        : reply.stage === "products_required" ? "Product access is still missing. Resume setup when you are ready."
        : reply.stage === "klaviyo_cost_missing"
          ? "Add the estimated 30-day email spend to finish setup. Enter 0 if there is no cost."
        : reply.feature === "klaviyo" && reply.stage === "select_account"
          ? "Finish the remaining Klaviyo setup step with Resume setup."
        : reply.stage === "select_account" || reply.stage === "select_reporting_account"
          ? "Choose the account to use for reporting." : "Resume setup"} />
      {reply.stage === "request_permissions" || reply.stage === "products_required" || reply.feature === "klaviyo"
        || ["select_account", "select_reporting_account"].includes(reply.stage)
        ? <s-button disabled={busy ? true : undefined} onClick={resume}>Resume setup</s-button> : null}
    </s-stack>
  ) : ["hiding_for_connect", "starting", "awaiting_status"].includes(phase) ? (
    <s-banner tone="info" heading="Starting connection…" />
  ) : null;
    return <>
      {status}
      {phase !== "explaining" ? (
        <s-button disabled={busy || selectionModel ? true : undefined} onClick={() => checkStatus(feature)}>Check status</s-button>
      ) : null}
    </>;
  };
  return {
    canManage: (feature: "google_ads" | "meta") => !busy && !hasUnknownResult,
    open, checkStatus, resumeProvider, manageProvider, busy: busy || hasUnknownResult, snapshot, providerContent,
    shopifyFailureCode,
    removeProductAccess, removingProduct, productRemovalResult, productRemovalUnknown,
    removeOrderAccess, removingOrder, orderRemovalResult, orderRemovalUnknown,
    checkingProduct: checking ? checkingFeature === "shopify_products" : snapshot.phase === "starting" && snapshot.feature === "shopify_products",
    checkingOrder: checking ? checkingFeature === "shopify_orders" : snapshot.phase === "starting" && snapshot.feature === "shopify_orders",
    content: <>
      {disconnectModel ? <PermissionProviderDisconnect key={disconnectModel.key} feature={disconnectModel.feature} onConfirm={confirmDisconnect} onAfterHide={afterDisconnectHide} /> : null}
      {selectionModel ? <PermissionSetupSelection key={selectionModel.key} model={selectionModel} busy={checking} onConfirm={confirmSelection} onAfterHide={afterSelectionHide} /> : null}
      <PermissionExplanation snapshot={snapshot} requestsAvailable={snapshot.feature ? availability[snapshot.feature] : false}
        unavailableReason={snapshot.feature ? unavailableReasons?.[snapshot.feature] : undefined}
        onConnect={connect} onHide={hide} onAfterHide={afterHide} />
    </>,
  };
}
