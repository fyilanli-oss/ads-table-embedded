# EO-04-A — Common adapter contract start brief

**Control date:** 10 October 2026  
**Status:** Implementation and CI complete; final product-owner acceptance pending  
**Parent:** A6-EO-04 — Meta, Google Ads and Klaviyo adapters  
**Execution effect:** EO-04-A start only; no provider secret, OAuth, live API, database, Vercel or deployment mutation

## Analyst result

EO-04-A will build one strict translation boundary between AdsTable and Meta, Google Ads and Klaviyo. Every provider speaks differently, but none may decide what a missing metric means, silently publish an incomplete page set, select another Shopify store, or turn a provider failure into zero.

This child does not implement Meta, Google Ads or Klaviyo endpoints. It freezes the behavior every provider-specific adapter must obey before EO-04-B/C/D can be accepted.

## Why this package exists

Without a common contract, three dangerous behaviors become likely:

1. an absent provider field is normalized to zero;
2. a paginated or throttled response is published as a complete dataset;
3. an ad account containing activity for more than one commerce store is treated as if every row belongs to the installed Shopify store.

Any of these can make AdsTable disagree with the provider Ads Manager and become the same class of review and trust risk identified during the reconciliation audit.

## Authority boundary

The immutable commerce authority is the verified Shopify installation:

```text
Installed Shopify Store
└── Workspace
    └── Provider connection
        ├── Meta canonical Reporting Account
        ├── Google Ads canonical Reporting Account
        └── Klaviyo canonical Connected Account
```

Rules:

- A provider account, pixel, domain, campaign URL or catalog never creates or changes a Shopify workspace.
- There is no merchant-selectable Reporting Store.
- Another Shopify store requires another AdsTable installation and subscription.
- Provider-side domain/store evidence can restrict or reject rows only where the official provider API exposes a deterministic relationship.
- A URL, UTM, click ID, campaign name or operator guess is not enough to attribute a provider row to the installed store.
- Ambiguous multi-store scope becomes an explicit support state; it is never silently mixed into organic or paid results.

## Provider account selection cardinality

Provider account selection is not generalized across all three providers:

- **Meta:** the merchant selects between one and three provider-verified Ad Accounts. Zero or more than three cannot become Connected.
- **Google Ads:** the merchant selects between one and three provider-verified advertiser/serving accounts where `customer.manager=false`. A Manager/MCC account is never selectable, never a Reporting Account and never a Funnel entity. When official Google access requires it, the manager ID may be retained privately only as the `login_customer_id` access path to a selected advertiser account.
- **Klaviyo:** a Klaviyo account is not an Ad Account. Exactly one server-verified Klaviyo Account is bound to the connection; the Meta/Google one-to-three rule does not apply.

Browser-supplied account IDs or names are never authority. Every selected account is re-read from the provider before persistence.

## Canonical Funnel fact demand contract

Meta, Google Ads and Klaviyo use different native endpoints and field names, but every provider adapter must answer the same canonical fact demand. Provider-specific children may not omit a canonical question merely because the native field is absent.

The adapter output carries the installed-workspace authority, provider identity, truthful hierarchy, daily leaf identity, raw facts, stable capability support and per-attempt observation state.

Canonical raw facts are exactly:

```text
impression
ad_click
session
spend_value
add_to_cart
add_to_cart_value
checkout
checkout_value
purchase
purchase_value
```

Stable `metric_support` is limited to `supported | unsupported | unknown`. Per-attempt `observation_state` carries `present | zero | empty | absent | not_requested | permission_denied | account_configuration_missing | ambiguous_store_scope | provisional | partial | failed`. A supported metric may therefore be absent in one response without becoming unsupported, and an unsupported metric remains `null`, never numeric zero.

The old `user_id` identity is forbidden. The new authority uses `workspace_id`, `installation_id`, `installation_generation`, `provider_connection_id`, `platform_account_id` and, where applicable, the verified Reporting Account ID. Active EO scope is Meta, Google Ads and Klaviyo only; TikTok and GA4 are not silently reactivated. Shopify organic ingestion is a separate source boundary and is not manufactured by these paid-provider adapters.

Provider-native calculated fields do not become Dataset truth merely because the provider returns them. CTR, CPC, ROAS, CPS, revenue, revenue margin, abandoned counts/values and rates remain Formula Engine outputs. A verified provider conversion value maps to `purchase_value`; it does not bypass the canonical formula contract.

Fallback, synthetic, partial or incomplete results cannot be published as canonical facts. Raw evidence is represented only by a bounded sanitized reference, content hash and request metadata.

## OAuth-to-first-data analyst sequence

Every provider connection follows this order:

1. Verify the OAuth callback.
2. Encrypt and persist the token; never persist plaintext.
3. Re-verify the Installed Shopify Store and active installation generation.
4. Discover provider accounts from the live provider API.
5. Let the merchant select one to three verified Meta/Google advertiser accounts.
6. Bind exactly one verified Klaviyo Account without calling it an Ad Account.
7. Re-read every selected account from the provider and bind it to the workspace/installation generation.
8. Fail closed when installed-store scope is ambiguous or conflicts with the connection authority.
9. Resolve account timezone, currency, API revision and metric capabilities.
10. Fetch the truthful Campaign/Flow hierarchy down to the currently verified provider leaf.
11. Request the complete canonical Funnel fact demand through provider-native fields.
12. Finish every required page/partition before making the attempt publishable.
13. Translate the native response into the canonical identity/entity/raw-metric envelope.
14. Validate support versus observation state, zero/null semantics, business date, single FX conversion and provenance.
15. Persist only the complete validated result idempotently through the later Dataset V2 writer boundary.
16. Initial bootstrap requests only yesterday and today, in that order; it is not a 14-day backfill.
17. Hand subsequent hourly refresh and backward reconciliation to EO-05.

OAuth success alone is not Connected. Account binding and all applicable authority gates must pass before first data is eligible for ingestion.

## Common adapter operations

EO-04-A will define provider-neutral operations; each provider child maps them to current official endpoints.

### 1. Inspect connection

Confirms token usability, provider identity, granted capabilities and the connection/reporting-account authority established in EO-03. It cannot select or replace a store, workspace or account.

### 2. Discover scope evidence

Returns only provider-supported account, domain, catalog, pixel, conversion-action or equivalent evidence needed to describe reporting scope. Evidence is descriptive; it does not invent attribution.

### 3. Fetch structure

Returns the provider hierarchy and exact stable identifiers needed by later Dataset V2 normalization. Provider-specific hierarchy remains truthful:

- Meta: account → campaign → ad set → ad;
- Google Ads: customer → campaign → ad group → ad, with Performance Max handled through its officially supported asset-group/asset hierarchy;
- Klaviyo: account → campaign/flow → message/variation where the current API supports it.

The precise deepest leaf remains subject to the provider-specific official-document and live-evidence gates.

### 4. Fetch facts

Returns requested reporting facts for an explicit account, time window, timezone and field set. The adapter reports what was requested and what the provider actually returned. It does not calculate AdsTable formulas or publish Dataset V2 directly.

### 5. Describe capability

Returns whether a field, breakdown, level or operation is officially supported and whether it was available in this exact account/request. Capability is versioned evidence, not a hard-coded optimistic promise.

## Support-state contract

Every requested metric or dimension must resolve to one of these states:

- `present`: provider returned a non-null value;
- `zero`: provider explicitly returned numeric zero;
- `empty`: provider returned an explicit empty collection/value;
- `absent`: request succeeded but the field/type was not present;
- `unsupported`: current official provider contract does not support it;
- `not_requested`: AdsTable did not ask for it;
- `permission_denied`: current credential cannot read it;
- `account_configuration_missing`: provider feature exists but this account lacks the required setup;
- `ambiguous_store_scope`: deterministic installed-store isolation cannot be proven;
- `provisional`: provider can still revise the window;
- `partial`: not every required page/partition completed;
- `failed`: request ended without publishable evidence.

Only an explicit provider zero becomes zero. `absent`, `empty`, `unsupported`, `permission_denied`, `partial` and `failed` are not interchangeable.

## Request envelope

Every adapter request is bound to:

- workspace ID and active Shopify installation generation;
- provider connection ID;
- canonical Reporting Account ID where the provider model has one;
- operation and contract version;
- provider API/revision version;
- installed-shop timezone;
- inclusive data dates and explicit UTC request boundaries;
- exact requested fields, levels and breakdowns;
- stable query fingerprint and attempt ID;
- scheduler/run ID when invoked by a job.

Caller-supplied workspace, store, token, arbitrary provider URL or mutable account identity is rejected.

## Response and evidence envelope

Every completed attempt records secret-free evidence:

- provider, operation, contract/API version and query fingerprint;
- provider request/trace ID when returned;
- started/completed/fetched timestamps;
- requested and returned date coverage;
- requested fields and per-field support state;
- page/partition count, row count and completeness;
- rate-limit headers or quota metadata when officially returned;
- normalized error class when unsuccessful;
- a private bounded raw-response evidence reference and content hash.

Tokens, authorization codes, PKCE verifiers, client secrets, database URLs, customer emails and profile-level personal data are forbidden in logs and evidence.

Raw evidence is not application logging and is not an unlimited data lake. Provider children must define redaction, private storage, retention and deletion before live calls. Klaviyo profile/person endpoints are outside this reporting adapter unless a later separately approved contract requires them.

## Pagination and completeness

- Provider cursors/page tokens are opaque and never manufactured.
- The query fingerprint must remain stable across pages.
- Repeated cursor detection, maximum pages/rows and total time budget stop infinite traversal.
- A page-token expiry or any missing required page restarts or fails the attempt according to the provider contract; it never publishes a partial snapshot as complete.
- Rows are staged under one attempt and become publishable only after all required pages/partitions pass.
- Duplicate page replay is idempotent.
- Google Ads Search pagination uses the provider's fixed page behavior; Klaviyo follows top-level cursor links. Meta-specific traversal is frozen only after the EO-04-B official-document gate passes.

## Retry and quota behavior

Retries are bounded by both attempt count and total elapsed time.

Retry is allowed only for the provider's documented transient conditions. The adapter:

1. honors `Retry-After` or provider recovery metadata when present;
2. otherwise uses exponential backoff with randomized jitter;
3. applies quota/concurrency control per provider and canonical account;
4. stops when the runtime time budget cannot safely complete the next attempt;
5. exposes retry exhaustion as a failed/partial result rather than zero.

Authentication, revoked token, permission, validation, unsupported field, malformed query and deterministic account-scope failures are not blindly retried.

## Normalized error classes

Provider details are preserved privately, while the common layer exposes:

- `reauthorization_required`;
- `permission_or_scope_missing`;
- `reporting_account_inaccessible`;
- `request_contract_invalid`;
- `provider_schema_changed`;
- `rate_limited`;
- `quota_exhausted`;
- `transient_provider_failure`;
- `provider_timeout`;
- `data_not_ready`;
- `ambiguous_store_scope`;
- `partial_result`;
- `internal_adapter_failure`.

A sanitized provider code, message class and request ID may accompany the class. Tokens and raw authorization headers never do.

## Provider facts confirmed for the common layer

### Google Ads

Current official documentation classifies authentication, retryable, validation and synchronization errors separately. Only transient server classes are candidates for bounded jittered backoff. Google Ads Search uses fixed 10,000-row pages in v19+; a page token is short-lived and subsequent requests must retain the identical query.

### Klaviyo

Klaviyo uses cursor pagination and endpoint-specific page sizes. It applies per-account burst and steady windows; OAuth apps receive quota per installed app instance. HTTP 429 returns `Retry-After`. API revision is an explicit required request header and therefore part of the evidence envelope.

### Meta

The current official rate-limit and Graph error pages returned HTTP 429 during the 10 October 2026 control check. Meta's accessible official May 2026 announcement confirms that Marketing API Access Tier governs enhanced rate-limit access. No Meta-specific numeric quota, retry code, header guarantee or pagination rule is frozen in EO-04-A from memory. EO-04-B cannot implement until the current official pages are readable and recorded.

## Secret and environment gate

EO-04-A creates no secret. Before a provider child introduces any credential:

- the secret inventory contract must be accepted;
- the provider-token encryption key recovery gate must pass before first real OAuth;
- the exact provider secret name, issuing authority, scopes, expiry, rotation and rollback must extend the inventory contract;
- Production, Preview and Development use isolated credentials;
- no secret value enters GitHub content, tests, fixtures, logs or acceptance evidence.

## Implementation sequence after acceptance

1. Define TypeScript request/result/support/error contracts.
2. Implement the provider-neutral pagination/retry/quota runner with injected clock, sleep and random sources.
3. Implement sanitized evidence construction and secret redaction guards.
4. Implement deterministic fake-provider fixtures for success, zero, empty, absent, unsupported, pagination, throttle, transient failure, auth failure, partial result and ambiguous store scope.
5. Add repository tests for idempotency, loop/time limits, no-zero fabrication and no secret leakage.
6. Stop for repository acceptance before any EO-04-B provider-specific implementation.

## Acceptance gates

EO-04-A cannot close until:

- product owner accepts this brief;
- repository implementation matches the executable contract;
- every required synthetic behavior passes;
- no real provider secret or token is used;
- no live provider, database, Vercel or deployment mutation occurs without a separate explicit gate;
- required CI passes;
- product owner explicitly accepts EO-04-A.

## Explicitly out of scope

- provider OAuth or token exchange;
- creating or editing provider apps/credentials;
- live provider calls;
- final endpoint/field lists for Meta, Google Ads or Klaviyo;
- Dataset V2 persistence and reconciliation scheduling;
- formulas, BFF/query API and UI;
- product/cross-sell proof;
- provider review submissions.

## Official sources checked on 10 October 2026

- Meta Marketing API Access Tier announcement: https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/
- Meta Graph API rate-limit documentation URL (HTTP 429 during control check): https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
- Meta Graph API error documentation URL (HTTP 429 during control check): https://developers.facebook.com/docs/graph-api/guides/error-handling/
- Google Ads error types: https://developers.google.com/google-ads/api/docs/best-practices/error-types
- Google Ads error model: https://developers.google.com/google-ads/api/docs/best-practices/understand-api-errors
- Google Ads pagination: https://developers.google.com/google-ads/api/docs/reporting/paging
- Klaviyo rate limits and errors: https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling
- Klaviyo API overview/pagination: https://developers.klaviyo.com/en/v2026-01-15/reference/api_overview
- Vercel Functions limits: https://vercel.com/docs/functions/limitations
- Supabase changelog: https://supabase.com/changelog


## Repository implementation — 10 October 2026

The product owner accepted the start brief before implementation. The provider-neutral boundary is now implemented without reading or creating a provider secret and without any live API, database, Vercel or deployment mutation.

Artifacts:

- `app/lib/providers/common-adapter.server.js`: runtime contract, canonical fact validation, complete-before-publish pagination, bounded retry and sanitized evidence.
- `app/lib/providers/common-adapter.server.d.ts`: strict public request/result/fact types.
- `tests/eo-04a-common-adapter.test.js`: deterministic fake-provider acceptance tests.

Implemented behavior:

- The same exact ten canonical raw metrics are demanded for Meta, Google Ads and Klaviyo.
- Stable capability support and per-attempt observation state are independent.
- Only an explicit provider numeric zero becomes zero; absence, unsupported state and failure remain null/non-publishable.
- Cursor values remain opaque. Repeated cursors, conflicting duplicate facts, row/page/time ceilings and incomplete traversal fail closed.
- Identical page replay is idempotent.
- Only `rate_limited`, `transient_provider_failure` and `provider_timeout` can be retried, and only when the provider child classifies them as retryable from its official contract.
- Authentication, authorization, validation and deterministic scope failures are never made retryable by a caller flag.
- `Retry-After` metadata takes precedence over bounded exponential jitter.
- Failed attempts return no publishable rows even when earlier pages were staged.
- Evidence is bounded, content-hashed and recursively redacts credentials, authorization material and email-shaped personal data.
- Klaviyo retains one platform account with no Ad Account selector. Meta and Google Ads continue to require their verified reporting-account authority from EO-03.

This implementation remains a provider-neutral contract. EO-04-B/C/D must still freeze current official endpoint, field, pagination, quota, account and error mappings before any live provider call.

### Remaining closure gate

EO-04-A is not yet Accepted. GitHub Actions run `38049487145` passed 163/163 tests, TypeScript verification and preview build. Explicit final product-owner acceptance and merge approval remain open. EO-04-B is not authorized by this implementation alone.
