import {PERMISSION_EXPLANATIONS} from "./permission-explanation-copy.js";

const resumeTargets = Object.freeze({
  request_permissions: "explanation",
  select_account: "account",
  select_reporting_account: "reporting_account",
  review_setup: "activation_pending",
  klaviyo_cost_missing: "cost",
});

export function permissionResumeTarget(stage) {
  return typeof stage === "string" && Object.hasOwn(resumeTargets, stage) ? resumeTargets[stage] : "check_status";
}

// UI intent only. Request adapters must authenticate and enforce all server gates.
// Each instance belongs to one Settings view, not one instance per provider.
export function createPermissionExplanationFlow({request, canRequest = () => false} = {}) {
  let sequence = 0;
  let state = Object.freeze({phase: "idle", feature: null, session: 0});
  const set = (phase) => { state = Object.freeze({...state, phase}); return state; };
  const current = session => session === state.session;
  return Object.freeze({
    get snapshot() { return state; },
    open(feature) {
      if (typeof feature !== "string" || !Object.hasOwn(PERMISSION_EXPLANATIONS, feature) || state.phase !== "idle") return null;
      state = Object.freeze({phase: "explaining", feature, session: ++sequence});
      return state;
    },
    connect(session, hideOverlay) {
      if (!current(session) || state.phase !== "explaining") return false;
      let available = false;
      try { available = canRequest(state.feature) === true && typeof request === "function"; } catch {}
      if (!available) { set("unavailable"); return false; }
      // Capture intent before native hide dispatches synchronously.
      set("hiding_for_connect");
      try { hideOverlay(); } catch { set("unknown"); return false; }
      return true;
    },
    hide(session) {
      if (!current(session)) return false;
      if (state.phase === "explaining" || state.phase === "unavailable") {
        set("hiding_for_cancel");
        return true;
      }
      return false;
    },
    async afterHide(session) {
      if (!current(session)) return false;
      if (["explaining", "hiding_for_cancel", "unavailable"].includes(state.phase)) {
        state = Object.freeze({...state, phase: "idle", feature: null});
        return false;
      }
      if (state.phase !== "hiding_for_connect") return false;
      const feature = state.feature;
      set("starting");
      try {
        // Recheck after animation: a closed gate must not dispatch a request.
        if (canRequest(feature) !== true) { set("unavailable"); return false; }
        await request(feature);
        // A resolved adapter is not proof of a grant or a completed setup.
        set("awaiting_status");
      } catch { set("unknown"); }
      return true;
    },
    statusObserved(session, feature) {
      if (!current(session) || feature !== state.feature || !["awaiting_status", "unknown", "unavailable"].includes(state.phase)) return false;
      set("idle");
      return true;
    },
  });
}
