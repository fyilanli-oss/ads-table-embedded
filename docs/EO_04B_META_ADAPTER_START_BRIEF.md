# EO-04-B — Meta adapter analyst start brief

**Control date:** 10 October 2026  
**Status:** Start brief accepted; repository implementation written and CI pending  
**Parent:** A6-EO-04 — Meta, Google Ads and Klaviyo adapters  
**Depends on:** Accepted EO-04-A common adapter contract  
**Execution effect:** Analyst contract only; no Meta secret, OAuth, live API, database, Vercel, deployment or Dataset V2 mutation

## Analyst result

EO-04-B will translate Meta Marketing API reporting into the canonical ten-field Funnel fact demand without inventing zeros, hiding incomplete pagination, or claiming Ads Manager parity that current evidence cannot prove.

This brief authorizes no code. Implementation may start only after the product owner accepts the decisions and open evidence gates below.

## User-visible business flow

1. The verified Installed Shopify Store and active installation generation remain the commerce authority.
2. The merchant connects Meta and selects between one and three provider-verified Ad Accounts.
3. AdsTable re-reads each selection from Meta; a browser-supplied ID or name is not authority.
4. For each selected account, AdsTable resolves account timezone, currency and supported API version.
5. It reads the truthful hierarchy: Ad Account → Campaign → Ad Set → Ad.
6. It requests daily ad-level facts for an explicit business-date window.
7. It follows every provider page before making the attempt publishable.
8. It records exactly what was requested and returned, including missing, empty and explicit-zero states.
9. It emits canonical facts only after completeness, scope, currency/time and evidence validation.
10. EO-05 later owns persistence, hourly refresh, maturity and backward reconciliation.

Meta never selects or changes the Shopify store. Ambiguous cross-store evidence fails closed rather than mixing rows.

## Reporting grain and hierarchy

Canonical reporting leaf for EO-04-B is Meta Ad:

```text
Meta Ad Account
└── Campaign
    └── Ad Set
        └── Ad
            └── one row per business date
```

Required identity includes canonical reporting-account ID, campaign/ad-set/ad IDs and names, business date, workspace/installation authority, connection ID and request provenance. Names are display metadata; IDs are identity.

Product/catalog rows are not a second EO-04-B Funnel grain. Converted-product evidence is preserved for EO-07-C discovery and cannot silently multiply or replace the daily ad fact.

## Native request families

The implementation must use a pinned, currently supported Graph/Marketing API version and record that version in every request and evidence envelope. Current official surfaces showed v26 references for Ads Action Stats and Product Item while one generated Ad Account Insights surface exposed v25-style reference material. Implementation must prove the actual pinned version and compatible field set; it may not silently combine schemas from different versions.

### Structure request

The structure operation must obtain stable IDs, names and statuses for account, campaign, ad set and ad. Structure status is descriptive and cannot be inferred from the Insights fact response.

### Fact request

The daily ad-level fact request starts from these exact native families:

- identity and dates: `account_id`, `campaign_id`, `campaign_name`, `adset_id`, `adset_name`, `ad_id`, `ad_name`, `date_start`, `date_stop`;
- base facts: `impressions`, `spend`;
- click candidates to be observed separately: `clicks`, `inline_link_clicks`, `website_clicks`, `outbound_clicks`;
- conversion collections: `actions`, `action_values`;
- attribution evidence: the effective account/ad-set attribution configuration and exact request parameters;
- pagination and quota evidence returned by Meta.

The adapter must never sum click aliases or conversion aliases.

## Canonical field mapping

| Canonical fact | Meta source | Decision |
|---|---|---|
| `impression` | `impressions` | Supported when returned; explicit zero only becomes zero |
| `ad_click` | provisional candidate: `outbound_clicks` | Must remain pending until one controlled same-ad/same-date comparison observes all click candidates |
| `session` | none in Meta Insights | Unsupported by Meta adapter; Shopify/analytics sources remain separate |
| `spend_value` | `spend` in account currency | Supported; currency preserved, no adapter FX |
| `add_to_cart` | matching standard `actions.action_type`, with verified omni fallback only | Standard first, one verified fallback, never sum |
| `add_to_cart_value` | matching `action_values.action_type` | Same alias rule |
| `checkout` | matching standard `actions.action_type`, with verified omni fallback only | Standard first, one verified fallback, never sum |
| `checkout_value` | matching `action_values.action_type` | Same alias rule |
| `purchase` | matching standard `actions.action_type`, with verified omni fallback only | Standard first, one verified fallback, never sum |
| `purchase_value` | matching `action_values.action_type` | Same alias rule |

Exact standard/omni action-type names are frozen in code only after the controlled live response proves which types Meta returns for the test account. A fallback may be used only when the standard type is absent and the fallback is officially compatible. If both appear, the adapter must not sum them; it must follow the accepted precedence and retain both observations in sanitized evidence.

## Click decision gate

Meta defines different click concepts:

- `clicks`: all clicks and therefore too broad for canonical ad click;
- `inline_link_clicks`: link clicks on or off Meta with its own attribution behavior;
- `website_clicks`: website-destination clicks;
- `outbound_clicks`: clicks taking a person away from Meta technologies.

`outbound_clicks` is the leading canonical candidate, not an accepted fact yet. Before implementation acceptance, one real reporting row must request all four fields for the same account, ad, date, level and attribution context. The evidence must show returned shapes and values and must reconcile the selected definition with the AdsTable `ad_click` meaning. Existing legacy evidence containing only `actions.link_click = 8` cannot close this gate.

## Missing, empty and zero

Meta returns `actions` and `action_values` as collections of distinct `action_type` rows.

- A matching row with numeric `value: "0"` is explicit zero.
- A successful response with no matching action type is `absent`, not zero.
- `action_values: []` is `empty`, not zero and not proof that the capability is unsupported.
- A field omitted because of permission, configuration, invalid aggregation or unavailable breakdown keeps its specific non-zero state.
- A failed or incomplete attempt publishes no facts.

Dataset V2 may later render a numeric zero only from the explicit-zero state. UI/formula behavior for unknown and unsupported remains outside this child.

## Attribution evidence and unresolved official contradiction

Current official Meta documentation is not internally consistent:

- one generated Insights reference describes `use_unified_attribution_setting=true` as the way to use ad-set attribution settings and match Ads Manager;
- the newer Insights best-practices page states that since 10 June 2025 `use_unified_attribution_setting` and `action_report_time` are disregarded and that ad-set or mixed attribution behavior applies.

Therefore EO-04-B must not promise exact Ads Manager parity from documentation alone. Every attempt preserves:

- the exact request parameters;
- the pinned API version;
- the selected level and breakdowns;
- the effective ad-set attribution setting where readable;
- the account timezone and business date;
- the returned action types and date coverage.

A controlled account with a real conversion is required to compare the Meta response with Ads Manager under the same date and attribution context. Until then conversion attribution status is `PENDING_REAL_CONVERSION_EVIDENCE`.

## Pagination, async fallback and completeness

- Follow the opaque URL/cursor in `paging.next`; never manufacture, edit or persist provider cursors.
- An empty data page may still have `paging.next`; stop only when `paging.next` is absent.
- Keep the query fingerprint stable across pages.
- Detect repeated cursors and enforce maximum pages, rows and elapsed time.
- Stage rows per attempt; publish only after all required pages complete.
- Start with narrow daily synchronous ad-level requests.
- Use the documented async Insights job only when response size or documented timeout behavior requires it.
- Async polling is bounded by poll count and total elapsed time.
- Partial sync or async output is not publishable.

## Error, retry and quota policy

The implementation maps current official Meta conditions rather than retrying arbitrary failures.

Retryable, bounded examples include documented transient/internal failures, rate limiting and supported sync timeout recovery. Non-retry examples include invalid breakdowns, invalid custom metrics, missing permission and oversized async jobs that require query splitting.

Known official examples reviewed for the brief include:

- sync timeout/size codes: reduce date/field scope or move to async;
- HTTP/Graph rate-limit conditions: honor recovery metadata, then bounded exponential backoff with jitter;
- invalid breakdown or field contract: fail as `request_contract_invalid`;
- missing permission: fail as `permission_or_scope_missing`;
- async job too large: split deterministically; do not blind retry the same request.

The adapter records provider request IDs and available usage/rate headers without secrets. Authentication, permission, validation and deterministic scope errors are never blindly retried.

## Store, currency and time boundaries

- Installed Shopify Store is immutable authority; no Reporting Store selector exists.
- Meta account selection is downstream and cannot replace the installed store.
- URL, UTM, `fbclid`, `fbc`, campaign name or destination similarity is not deterministic store proof.
- When a Meta account covers multiple stores and official evidence cannot isolate the installed store, affected rows become `ambiguous_store_scope` and cannot publish.
- Meta account currency is preserved as `source_currency`; EO-05 performs one versioned FX conversion.
- Meta account timezone and explicit date fields produce the source business date; EO-05 owns canonical reconciliation and finality.

## Raw evidence and privacy

Every attempt writes only a bounded, private, sanitized raw reference plus content hash and request metadata. Evidence includes requested fields, returned field/action types, page count, row count, completeness, API version, request ID and attribution context.

Evidence must exclude tokens, authorization headers, secrets, emails, profile/person data and unbounded response bodies. Retention and deletion must be defined before the first live Meta call. Application logs are not the raw-evidence store.

## Converted-product route reserved for EO-07-C

Current official Meta references conditionally expose `converted_product_quantity` and `converted_product_value` with a converted-product-ID breakdown. They describe products purchased after ad interaction when the merchant pixel/app SDK records complete product IDs, quantities and values.

This does not directly yield trustworthy Shopify SKU/name. The route is:

```text
Meta Ad fact
→ converted product ID + quantity/value
→ Meta Catalog Product Item
→ retailer_id/name/image/url/group evidence
→ deterministic Installed Shopify Store product/variant mapping
→ EO-07-C product/cross-sell acceptance
```

Generic `product_id` is not purchased-product proof. `retailer_id` is not presumed to equal Shopify SKU. `action_converted_product_id` has limited Collaborative Ads availability. Both exact earring fixtures—clicked item not purchased and clicked item purchased, each with non-advertised basket products—must pass independently before EO-07-C activates Meta product rows or charts.

EO-04-B may preserve provider product evidence but does not implement Ad Analysis product UI or claim cross-sell support.

## Acceptance sequence

### Gate 1 — product decision

The product owner accepts this brief and executable contract. This allows repository implementation, not live provider access.

### Gate 2 — repository implementation

Implement the Meta adapter against EO-04-A with deterministic fixtures for hierarchy, explicit zero, missing action type, empty action values, complete multi-page traversal, empty page with next, repeated cursor, transient error, permission error, timeout-to-async, partial failure and ambiguous store scope.

### Gate 3 — controlled live evidence

Requires a separate explicit gate for any needed secret/authorization. Evidence must prove:

1. account discovery and one-to-three account authority;
2. structure down to Ad;
3. the four click candidates on one same-scope row;
4. actions/action_values shapes and alias precedence;
5. attribution configuration using a real conversion;
6. complete pagination or an explicitly single-page response;
7. sanitized raw-reference/hash and no leakage.

No live product/cross-sell claim belongs to this gate; that remains EO-07-C.

### Gate 4 — closure

Required CI passes, evidence is durable on GitHub without secrets/PII, no partial facts publish, and the product owner explicitly accepts EO-04-B. Only then may EO-04-C become the active child.

## Explicitly out of scope

- Dataset V2 persistence, hourly scheduling, FX conversion, maturity and reconciliation;
- AdsTable formula calculations;
- Shopify organic ingestion;
- Google Ads or Klaviyo implementation;
- Ad Analysis product UI or cross-sell acceptance;
- provider review submission;
- autonomous production, secret or environment mutation.

## Official sources checked 10 October 2026

- Insights: https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights
- Insights best practices: https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/best-practices
- Insights breakdowns: https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/breakdowns
- Insights errors: https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/error-codes
- Ad Account Insights reference: https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/
- Ads Action Stats reference: https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/
- Product Item reference: https://developers.facebook.com/docs/marketing-api/reference/product-item/
- Graph API pagination: https://developers.facebook.com/docs/graph-api/results/


## Product-owner acceptance and repository implementation — 10 October 2026

The product owner explicitly accepted this analyst brief before implementation.

Written artifacts:

- `app/lib/providers/meta-adapter.server.js`
- `app/lib/providers/meta-adapter.server.d.ts`
- `tests/eo-04b-meta-adapter.test.js`

Implemented repository behavior:

- Graph/Marketing API version is pinned to `v26.0` and recorded in requests.
- Daily Ad-level requests ask for all four click candidates, but canonical `ad_click` remains provisional and null until the controlled live field comparison passes.
- Standard pixel action types take precedence over verified omni fallbacks; aliases are never summed.
- Explicit zero, empty collection and absent action type remain distinct.
- `paging.next` remains opaque; an empty page with `next` continues through the common complete-before-publish runner.
- Meta error mapping retries only documented rate/transient classes and fails closed for permission, invalid request and schema/account mismatches.
- Currency remains in Meta account currency with identity conversion; EO-05 owns FX.
- Raw evidence contains bounded field/action summaries and hashes, not access tokens or full bodies.
- Converted-product capability remains an EO-07-C evidence route and does not activate product UI.

No live Meta call, secret, OAuth, database, Vercel, deployment or Dataset V2 mutation occurred. Repository implementation remains pending CI and later separately authorized controlled live evidence.


## Repository CI evidence — 10 October 2026

GitHub Actions Repository Governance run `38063777629` passed:

- 174/174 repository tests;
- TypeScript contract verification;
- preview build.

The repository implementation gate is closed. EO-04-B is now waiting at the separately authorized controlled-live-evidence gate. CI success does not authorize a Meta token read, live API request, environment change, database write or deployment.
