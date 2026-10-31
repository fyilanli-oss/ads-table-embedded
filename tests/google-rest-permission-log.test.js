import assert from "node:assert/strict";
import test from "node:test";
import {discoverGoogleAdsAccounts} from "../app/lib/providers/google-account-discovery.server.js";
import {createGoogleAdsRestClient,GoogleAdsRestError,googleAdsRestFailureMetadata} from "../app/lib/providers/google-ads-rest.server.js";
import {logPermissionFailure} from "../app/lib/server-error-log.server.js";

const payload=(enumCode,status)=>({error:{status,message:"BODY_SECRET",details:[{errors:[{
  errorCode:{authorizationError:enumCode},message:"MESSAGE_SECRET",trigger:{stringValue:"ACCOUNT_SECRET"},
}]}]}});
const failureResponse=(status,enumCode,providerStatus)=>new Response(JSON.stringify(payload(enumCode,providerStatus)),{
  status,headers:{"request-id":"REQUEST_ID_SECRET"},
});
function logsFor(error,overrides={}){
  const saved=console.error,logs=[];console.error=line=>logs.push(JSON.parse(line));
  try{logPermissionFailure({feature:"google_ads",intent:"permission_callback",requestId:null,error,...overrides});}
  finally{console.error=saved;}
  return logs;
}

for(const operation of ["list_accessible_customers","search"])for(const [status,enumCode,providerStatus] of [
  [401,"OAUTH_TOKEN_INVALID","UNAUTHENTICATED"],[403,"USER_PERMISSION_DENIED","PERMISSION_DENIED"],
  [429,"RESOURCE_EXHAUSTED","RESOURCE_EXHAUSTED"],[503,"UNKNOWN","UNAVAILABLE"],
  [500,"INTERNAL_ERROR","INTERNAL"],[400,"DEVELOPER_TOKEN_PARAMETER_MISSING","INVALID_ARGUMENT"],
])test(`${operation} ${status}: actual discovery error logs safe cause and stops at first failure`,async()=>{
  let calls=0;
  const fetchFn=async()=>{
    calls++;
    if(operation==="search"&&calls===1)return new Response(JSON.stringify({resourceNames:["customers/111111","customers/222222"]}));
    return failureResponse(status,enumCode,providerStatus);
  };
  let error;
  try{await discoverGoogleAdsAccounts({accessToken:"ACCESS_SECRET",developerToken:"DEVELOPER_SECRET",fetchFn,stopOnFirstError:true});}
  catch(e){error=e;}
  assert.equal(error.code,"GOOGLE_ADS_REST_REQUEST_FAILED");
  assert.equal(calls,operation==="search"?2:1,"no retry or next-root request");
  assert.deepEqual(logsFor(error),[{event:"adstable_permission_error",code:"GOOGLE_ADS_REST_REQUEST_FAILED",
    feature:"google_ads",intent:"permission_callback",requestId:null,
    google_rest:{operation,http_status:status,provider_status:providerStatus,provider_error_code:enumCode}}]);
  assert.doesNotMatch(JSON.stringify(logsFor(error)),/SECRET|customers\/|headers|authorization|request_id/);
  assert.equal(Object.isFrozen(googleAdsRestFailureMetadata(error)),true);
  // Caller-controlled mutable details cannot inject data after native projection.
  error.details={status:200,provider_status:"SECRET",provider_error_code:"SECRET",request_id:"SECRET"};
  assert.equal(logsFor(error)[0].google_rest.http_status,status);
  assert.equal(logsFor(error,{feature:"meta"})[0].google_rest,undefined);
  assert.equal(logsFor(error,{intent:"permission_status"})[0].google_rest,undefined);
});

test("HTTP200 search error envelope retains its error semantics and safe operation metadata",async()=>{
  const client=createGoogleAdsRestClient({accessToken:"SECRET",fetchFn:async()=>failureResponse(200,"CUSTOMER_NOT_ENABLED","FAILED_PRECONDITION")});
  let error;try{await client.search({customerId:"123",query:"SELECT customer.id FROM customer"});}catch(e){error=e;}
  assert.equal(error.code,"GOOGLE_ADS_REST_REQUEST_FAILED");
  assert.deepEqual(logsFor(error)[0].google_rest,{operation:"search",http_status:200,provider_status:"FAILED_PRECONDITION",provider_error_code:"CUSTOMER_NOT_ENABLED"});
});

for(const code of ["SECRET", "RAW_SECRET_".repeat(100),null])test(`unknown provider enum is never passed through (${String(code).length})`,async()=>{
  const client=createGoogleAdsRestClient({accessToken:"SECRET",fetchFn:async()=>failureResponse(403,code,"RAW_STATUS_SECRET")});
  let error;try{await client.listAccessibleCustomers();}catch(e){error=e;}
  assert.deepEqual(logsFor(error)[0].google_rest,{operation:"list_accessible_customers",http_status:403,provider_status:null,provider_error_code:null});
  assert.doesNotMatch(JSON.stringify(logsFor(error)),/SECRET/);
});

test("forged errors, hostile getters and malformed HTTP metadata cannot create log authority",async()=>{
  const forged=new GoogleAdsRestError("GOOGLE_ADS_REST_REQUEST_FAILED","SECRET",{status:403,operation:"search",provider_error_code:"USER_PERMISSION_DENIED"});
  Object.defineProperty(forged,"details",{get(){assert.fail("details getter must not be inspected");}});
  assert.equal(googleAdsRestFailureMetadata(forged),null);assert.equal(logsFor(forged)[0].google_rest,undefined);
  for(const value of [null,undefined,42,"SECRET",{details:{operation:"search"}}])assert.equal(googleAdsRestFailureMetadata(value),null);
  const client=createGoogleAdsRestClient({accessToken:"SECRET",fetchFn:async()=>({ok:false,status:"403",headers:{get:()=>"SECRET"},json:async()=>payload("USER_PERMISSION_DENIED","PERMISSION_DENIED")})});
  let error;try{await client.listAccessibleCustomers();}catch(e){error=e;}
  assert.equal(logsFor(error)[0].google_rest.http_status,null);
  assert.doesNotMatch(JSON.stringify(logsFor(error)),/SECRET/);
  const saved=console.error;console.error=()=>{throw Error("SINK_SECRET");};
  try{assert.doesNotThrow(()=>logPermissionFailure({feature:"google_ads",intent:"permission_callback",error}));}finally{console.error=saved;}
});
