import {refreshWorkIdentity} from "./work-stop-policy.server.js";
import {refreshQuotaWait,refreshQuotaWaitBoundary} from "./quota-work-wait.server.js";

// One already-reserved chunk only. No routes, native provider adapters, Dataset writer or retry loop.
export async function runRefreshChunk({claim: suppliedClaim, window: suppliedWindow, limits: suppliedLimits, store, loadAuthority, verifyEntitlement, isEntitlementCurrent, readPage, validatePage, now}) {
  const claim=structuredClone(suppliedClaim);
  refreshWorkIdentity(claim,{claimRequired:true});
  const window=structuredClone(suppliedWindow);
  const limits=structuredClone(suppliedLimits);
  const inputInvalid=()=>{throw new Error("REFRESH_CHUNK_INPUT_INVALID");};
  if (!["advanceStage","isClaimCurrent","readAdmissionSnapshot","recordStop"].every(key=>typeof store?.[key]==="function")
    || [loadAuthority,verifyEntitlement,isEntitlementCurrent,readPage,validatePage,now].some(fn=>typeof fn!=="function")) inputInvalid();
  for(const field of ["requestTimeoutMs","finishReserveMs","maxRows","maxBytes","deadlineAt"]) {
    if(!Number.isSafeInteger(limits?.[field])||limits[field]<1) inputInvalid();
  }
  if(limits.requestTimeoutMs>2_147_483_647||!window||typeof window.from!=="string"||typeof window.to!=="string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(window.from)||!/^\d{4}-\d{2}-\d{2}$/.test(window.to)||window.from>window.to
    || !["requests","dbWrites","connections"].every(key=>Number.isSafeInteger(claim.cost?.[key])&&claim.cost[key]>=1)
    || !Number.isSafeInteger(claim.cost?.rows)||limits.maxRows>claim.cost.rows
    || !Number.isSafeInteger(claim.cost?.bytes)||limits.maxBytes>claim.cost.bytes) inputInvalid();
  const started=now();
  if(!Number.isSafeInteger(started)||started<0) inputInvalid();
  for(const date of [window.from,window.to]) {
    try {if(new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date) inputInvalid();} catch {inputInvalid();}
  }
  let phase=null;
  const context=()=>({claim:structuredClone(claim),window:structuredClone(window)});
  const timeLeft=()=>{const current=now();return Number.isSafeInteger(current)&&current>=started?limits.deadlineAt-current:-1;};
  const authorityAllowed=a=>a&&["workspaceId","installGeneration","provider","accountId"].every(key=>a[key]===claim[key])
    && ["installationVerified","connected","setupComplete","allowedWindow"].every(key=>a[key]===true)
    && typeof a.connectionId==="string"&&a.connectionId.length>0&&a.connectionId.length<=256
    && Number.isSafeInteger(a.connectionVersion)&&a.connectionVersion>0;
  async function advance(next, rows=0, bytes=0) {
    const accepted=await store.advanceStage({claim,window,expectedStage:phase,stage:next,rows,bytes});
    if(accepted!==true) return false;
    phase=next;return true;
  }
  async function stop(reason, externalOutcome) {
    try {
      const snapshot=await store.readAdmissionSnapshot();
      const recorded=await store.recordStop({job:claim,reason,expectedRevision:snapshot.state.revision});
      return {status:recorded?.recorded===true?(externalOutcome==="unknown"?"uncertain":"paused"):"needs_attention",
        phase,reason,externalOutcome,stopRecorded:recorded?.recorded===true};
    } catch {return {status:"needs_attention",phase,reason:"stop_tracking_unavailable",externalOutcome,stopRecorded:false};}
  }
  async function waitForQuota(wait) {
    const boundary=refreshQuotaWaitBoundary(wait);
    try {
      if(typeof store.deferQuotaWait!=="function") throw Error();
      const accepted=await store.deferQuotaWait({claim,window,wait});
      return {status:accepted===true?"quota_waiting":"needs_attention",phase,waitingBoundary:boundary,boundaryExternalOutcome:"not_sent",
        externalOutcome:boundary==="entitlement"?"not_sent":"settled",
        waitRecorded:accepted===true,reservationRetained:accepted!==true};
    } catch {return {status:"needs_attention",phase,reason:"quota_wait_tracking_unavailable",reservationRetained:true};}
  }
  let sent=false;
  let settled=false;
  async function authoritySnapshot() {
    try {return structuredClone(await loadAuthority(context()));} catch {return null;}
  }
  try {
    if(!await advance("checking_authority")) return {status:"not_current",phase};
    const authority=await authoritySnapshot();
    if(!authorityAllowed(authority)) return stop("authority_required","not_sent");
    if(timeLeft()<limits.requestTimeoutMs+limits.finishReserveMs) return stop("stopped_before_call","not_sent");
    if(!await advance("request_intent")) return {status:"not_current",phase};
    let entitlement;
    try {entitlement=await verifyEntitlement(context());} catch {return stop("request_outcome_unknown","unknown");}
    if(refreshQuotaWaitBoundary(entitlement)==="entitlement") return waitForQuota(entitlement);
    if(entitlement?.status!=="verified") {
      if(entitlement?.externalOutcome==="unknown") return stop("request_outcome_unknown","unknown");
      return stop(entitlement?.status==="denied"?"entitlement_required":"stopped_before_call","not_sent");
    }
    if(timeLeft()<limits.requestTimeoutMs+limits.finishReserveMs) return stop("stopped_before_call","not_sent");
    // Read current authority again after persistence. A cached initial credential is not enough.
    const current=await authoritySnapshot();
    if(!authorityAllowed(current)||current.connectionId!==authority.connectionId||current.connectionVersion!==authority.connectionVersion) {
      return stop("authority_required","not_sent");
    }
    if(timeLeft()<limits.requestTimeoutMs+limits.finishReserveMs) return stop("stopped_before_call","not_sent");
    if(await store.isClaimCurrent({claim})!==true) return {status:"not_current",phase};
    if(await isEntitlementCurrent({...context(),receipt:entitlement.receipt})!==true) return stop("entitlement_required","not_sent");
    if(timeLeft()<limits.requestTimeoutMs+limits.finishReserveMs) return stop("stopped_before_call","not_sent");
    const controller=new AbortController();
    let timer;
    let observed;
    try {
      const expired=new Promise(resolve=>{timer=setTimeout(()=>resolve({kind:"unknown"}),limits.requestTimeoutMs);});
      sent=true;
      const response=Promise.resolve().then(()=>readPage({...context(),authority:structuredClone(current),signal:controller.signal}))
        .then(value=>({kind:"returned",value}),error=>{
          const wait=refreshQuotaWait(error,"provider_page",claim);
          return wait?{kind:"quota_wait",wait}:{kind:"unknown"};
        });
      observed=await Promise.race([response,expired]);
      if(observed.kind==="unknown") controller.abort();
    } finally {clearTimeout(timer);}
    // Abort/timeout/transport rejection is NOT proof that the remote operation stopped.
    if(observed.kind==="unknown") return stop("request_outcome_unknown","unknown");
    if(observed.kind==="quota_wait") return waitForQuota(observed.wait);
    settled=true;
    if(!await advance("response_received")) return {status:"not_current",phase,externalOutcome:"settled"};
    if(observed.value?.kind==="rejected") {
      const reason=["provider_permission_denied","provider_throttled","provider_rejected"].includes(observed.value.reason)
        ?observed.value.reason:"provider_unknown_error";
      return stop(reason,"settled");
    }
    if(timeLeft()<limits.finishReserveMs) return stop("worker_stopped","settled");
    let rows;
    let bytes;
    try {
      if(observed.value?.kind!=="complete") throw new Error();
      const result=validatePage({...context(),authority:structuredClone(current),payload:observed.value.payload});
      if(result&&typeof result.then==="function") {
        // Async validators are unsupported; observe rejection without treating it as validation success.
        void Promise.resolve(result).catch(()=>{});
        throw new Error();
      }
      if(result?.complete!==true||!Array.isArray(result.rows)||result.rows.length>limits.maxRows) throw new Error();
      rows=structuredClone(result.rows);
      bytes=Buffer.byteLength(JSON.stringify(rows),"utf8");
      if(bytes>limits.maxBytes) throw new Error();
    } catch {return stop("validation_failed_after_request","settled");}
    const beforeHandoff=await authoritySnapshot();
    if(!authorityAllowed(beforeHandoff)||beforeHandoff.connectionId!==current.connectionId||beforeHandoff.connectionVersion!==current.connectionVersion
      || await isEntitlementCurrent({...context(),receipt:entitlement.receipt})!==true) {
      return stop("authority_check_failed_after_request","settled");
    }
    if(timeLeft()<limits.finishReserveMs) return stop("worker_stopped","settled");
    if(!await advance("ready_for_dataset",rows.length,bytes)) return {status:"not_current",phase,externalOutcome:"settled"};
    // This is an in-memory handoff, NOT a durable Dataset commit, checkpoint or successful refresh.
    return {status:"awaiting_dataset",phase,rows,bytes,externalOutcome:"settled",reservationRetained:true};
  } catch {
    return {status:"needs_attention",phase,reason:"progress_or_authority_unavailable",
      externalOutcome:sent?(settled?"settled":"unknown"):"not_sent",reservationRetained:true};
  }
}
