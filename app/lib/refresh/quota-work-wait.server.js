import {quotaBoundaryControl} from "./quota-native-fetch.server.js";
import {refreshWorkIdentity} from "./work-stop-policy.server.js";

// A private in-process receipt, never a provider JSON field or a serialized callback status.
const waits=new WeakMap();
export function refreshQuotaWait(error,boundary,claim) {
  const control=quotaBoundaryControl(error);
  if(control?.status!=="waiting"||control.priorBoundaryAttempts!==0
    ||!["entitlement","provider_page"].includes(boundary)) return null;
  const receipt=Object.freeze({status:"quota_waiting",boundaryExternalOutcome:"not_sent"});
  waits.set(receipt,{boundary,identity:JSON.stringify(refreshWorkIdentity(claim,{claimRequired:true}))});
  return receipt;
}
export function refreshQuotaWaitBoundary(receipt) {return waits.get(receipt)?.boundary??null;}
export function takeRefreshQuotaWait(receipt,claim) {
  const proof=waits.get(receipt);
  if(!proof||proof.identity!==JSON.stringify(refreshWorkIdentity(claim,{claimRequired:true}))) return null;
  waits.delete(receipt); // Unknown DB outcome cannot authorize another deferral attempt.
  return proof.boundary;
}
