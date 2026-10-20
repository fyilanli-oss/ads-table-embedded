const integer=value=>typeof value==="string"&&/^(0|[1-9][0-9]{0,15})$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
// Only documented Klaviyo API response fields. Never store arbitrary headers, body or URLs.
export function quotaResponseFeedback(metadata,response) {
  if(metadata?.provider!=="klaviyo"||["token","revoke"].includes(metadata.family)) return null;
  const empty=kind=>({kind,httpStatus:response.status,limit:null,remaining:null,resetSeconds:null,retryAfterSeconds:null});
  const get=name=>response.headers?.get?.(name)??null;
  if(response.status===429) {
    const retry=integer(get("retry-after"));
    return retry!==null&&retry<=2147483647?{...empty("retry_after"),retryAfterSeconds:retry}:empty("invalid");
  }
  const raw=[get("ratelimit-limit"),get("ratelimit-remaining"),get("ratelimit-reset")];
  if(raw.every(v=>v===null)) return empty("missing");
  const [limit,remaining,resetSeconds]=raw.map(integer);
  if(limit===null||limit<1||remaining===null||remaining>limit||resetSeconds===null||resetSeconds>60) return empty("invalid");
  return {...empty("steady"),limit,remaining,resetSeconds};
}
