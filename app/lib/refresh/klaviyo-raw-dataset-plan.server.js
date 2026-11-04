import {readSourceStoragePolicy} from "../database/source-evidence-config.server.js";
const exact=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const id=v=>typeof v==="string"&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const uuid=v=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const fail=()=>{throw Error("KLAVIYO_RAW_CAPTURE_CONFIGURATION_REQUIRED");};
export function readKlaviyoRawDatasetPlan(p,now) {
 if(!exact(p,["version","target","limits","storageLimits","sourcePolicy"])||p.version!==1||!Number.isSafeInteger(now))fail();
 const t=p.target,l=p.limits,s=p.storageLimits;
 if(!exact(t,["operationId","workspaceId","installGeneration","shopId","shopDomain","accountId","connectionId","connectionVersion","credentialId","selectionId","window","expiresAt"])
  ||![t.operationId,t.workspaceId,t.connectionId,t.credentialId].every(uuid)||!id(t.installGeneration)||t.selectionId!==null
  ||typeof t.accountId!=="string"||!/^[A-Za-z0-9_-]{1,256}$/.test(t.accountId)||!Number.isSafeInteger(t.connectionVersion)||t.connectionVersion<1||!/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(t.shopId)
  ||typeof t.shopDomain!=="string"||!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(t.shopDomain)
  ||!exact(t.window,["from","to"])||t.window.from!==t.window.to||!/^\d{4}-\d\d-\d\d$/.test(t.window.from)
  ||!Number.isFinite(Date.parse(t.window.from))||new Date(t.window.from).toISOString().slice(0,10)!==t.window.from
  ||typeof t.expiresAt!=="string"||!Number.isFinite(Date.parse(t.expiresAt))||Date.parse(t.expiresAt)<=now||Date.parse(t.expiresAt)>now+900000)fail();
 if(!exact(l,["maxBytes","maxElapsedMs","maxPages","maxRows","maxRequests"])
  ||Object.values(l).some(v=>!Number.isSafeInteger(v)||v<1)||l.maxBytes>1048576||l.maxElapsedMs<90000||l.maxElapsedMs>120000
  ||l.maxRequests<11||l.maxRequests>21||l.maxPages>10||l.maxRows>1000
  ||!exact(s,["maxBytes","maxRows"])||!Number.isSafeInteger(s.maxBytes)||s.maxBytes<1||s.maxBytes>1048576
  ||!Number.isSafeInteger(s.maxRows)||s.maxRows<1||s.maxRows>1000)fail();
 return {...p,sourcePolicy:readSourceStoragePolicy(p.sourcePolicy,now)};
}
