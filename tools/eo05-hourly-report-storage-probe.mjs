import assert from "node:assert/strict";
import {planIncrementalReport} from "../app/lib/refresh/incremental-report-plan.server.js";

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
    console.log("EO05_HOURLY_STORAGE_PROBE_PASS real_SQL=true overlap_replaced=true delayed_replay_ignored=true invalid_batch_atomic=true daily_unchanged=true accounts_separate=true job_bound=true receipt_readback=true");
  } finally {
    await client.query("rollback");
  }
}
