import test from 'node:test';
import assert from 'node:assert/strict';
import {metaRawDatasetsFixture} from './fixtures/meta-raw-datasets-fixture.js';
import {klaviyoRawDatasetsFixture} from './fixtures/klaviyo-raw-datasets-fixture.js';
import {validateMetaRawEligibility} from '../app/lib/refresh/meta-raw-eligibility.server.js';
import {validateKlaviyoRawEligibility} from '../app/lib/refresh/klaviyo-raw-eligibility.server.js';
for(const [provider,fixture,validate]of [['meta',metaRawDatasetsFixture,validateMetaRawEligibility],['klaviyo',klaviyoRawDatasetsFixture,validateKlaviyoRawEligibility]]){
 test(provider+' synthetic receipt eligibility stays valid across day, month and year changes',{concurrency:false},t=>{
  let clock=Date.parse('2026-11-04T23:59:59.999Z');t.mock.method(Date,'now',()=>clock);
  let originalEpoch;
  for(const date of ['2026-11-04T23:59:59.999Z','2026-11-05T00:00:00.000Z','2026-12-01T00:00:00.000Z','2027-01-01T00:00:00.000Z','2028-02-29T12:00:00.000Z']){
   clock=Date.parse(date);const x=fixture(),source=x.f.source,window=x.plan.target.window;
   const nativeDayStartMs=Date.parse(window.from+'T00:00:00Z');
   const value={kind:provider+'_raw_native_business_day_v1',businessDate:window.from,timezone:source.timezone,eligibleFromMs:source.eligibleFromMs,nativeDayStartMs,includesPreConnectionHours:nativeDayStartMs<source.eligibleFromMs,authorizesReportingDataset:false};
   assert.equal(new Date(source.eligibleFromMs).toISOString().slice(0,10),window.from);
   assert.equal(validate(value,{window,source}).businessDate,window.from);
   originalEpoch??=source.eligibleFromMs;assert.equal(source.eligibleFromMs,originalEpoch);
   // The production guard must still reject a true next-day connection mismatch.
   assert.throws(()=>validate({...value,eligibleFromMs:nativeDayStartMs+86400000+3600000},{window}),/ELIGIBILITY_UNCONFIRMED/);
  }
 });
}
