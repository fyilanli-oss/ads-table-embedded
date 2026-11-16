import assert from "node:assert/strict";
import {planIncrementalReport} from "../app/lib/refresh/incremental-report-plan.server.js";

// A logged table in the isolated replay only. The rollback removes the entire
// prototype. The statement never has a path to the application's daily facts.
const writeHours = `
  insert into eo05_hourly_rehearsal.hour_snapshots as saved
    (series_id, hour_start, observed_at, facts)
  select $1, input.hour_start, $2::timestamptz, input.facts
    from jsonb_to_recordset($3::jsonb) as input(hour_start timestamptz, facts jsonb)
    order by input.hour_start
  on conflict (series_id, hour_start) do update
    set observed_at=excluded.observed_at, facts=excluded.facts
    where excluded.observed_at > saved.observed_at
  returning hour_start
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
      insert into eo05_hourly_rehearsal.day_snapshots values ('account-a', '2026-11-16', 42);
    `);
    const firstTick = "2026-11-16T21:00:00.000Z";
    const secondTick = "2026-11-16T22:00:00.000Z";
    const args = (series, tick, values) => {
      const {hourly} = planIncrementalReport({tickAt:tick, timeZone:"Europe/Istanbul", hourlySupported:true});
      return [series, tick, JSON.stringify(hourly.hours.map((hour_start, index) => ({
        hour_start, facts:values[index],
      })))];
    };
    const first = args("account-a", firstTick, [[1], [3]]);
    assert.equal((await client.query(writeHours, first)).rowCount, 2);
    assert.equal((await client.query(writeHours, args("account-b", firstTick, [[10], [13]]))).rowCount, 2);
    assert.equal((await client.query(writeHours, args("account-a", secondTick, [[5], []]))).rowCount, 2);
    assert.equal((await client.query(writeHours, first)).rowCount, 0);

    await client.query("savepoint invalid_hour_batch");
    const bad = args("account-a", "2026-11-16T23:00:00.000Z", [[99], {invalid:true}]);
    await assert.rejects(client.query(writeHours, bad), {code:"23514"});
    await client.query("rollback to savepoint invalid_hour_batch");
    await client.query("release savepoint invalid_hour_batch");

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
    console.log("EO05_HOURLY_STORAGE_PROBE_PASS real_SQL=true overlap_replaced=true delayed_replay_ignored=true invalid_batch_atomic=true daily_unchanged=true accounts_separate=true");
  } finally {
    await client.query("rollback");
  }
}
