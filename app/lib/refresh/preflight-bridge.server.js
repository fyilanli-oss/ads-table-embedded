import {createHash} from "node:crypto";
import {planRefreshPreflightAdmissions} from "./admission-policy.server.js";
import {runRefreshChunk} from "./chunk-worker.server.js";

// Internal composition only. No route, scheduler, native provider, date policy or Dataset writer.
export async function dispatchRefreshPreflight({store, buildWorkPlan, entitlementVerifier, readPage, validatePage, now}) {
  if (!["readPreflightSnapshot","commitPreflight","loadBoundAuthority"].every(key=>typeof store?.[key]==="function")
    || [buildWorkPlan,readPage,validatePage,now,entitlementVerifier?.verify,entitlementVerifier?.isCurrent].some(fn=>typeof fn!=="function")) {
    throw new Error("REFRESH_PREFLIGHT_INPUT_INVALID");
  }
  let claim;
  try {
    const snapshot=await store.readPreflightSnapshot();
    if(snapshot?.configured!==true) return {status:"not_configured"};
    const candidates=[];
    const plans=new Map();
    for(const source of snapshot.candidates) {
      // This trusted planner must explicitly choose an eligible period, partition and workload.
      // Missing policy is not permission to invent dates or backfill disconnected periods.
      const plan=structuredClone(await buildWorkPlan(structuredClone(source)));
      if(plan===null) continue;
      const current=now(),l=plan?.limits,w=plan?.window;
      if(typeof plan?.partitionId!=="string"||plan.partitionId.length<1||plan.partitionId.length>256
        || !["requestTimeoutMs","finishReserveMs","maxRows","maxBytes","deadlineAt"].every(k=>Number.isSafeInteger(l?.[k])&&l[k]>0)
        || l.requestTimeoutMs>2_147_483_647||!Number.isSafeInteger(current)||current<0||l.deadlineAt-current<l.requestTimeoutMs+l.finishReserveMs
        || !Number.isSafeInteger(plan.cost?.requests)||plan.cost.requests<2
        || !["dbWrites","connections"].every(k=>Number.isSafeInteger(plan.cost?.[k])&&plan.cost[k]>0)
        || !["rows","bytes"].every(k=>Number.isSafeInteger(plan.cost?.[k])&&plan.cost[k]>=0)
        || l.maxRows>plan.cost.rows||l.maxBytes>plan.cost.bytes
        || ![w?.from,w?.to].every(d=>typeof d==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(`${d}T00:00:00Z`).toISOString().slice(0,10)===d)
        || w.from>w.to) return {status:"work_plan_required"};
      const id=createHash("sha256").update(JSON.stringify([source,plan.partitionId,w])).digest("hex");
      const job={id,workspaceId:source.workspaceId,installGeneration:source.installGeneration,provider:source.provider,accountId:source.accountId,
        scheduledHour:source.scheduledHour,queuedAt:source.queuedAt,workClass:plan.workClass,cost:plan.cost,
        authority:{installationVerified:true,connected:true,setupComplete:true,allowedWindow:true}};
      candidates.push(job);plans.set(id,{source,plan});
    }
    const proposal=planRefreshPreflightAdmissions({...snapshot,candidates,now:now()});
    if(proposal.status!=="proposed") return {status:proposal.status,deferred:proposal.deferred};
    const selected=proposal.admitted[0],binding=plans.get(selected.id);
    const accepted=await store.commitPreflight({expectedRevision:snapshot.state.revision,queueRevision:snapshot.queueRevision,
      nextState:proposal.nextState,source:binding.source,window:binding.plan.window,partitionId:binding.plan.partitionId,deadlineAt:binding.plan.limits.deadlineAt});
    if(accepted!==true) return {status:"conflict"};
    claim=selected;
    return {claim:structuredClone(claim),...await runRefreshChunk({claim,window:binding.plan.window,limits:binding.plan.limits,store,
      loadAuthority:context=>store.loadBoundAuthority(context),verifyEntitlement:context=>entitlementVerifier.verify(context),
      isEntitlementCurrent:context=>entitlementVerifier.isCurrent(context),readPage,validatePage,now})};
  } catch {
    // An unknown commit outcome cannot authorize execution or automatic reservation release.
    return {status:"needs_attention",reason:"preflight_unavailable",reservationMayExist:true,...claim?{claim}: {}};
  }
}
