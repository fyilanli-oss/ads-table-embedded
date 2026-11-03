import assert from "node:assert/strict";
import test from "node:test";
import {inspectGoogleSourceRole} from "../tools/eo05-google-source-role-plan.mjs";

function catalog(replies){const calls=[];return {calls,async query(sql,args){calls.push({sql,args});const reply=replies.shift();if(reply instanceof Error)throw reply;return {rows:reply};}};}
test("read-only readiness never authorizes installation or activation",async()=>{
 const client=catalog([[{ready:true}],[{present:false}]]);
 assert.deepEqual(await inspectGoogleSourceRole(client),{status:"ready_to_install",authorizesInstallation:false,authorizesActivation:false});
 assert.equal(client.calls.length,2);assert.ok(client.calls.every(x=>/^\s*(with|select)\b/i.test(x.sql)));
});
test("changed prerequisites stop inspection without invoking installer or role repair",async()=>{
 const client=catalog([[{ready:false}],[{present:false}]]);
 assert.equal((await inspectGoogleSourceRole(client)).status,"blocked");assert.equal(client.calls.length,2);
});
for(const [profile,inactive,status]of [[true,true,"installed_inactive"],[false,true,"blocked"],[true,false,"blocked"]])test(`existing role profile=${profile} inactive=${inactive} is ${status}`,async()=>{
 const client=catalog([[{ready:true}],[{present:true}],[{profile_ready:profile}],[{inactive}]]);
 const r=await inspectGoogleSourceRole(client);assert.equal(r.status,status);assert.equal(r.authorizesInstallation,false);assert.equal(r.authorizesActivation,false);
});
test("catalogue failure is propagated once without retry",async()=>{
 const client=catalog([Error("catalogue unavailable")]);await assert.rejects(inspectGoogleSourceRole(client),/catalogue unavailable/);assert.equal(client.calls.length,1);
});
test("missing catalogue rows cannot become successful readiness",async()=>{
 const client=catalog([[],[{present:false}]]);await assert.rejects(inspectGoogleSourceRole(client),/PREFLIGHT_INVALID/);
});
