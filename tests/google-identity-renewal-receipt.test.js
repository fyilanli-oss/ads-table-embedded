import assert from "node:assert/strict";
import test from "node:test";
import {createTokenVault} from "../app/lib/oauth/token-vault.server.js";
import {stampGoogleIdentityCredential} from "../app/lib/oauth/google-identity-credential.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";

const id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const now=()=>new Date("2026-10-28T17:00:00.000Z");
const owner={authority:"shopify_installation_verified",status:"active",workspaceId:id("1"),installGeneration:1};
const environment={ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",
  ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:Buffer.alloc(32,41).toString("base64url")};
function harness({fail=false,bad=false,receiptChange={}}={}) {
  const writes=[],reads=[];let receipt;
  const repository={async assertContract(v){return {contractVersion:v,usedKeyVersions:[]};},
    async commitGoogleIdentityRenewal(v){writes.push(v);receipt={renewal_id:v.renewalId,
      connection_id:v.connectionId,version_before:v.expectedVersion,version_after:v.expectedVersion+1,
      credential_before_id:v.expectedCredentialId,credential_after_id:v.recordId};
      if(fail)throw Error("lost response SECRET");
      return {renewal_id:v.renewalId,connection_id:v.connectionId,connection_version:8,
        lifecycle_status:"connected",credential_id:bad?id("9"):v.recordId};
    },async readGoogleIdentityRenewal(v){reads.push(v);return receipt?{...receipt,...receiptChange}:null;}};
  const vault=createTokenVault({environment,repository,now});
  const input={installationAuthority:owner,renewalId:id("3"),connectionId:id("2"),expectedVersion:7,
    expectedCredentialId:id("4"),tokenSet:stampGoogleIdentityCredential({access_token:"SECRET",
      refresh_token:"REFRESH",expires_in:3600,scope:oauthPermissionScopes("google_ads","identity_v1").join(" ")},now)};
  return {vault,input,writes,reads};
}
test("renewal seals before await; SQL receives a frozen-in-time owner, grant and encrypted payload",async()=>{
  const h=harness();const pending=h.vault.renewGoogleIdentityCredential(h.input);
  h.input.tokenSet={access_token:"mutated"};h.input.installationAuthority={...owner,workspaceId:id("9")};
  const r=await pending;assert.equal(r.version,8);assert.equal(r.renewalId,id("3"));
  assert.equal(h.writes.length,1);const v=h.writes[0];assert.equal(v.workspaceId,owner.workspaceId);
  assert.equal(v.expectedCredentialId,id("4"));assert.equal(v.expiresAt,"2026-10-28T18:00:00.000Z");
  assert.equal(v.ciphertext.includes(Buffer.from("SECRET")),false);assert.equal(JSON.stringify(v).includes("REFRESH"),false);
  assert.equal(h.reads.length,0);
});
for(const options of [{fail:true},{bad:true}])test(`unknown result carries only the operation ID; explicit receipt never replays ${JSON.stringify(options)}`,async()=>{
  const h=harness(options);await assert.rejects(h.vault.renewGoogleIdentityCredential(h.input),e=>{
    assert.equal(e.message,"GOOGLE_IDENTITY_RENEWAL_WRITE_UNCONFIRMED");assert.equal(e.renewalId,id("3"));
    assert.equal(JSON.stringify(e).includes("SECRET"),false);return true;
  });
  assert.equal(h.writes.length,1);assert.equal(h.reads.length,0);
  const proof=await h.vault.readGoogleIdentityRenewal(h.input);
  assert.equal(proof.historicalCommit,true);assert.equal(proof.authorizesActivation,false);
  assert.equal(proof.credentialBeforeId,id("4"));assert.equal(proof.versionAfter,8);
  assert.equal(h.writes.length,1);
});
test("absent receipt means unconfirmed, with no mutation or activation",async()=>{
  const h=harness();assert.equal(await h.vault.readGoogleIdentityRenewal(h.input),null);
  assert.equal(h.writes.length,0);assert.equal(h.reads.length,1);
});
for(const change of [{expectedVersion:0},{expectedVersion:Number.MAX_SAFE_INTEGER},{renewalId:"bad"},
  {expectedCredentialId:"bad"},{tokenSet:{access_token:"SECRET"}}])test(`invalid renewal metadata never writes ${Object.keys(change)[0]}`,async()=>{
    const h=harness();await assert.rejects(h.vault.renewGoogleIdentityCredential({...h.input,...change}));assert.equal(h.writes.length,0);
  });
for(const change of [{expires_in:0},{scope:"https://www.googleapis.com/auth/adwords"},{refresh_token:""},
  {scope_verified_at:"2026-10-28T18:00:00.000Z"},{expires_at:"2026-10-28T17:00:00.000Z"}])
  test(`invalid or expired native token never writes ${Object.keys(change)[0]}`,async()=>{
    const h=harness();await assert.rejects(h.vault.renewGoogleIdentityCredential({...h.input,tokenSet:{...h.input.tokenSet,...change}}));assert.equal(h.writes.length,0);
  });
for(const receiptChange of [{version_after:9},{credential_before_id:"bad"},{renewal_id:id("9")}])
  test(`malformed historical receipt is rejected ${Object.keys(receiptChange)[0]}`,async()=>{
    const h=harness({receiptChange});await h.vault.renewGoogleIdentityCredential(h.input);
    await assert.rejects(h.vault.readGoogleIdentityRenewal(h.input),/RECEIPT_INVALID/);assert.equal(h.writes.length,1);
  });
