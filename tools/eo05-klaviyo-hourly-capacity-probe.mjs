import assert from "node:assert/strict";
import {randomBytes, randomUUID} from "node:crypto";
import {createSourceEvidenceCipher} from "../app/lib/database/source-evidence-store.server.js";
import {buildKlaviyoOrderedProductEventsRequest, buildKlaviyoHourlyOrderedProductEventsRequest}
  from "../app/lib/providers/klaviyo-reporting.server.js";
import {createKlaviyoSourceCapture} from "../app/lib/providers/klaviyo-source-capture.server.js";

const stores = 500, products = 500, pageSize = 200;
const origin = Date.parse("2026-11-16T00:00:00.000Z");
const end = "2026-11-17T00:00:00.000Z", start = "2026-11-16T22:00:00.000Z";
const metricId = "ordered-product";

function eventsFor(store) {
  return Array.from({length:products}, (_,product) => {
    const minute = (product*137+store*31) % 1440;
    return {type:"event",id:`event-${store}-${product}`,attributes:{
      datetime:new Date(origin+minute*60_000).toISOString(),
      event_properties:{ProductID:`product-${product}`,Quantity:1,"$value":"19.99"},
    },relationships:{metric:{data:{type:"metric",id:metricId}}}};
  }).sort((a,b) => a.attributes.datetime.localeCompare(b.attributes.datetime));
}

function stats(samples) {
  const ordered = [...samples].sort((a,b) => a-b);
  const rounded = n => Math.round(n*100)/100;
  return {totalMs:rounded(samples.reduce((a,b) => a+b,0)),
    p50Ms:rounded(ordered[Math.ceil(ordered.length*.5)-1]),p95Ms:rounded(ordered[Math.ceil(ordered.length*.95)-1])};
}

// Compares payload volume and raw source work on the same isolated PostgreSQL
// runner. No network latency, claimed production capacity or report workload.
export async function klaviyoHourlyCapacityProbe(client) {
  const cipher = createSourceEvidenceCipher({keys:new Map([[1,randomBytes(32)]]),activeVersion:1,forbiddenKeys:[]});
  const totals = Object.fromEntries(["daily","hourly"].map(mode => [mode,{
    rows:0,pages:0,wireBytes:0,encryptedBytes:0,capture:[],write:[],
  }]));
  await client.query("begin");
  try {
    await client.query(`
      create schema eo05_capacity_rehearsal;
      create table eo05_capacity_rehearsal.source_pages (
        mode text not null, store_number int not null, ordinal int not null,
        ciphertext bytea not null, payload_hash text not null,
        primary key(mode,store_number,ordinal)
      )
    `);
    for (let store=0;store<stores;store++) {
      const events = eventsFor(store);
      const owner = {workspaceId:randomUUID(),installationId:"1",generation:"1",
        shopId:`gid://shopify/Shop/${store+1}`,shopDomain:`hourly-store-${store}.myshopify.com`,
        provider:"klaviyo",accountId:`account-${store}`,connectionId:randomUUID(),
        connectionVersion:"1",selectionEpoch:null,credentialId:randomUUID()};
      const hourly = events.filter(event => event.attributes.datetime>=start && event.attributes.datetime<end);
      // Alternate first pass to reduce warm-up and order effects within each shop.
      for (const mode of store%2 ? ["hourly","daily"] : ["daily","hourly"]) {
        const daily = mode==="daily", samples = totals[mode];
        const selected = daily ? events : hourly;
        const request = daily
          ? buildKlaviyoOrderedProductEventsRequest({accessToken:"synthetic",orderedProductMetricId:metricId,
            businessDate:"2026-11-16",timeZone:"UTC"})
          : buildKlaviyoHourlyOrderedProductEventsRequest({accessToken:"synthetic",orderedProductMetricId:metricId,
            tickAt:end,timeZone:"UTC",job:{provider:"klaviyo",id:`job-${store}`,workspaceId:owner.workspaceId,
              accountId:owner.accountId,installGeneration:"1",fence:1,window:{start,end}}}).request;
        let timer = performance.now();
        const capture = createKlaviyoSourceCapture({maxBytes:2_000_000,check:() => {}});
        for (let offset=0;offset<Math.max(1,selected.length);offset+=pageSize) {
          const body = JSON.stringify({data:selected.slice(offset,offset+pageSize),
            links:{next:offset+pageSize<selected.length ? "synthetic-next" : null}});
          samples.wireBytes += Buffer.byteLength(body);
          await capture.read(new Response(body),request.url);
        }
        const attemptId = randomUUID();
        const pages = capture.finish().map(({family,payload},ordinal) => {
          const sealed = cipher.seal({owner,attemptId,ordinal:0,payload,page:{
            family,ordinal,origin:"klaviyo",fieldCoverage:["records"],captureLayer:"native_response_projection",
            numericFidelity:"lossless_token",schemaVersion:"capacity-fixture-v1",sanitizerVersion:"klaviyo-native-fields-v1",
          }});
          samples.encryptedBytes += sealed.ciphertext.length/2;
          return {ordinal,ciphertext:sealed.ciphertext,payload_hash:sealed.payloadHash};
        });
        samples.capture.push(performance.now()-timer);
        samples.rows += selected.length;
        samples.pages += pages.length;
        timer = performance.now();
        const written = await client.query(`
          insert into eo05_capacity_rehearsal.source_pages(mode,store_number,ordinal,ciphertext,payload_hash)
          select $1,$2,page.ordinal,decode(page.ciphertext,'hex'),page.payload_hash
          from jsonb_to_recordset($3::jsonb) as page(ordinal int,ciphertext text,payload_hash text)
        `,[mode,store,JSON.stringify(pages)]);
        samples.write.push(performance.now()-timer);
        assert.equal(written.rowCount,pages.length);
      }
    }
    const {daily,hourly} = totals;
    assert.equal(daily.rows,stores*products);
    assert.equal(daily.pages,stores*3);
    assert.equal(hourly.pages,stores);
    assert.ok(hourly.rows<daily.rows && hourly.wireBytes<daily.wireBytes);
    const summary = Object.fromEntries(Object.entries(totals).map(([mode,{capture,write,...volume}]) =>
      [mode,{...volume,capture:stats(capture),write:stats(write)}]));
    console.log("EO05_KLAVIYO_500_WINDOW_CAPACITY " + JSON.stringify({
      stores,productsPerStore:products,synthetic:true,providerCalls:0,runner:"same",...summary,
    }));
  } finally {
    await client.query("rollback");
  }
}
