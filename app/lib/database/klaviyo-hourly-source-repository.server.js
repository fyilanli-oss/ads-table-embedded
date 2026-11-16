import {canonicalSourceJson, createSourceEvidenceRepository} from "./source-evidence-store.server.js";
import {resolveSourceRetentionDurationPolicy} from "./source-retention-policy.server.js";

const commitSql = "select evidence.commit_klaviyo_hourly_source($1::jsonb,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb,$6::timestamptz,$7::timestamptz,$8::jsonb) as result";
const fail = () => {throw Error("KLAVIYO_HOURLY_SOURCE_REPOSITORY_INVALID");};

// Trusted composition supplies a private connection and the worker's exact
// quota observation. No route grants this repository execution authority.
export function createKlaviyoHourlySourceRepository({database, policy, observedAt, quotaContext, now = Date.now}) {
  if (typeof database?.query !== "function" || typeof now !== "function" || !quotaContext
    || typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))) fail();
  const context = structuredClone(quotaContext);
  const source = createSourceEvidenceRepository(database);
  return Object.freeze({
    async commitHourlySource({owner, scope, attemptId, deadlineAt, batch}) {
      const retention = resolveSourceRetentionDurationPolicy(policy, new Date(now()).toISOString());
      const body = {sourceState:"complete", policy:retention,
        pages:batch.pages.map(page => ({...page, key:`hour-page-${page.ordinal}`})),
        references:[], rules:[], mappings:[], orders:[], lines:[], journeys:[], claims:[], links:[]};
      const {rows} = await database.query(commitSql, [owner, attemptId, body, scope, batch.manifest,
        observedAt, new Date(deadlineAt).toISOString(), context]);
      const receipt = rows?.[0]?.result;
      if (rows?.length !== 1 || receipt?.status !== "committed" || receipt.sourceState !== "complete"
        || canonicalSourceJson(receipt.manifest?.klaviyoHourlyRead) !== canonicalSourceJson(scope)
        || canonicalSourceJson(receipt.manifest?.klaviyoHourlyManifest) !== canonicalSourceJson(batch.manifest)) fail();
      return {status:"committed", attemptId, digest:batch.manifest.digest};
    },
    async readHourlySource({owner, scope, attemptId, maxPages}) {
      const receipt = await source.inspect({owner, attemptId, ordinal:0});
      if (receipt?.status !== "committed" || receipt.sourceState !== "complete"
        || canonicalSourceJson(receipt.manifest?.klaviyoHourlyRead) !== canonicalSourceJson(scope)
        || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 300) fail();
      const pages = [];
      let after = "0";
      while (pages.length <= maxPages) {
        const next = await source.readPages({owner, attemptId, ordinal:0, after,
          limit:Math.min(100,maxPages+1-pages.length)});
        if (next.length === 0) break;
        for (const page of next) {
          if (!/^[1-9][0-9]*$/.test(page.id ?? "") || BigInt(page.id) <= BigInt(after)
            || page.available !== true || page.expired !== false || page.retentionPruned !== false) fail();
          pages.push(page);
          after = page.id;
        }
      }
      if (pages.length > maxPages) fail();
      return {manifest:receipt.manifest.klaviyoHourlyManifest, pages};
    },
  });
}
