const codes=new Set(["RESOURCE_EXHAUSTED","RESOURCE_TEMPORARILY_EXHAUSTED","EXCESSIVE_SHORT_TERM_QUERY_RESOURCE_CONSUMPTION","EXCESSIVE_LONG_TERM_QUERY_RESOURCE_CONSUMPTION"]);
// Observation ONLY, not permission to choose/stop a shared rate bucket or retry.
// v25 is the current native client; v24 fixtures remain explicitly reviewed. Unknown shapes stay unclassified.
export function googleQuotaObservation(metadata,status,payload) {
  if(metadata?.provider!=="google_ads"||metadata.family!=="reporting_query"||!["v24","v25"].includes(metadata.version)
    ||status!==429||payload?.error?.code!==429||payload.error.status!=="RESOURCE_EXHAUSTED") return null;
  const failures=payload.error.details;
  if(!Array.isArray(failures)||failures.length!==1||failures[0]?.["@type"]!==`type.googleapis.com/google.ads.googleads.${metadata.version}.errors.GoogleAdsFailure`) return null;
  const errors=failures[0].errors;
  if(!Array.isArray(errors)||errors.length<1||errors.length>32) return null;
  let result;
  for(const error of errors) {
    const code=error?.errorCode?.quotaError,scope=error?.details?.quotaErrorDetails?.rateScope;
    if(Object.keys(error?.errorCode??{}).length!==1||!codes.has(code)||!["ACCOUNT","DEVELOPER"].includes(scope)) return null;
    if(result&&(result.code!==code||result.scope!==scope)) return null;
    result={scope,code};
  }
  return Object.freeze(result);
}
