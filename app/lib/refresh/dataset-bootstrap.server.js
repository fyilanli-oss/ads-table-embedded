import {maturityDate, maturityInstant, freezeMaturity} from "./maturity-policy.server.js";
import {klaviyoBusinessDayTimeframe} from "../providers/klaviyo-reporting.server.js";
import {datasetConsumptionMatches} from "../database/dataset-reconciliation.server.js";
const plans = new WeakMap();

/** Pure ordering, never an authorization, checkpoint or provider dispatcher.
 * Admission must still obtain current server authority and confirmed day receipts.
 * A day crossing the eligibility boundary is unavailable until its separately
 * governed partial-day policy exists; it is never silently rounded backwards. */
export function planDatasetBootstrap({now, timeZone, eligibleFromMs}) {
  maturityInstant(now);
  if (typeof timeZone !== "string" || !timeZone) throw Error("DATASET_BOOTSTRAP_TIMEZONE_INVALID");
  if (!Number.isSafeInteger(eligibleFromMs) || eligibleFromMs < 0 || eligibleFromMs > Date.parse(now)) throw Error("DATASET_BOOTSTRAP_ELIGIBILITY_INVALID");
  let today;
  try {
    const p = new Intl.DateTimeFormat("en-CA", {timeZone, year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(new Date(now));
    const get = type => p.find(x => x.type === type).value;
    today = maturityDate(get("year") + "-" + get("month") + "-" + get("day"));
  } catch {throw Error("DATASET_BOOTSTRAP_TIMEZONE_INVALID");}
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  const plan = freezeMaturity({version: "eo05d-bootstrap-v1", timeZone, days: [yesterday, today].map(businessDate => {
    const start = Date.parse(klaviyoBusinessDayTimeframe({businessDate, timeZone}).start);
    return {businessDate, state: start < eligibleFromMs ? "unavailable_eligibility_boundary" : "requires_current_admission"};
  }), authorizesDispatch: false, checkpointAdvanced: false, hourlyRefreshActivated: false});
  plans.set(plan, {used: false}); return plan;
}

/** Trusted server composition supplies its existing admitted day reader/writer.
 * No direct HTTP, new permission or history recovery is introduced. A lost write
 * or unverified receipt stops before the next day, without automatic replay. */
export async function executeDatasetBootstrap({plan, owner, runDay}) {
  const state = plans.get(plan);
  if (!state || state.used || typeof runDay !== "function") throw Error("DATASET_BOOTSTRAP_CAPABILITY_REQUIRED");
  state.used = true; const results = [];
  for (const day of plan.days) {
    if (day.state === "unavailable_eligibility_boundary") {results.push(day); continue;}
    const receipt = await runDay(Object.freeze({businessDate: day.businessDate, timeZone: plan.timeZone}));
    if (!datasetConsumptionMatches(receipt, owner, day.businessDate, plan.timeZone)) throw Error("DATASET_BOOTSTRAP_RECEIPT_REQUIRED");
    results.push({businessDate: day.businessDate, state: "verified", operationId: receipt.operationId});
  }
  return freezeMaturity({results, hourlyRefreshActivated: false, authorizesActivation: false});
}
