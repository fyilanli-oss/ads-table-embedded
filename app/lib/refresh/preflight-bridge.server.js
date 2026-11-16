import {createHash} from "node:crypto";
import {planRefreshPreflightAdmissions} from "./admission-policy.server.js";
import {runRefreshChunk} from "./chunk-worker.server.js";
import {reconcileStoredDatasetSources} from "../database/dataset-reconciliation.server.js";

// Internal composition for a trusted work plan. The existing HTTP queue entry is queue-only.
export async function dispatchRefreshPreflight({store, buildWorkPlan, entitlementVerifier, readPage, validatePage, now, loadDatasetInputs,
  finishKlaviyoHourlyReport}) {
  if (!["readPreflightSnapshot","commitPreflight","loadBoundAuthority"].every(key=>typeof store?.[key]==="function")
    || [buildWorkPlan,readPage,validatePage,now,entitlementVerifier?.verify,entitlementVerifier?.isCurrent].some(fn=>typeof fn!=="function")) {
    throw new Error("REFRESH_PREFLIGHT_INPUT_INVALID");
  }
  if (loadDatasetInputs !== undefined && typeof loadDatasetInputs !== "function") throw Error("REFRESH_DATASET_INPUT_INVALID");
  if (finishKlaviyoHourlyReport !== undefined && typeof finishKlaviyoHourlyReport !== "function") throw Error("REFRESH_HOURLY_REPORT_POLICY_INVALID");
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
      const hourly = plan?.hourlySource;
      const klaviyoHourly = finishKlaviyoHourlyReport !== undefined && source.provider === "klaviyo"
        && plan?.workClass === "hourly_hot_window" && hourly
        && plan.partitionId === `klaviyo-hourly-source:${hourly.start}/${hourly.end}`;
      if(typeof plan?.partitionId!=="string"||plan.partitionId.length<1||plan.partitionId.length>256
        || !["requestTimeoutMs","finishReserveMs","maxRows","maxBytes","deadlineAt"].every(k=>Number.isSafeInteger(l?.[k])&&l[k]>0)
        || l.requestTimeoutMs>2_147_483_647||!Number.isSafeInteger(current)||current<0||l.deadlineAt-current<l.requestTimeoutMs+l.finishReserveMs
        || !Number.isSafeInteger(plan.cost?.requests)||plan.cost.requests<2
        || !["dbWrites","connections"].every(k=>Number.isSafeInteger(plan.cost?.[k])&&plan.cost[k]>0)
        || !["rows","bytes"].every(k=>Number.isSafeInteger(plan.cost?.[k])&&plan.cost[k]>=0)
        || l.maxRows>plan.cost.rows||l.maxBytes>plan.cost.bytes
        || ![w?.from,w?.to].every(d=>typeof d==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(`${d}T00:00:00Z`).toISOString().slice(0,10)===d)
        || w.from>w.to || !klaviyoHourly && loadDatasetInputs!==undefined && w.from!==w.to) return {status:"work_plan_required"};
      const dailyReport = plan.workClass === "deep_reconciliation"
        && /^daily-report:(?:yesterday|today):\d{4}-\d{2}-\d{2}$/.test(plan.partitionId);
      // The database already keys durable runs by owner and job ID. The same
      // daily slot must keep its identity when the queue advances to another hour.
      const identity = dailyReport || klaviyoHourly
        ? [dailyReport ? "daily-report" : "klaviyo-hourly-source", source.workspaceId, source.installGeneration, source.provider,
          source.accountId, plan.partitionId, w.from, w.to]
        : [source, plan.partitionId, w];
      const id=createHash("sha256").update(JSON.stringify(identity)).digest("hex");
      const job={id,workspaceId:source.workspaceId,installGeneration:source.installGeneration,provider:source.provider,accountId:source.accountId,
        scheduledHour:source.scheduledHour,queuedAt:source.queuedAt,workClass:plan.workClass,cost:plan.cost,
        authority:{installationVerified:true,connected:true,setupComplete:true,allowedWindow:true}};
      candidates.push(job);plans.set(id,{source,plan,klaviyoHourly});
    }
    const proposal=planRefreshPreflightAdmissions({...snapshot,candidates,now:now()});
    if(proposal.status!=="proposed") return {status:proposal.status,deferred:proposal.deferred};
    const selected=proposal.admitted[0],binding=plans.get(selected.id);
    const accepted=await store.commitPreflight({expectedRevision:snapshot.state.revision,queueRevision:snapshot.queueRevision,
      nextState:proposal.nextState,source:binding.source,window:binding.plan.window,partitionId:binding.plan.partitionId,deadlineAt:binding.plan.limits.deadlineAt});
    if(accepted!==true) return {status:"conflict"};
    claim=selected;
    const readBoundPage = binding.klaviyoHourly
      ? context => readPage({...context, hourlySource:structuredClone(binding.plan.hourlySource)})
      : readPage;
    const result=await runRefreshChunk({claim,window:binding.plan.window,limits:binding.plan.limits,store,
      loadAuthority:context=>store.loadBoundAuthority(context),verifyEntitlement:context=>entitlementVerifier.verify(context),
      isEntitlementCurrent:context=>entitlementVerifier.isCurrent(context),readPage:readBoundPage,validatePage,now});
    if (result.status!=="awaiting_dataset") return {claim:structuredClone(claim),...result};
    if (binding.klaviyoHourly) {
      const completed = await finishKlaviyoHourlyReport({claim:structuredClone(claim),partitionId:binding.plan.partitionId});
      if (completed === true) return {status:"completed",claim:structuredClone(claim),reservationRetained:false};
      return {claim:structuredClone(claim),...result};
    }
    if (loadDatasetInputs===undefined) return {claim:structuredClone(claim),...result};

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
