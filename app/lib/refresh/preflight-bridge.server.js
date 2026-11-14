import {createHash} from "node:crypto";
import {planRefreshPreflightAdmissions} from "./admission-policy.server.js";
import {runRefreshChunk} from "./chunk-worker.server.js";
import {reconcileStoredDatasetSources} from "../database/dataset-reconciliation.server.js";

// Internal composition for a trusted work plan. The existing HTTP queue entry is queue-only.
export async function dispatchRefreshPreflight({store, buildWorkPlan, entitlementVerifier, readPage, validatePage, now, loadDatasetInputs,
  coordinateAdmission = reserve => reserve(), coordinateCommit = commit => commit()}) {
  if (!["readPreflightSnapshot","commitPreflight","loadBoundAuthority"].every(key=>typeof store?.[key]==="function")
    || [buildWorkPlan,readPage,validatePage,now,entitlementVerifier?.verify,entitlementVerifier?.isCurrent].some(fn=>typeof fn!=="function")) {
    throw new Error("REFRESH_PREFLIGHT_INPUT_INVALID");
  }
  if (loadDatasetInputs !== undefined && typeof loadDatasetInputs !== "function") throw Error("REFRESH_DATASET_INPUT_INVALID");
  let claim;
  try {
    const reservation = await coordinateAdmission(async () => {
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
          || w.from>w.to || loadDatasetInputs!==undefined && w.from!==w.to) return {status:"work_plan_required"};
        const id=createHash("sha256").update(JSON.stringify([source,plan.partitionId,w])).digest("hex");
        const job={id,workspaceId:source.workspaceId,installGeneration:source.installGeneration,provider:source.provider,accountId:source.accountId,
          scheduledHour:source.scheduledHour,queuedAt:source.queuedAt,workClass:plan.workClass,cost:plan.cost,
          authority:{installationVerified:true,connected:true,setupComplete:true,allowedWindow:true}};
        candidates.push(job);plans.set(id,{source,plan});
      }
      const proposal=planRefreshPreflightAdmissions({...snapshot,candidates,now:now()});
      if(proposal.status!=="proposed") return {status:proposal.status,deferred:proposal.deferred};
      const selected=proposal.admitted[0],binding=plans.get(selected.id);
      const accepted=await coordinateCommit(() => store.commitPreflight({expectedRevision:snapshot.state.revision,queueRevision:snapshot.queueRevision,
        nextState:proposal.nextState,source:binding.source,window:binding.plan.window,partitionId:binding.plan.partitionId,deadlineAt:binding.plan.limits.deadlineAt}));
      if(accepted!==true) return {status:"conflict"};
      return {status:"reserved", claim:selected, binding};
    });
    if (reservation.status !== "reserved") return reservation;
    const {binding} = reservation;
    claim=reservation.claim;
    const result=await runRefreshChunk({claim,window:binding.plan.window,limits:binding.plan.limits,store,
      loadAuthority:context=>store.loadBoundAuthority(context),verifyEntitlement:context=>entitlementVerifier.verify(context),
      isEntitlementCurrent:context=>entitlementVerifier.isCurrent(context),readPage,validatePage,now});
    if (result.status!=="awaiting_dataset" || loadDatasetInputs===undefined) return {claim:structuredClone(claim),...result};

    const {window,limits}=binding.plan;
    const inputs=await loadDatasetInputs({claim:structuredClone(claim),window:structuredClone(window),deadlineAt:limits.deadlineAt});
    const {owner,database,cipher,batches,expectedRevision,fxResolver}=inputs;
    if (owner?.workspaceId!==claim.workspaceId || owner.generation!==claim.installGeneration || owner.provider!==claim.provider
      || owner.accountId!==claim.accountId || owner.connectionId!==binding.source.connectionId
      || owner.connectionVersion!==String(binding.source.connectionVersion) || owner.selectionEpoch!==(binding.source.selectionId ?? null)
      || await store.isClaimCurrent({claim})!==true) throw Error("REFRESH_DATASET_SCOPE_INVALID");
    const receipt=await reconcileStoredDatasetSources({owner,database,cipher,batches,expectedRevision,fxResolver,now,
      limits:{maxPages:300,maxRows:limits.maxRows,maxBytes:limits.maxBytes,deadlineAt:limits.deadlineAt},
      scheduled:true,admittedScope:{jobId:claim.id,fence:String(claim.fence),from:window.from,to:window.to}});
    return {status:receipt.jobCompleted===true?"completed":"awaiting_dataset",claim:structuredClone(claim),
      dataset:{status:receipt.status,consumerReceipt:receipt.consumerReceipt,checkpointAdvanced:receipt.checkpointAdvanced},reservationRetained:receipt.jobCompleted!==true};
  } catch {
    // An unknown commit outcome cannot authorize execution or automatic reservation release.
    return {status:"needs_attention",reason:"preflight_unavailable",reservationMayExist:true,...claim?{claim}: {}};
  }
}
