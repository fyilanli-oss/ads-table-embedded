# A6-EO Cross-Cutting Safety, Capacity and Portability Freeze

**Status:** Decision frozen; implementation and acceptance pending  
**Decision date:** 7 October 2026  
**Executable contract:** `contracts/a6-eo-cross-cutting-safety-capacity-v1.json`

## Analyst conclusion

Supabase has no fixed “workspace count” wall. Capacity is determined by rows and bytes written per refresh, reconciliation amplification, query shapes, concurrent users and exports, retention, connection usage, CPU, memory and disk IO. Therefore AdsTable will not promise an unmeasured workspace number and will not wait for production failure before planning a database move.

The product target is **2,000 active workspaces**. This becomes certified only after a **4,000-workspace synthetic stress test**, a 2,000-workspace hourly-cycle test and a 24-hour 2,000-workspace soak test pass with the thresholds below.

At 2,000 workspaces, uniformly sharded hourly scheduling averages 0.556 workspace starts per second. If all three providers are active, that is approximately 144,000 provider jobs per day or 1.667 provider job starts per second. This scheduler rate is not itself dangerous. The unknown multiplier is the amount of provider data normalized and written by each job. That multiplier must be measured before EO-05 implementation.

## Authority and first-review boundary

- This repository and `docs/EXECUTION_PLAN.md` are the active authority.
- `ads-table-dev` is initial provenance, evidence and containment only.
- Export is outside the first review slice.
- Settings is the only connection authority. There is no separate top-level Data Sources control.
- Refresh is AdsTable-owned and hourly. There is no user refresh toggle; the UI may show only last update and next scheduled refresh.

## Subscription and privacy

- Trial and active subscriptions receive full product access.
- Pending, frozen, cancelled, declined, expired or missing entitlement stops provider jobs.
- Settings and privacy actions remain available; Funnel and Ad Analysis show subscription-required state and no metrics.
- Subscription loss does not immediately delete data. Deletion is driven only by confirmed Delete My Data, verified Shopify redaction, or an approved retention expiry.
- Shopify webhook HMAC is mandatory. Shopify’s 30-day completion deadline and uninstall-triggered `shop/redact` lifecycle remain binding.
- There is no blanket legal-retention exception. Every exception needs an exact data class, legal basis, owner and expiry.
- A restore cannot reopen service until the deletion ledger has been replayed.

## Reconciliation and finality

- The hourly hot window is only provider-business-date today and yesterday.
- Full history is never fetched every hour.
- Once per 24 hours, AdsTable reconciles the full effective provider attribution horizon.
- Meta uses the maximum verified active account/campaign/ad-set attribution setting used for reporting. If unavailable, finality stays unknown and provisional.
- Google Ads uses the longest active conversion-action click/view lookback. Official general caps are 90 click days and 30 view days.
- Klaviyo uses the verified current account/message attribution setting. The current test account’s five-day email window is evidence, not a global constant.
- A date becomes final only after the effective horizon, one full provider business day and a successful post-window reconciliation.
- Failed, partial or quota-limited runs never advance finality. Setting changes reopen affected dates.

## Date and compare boundary

- Timezone authority is the active Reporting Store’s Shopify IANA timezone; provider raw dates/timezones remain stored.
- Default is the last seven calendar days including today.
- Summary/Table custom ranges are limited to 90 days; Daily is limited to 31.
- Compare ranges must have equal day counts, cannot overlap, and use the same timezone and reporting currency.
- Bootstrap remains yesterday+today. Earlier unavailable dates are not synthetic zero.
- Current/non-final dates are visibly provisional.
- If provider daily facts cannot be translated truthfully, AdsTable returns partial/timezone-misaligned rather than silently remapping.

## Restore objectives

These are AdsTable acceptance objectives, not provider guarantees:

| Boundary | RPO | RTO |
|---|---:|---:|
| Code/deployment | 0 | safe rollback ≤30 min |
| Critical control-plane DB | ≤15 min | included below |
| Replayable Dataset V2 | ≤60 min | rebuilt by replay/reconciliation |
| Safe degraded service | — | ≤60 min |
| Full operation | — | ≤240 min |

PITR is required before production. A timed restore rehearsal must pass before EO-08-D. The restore manifest covers database plus explicit presence/absence of Storage, Edge Functions, Auth settings, API keys/secret rotation, Realtime, extensions, replicas and Vercel configuration/deployment. Deleted data must not be resurrected.

## Capacity envelope

### Required workload budget

Before EO-05, measurements must establish provider rows, database rows and bytes per refresh; reconciliation amplification; interactive query and export concurrency; and retention growth per workspace.

### Scheduling

- Workspaces are uniformly sharded across the hour; top-of-hour fan-out is forbidden.
- Leases and single-flight prevent duplicate runs.
- Provider and database concurrency are bounded.
- Backpressure, retry jitter and checkpoints are mandatory.
- The p95 hourly cycle must complete within 45 minutes, preserving 15 minutes of reserve.

### Queries and export

- Every query is workspace- and date-bounded.
- Indexes follow measured query shapes; unbounded scans are forbidden.
- UI reads aggregate first.
- When export is introduced, it is asynchronous, cursor-paged and snapshot-bounded. It cannot consume the primary interactive connection pool, and generated files expire.

### Acceptance thresholds

- Interactive reads: p95 ≤2 s; p99 ≤5 s.
- Job/query error rate: <0.1%; tenant isolation failures: 0.
- Sustained CPU <60%, peak CPU <80%, sustained memory <70%.
- Database/pooler connection-limit utilization <60%.
- Recommended database-size utilization <70%.
- Disk IO throttling events: 0. Any steady-state disk IO budget consumption triggers an upgrade review.
- At least 30% measured headroom remains.

Production admission may never exceed the latest certified capacity. At 80% of that capacity, scaling review is mandatory; automatic unbounded onboarding is forbidden.

## Scale ladder

1. Fix query plans, indexes, batching and retention.
2. Increase Supabase compute.
3. Provision disk IOPS/throughput when measured.
4. Move read-only analysis and export to a read replica, with visible replication lag.
5. Separate operational control-plane data from analytical fact workload if needed.
6. Consider another PostgreSQL platform only through a measured business/operations decision—not during an outage.

Supabase officially provides dedicated Postgres compute from Micro through large/custom sizes, configurable disk performance and read replicas for analytical reads. This means growth does not imply an automatic Google database migration. It does require measured scaling.

## Portability boundary

Canonical facts remain standard-PostgreSQL-first, with repository-owned migrations, explicit keys and portable data types. Vendor-specific features require an adapter and exit record. Canonical facts may not depend irreversibly on Supabase Auth or Storage. EO-08 includes a neutral PostgreSQL restore rehearsal so a future platform move is planned and recoverable.

## Package routing

- EO-02: subscription/privacy and schema prerequisites.
- EO-05: reconciliation, scheduler, write-path capacity and observability.
- EO-06: formulas, time ranges, query and export capacity.
- EO-07: first-review controls and truthful UI states.
- EO-08: restore, load, portability and rollback rehearsal.

This decision creates no new parent package, advances no package status and authorizes no production mutation, resizing, replica or database migration.

## Official sources checked 7 October 2026

- [Supabase Compute and Disk](https://supabase.com/docs/guides/platform/compute-and-disk)
- [Supabase Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase Read Replicas](https://supabase.com/docs/guides/platform/read-replicas)
- [Supabase Metrics API](https://supabase.com/docs/guides/observability/metrics)
- [Supabase restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
- [Google Ads conversion windows](https://developers.google.com/google-ads/api/docs/conversions/getting-started)
- [Klaviyo attribution settings](https://help.klaviyo.com/hc/en-us/articles/11118357030555)
- [Meta official Marketing API collection](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi)
- [Shopify privacy compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)
- [Vercel rollback](https://vercel.com/docs/cli/rollback)
