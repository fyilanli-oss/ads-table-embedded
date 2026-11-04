import {readSourceStoragePolicy} from "../database/source-evidence-config.server.js";
const exact=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const id=v=>typeof v==="string"&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const uuid=v=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const fail=()=>{throw Error("GOOGLE_RAW_CAPTURE_CONFIGURATION_REQUIRED");};
export function readGoogleRawDatasetPlan(p,now) {
 if(!exact(p,["version","target","limits","storageLimits","sourcePolicy","merchant"])||p.version!==2||!Number.isSafeInteger(now))fail();
 const t=p.target,l=p.limits,s=p.storageLimits;
 if(!exact(t,["operationId","workspaceId","installGeneration","shopId","shopDomain","accountId","connectionId","connectionVersion","credentialId","selectionId","window","expiresAt"])
  ||![t.operationId,t.workspaceId,t.connectionId,t.credentialId].every(uuid)||![t.installGeneration,t.accountId,t.selectionId].every(id)
  ||!Number.isSafeInteger(t.connectionVersion)||t.connectionVersion<1||!/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(t.shopId)
  ||typeof t.shopDomain!=="string"||!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(t.shopDomain)
  ||!exact(t.window,["from","to"])||t.window.from!==t.window.to||!/^\d{4}-\d\d-\d\d$/.test(t.window.from)
  ||!Number.isFinite(Date.parse(t.window.from))||new Date(t.window.from).toISOString().slice(0,10)!==t.window.from
  ||typeof t.expiresAt!=="string"||!Number.isFinite(Date.parse(t.expiresAt))||Date.parse(t.expiresAt)<=now||Date.parse(t.expiresAt)>now+900000)fail();
 if(!exact(l,["maxBytes","maxElapsedMs","maxLinkPages","maxLinks","maxPages","maxRows","maxRequests"])
  ||Object.values(l).some(v=>!Number.isSafeInteger(v)||v<1)||l.maxBytes>1048576||l.maxElapsedMs<40000||l.maxElapsedMs>60000
  ||l.maxRequests<18||l.maxRequests>80||l.maxPages>10||l.maxLinkPages!==1||l.maxLinks>1000||l.maxRows>1000
  ||!exact(s,["maxBytes","maxRows"])||!Number.isSafeInteger(s.maxBytes)||s.maxBytes<1||s.maxBytes>1048576
  ||!Number.isSafeInteger(s.maxRows)||s.maxRows<1||s.maxRows>1000)fail();
 if(p.merchant!==null&&(!exact(p.merchant,["targetAccountId","quotaAccountId","apiVersion","bindingEpoch"])
  ||![p.merchant.targetAccountId,p.merchant.quotaAccountId].every(id)||p.merchant.apiVersion!=="products/v1"
  ||!Number.isSafeInteger(p.merchant.bindingEpoch)||p.merchant.bindingEpoch<1))fail();
 return {...p,sourcePolicy:readSourceStoragePolicy(p.sourcePolicy,now)};
}
