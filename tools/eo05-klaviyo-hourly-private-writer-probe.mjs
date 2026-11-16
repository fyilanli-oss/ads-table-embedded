import assert from "node:assert/strict";
import {randomBytes, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {buildKlaviyoHourlyOrderedProductEventsRequest} from "../app/lib/providers/klaviyo-reporting.server.js";
import {createKlaviyoHourlySourceRepository} from "../app/lib/database/klaviyo-hourly-source-repository.server.js";
import {createSourceEvidenceCipher} from "../app/lib/database/source-evidence-store.server.js";
import {sourceRetentionDurationPolicy} from "../app/lib/database/source-retention-policy.server.js";
import {commitKlaviyoHourlyEventReport, commitKlaviyoHourlySourceBatch,
  prepareKlaviyoHourlySourceBatch} from "../app/lib/database/klaviyo-hourly-source-page.server.js";
import {createRefreshEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";
import {dispatchRefreshPreflight} from "../app/lib/refresh/preflight-bridge.server.js";
import {planKlaviyoHourlySource} from "../app/lib/refresh/incremental-report-plan.server.js";

export async function klaviyoHourlyPrivateWriterProbe(client, {store,workspace,shopId,shopDomain,connection,installation}) {
  await client.query("savepoint klaviyo_hourly_private_writer");
  try {
    await client.query(readFileSync(new URL("./sql/eo05-klaviyo-hourly-source.sql",import.meta.url),"utf8"));
    await client.query(readFileSync(new URL("./sql/eo05-klaviyo-hourly-event-report.sql",import.meta.url),"utf8"));
    await client.query("update integrations.provider_connections set connected_at=statement_timestamp()-interval '3 days' where id=$1",
      [connection.id]);
    await client.query("update integrations.reporting_account_bindings set effective_from=statement_timestamp()-interval '3 days' where connection_id=$1 and effective_to is null",
      [connection.id]);
    await store.checkQueueFromAuthority({expectedRevision:(await store.readQueueCheck()).revision});
    const current = Date.now();
    const {start,end,partitionId,window} = planKlaviyoHourlySource({tickAt:new Date(current).toISOString(),timeZone:"UTC"});
    const endMs = Date.parse(end);
    await client.query(`
      update operations.refresh_queue_accounts set first_due_hour_ms=$2, first_queued_at_ms=$2
      where workspace_id=$1 and provider='klaviyo' and account_id='klaviyo-a' and state='pending'
    `, [workspace,endMs-3_600_000]);
    const deadlineAt = current+90_000;
    let sourceWritten = false;
    const verifier = createRefreshEntitlementVerifier({
      store, appId:"gid://shopify/App/456", now:Date.now,
      limits:{deadlineAt, requestTimeoutMs:10000, finishReserveMs:1000},
      authorizeRead:async () => true,
      partnerApi:{appId:"gid://shopify/App/456",activeSubscription:async () => ({data:{activeSubscription:{
        shop:{id:shopId,myshopifyDomain:shopDomain},billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:false,
        trialEndsAt:null,currentBillingCycle:{startTime:new Date(current-86_400_000).toISOString(),
          endTime:new Date(current+86_400_000).toISOString()},
        items:[{handle:"monthly",price:{active:true}}],pendingUpdate:null,
      }}})},
    });
    const run = await dispatchRefreshPreflight({
      store, now:Date.now,
      buildWorkPlan:async candidate => candidate.provider==="klaviyo" ? {
        window, partitionId, workClass:"hourly_hot_window",
        cost:{requests:4,dbWrites:8,connections:1,rows:10,bytes:10000},
        limits:{deadlineAt,requestTimeoutMs:10000,finishReserveMs:1000,maxRows:10,maxBytes:10000},
      } : null,
      entitlementVerifier:verifier,
      readPage:async execution => {
        const {claim,entitlementReceipt:{observedAt}} = execution;
        const owner = {provider:"klaviyo",workspaceId:workspace,installationId:installation.id,
          generation:claim.installGeneration,shopId,shopDomain,accountId:claim.accountId,
          connectionId:connection.id,connectionVersion:String(connection.connection_version),
          selectionEpoch:null,credentialId:connection.credential_id};
        const {rows:[quota]} = await client.query(
          "select operations.load_refresh_quota_context($1,$2,'klaviyo',$3,$4,$5,$6,$7,'klaviyo',$8) as context",
          [workspace,claim.installGeneration,claim.accountId,claim.id,claim.fence,window.from,window.to,observedAt],
        );
        assert.ok(quota.context,"hourly claim must retain current quota authority");
        const metricId = "m".repeat(256);
        const {sourceScope:scope} = buildKlaviyoHourlyOrderedProductEventsRequest({
          accessToken:"synthetic-only",orderedProductMetricId:metricId,tickAt:end,timeZone:"UTC",
          job:{...claim,window:{start,end}},
        });
        const attemptId = randomUUID();
        const cipher = createSourceEvidenceCipher({keys:new Map([[1,randomBytes(32)]]),activeVersion:1,forbiddenKeys:[]});
        const sourceInput = {owner,scope,attemptId,cipher,
          limits:{maxPages:2,maxRows:2,maxBytes:10000},
          projections:[{revision:scope.revision,included:[{type:"attribution",id:"sale-attribution",relationships:{
            flow:{data:{type:"flow",id:"parent-flow"}},
            "flow-message":{data:{type:"flow-message",id:"message"}},
            "flow-message-variation":{data:{type:"flow-message-variation",id:"variation"}},
          }}],hasNext:false,records:[
            {type:"event",id:"event",attributes:{datetime:start,event_properties:{ProductID:"first",Quantity:"2",$value:"24.50"}},
              relationships:{metric:{data:{type:"metric",id:metricId}},
                attributions:{data:[{type:"attribution",id:"sale-attribution"}]}}},
            {type:"event",id:"next-hour-event",attributes:{datetime:new Date(endMs-3_600_000).toISOString()},
              relationships:{metric:{data:{type:"metric",id:metricId}}}},
          ]}],
        };
        let sqlFailure;
        const repository = createKlaviyoHourlySourceRepository({policy:sourceRetentionDurationPolicy(),
          database:{async query(sql,args) {
            try {return await client.query(sql,args);}
            catch (error) {sqlFailure = error; throw error;}
          }},observedAt,quotaContext:quota.context});
        const staleAttempt = randomUUID();
        const stale = prepareKlaviyoHourlySourceBatch({...sourceInput,attemptId:staleAttempt,
          scope:{...scope,fence:scope.fence+1}});
        await client.query("savepoint stale_hourly_claim");
        try {
          await assert.rejects(commitKlaviyoHourlySourceBatch({batch:stale,repository,deadlineAt}), /WRITE_UNCONFIRMED/);
        } finally {
          await client.query("rollback to savepoint stale_hourly_claim");
          await client.query("release savepoint stale_hourly_claim");
        }
        assert.equal((await client.query("select count(*)::int n from evidence.source_batches where attempt_id=$1",
          [staleAttempt])).rows[0].n, 0);
        const batch = prepareKlaviyoHourlySourceBatch(sourceInput);
        await client.query("savepoint hourly_write_roundtrip");
        let receipt;
        sqlFailure = undefined;
        try {
          receipt = await commitKlaviyoHourlySourceBatch({batch,repository,deadlineAt});
        } catch (error) {
          await client.query("rollback to savepoint hourly_write_roundtrip");
          console.error("EO05_KLAVIYO_HOURLY_PRIVATE_WRITE_STOP", JSON.stringify({
            code:sqlFailure?.code, message:sqlFailure?.message ?? error.message,
          }));
          throw error;
        } finally {
          await client.query("release savepoint hourly_write_roundtrip");
        }
        assert.deepEqual(receipt,{attemptId,digest:batch.manifest.digest,pageCount:1,rowCount:2,contentVerified:true});
        await assert.rejects(commitKlaviyoHourlyEventReport({database:client,sourceReceipt:{...receipt},deadlineAt}),
          /SCOPE_INVALID/);
        const report = await commitKlaviyoHourlyEventReport({database:client,sourceReceipt:receipt,deadlineAt});
        assert.deepEqual(report.counts,[1,1]);
        assert.equal(report.applied.length,2);
        const facts = await client.query("select event_count from analytics.klaviyo_hourly_event_facts order by hour_start");
        assert.deepEqual(facts.rows,[{event_count:1},{event_count:1}]);
        const products = await client.query("select sale from analytics.klaviyo_hourly_product_sales order by ordinal");
        assert.deepEqual(products.rows.map(({sale}) => [sale.productId,sale.quantity,sale.value]),
          [["first","2","24.5"],[null,null,null]]);
        const {attribution} = products.rows[0].sale;
        assert.deepEqual([attribution.source,attribution.source_entity_id,attribution.channel_id,
          attribution.variation_id,attribution.sales_role],["flow","parent-flow","message","variation","Triggered"]);
        assert.equal(await store.isClaimCurrent({claim}),true,"source receipt must not finish the report job");
        sourceWritten = true;
        return {kind:"complete",payload:{}};
      },
      validatePage:() => ({complete:true,rows:[]}),
    });
    assert.equal(run.status,"awaiting_dataset",JSON.stringify({status:run.status,reason:run.reason,deferred:run.deferred}));
    assert.equal(sourceWritten,true);
    console.log("EO05_KLAVIYO_HOURLY_PRIVATE_WRITER_ROUNDTRIP_PASS actual_source_tables=true actual_claim=true readback=true real_provider_calls=0");
    console.log("EO05_KLAVIYO_HOURLY_EVENT_REPORT_PASS actual_hourly_facts=true source_receipt_bound=true report_readback=true runtime_grants=false");
  } finally {
    await client.query("rollback to savepoint klaviyo_hourly_private_writer");
    await client.query("release savepoint klaviyo_hourly_private_writer");
  }
}
