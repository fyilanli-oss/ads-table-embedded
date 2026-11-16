import assert from "node:assert/strict";
import test from "node:test";
import {randomBytes, randomUUID} from "node:crypto";
import {canonicalSourceJson, sourceStoreOwner, sourcePayloadHash, createSourceEvidenceCipher,
  createSourceEvidenceRepository, prepareSourceWrite} from "../app/lib/database/source-evidence-store.server.js";
import {sourceStoreFixture} from "./fixtures/source-store-fixture.js";
import {buildKlaviyoHourlyOrderedProductEventsRequest} from "../app/lib/providers/klaviyo-reporting.server.js";
import {createKlaviyoSourceCapture} from "../app/lib/providers/klaviyo-source-capture.server.js";
import {createKlaviyoHourlySourceRepository} from "../app/lib/database/klaviyo-hourly-source-repository.server.js";
import {sourceRetentionDurationPolicy} from "../app/lib/database/source-retention-policy.server.js";
import {openKlaviyoHourlySourcePage, sealKlaviyoHourlySourcePage,
  commitKlaviyoHourlyEventReport, commitKlaviyoHourlySourceBatch, prepareKlaviyoHourlySourceBatch,
  projectVerifiedKlaviyoHourlyProductSales, verifyKlaviyoHourlySourceBatch} from "../app/lib/database/klaviyo-hourly-source-page.server.js";

test("hourly Klaviyo capture encrypts the original query scope with the sanitized page", async () => {
  const {input} = sourceStoreFixture();
  const owner = {...input.owner, provider:"klaviyo", accountId:"account",
    connectionId:randomUUID(), connectionVersion:"1", credentialId:randomUUID(), selectionEpoch:null};
  const tickAt = "2026-11-16T22:00:00.000Z", start = "2026-11-16T20:00:00.000Z";
  const query = buildKlaviyoHourlyOrderedProductEventsRequest({
    accessToken:"synthetic", orderedProductMetricId:"ordered", tickAt, timeZone:"Europe/Istanbul",
    job:{id:"job", fence:7, provider:"klaviyo", workspaceId:owner.workspaceId,
      installGeneration:owner.generation, accountId:owner.accountId, window:{start,end:tickAt}},
  });
  const event = {id:"event-1", type:"event", attributes:{datetime:start,
    event_properties:{ProductID:"product",VariantID:"variant",Quantity:2,$value:"19.99"}},
    relationships:{metric:{data:{type:"metric", id:"ordered"}},attributions:{data:[{type:"attribution",id:"flow-a"}]}}};
  const capture = createKlaviyoSourceCapture({maxBytes:10000, check:() => {}});
  await capture.read(new Response(JSON.stringify({data:[event], links:{next:null}})), query.request.url);
  const [{payload:projection}] = capture.finish();
  const context = {owner, scope:query.sourceScope, cipher:input.cipher, attemptId:input.attemptId, pageOrdinal:0};
  const page = sealKlaviyoHourlySourcePage({...context, projection});
  assert.deepEqual(openKlaviyoHourlySourcePage({...context, page}), projection);
  assert.throws(() => openKlaviyoHourlySourcePage({...context, page, pageOrdinal:1}), /SCOPE_INVALID/);
  assert.throws(() => openKlaviyoHourlySourcePage({...context, page,
    scope:{...context.scope, fence:8}}), /SCOPE_INVALID/);
  assert.throws(() => openKlaviyoHourlySourcePage({...context, page,
    owner:{...owner, connectionVersion:"2"}}), /ENVELOPE_INVALID/);
  assert.throws(() => sealKlaviyoHourlySourcePage({...context, projection:{...projection, records:[
    {...projection.records[0], attributes:{datetime:tickAt}},
  ]}}), /SCOPE_INVALID/);

  const first = {...projection, hasNext:true};
  const second = {...projection, records:[{...projection.records[0],id:"event-2",
    attributes:{datetime:start,event_properties:{ProductID:"second",Quantity:{jsonNumber:"1"}}},
    relationships:{metric:{data:{type:"metric",id:"ordered"}}}}],
  included:[{type:"attribution",id:"flow-a",relationships:{
    flow:{data:{type:"flow",id:"flow-id"}},
    "flow-message":{data:{type:"flow-message",id:"message-id"}},
    "flow-message-variation":{data:{type:"flow-message-variation",id:"variation-id"}},
  }}]};
  const batchContext = {...context, limits:{maxPages:3,maxRows:3,maxBytes:10000}};
  const {pages, manifest} = prepareKlaviyoHourlySourceBatch({...batchContext, projections:[first,second]});
  const read = {...batchContext, pages, manifest, expectedManifest:manifest};
  assert.deepEqual(verifyKlaviyoHourlySourceBatch(read), manifest);
  assert.equal(manifest.rows, 2);
  assert.throws(() => verifyKlaviyoHourlySourceBatch({...read, pages:[pages[1],pages[0]]}), /SCOPE_INVALID/);
  assert.throws(() => verifyKlaviyoHourlySourceBatch({...read, pages:[pages[0]]}), /SCOPE_INVALID/);
  assert.throws(() => verifyKlaviyoHourlySourceBatch({...read, manifest:{...manifest, rows:1}}), /SCOPE_INVALID/);
  assert.throws(() => prepareKlaviyoHourlySourceBatch({...batchContext, projections:[first,projection]}), /SCOPE_INVALID/);
  const empty = prepareKlaviyoHourlySourceBatch({...batchContext, projections:[{...projection, records:[]}]});
  assert.equal(empty.manifest.rows, 0);
  assert.throws(() => prepareKlaviyoHourlySourceBatch({...batchContext,
    limits:{...batchContext.limits,maxRows:1}, projections:[first,second]}), /SCOPE_INVALID/);

  let writes = 0, reads = 0;
  const writeOptions = {deadlineAt:1000, now:() => 0, repository:{
    async commitHourlySource() {writes++; throw Error("unknown outcome");},
    async readHourlySource() {reads++;},
  }};
  await assert.rejects(commitKlaviyoHourlySourceBatch({...writeOptions,batch:empty}), /WRITE_UNCONFIRMED/);
  await assert.rejects(commitKlaviyoHourlySourceBatch({...writeOptions,batch:empty}), /SCOPE_INVALID/);
  assert.deepEqual([writes,reads], [1,0]);
  const confirmed = prepareKlaviyoHourlySourceBatch({...batchContext,projections:[first,second]});
  const calls = [];
  const repository = createKlaviyoHourlySourceRepository({policy:sourceRetentionDurationPolicy(),
    observedAt:tickAt, quotaContext:{fixture:true}, now:() => Date.parse(tickAt),
    database:{async query(sql,args) {
      calls.push(sql);
      const receipt = {status:"committed", sourceState:"complete", manifest:{
        klaviyoHourlyRead:context.scope, klaviyoHourlyManifest:confirmed.manifest}};
      if (sql.includes("commit_klaviyo_hourly_source")) {
        assert.equal(args[3].fence,7);
        assert.equal(args[2].pages.length,2);
        assert.deepEqual(args[7],{fixture:true});
        return {rows:[{result:receipt}]};
      }
      if (sql.includes("read_source_receipt")) return {rows:[{result:receipt}]};
      assert.match(sql,/read_source_pages/);
      return {rows:[{result:args[3]==="0" ? confirmed.pages.map((stored,index) => ({
        ...stored,id:String(index+1),available:true,expired:false,retentionPruned:false,
      })) : []}]};
    }}});
  const result = await commitKlaviyoHourlySourceBatch({...writeOptions,batch:confirmed,repository});
  assert.equal(calls.length,4);
  assert.deepEqual(result,{attemptId:context.attemptId,digest:confirmed.manifest.digest,
    pageCount:2,rowCount:2,contentVerified:true});
  const {sales} = projectVerifiedKlaviyoHourlyProductSales(result);
  assert.deepEqual(sales.map(row => [row.productId,row.variantId,row.quantity,row.value]), [
    ["product","variant","2","19.99"], ["second",null,"1",null],
  ]);
  assert.deepEqual(sales.map(row => [row.attribution.source_entity_id,row.attribution.channel_id,
    row.attribution.variation_id,row.attribution.sales_role]), [
    ["flow-id","message-id","variation-id","Triggered"], [null,null,null,"Unclassified"],
  ]);
  const reportReceipt = {attemptId:result.attemptId,digest:result.digest,
    counts:[2,0],applied:[start],productRows:2,productDigest:"f".repeat(64)};
  let reportCalls = 0;
  const reportDatabase = {async query(sql,args) {
    reportCalls++;
    if (sql.includes("commit_klaviyo_hourly_event_report")) {
      assert.equal(args[3],"[2,0]");
      assert.deepEqual(JSON.parse(args[5]),sales);
    }
    return {rows:[{result:reportReceipt}]};
  }};
  const report = {database:reportDatabase,deadlineAt:1000,now:() => 0};
  await assert.rejects(commitKlaviyoHourlyEventReport({...report,sourceReceipt:{...result}}),/SCOPE_INVALID/);
  assert.deepEqual(await commitKlaviyoHourlyEventReport({...report,sourceReceipt:result}),reportReceipt);
  await assert.rejects(commitKlaviyoHourlyEventReport({...report,sourceReceipt:result}),/SCOPE_INVALID/);
  assert.equal(reportCalls,2);
});

test("source evidence encryption binds actual owner, attempt, page metadata and sanitized content", () => {
  const {input, prepare} = sourceStoreFixture();
  const write = prepare(), page = write.body.pages[0];
  const open = (owner = write.owner, attemptId = write.attemptId, ordinal = 0, next = page) =>
    input.cipher.open({owner, attemptId, ordinal, page: next});
  assert.deepEqual(open(), input.pages[0].payload);
  assert.equal(JSON.stringify(write).includes('"amount":"120.50"'), true, "structured native source preserves exact amount separately");
  assert.equal(page.ciphertext.includes(Buffer.from("120.50").toString("hex")), false);
  for (const changed of [{...write.owner, workspaceId: randomUUID()}, {...write.owner, generation: "2"}, {...write.owner, installationId: "2"}]) {
    assert.throws(() => open(changed), /ENVELOPE_INVALID/);
  }
  assert.throws(() => open(write.owner, randomUUID()), /ENVELOPE_INVALID/);
  assert.throws(() => open(write.owner, write.attemptId, 1), /ENVELOPE_INVALID/);
  for (const changed of [{...page, family: "other"}, {...page, payloadHash: "0".repeat(64)}, {...page, fieldCoverage: []},
    {...page, authTag: "0".repeat(32)}, {...page, ciphertext: (parseInt(page.ciphertext.slice(0,2),16)^1).toString(16).padStart(2,"0") + page.ciphertext.slice(2)}]) {
    assert.throws(() => open(write.owner, write.attemptId, 0, changed), /ENVELOPE_INVALID/);
  }
});

test("source keys are copied, versioned and cannot reuse session/token or other-version key material", () => {
  const key = randomBytes(32);
  assert.throws(() => createSourceEvidenceCipher({keys: new Map([[1, key]]), activeVersion: 1, forbiddenKeys: [key]}), /KEY_REUSE/);
  assert.throws(() => createSourceEvidenceCipher({keys: new Map([[1, key], [2, key]]), activeVersion: 2, forbiddenKeys: []}), /KEY_REUSE/);
  const keys = new Map([[1, key]]), cipher = createSourceEvidenceCipher({keys, activeVersion: 1, forbiddenKeys: []});
  const {input} = sourceStoreFixture({cipher});
  key.fill(0); keys.clear();
  const write = prepareSourceWrite(input);
  assert.deepEqual(cipher.open({owner: write.owner, attemptId: write.attemptId, ordinal: 0, page: write.body.pages[0]}), input.pages[0].payload);
});

test("source canonicalization preserves identity text, rejects private fields, lossy numbers and non-JSON authority", () => {
  assert.equal(canonicalSourceJson({b: "9223372036854775807", a: null}), '{"a":null,"b":"9223372036854775807"}');
  for (const input of [{token: "hidden"}, {records: [{email: "hidden"}]}, {x: 1.2}, {x: Infinity}, {x: BigInt(1)}, {x: undefined}, new Date()]) {
    assert.throws(() => canonicalSourceJson(input));
  }
  const {input} = sourceStoreFixture();
  assert.throws(() => sourceStoreOwner({...input.owner, installationId: 1}), /OWNER_INVALID/);
  assert.throws(() => sourceStoreOwner({...input.owner, nativePermissionVerified: true}), /OWNER_INVALID/);
});

test("source reference hashes come from the exact encrypted page record and cannot be supplied or point elsewhere", () => {
  const {input, prepare} = sourceStoreFixture();
  assert.equal(prepare().body.references[0].hash, sourcePayloadHash(input.pages[0].payload.records[0]));
  input.records.references[0].locator = "/records/9";
  assert.throws(() => prepareSourceWrite(input), /REFERENCE_INVALID/);
  input.records.references[0].locator = "/records/0";
  input.records.references[0].hash = "0".repeat(64);
  assert.throws(() => prepareSourceWrite(input), /SHAPE_INVALID/);
});

test("source bundle preparation rejects missing retention, foreign references, duplicate keys and exceeded explicit budgets", () => {
  for (const change of [i => {i.policy.raw.until = i.now;}, i => {delete i.policy.claim;},
    i => {i.records.lines[0].reference = "foreign";}, i => {i.records.lines[0].order = "foreign";},
    i => {i.pages.push(i.pages[0]);}, i => {i.limits.maxBytes = 20;}]) {
    const {input} = sourceStoreFixture(); change(input); assert.throws(() => prepareSourceWrite(input));
  }
});

test("structured content must equal its referenced evidence; storage flags cannot manufacture native verification", () => {
  const {input} = sourceStoreFixture();
  input.records.orders[0].data = {...input.records.orders[0].data, amount: "999.99"};
  assert.throws(() => prepareSourceWrite(input), /CONTENT_REFERENCE_CONFLICT/);
  const second = sourceStoreFixture().input;
  second.records.references[0].nativeId = "gid://shopify/Order/999";
  assert.throws(() => prepareSourceWrite(second), /NATIVE_REFERENCE_CONFLICT/);
  const third = sourceStoreFixture().input;
  third.records.rules.push({key: "rule", ruleKey: "unproven", version: "1", kind: "test", context: {},
    parserVersion: "1", state: "reviewed", basis: {}, applicability: {}});
  assert.throws(() => prepareSourceWrite(third), /NATIVE_RECEIPT_REQUIRED/);
});

test("lost or malformed commit result consumes the one-use write and permits explicit read-only inspection only", async () => {
  for (const result of [null, {rows: [{result: {status: "committed"}}]}]) {
    const queries = [], repository = createSourceEvidenceRepository({query: async (sql, args) => {
      queries.push([sql, args]);
      if (sql.includes("commit_source_batch")) {if (result === null) throw Error("private provider/body must not escape"); return result;}
      return {rows: [{result: {status: "not_observed", rollbackProven: false}}]};
    }});
    const {prepare} = sourceStoreFixture(), write = prepare();
    await assert.rejects(repository.commit(write), {message: "SOURCE_STORE_WRITE_UNCONFIRMED"});
    await assert.rejects(repository.commit(write), /WRITE_CAPABILITY_REQUIRED/);
    await assert.rejects(repository.commit(structuredClone(write)), /WRITE_CAPABILITY_REQUIRED/);
    assert.deepEqual(await repository.inspect(write), {status: "not_observed", rollbackProven: false});
    assert.equal(queries.filter(([sql]) => sql.includes("commit_source_batch")).length, 1);
    assert.equal(queries.filter(([sql]) => sql.includes("read_source_receipt")).length, 1);
  }
});

test("a valid source storage receipt does not claim native acceptance, Dataset completion or activation", async () => {
  const {prepare} = sourceStoreFixture(), write = prepare();
  const receipt = {status: "committed", batchId: "9223372036854775807", commitId: randomUUID(), digest: "a".repeat(64),
    sourceState: "complete", manifest: {counts: Object.fromEntries(Object.keys(write.body).filter(k => Array.isArray(write.body[k])).map(k => [k, write.body[k].length]))}};
  const repository = createSourceEvidenceRepository({query: async () => ({rows: [{result: receipt}]})});
  assert.deepEqual(await repository.commit(write), receipt);
  assert.equal(Object.hasOwn(receipt, "nativePermissionVerified"), false);
  assert.equal(Object.hasOwn(receipt, "DatasetWritePerformed"), false);
});

test("bounded page reads never fall back to direct tables and reject invalid cursors before SQL", async () => {
  let calls = 0;
  const repository = createSourceEvidenceRepository({query: async sql => {calls++; assert.match(sql, /evidence.read_source_pages/); return {rows: [{result: []}]};}});
  const {input} = sourceStoreFixture();
  await assert.rejects(repository.readPages({...input, after: "1;delete", limit: 1}), /INPUT_INVALID/);
  assert.equal(calls, 0);
  assert.deepEqual(await repository.readPages({...input, after: "0", limit: 1}), []);
});
