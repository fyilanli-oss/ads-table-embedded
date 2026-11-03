import {randomUUID} from "node:crypto";
import {createIdentityAuthorityRepository} from "../database/identity-authority-repository.server.js";
import {inspectGoogleIdentityCredential} from "../oauth/google-identity-credential.server.js";
import {validateIdentityOAuthGrantedScopes} from "../oauth/oauth-permission-profile.server.js";
import {readGoogleAdsOAuthConfig, refreshGoogleAdsAccessToken} from "../providers/google-ads-rest.server.js";
import {runIdentityReadDeadline} from "../providers/identity-read-deadline.server.js";

const fail = () => {throw Error("GOOGLE_REFRESH_CREDENTIAL_UNCONFIRMED");};
const equal = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const scopes = value => [...validateIdentityOAuthGrantedScopes("google_ads",value)].sort();

// Internal admitted-job preparation only. The caller supplies the existing fenced
// quota transport, never an HTTP/body/account override or an interactive action.
export async function prepareGoogleRefreshCredential({verified,database,tokenVault,workStore,execution,
  environment,fetchFn,signal,now=Date.now,minimumValidityMs=60000}) {
  if(!Number.isSafeInteger(minimumValidityMs)||minimumValidityMs<60000||minimumValidityMs>660000)fail();
  const env={...environment},scope=structuredClone(execution),owner=structuredClone(verified.installationAuthority),
    shop=structuredClone(verified.identity.shop);
  const repository=createIdentityAuthorityRepository(database);
  let activeSignal=signal;
  const current=async()=>{
    if(activeSignal?.aborted)fail();
    const value=await repository.load({workspaceId:owner.workspaceId,installGeneration:owner.installGeneration,
      provider:"google_ads",shopId:shop.shopId,shopDomain:shop.myshopifyDomain});
    if(activeSignal?.aborted)fail();
    return value?{...value,grantedScopes:scopes(value.grantedScopes?.join(" "))}:null;
  };
  return runIdentityReadDeadline({signal,timeoutMs:20000,run:async child=>{
    activeSignal=child;
    const guard=()=>{if(child.aborted)fail();};
    guard();
    const before=await current();guard();
    const bound=await workStore.loadQuotaContext({...scope,provider:"google_ads"});guard();
    if(!before||before.installationStatus!=="active"||before.workspaceId!==owner.workspaceId
      ||before.installGeneration!==owner.installGeneration||before.shopId!==shop.shopId||before.shopDomain!==shop.myshopifyDomain
      ||before.status!=="connected"||before.reportingAccountId!==scope.claim.accountId
      ||bound?.provider!=="google_ads"||bound.accountId!==scope.claim.accountId)fail();
    const token=structuredClone(await tokenVault.loadProviderTokenSet({credentialId:before.credentialId,
      installationAuthority:owner,provider:"google_ads"}));guard();
    if(!equal(scopes(token?.scope),before.grantedScopes))fail();
    const timing=inspectGoogleIdentityCredential(token,()=>new Date(now()));
    if(!equal(before,await current()))fail();guard();
    if(!timing.needsRefresh&&Date.parse(token.expires_at)-now()>minimumValidityMs)return Object.freeze({renewed:false});
    if(typeof tokenVault.renewGoogleIdentityCredential!=="function"||typeof token.refresh_token!=="string"
      ||!token.refresh_token||token.refresh_token.length>16384||/[\u0000-\u0020\u007f]/.test(token.refresh_token))fail();
    const config=readGoogleAdsOAuthConfig(env);let sent=false;
    const replacement=await refreshGoogleAdsAccessToken({config,refreshToken:token.refresh_token,
      permissionProfile:"identity_v1",now:()=>new Date(now()),fetchFn:async(url,init)=>{
        guard();if(sent||url!=="https://oauth2.googleapis.com/token"||init.method!=="POST")fail();sent=true;
        const response=await fetchFn(url,{...init,signal:child,redirect:"error"});guard();
        if(!response?.body?.getReader)fail();
        const reader=response.body.getReader(),chunks=[];let bytes=0;
        const cancel=()=>{void reader.cancel().catch(()=>{});};
        child.addEventListener("abort",cancel,{once:true});
        try {
          for(;;){guard();const part=await reader.read();guard();if(part.done)break;
            bytes+=part.value.byteLength;if(bytes>65536){cancel();fail();}chunks.push(part.value);}
          return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
        }finally{child.removeEventListener("abort",cancel);reader.releaseLock();}
      }});guard();
    if(!equal(scopes(replacement.scope),before.grantedScopes)
      ||inspectGoogleIdentityCredential(replacement,()=>new Date(now())).needsRefresh
      ||Date.parse(replacement.expires_at)-now()<=minimumValidityMs)fail();
    for(const [key,max] of [["access_token",4096],["refresh_token",16384]])
      if(typeof replacement[key]!=="string"||!replacement[key]||replacement[key].length>max
        ||/[\u0000-\u0020\u007f]/.test(replacement[key]))fail();
    if(!equal(before,await current())||!equal(bound,await workStore.loadQuotaContext({...scope,provider:"google_ads"})))fail();guard();
    const renewalId=randomUUID();
    const result=await tokenVault.renewGoogleIdentityCredential({installationAuthority:owner,renewalId,
      connectionId:before.connectionId,expectedVersion:before.connectionVersion,expectedCredentialId:before.credentialId,
      tokenSet:replacement,refreshExecution:scope});guard();
    if(result?.renewalId!==renewalId||result.connectionId!==before.connectionId||result.status!=="connected"
      ||result.version!==before.connectionVersion+1||result.credentialId===before.credentialId)fail();
    const after=await current(),afterBound=await workStore.loadQuotaContext({...scope,provider:"google_ads"});guard();
    if(!equal(after,{...before,connectionVersion:result.version,credentialId:result.credentialId})
      ||!equal(afterBound,bound))fail();
    return Object.freeze({renewed:true});
  }});
}
