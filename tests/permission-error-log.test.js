import assert from "node:assert/strict";
import test from "node:test";
import {logPermissionFailure} from "../app/lib/oauth/permission-error-log.server.js";

test("permission diagnostics contain only allowlisted fields and never raw provider data",()=>{
  const saved=console.error,logs=[];
  console.error=value=>logs.push(JSON.parse(value));
  try {
    const input={feature:"google_ads",intent:"permission_connect",requestId:"12345678-1234-4234-8234-123456789012"};
    logPermissionFailure({...input,error:Object.assign(new Error("IDENTITY_OAUTH_CONNECTION_STATE_NOT_ELIGIBLE"),{detail:"SECRET",cause:{token:"SECRET"}})});
    assert.equal(logs[0].code,"IDENTITY_OAUTH_CONNECTION_STATE_NOT_ELIGIBLE");
    logPermissionFailure({...input,error:Object.assign(new Error("raw SECRET"),{code:"PG_RAW_SECRET",stack:"SECRET"})});
    logPermissionFailure({feature:"raw SECRET",intent:"raw SECRET",requestId:"raw SECRET",error:"SECRET"});
    const hostile=new Error("raw SECRET");Object.defineProperty(hostile,"code",{get(){throw Error("SECRET");}});
    logPermissionFailure({...input,error:hostile});
    assert.equal(logs.length,4);
    assert.equal(logs[1].code,"PERMISSION_OPERATION_UNCONFIRMED");
    assert.deepEqual(logs[2],{event:"adstable_permission_error",code:"PERMISSION_OPERATION_UNCONFIRMED",feature:"unknown",intent:"unknown",requestId:null});
    for(const row of logs)assert.deepEqual(Object.keys(row),["event","code","feature","intent","requestId"]);
    assert.equal(JSON.stringify(logs).includes("SECRET"),false);
    console.error=()=>{throw Error("sink failed");};
    assert.doesNotThrow(()=>logPermissionFailure({...input,error:new Error("IDENTITY_OAUTH_DISCONNECT_INCOMPLETE")}));
  }finally{console.error=saved;}
});
