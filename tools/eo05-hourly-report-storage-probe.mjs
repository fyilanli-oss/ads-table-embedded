import assert from "node:assert/strict";
import {randomBytes, randomUUID} from "node:crypto";
import {planIncrementalReport} from "../app/lib/refresh/incremental-report-plan.server.js";
import {buildKlaviyoHourlyOrderedProductEventsRequest} from "../app/lib/providers/klaviyo-reporting.server.js";
import {createSourceEvidenceCipher} from "../app/lib/database/source-evidence-store.server.js";
import {commitKlaviyoHourlySourceBatch, prepareKlaviyoHourlySourceBatch} from "../app/lib/database/klaviyo-hourly-source-page.server.js";

// A logged table in the isolated replay only. The rollback removes the entire
// prototype. The statement never has a path to the application's daily facts.
const writeHours = `
  with input as materialized (
    select * from jsonb_to_recordset($5::jsonb) as item(hour_start timestamptz, facts jsonb)
  ), claimed as materialized (
    select work.* from eo05_hourly_rehearsal.work_orders work
    where work.job_id=$3 and work.fence=$4 and work.series_id=$1 and not work.finished
      and $2::timestamptz >= work.hour_end
      and (select count(*) from input)=2
      and exists (select 1 from input where hour_start=work.hour_end - interval '2 hours')
      and exists (select 1 from input where hour_start=work.hour_end - interval '1 hour')
    for update of work
  ), written as (
    insert into eo05_hourly_rehearsal.hour_snapshots as saved
      (series_id, hour_start, observed_at, facts)
    select claimed.series_id, input.hour_start, $2::timestamptz, input.facts
      from claimed cross join input order by input.hour_start
    on conflict (series_id, hour_start) do update
      set observed_at=excluded.observed_at, facts=excluded.facts
      where excluded.observed_at > saved.observed_at
    returning hour_start
  ), finished as (
    update eo05_hourly_rehearsal.work_orders work set finished=true
    from claimed where work.job_id=claimed.job_id returning work.*
  )
  insert into eo05_hourly_rehearsal.receipts (job_id, fence, series_id, hour_end, written_count)
    select job_id, fence, series_id, hour_end, (select count(*) from written) from finished
  returning job_id, fence, series_id, hour_end, written_count
`;

export async function hourlyReportStorageProbe(client) {
  await client.query("begin");
  try {
    await client.query(`
      create schema eo05_hourly_rehearsal;
      create table eo05_hourly_rehearsal.hour_snapshots (
        series_id text not null,
        hour_start timestamptz not null,
        observed_at timestamptz not null,
        facts jsonb not null check (jsonb_typeof(facts) = 'array'),
        primary key (series_id, hour_start)
      );
      create table eo05_hourly_rehearsal.day_snapshots (
        series_id text not null,
        business_date date not null,
        value int not null,
        primary key (series_id, business_date)
      );
      create table eo05_hourly_rehearsal.work_orders (
        job_id text primary key,
        fence int not null,
        series_id text not null,
        hour_end timestamptz not null,
        finished boolean not null default false
      );
      create table eo05_hourly_rehearsal.receipts (
        job_id text primary key references eo05_hourly_rehearsal.work_orders(job_id),
        fence int not null,
        series_id text not null,
        hour_end timestamptz not null,
        written_count int not null check (written_count between 0 and 2)
      );
      insert into eo05_hourly_rehearsal.day_snapshots values ('account-a', '2026-11-16', 42);
    `);
    const firstTick = "2026-11-16T21:00:00.000Z";
    const secondTick = "2026-11-16T22:00:00.000Z";
    const args = async (job, series, tick, values) => {
      const {hourly} = planIncrementalReport({tickAt:tick, timeZone:"Europe/Istanbul", hourlySupported:true});
      await client.query(
        "insert into eo05_hourly_rehearsal.work_orders(job_id,fence,series_id,hour_end) values ($1,7,$2,$3)",
        [job, series, tick],
      );
      return [series, tick, job, 7, JSON.stringify(hourly.hours.map((hour_start, index) => ({
        hour_start, facts:values[index],
      })))];
    };
    const first = await args("first", "account-a", firstTick, [[1], [3]]);
    const receipt = (await client.query(writeHours, first)).rows[0];
    assert.deepEqual({...receipt,hour_end:receipt.hour_end.toISOString()}, {
      job_id:"first", fence:7, series_id:"account-a", hour_end:firstTick, written_count:2,
    });
    assert.deepEqual((await client.query(
      "select * from eo05_hourly_rehearsal.receipts where job_id=$1", ["first"],
    )).rows, [receipt]);
    await client.query(writeHours, await args("other", "account-b", firstTick, [[10], [13]]));
    const next = await args("next", "account-a", secondTick, [[5], []]);
    assert.equal((await client.query(writeHours, ["account-b", ...next.slice(1)])).rowCount, 0);
    assert.equal((await client.query(writeHours, [...next.slice(0,3), 8, next[4]])).rowCount, 0);
    assert.equal((await client.query(writeHours, [...next.slice(0,4), first[4]])).rowCount, 0);
    assert.equal((await client.query(writeHours, next)).rows[0].written_count, 2);
    assert.equal((await client.query(writeHours, first)).rowCount, 0);
    const late = await args("late", "account-a", firstTick, [[90], [93]]);
    assert.equal((await client.query(writeHours, late)).rows[0].written_count, 0);

    const bad = await args("bad", "account-a", "2026-11-16T23:00:00.000Z", [[99], {invalid:true}]);
    await client.query("savepoint invalid_hour_batch");
    await assert.rejects(client.query(writeHours, bad), {code:"23514"});
    await client.query("rollback to savepoint invalid_hour_batch");
    await client.query("release savepoint invalid_hour_batch");
    assert.deepEqual((await client.query(`
      select work.finished, receipt.job_id from eo05_hourly_rehearsal.work_orders work
      left join eo05_hourly_rehearsal.receipts receipt using (job_id) where work.job_id='bad'
    `)).rows, [{finished:false, job_id:null}]);

    const readHours = await client.query(`
      select series_id, hour_start, facts from eo05_hourly_rehearsal.hour_snapshots
      order by series_id, hour_start
    `);
    assert.deepEqual(readHours.rows.map(row => [row.series_id,row.hour_start.toISOString(),row.facts]), [
      ["account-a", "2026-11-16T19:00:00.000Z", [1]],
      ["account-a", "2026-11-16T20:00:00.000Z", [5]],
      ["account-a", "2026-11-16T21:00:00.000Z", []],
      ["account-b", "2026-11-16T19:00:00.000Z", [10]],
      ["account-b", "2026-11-16T20:00:00.000Z", [13]],
    ]);
    const days = await client.query("select value from eo05_hourly_rehearsal.day_snapshots");
    assert.deepEqual(days.rows, [{value:42}]);
    await klaviyoBatchRoundTrip(client, firstTick);
    console.log("EO05_HOURLY_STORAGE_PROBE_PASS real_SQL=true overlap_replaced=true delayed_replay_ignored=true invalid_batch_atomic=true daily_unchanged=true accounts_separate=true job_bound=true receipt_readback=true");
  } finally {
    await client.query("rollback");
  }
}

async function klaviyoBatchRoundTrip(client, tickAt) {
  await client.query(`
    create table eo05_hourly_rehearsal.source_batches (
      attempt_id uuid primary key,
      manifest jsonb not null
    );
    create table eo05_hourly_rehearsal.source_pages (
      attempt_id uuid not null references eo05_hourly_rehearsal.source_batches(attempt_id),
      ordinal int not null,
      envelope jsonb not null,
      primary key (attempt_id, ordinal)
    );
  `);
  const owner = {provider:"klaviyo", workspaceId:randomUUID(), installationId:"1", generation:"1",
    shopId:"gid://shopify/Shop/1", shopDomain:"hourly-fixture.myshopify.com",
    accountId:"hourly-account", connectionId:randomUUID(), connectionVersion:"1",
    selectionEpoch:null, credentialId:randomUUID()};
  const timeZone = "Europe/Istanbul";
  const {hourly} = planIncrementalReport({tickAt,timeZone,hourlySupported:true});
  const {sourceScope:scope} = buildKlaviyoHourlyOrderedProductEventsRequest({
    accessToken:"synthetic-only", orderedProductMetricId:"ordered", tickAt, timeZone,
    job:{id:"hourly-source-job", fence:7, provider:owner.provider, workspaceId:owner.workspaceId,
      installGeneration:owner.generation, accountId:owner.accountId, window:{start:hourly.start,end:hourly.end}},
  });
  const input = {owner, scope, attemptId:randomUUID(), limits:{maxPages:2,maxRows:2,maxBytes:10000},
    cipher:createSourceEvidenceCipher({keys:new Map([[1,randomBytes(32)]]), activeVersion:1, forbiddenKeys:[]})};
  const projections = hourly.hours.map((datetime,index) => ({
    revision:scope.revision, included:[], hasNext:index===0,
    records:[{type:"event",id:"event-"+index,attributes:{datetime},
      relationships:{metric:{data:{id:scope.metricId}}}}],
  }));
  await client.query(`
    insert into eo05_hourly_rehearsal.work_orders(job_id,fence,series_id,hour_end)
    values ($1,$2,$3,$4)
  `, [scope.jobId, scope.fence, scope.accountId, scope.timeframe.end]);
  const repository = {
    async commitHourlySource({attemptId, batch, scope:readScope}) {
      const {rows:[receipt]} = await client.query(`
        with claim as materialized (
          select job_id from eo05_hourly_rehearsal.work_orders
          where job_id=$4 and fence=$5 and series_id=$6 and hour_end=$7 and not finished
          for update
        ), batch as (
          insert into eo05_hourly_rehearsal.source_batches(attempt_id,manifest)
          select $1, $2::jsonb from claim returning attempt_id, manifest
        ), stored as (
          insert into eo05_hourly_rehearsal.source_pages(attempt_id,ordinal,envelope)
          select batch.attempt_id, (page->>'ordinal')::int, page
          from batch cross join jsonb_array_elements($3::jsonb) item(page)
          returning ordinal
        )
        select 'committed' status, attempt_id as "attemptId", manifest->>'digest' digest
        from batch where (select count(*) from stored)=jsonb_array_length(manifest->'pages')
      `, [attemptId, JSON.stringify(batch.manifest), JSON.stringify(batch.pages),
        readScope.jobId, readScope.fence, readScope.accountId, readScope.timeframe.end]);
      return receipt;
    },
    async readHourlySource({attemptId,maxPages}) {
      const {rows:[stored]} = await client.query(`
        select batch.manifest, jsonb_agg(page.envelope order by page.ordinal) as pages
        from eo05_hourly_rehearsal.source_batches batch
        cross join lateral (
          select ordinal,envelope from eo05_hourly_rehearsal.source_pages
          where attempt_id=batch.attempt_id order by ordinal limit $2
        ) page
        where batch.attempt_id=$1 group by batch.manifest
      `, [attemptId,maxPages+1]);
      return stored;
    },
  };
  const batch = prepareKlaviyoHourlySourceBatch({...input,projections});
  const actual = await commitKlaviyoHourlySourceBatch({batch, repository, deadlineAt:Date.now()+15000});
  assert.equal(actual.digest, batch.manifest.digest);
  assert.equal(actual.pageCount, 2);
  console.log("EO05_KLAVIYO_HOURLY_BATCH_PROBE_PASS real_SQL=true ordered_pages=2 immutable_manifest_readback=true synthetic=true");
}
