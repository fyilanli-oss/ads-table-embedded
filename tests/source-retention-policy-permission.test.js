import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceRetentionDurationPolicy,readSourceRetentionDurationPolicy,resolveSourceRetentionDurationPolicy,SOURCE_RETENTION_POLICY_VERSION} from '../app/lib/database/source-retention-policy.server.js';
import {readSourceStoragePolicy} from '../app/lib/database/source-evidence-config.server.js';
import {createSourceEvidenceRepository} from '../app/lib/database/source-evidence-store.server.js';
import {sourceStoreFixture} from './fixtures/source-store-fixture.js';
const policy=sourceRetentionDurationPolicy();
test('retention duration: exact approved days, immutable, no arbitrary or infinite extension',()=>{
 assert.ok(Object.isFrozen(policy.days)); assert.deepEqual(readSourceStoragePolicy(policy,Date.now()),policy);
 for(const p of [null,{}, {...policy,extra:true},{...policy,version:'unapproved'}, {...policy,days:{...policy.days,raw:91}}, {...policy,days:{...policy.days,metadata:Infinity}}, {...policy,days:{raw:90}}, {...policy,days:{...policy.days,backup:30}}])assert.throws(()=>readSourceRetentionDurationPolicy(p),/POLICY_INVALID/);
 assert.throws(()=>readSourceStoragePolicy(policy,NaN),/CONFIGURATION_REQUIRED/);
});
test('retention duration: UTC elapsed days across leap day, DST and year boundary',()=>{
 for(const anchor of ['2028-02-29T23:59:59.123Z','2026-03-29T00:30:00.000Z','2026-11-04T13:27:10.916Z']){
  const result=resolveSourceRetentionDurationPolicy(policy,anchor);
  for(const [kind,days] of Object.entries(policy.days)){assert.equal(Date.parse(result[kind].until)-Date.parse(anchor),days*86400000);assert.equal(result[kind].version,SOURCE_RETENTION_POLICY_VERSION);}
 }
 for(const anchor of [null,'2026-11-04','2026-02-30T00:00:00.000Z','2026-11-04T00:00:00+00:00','infinity'])assert.throws(()=>resolveSourceRetentionDurationPolicy(policy,anchor),/POLICY_INVALID/);
});
test('retention duration: each shared write gets its own anchor, including empty and partial provider payloads',async()=>{
 for(const provider of ['google_ads','meta','klaviyo']) for(const sourceState of ['complete','partial']){
  const {input,prepare}=sourceStoreFixture();
  Object.assign(input.owner,{provider,connectionId:'11111111-1111-4111-8111-111111111111',credentialId:'22222222-2222-4222-8222-222222222222',connectionVersion:'1',accountId:'test',selectionEpoch:provider==='klaviyo'?null:'1'});
  input.policy=policy; input.sourceState=sourceState; input.pages[0].origin=provider; input.pages[0].payload={records:[]};
  for(const key of Object.keys(input.records))input.records[key]=[];
  const captured=[]; const repo=createSourceEvidenceRepository({async query(sql,args){captured.push(JSON.parse(args[3]));throw Error('synthetic capture only');}});
  const first='2026-11-04T01:00:00.000Z',second='2026-11-05T01:00:00.000Z';
  for(const now of [first,second]){input.now=now;await assert.rejects(repo.commit(prepare()));}
  assert.equal(captured.length,2);
  for(const kind of Object.keys(policy.days))assert.equal(Date.parse(captured[1].policy[kind].until)-Date.parse(captured[0].policy[kind].until),86400000);
  assert.equal(captured[0].sourceState,sourceState);
 }
});
test('retention duration: explicit historical policy is unchanged and never silently upgraded',()=>{
 const legacy=Object.fromEntries(Object.keys(policy.days).map(kind=>[kind,{version:'temporary-7-30',until:kind==='metadata'?'2026-12-04T00:00:00.000Z':'2026-11-11T00:00:00.000Z'}]));
 assert.deepEqual(readSourceStoragePolicy(legacy,Date.parse('2026-11-04T00:00:00.000Z')),legacy);
 assert.throws(()=>readSourceStoragePolicy(legacy,Date.parse('2026-11-12T00:00:00.000Z')),/CONFIGURATION_REQUIRED/);
});

import {googleRawDatasetsFixture} from './fixtures/google-raw-datasets-fixture.js';
import {metaRawDatasetsFixture} from './fixtures/meta-raw-datasets-fixture.js';
import {klaviyoRawDatasetsFixture} from './fixtures/klaviyo-raw-datasets-fixture.js';
import {createGoogleRawCaptureExecution} from '../app/lib/refresh/google-raw-server.server.js';
import {createMetaRawCaptureExecution} from '../app/lib/refresh/meta-raw-server.server.js';
import {createKlaviyoRawCaptureExecution} from '../app/lib/refresh/klaviyo-raw-server.server.js';
for(const [name,fixture,create]of [['google',googleRawDatasetsFixture,createGoogleRawCaptureExecution],['meta',metaRawDatasetsFixture,createMetaRawCaptureExecution],['klaviyo',klaviyoRawDatasetsFixture,createKlaviyoRawCaptureExecution]])test('retention duration: '+name+' private server preserves explicit duration through encryption and readback',async()=>{
 const x=fixture();x.plan.sourcePolicy=sourceRetentionDurationPolicy();x.setPlan();const start=x.options.now();
 const execution=create(x.options);try{const r=await execution.run();assert.equal(r.contentVerified,true,JSON.stringify(r));assert.ok(x.writes.length>=2);
 for(const w of x.writes){for(const [kind,days]of Object.entries(policy.days)){const anchor=Date.parse(w.body.policy[kind].until)-days*86400000;assert.ok(anchor>=start&&anchor<=x.options.now());assert.equal(w.body.policy[kind].version,SOURCE_RETENTION_POLICY_VERSION);}}
 }finally{await execution.close();}
});
