import test from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
const run=promisify(execFile),script=fileURLToPath(new URL("./helpers/shopify-admin-sdk-bootstrap-scenario.js",import.meta.url));
// Separate SDK lifetimes: successful startup uses the application installer, never a test setter.
for(const mode of ["import-only","router-only","foreign-hook","singleton","input","unbound","close-before","close","changed",
  "identity-orders-permission","two-shops","authority","missing-profile","known-error","shutdown"]){
  test(`Admin SDK bootstrap ${mode}`,async()=>{
    const {stdout}=await run(process.execPath,[script,mode],{timeout:20000,windowsHide:true,maxBuffer:65536});
    assert.match(stdout,new RegExp(`SHOPIFY_ADMIN_SDK_BOOTSTRAP_PASS ${mode} native_HTTP=0`));assert.doesNotMatch(stdout,/SECRET/);
  });
}
