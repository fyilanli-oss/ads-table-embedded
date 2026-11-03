import {createSourceEvidenceCipher} from "./source-evidence-store.server.js";
import {readProviderTokenKeyring} from "../oauth/token-envelope.server.js";
import {readSessionEncryptionKey} from "../shopify/session-envelope.server.js";
const prefix="ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V";
const fail=()=>{throw Error("SOURCE_EVIDENCE_CONFIGURATION_REQUIRED");};

// No generated/default key, token-key fallback, public config or secret output.
export function createConfiguredSourceEvidenceCipher(environment) {
 const owned=[];
 try{
  const active=environment?.ADSTABLE_SOURCE_EVIDENCE_ACTIVE_KEY_VERSION;
  if(typeof active!=="string"||! /^[1-9][0-9]{0,4}$/.test(active)||Number(active)>32767)fail();
  const keys=new Map();
  for(const [name,value]of Object.entries(environment??{})){
   if(!name.startsWith(prefix))continue;const version=name.slice(prefix.length);
   if(!/^[1-9][0-9]{0,4}$/.test(version)||Number(version)>32767||keys.size>=16
    ||typeof value!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(value))fail();
   const key=Buffer.from(value,"base64url");owned.push(key);if(key.length!==32||key.toString("base64url")!==value)fail();keys.set(Number(version),key);
  }
  const provider=readProviderTokenKeyring(environment),session=readSessionEncryptionKey(environment);owned.push(session);
  const forbidden=provider.versions.map(v=>provider.get(v));owned.push(...forbidden);
  return createSourceEvidenceCipher({keys,activeVersion:Number(active),forbiddenKeys:[session,...forbidden]});
 }catch{fail();}finally{for(const key of owned)key.fill(0);}
}

export function readSourceStoragePolicy(input,now) {
 try{
  const p=structuredClone(input),kinds=["claim","identity","metadata","order","raw"];
  if(!p||Object.keys(p).sort().join()!==kinds.join()||!Number.isSafeInteger(now))fail();
  for(const kind of kinds){const row=p[kind];
   if(!row||Object.keys(row).sort().join()!=="until,version"||typeof row.version!=="string"||row.version.length<1||row.version.length>128
    ||typeof row.until!=="string"||!Number.isFinite(Date.parse(row.until))||new Date(row.until).toISOString()!==row.until||Date.parse(row.until)<=now)fail();
   Object.freeze(row);
  }
  if(kinds.some(kind=>Date.parse(p.metadata.until)<Date.parse(p[kind].until)))fail();
  return Object.freeze(p);
 }catch{fail();}
}
