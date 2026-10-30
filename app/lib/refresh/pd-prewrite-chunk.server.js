import {runRefreshChunk} from "./chunk-worker.server.js";
import {createRefreshPdSourceReader, isRefreshPdSourceObservation, refreshPdSourceAuthorityMatches} from "./pd-source-reader.server.js";
import {createIdentityAuthorityRepository} from "../database/identity-authority-repository.server.js";
import {refreshWorkIdentity} from "./work-stop-policy.server.js";
import {reviewRefreshIntegratedPrewrite} from "./integrated-prewrite-review.server.js";
import {reviewRefreshSetupProof} from "./setup-proof-review.server.js";

const fail = () => {throw Error("PD_PREWRITE_CHUNK_INPUT_INVALID");};
const flags = {persistable: false, publishable: false, authorizes_activation: false, canonical_scope_ready: false,
  Dataset_write_performed: false, sales_roles_changed: false};

/** Structural gate for a completed in-process source read, not native proof
 * or write authority. Caller JSON and replay into a different claim are rejected.
 */
export function reviewRefreshPdPrewrite({claim, window, authority, observation}) {
  const blocked = reason => ({status: "blocked", reason, complete: false, rows: [], ...flags});
  if (!isRefreshPdSourceObservation(observation)) return blocked("source_observation_required");
  const s = observation.source_context;
  if (!s || !claim || !window || !authority || [["workspaceId", "workspace_id"], ["provider", "provider"], ["accountId", "platform_account_id"],
    ["id", "job_or_run_id"], ["fence", "claim_fence"]].some(([a, b]) => claim[a] !== s[b])
    || String(s.installation_generation) !== claim.installGeneration || window.from !== window.to || s.business_date !== window.from
    || authority.connectionId !== s.provider_connection_id || authority.connectionVersion !== s.connection_version) return blocked("source_scope_mismatch");
  const records = observation.records;
  if (observation.status !== "source_read" || !records || records.status !== "validated" || records.canonical_validated !== true
    || !Array.isArray(records.rows) || records.rows.length === 0) return blocked(records?.reason ?? "validated_records_required");
  if (observation.composition && !["composed", "not_observed"].includes(observation.composition.status)) return blocked("source_composition_incomplete");
  return {status: "reviewed_not_written", reason: null, complete: true, rows: records.rows, ...flags};
}

/** Explicit internal worker binding only. No scheduler, route or writer is wired.
 * Worker supplies the fresh claim/window/entitlement receipt and abort signal.
 */
export async function runRefreshPdPrewriteChunk({worker, source, prewrite, setup, ...extra} = {}) {
  if (Object.keys(extra).length || !worker || !source
    || Object.keys(worker).some(k => !["claim", "window", "limits", "store", "loadAuthority", "verifyEntitlement", "isEntitlementCurrent", "now"].includes(k))
    || ["claim", "window", "entitlementReceipt", "signal", "now"].some(k => Object.hasOwn(source, k))
    || typeof worker.loadAuthority !== "function" || typeof worker.isEntitlementCurrent !== "function"
    || typeof worker.now !== "function" || typeof source.database?.query !== "function") fail();
  const claim = structuredClone(worker.claim), window = structuredClone(worker.window), limits = structuredClone(worker.limits);
  refreshWorkIdentity(claim, {claimRequired: true});
  if (window.from !== window.to || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 2048
    || !Number.isSafeInteger(source.limits?.maxElapsedMs)
    || source.limits.maxElapsedMs > limits.requestTimeoutMs || source.limits.maxRows > limits.maxRows
    || source.limits.maxBytes > limits.maxBytes) fail();
  const config = {...source};
  for (const k of ["verified", "limits", "googlePd", "klaviyoPd", "recordBridge", "environment"])
    if (config[k] !== undefined) config[k] = structuredClone(config[k]);
  const loadAuthority = worker.loadAuthority, now = worker.now, entitlementCurrent=worker.isEntitlementCurrent;
  config.database = {query: source.database.query.bind(source.database)};
  const identity = createIdentityAuthorityRepository(config.database);
  async function boundedAuthority(read) {
    const remaining = Math.min(limits.requestTimeoutMs, limits.deadlineAt - now());
    if (!Number.isSafeInteger(remaining) || remaining < 1 || remaining > 2_147_483_647) fail();
    let timer;
    try {return await Promise.race([Promise.resolve().then(read), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("PD_PREWRITE_AUTHORITY_TIMEOUT")), remaining);
    })]);} finally {clearTimeout(timer);}
  }
  if(prewrite!==undefined && (!prewrite || Object.keys(prewrite).some(k=>!["identity","shopify","interaction"].includes(k))
    || !prewrite.identity || Object.keys(prewrite.identity).some(k=>!["expected","observation"].includes(k)))) fail();
  const bundle=prewrite===undefined?null:{identity:{expected:structuredClone(prewrite.identity?.expected),observation:prewrite.identity?.observation},
    shopify:prewrite.shopify?{...prewrite.shopify}:null,interaction:prewrite.interaction??null};
  if(setup!==undefined && (!setup || Object.keys(setup).some(k=>!["shopify","assets","identity"].includes(k))))fail();
  const setupInput=setup===undefined?null:{shopify:setup.shopify??null,assets:setup.assets??null,identity:setup.identity??null};
  const setupNow=config.readNow??(()=>new Date());
  let snapshot = null, review = null, integration = null, setupReview=null;
  function checkSetup() {
    if(!setupInput)return true;
    const orders=bundle?.shopify?.current;
    setupReview=reviewRefreshSetupProof({pdObservation:snapshot,...setupInput,includeOrders:bundle?.shopify!==null&&bundle?.shopify!==undefined,
      includeOrderHistory:orders?.nativeScopeObservation?.includeOrderHistory===true,now:setupNow});
    if(orders && setupReview.status==="reviewed_for_prewrite_only"
      && orders.nativeScopeObservation?.after?.evidence?.appInstallationId!==setupInput.shopify.evidence.appInstallationId)
      setupReview={...setupReview,status:"blocked",ordersReady:false,reason:"shopify_app_installation_mismatch"};
    return setupReview.status==="reviewed_for_prewrite_only";
  }
  const result = await runRefreshChunk({...worker, claim, window, limits,
    loadAuthority: async input => {
      const current = await boundedAuthority(() => loadAuthority(input));
      if (!snapshot) return current;
      if(!checkSetup())return null;
      const s = snapshot.source_context;
      const row = await boundedAuthority(() => identity.load({workspaceId: s.workspace_id, installGeneration: s.installation_generation,
        provider: s.provider, shopId: s.shop_id, shopDomain: s.shop_domain}));
      return refreshPdSourceAuthorityMatches(snapshot, row) && checkSetup() ? current : null;
    },
    isEntitlementCurrent:async input=>await entitlementCurrent(input)===true&&(!snapshot||checkSetup()),
    readPage: async ({claim, window, entitlementReceipt, signal}) => {
      snapshot = await createRefreshPdSourceReader({...config, claim, window, entitlementReceipt, signal, now}).readEvidence();
      return {kind: "complete", payload: snapshot};
    },
    validatePage: ({claim, window, authority, payload}) => {
      if (payload !== snapshot) return {complete: false, rows: []};
      review = reviewRefreshPdPrewrite({claim, window, authority, observation: snapshot});
      if(!checkSetup())review={status:"blocked",reason:setupReview.reason,complete:false,rows:[],...flags};
      if(bundle && review.complete) {
        try {integration=reviewRefreshIntegratedPrewrite({claim,window,pdObservation:snapshot,...bundle});
          if(integration.interactionReview.state==="conflicting_references") throw Error("INTEGRATED_PREWRITE_INTERACTION_CONFLICT");
        } catch(error) {review={status:"blocked",reason:/^INTEGRATED_PREWRITE_[A-Z_]+$/.test(error?.message??"")
          ?error.message:"integrated_prewrite_failed",complete:false,rows:[],...flags};}
      }
      // Account for both retained source and cloned canonical rows before the
      // worker advances. This bounds serialized output, not peak memory.
      if (Buffer.byteLength(JSON.stringify({source_observation: snapshot, rows: review.rows, integration_review:integration,setup_review:setupReview}), "utf8") + 2048 > limits.maxBytes)
        review = {status: "blocked", reason: "prewrite_result_bound_exceeded", complete: false, rows: [], ...flags};
      return review;
    }});
  const output = {...result, source_review: review ? {status: review.status, reason: review.reason} : null,
    ...(bundle?{integration_review:integration}:{}),...(setupInput?{setup_review:setupReview}:{}),source_observation: snapshot,
    handoff_kind: bundle?"integrated_prewrite_review":"pd_prewrite_only", ...flags};
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > limits.maxBytes)
    return {...result, rows: undefined, status: "needs_attention", reason: "prewrite_result_bound_exceeded",
      source_review: {status: "blocked", reason: "prewrite_result_bound_exceeded"}, source_observation: null,
      handoff_kind: "pd_prewrite_only", ...flags};
  return output;
}
