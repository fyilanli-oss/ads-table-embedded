import assert from "node:assert/strict";
import test from "node:test";
import {createTokenVault} from "../app/lib/oauth/token-vault.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";

const id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const owner={authority:"shopify_installation_verified",status:"active",workspaceId:id("1"),installGeneration:1};
const environment={ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",
  ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:Buffer.alloc(32,21).toString("base64url")};
function harness({fail=false,bad=false}={}) {
  const calls=[];let row;
  const repository={async assertContract(v){return {contractVersion:v,usedKeyVersions:[]};},
    async commitIdentityCredential(v){calls.push(v);row={connection_id:id("2"),credential_id:v.recordId,
      connection_version:8,lifecycle_status:"connected"};
      if(fail) throw Error("network response lost with SECRET");
      return bad?{...row,credential_id:id("9")}:row;
    },async readIdentityCommit(){return row;}};
  const vault=createTokenVault({environment,repository});
  const input={installationAuthority:owner,provider:"google_ads",transactionId:id("3"),connectionId:id("2"),
    binding:{connectionId:id("2"),version:7},scopes:[...oauthPermissionScopes("google_ads","identity_v1")],
    accounts:[{id:"111",kind:"advertiser",reportingEligible:true,name:"never persisted"}],
    tokenSet:{access_token:"SECRET",refresh_token:"REFRESH",permission_profile:"identity_v1",
      scope:oauthPermissionScopes("google_ads","identity_v1").join(" ")},
    verifiedAt:"2026-10-28T12:00:00.000Z",expiresAt:"2026-10-28T13:00:00.000Z"};
  return {vault,input,calls};
}
test("identity commit passes only an encrypted envelope and snapshots authority before awaits",async()=>{
  const h=harness(); const result=h.vault.commitIdentityOAuthCredential(h.input);
  h.input.accounts[0].id="mutated";h.input.scopes.length=0;h.input.binding.version=99;
  const r=await result;assert.equal(r.status,"connected");assert.equal(r.version,8);
  const v=h.calls[0];assert.equal(v.accounts[0].id,"111");assert.equal(v.binding.version,7);
  assert.equal(v.scopes.length,2);assert.equal(v.workspaceId,owner.workspaceId);
  assert.equal(v.ciphertext.includes(Buffer.from("SECRET")),false);
  assert.equal(JSON.stringify(v).includes("REFRESH"),false);assert.equal("name" in v.accounts[0],false);
});
for(const options of [{fail:true},{bad:true}]) test(`uncertain/malformed commit stops once; explicit receipt is historical only ${JSON.stringify(options)}`,async()=>{
  const h=harness(options);await assert.rejects(h.vault.commitIdentityOAuthCredential(h.input),/^Error: IDENTITY_OAUTH_WRITE_UNCONFIRMED$/);
  assert.equal(h.calls.length,1);
  const receipt=await h.vault.readIdentityOAuthCommit(h.input);
  assert.equal(receipt.historicalCommit,true);assert.equal(receipt.authorizesActivation,false);
  assert.equal(h.calls.length,1);
});
for(const change of [{binding:{}},{transactionId:"bad"},{tokenSet:{access_token:"secret"}},{scopes:[]},{accounts:[]}])
  test(`invalid identity commit input never writes ${Object.keys(change)[0]}`,async()=>{
    const h=harness();await assert.rejects(h.vault.commitIdentityOAuthCredential({...h.input,...change}));assert.equal(h.calls.length,0);
  });
