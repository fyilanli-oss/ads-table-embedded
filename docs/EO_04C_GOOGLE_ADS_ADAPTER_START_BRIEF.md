# EO-04-C — Google Ads adapter analyst start brief

**Control date:** 11 October 2026  
**Status:** Repository adapter and OAuth/REST boundary CI PASS; controlled live evidence ready, route wiring pending  
**Parent:** A6-EO-04 — Meta, Google Ads and Klaviyo adapters  
**Depends on:** Accepted EO-04-A common adapter contract  
**Execution effect:** Documentation decision only; no Google OAuth, secret, live API, database, Vercel, deployment or Dataset V2 mutation

## Analyst result

Google Ads can supply the common Funnel facts at a truthful native leaf, but Standard campaigns and Performance Max do not share the same hierarchy. AdsTable will preserve this difference instead of inventing a universal Ad row.

The product owner accepted this brief and requested that the documented Google decisions be recorded before beginning Klaviyo official-document discovery.

## Account authority

1. OAuth uses the restricted `https://www.googleapis.com/auth/adwords` scope with offline access.
2. `ListAccessibleCustomers` identifies direct-access roots; manager hierarchies are traversed through `customer_client`.
3. The merchant may select one to three provider-verified advertiser/serving accounts.
4. A selectable reporting account must have `customer.manager = false`.
5. Manager/MCC accounts are never reporting accounts. When required, a manager ID may be retained only as the `login-customer-id` access path.
6. Provider account selection remains downstream of the immutable Installed Shopify Store and cannot change workspace commerce authority.

Google retired developer-token requirements on 9 September 2026. Access level is now tied to the Google Cloud project that owns the OAuth credentials. The clean implementation must not introduce `GOOGLE_ADS_DEVELOPER_TOKEN` as a required secret.

## API and transport baseline

The current implementation baseline is Google Ads API v25. Google projects v26 for October 2026, so the supported-version list and field compatibility must be rechecked immediately before repository implementation or a live call if v26 has shipped.

Google does not publish an official Node.js client library. The planned Node runtime path is direct REST with pinned version, exact request contracts, request-ID evidence and bounded parsing. This brief does not authorize implementation.

## Truthful hierarchy

### Standard campaigns

```text
Advertiser account
└── Campaign
    └── Ad Group
        └── Ad
            └── source date
```

### Performance Max

```text
Advertiser account
└── Campaign
    └── Asset Group
        └── source date
```

Google explicitly states that individual-ad performance is unavailable for Performance Max. AdsTable must not generate a synthetic PMax Ad leaf. Asset Group is the truthful analytical leaf.

Standard Ad identity includes `ad_group_ad.ad.id`, `ad_group_ad.ad.name`, status, Ad Group and Campaign identity. PMax identity includes `asset_group.id`, `asset_group.name`, status and Campaign identity.

## Canonical ten-field Funnel mapping

| Canonical fact | Google Ads source | Decision |
|---|---|---|
| `impression` | `metrics.impressions` | Supported when returned |
| `ad_click` | `metrics.clicks` | Google Ads click; never treated as session |
| `session` | none | Unsupported by Google Ads adapter |
| `spend_value` | `metrics.cost_micros / 1,000,000` | Preserve account currency; no adapter FX |
| `add_to_cart` | `ADD_TO_CART` + `metrics.all_conversions` | Action/category segmented |
| `add_to_cart_value` | `ADD_TO_CART` + `metrics.all_conversions_value` | Same action identity |
| `checkout` | `BEGIN_CHECKOUT` + `metrics.all_conversions` | Action/category segmented |
| `checkout_value` | `BEGIN_CHECKOUT` + `metrics.all_conversions_value` | Same action identity |
| `purchase` | `PURCHASE` + `metrics.all_conversions` | Action/category segmented |
| `purchase_value` | `PURCHASE` + `metrics.all_conversions_value` | Same action identity |

`metrics.conversions` and `metrics.conversions_value` include only actions configured for the primary Conversions column. Funnel actions may be secondary; therefore canonical Funnel extraction uses `all_conversions` and `all_conversions_value`.

The adapter must not blindly aggregate the All conversions family. It preserves conversion action ID/name/category and `segments.conversion_attribution_event_type` so interaction-, engaged-view- and impression-attributed conversions remain distinguishable.

## Missing, absent and zero

Google omits rows whose selected metrics are all zero when a report is segmented. Therefore a missing segmented row is not automatically numeric zero.

- A returned numeric zero is `zero`.
- No matching action row after a successful query is initially `absent`.
- A non-queryable field is `unsupported`.
- Missing account conversion setup is `account_configuration_missing`.
- Only complete query coverage and proven scope may later promote an absence to a truthful zero.
- Failed or incomplete attempts publish nothing.

## Time, attribution and currency

- `customer.time_zone` is the source timezone.
- `customer.currency_code` is the source currency.
- `segments.date` is interpreted in the Google Ads customer timezone.
- Standard conversion metrics reported with date follow the ad-interaction date and therefore align with the default Google Ads Manager view.
- `*_by_conversion_date` fields preserve conversion-occurrence-date evidence but do not replace the primary interaction-date Dataset semantics.
- EO-05 owns installed-shop business-date normalization, reconciliation and one versioned FX conversion.

Google finality is not one fixed number. Click/impression/cost commonly have an approximately one-hour freshness SLO. Google Ads conversion tracking commonly takes about three hours for last-click and up to fifteen hours for other models; GA-imported conversions commonly take about twelve to twenty-four hours. Conversion windows are action-specific and may range from one to ninety days. EO-05 must derive reconciliation behavior from actual conversion settings and evidence, not a fabricated global seven-day rule.

## Pagination, quota and error behavior

- Search pages contain at most 10,000 rows.
- `next_page_token` is opaque; every subsequent page uses the identical query.
- The page token is short-lived, approximately two hours.
- Valid next-page requests do not consume additional operation quota.
- SearchStream is preferred for large reports.
- The response-size ceiling is 64 MB.
- Every attempt preserves Google request ID and query fingerprint.
- Only documented transient classes receive bounded exponential backoff with jitter.
- Authentication, revoked token, permission, validation, unsupported-field, malformed-query and deterministic account-scope failures are not blindly retried.

## Four separate Google reporting request families

Google data must not be forced through one universal query or one fabricated Ad grain. The adapter has four independent request families:

1. **Canonical performance:** Standard campaigns remain Campaign → Ad Group → Ad; Performance Max remains Campaign → Asset Group. These rows produce the common canonical metrics at the real provider leaf.
2. **Shopping product performance:** `shopping_performance_view` produces Campaign → Ad Group → Product Item performance, including product identity/title and compatible impression, click, cost, conversion, order, unit and revenue metrics. A Product Item is not renamed or persisted as a Google Ad.
3. **PMax retail product performance:** `asset_group_product_group_view` plus `asset_group_listing_group_filter` may produce Campaign → Asset Group → Product Item only when the account's real listing tree contains an item-ID partition. “All products”, brand, category or custom-label grouping is not item identity and cannot be expanded synthetically.
4. **Sold-product cart data:** `cart_data_sales_view` produces sold-product identity/title, units and revenue at Campaign or Ad Group segmentation. It accepts neither Standard Ad ID nor PMax Asset Group ID in the validated sold-product query shape.

Binding consequences:

- Google Search keeps truthful Ad performance, but its sold products cannot be attached to one Ad through the current native reporting contract; product linkage is **unsupported**, not inferred.
- `units_sold` is quantity, not purchase/order count. It must never be relabelled `purchase`.
- Shopping Product Item and PMax Asset Group Product Item are native product-reporting grains, not invented Ads.
- Advertised-product performance and sold-basket evidence remain separate unless one native Google query returns a compatible relationship.
- `product_item_id` and `product_sold_item_id` are Merchant Center identities, not presumed Shopify SKU or variant IDs.
- Deterministic Merchant item → Installed Shopify Store product/variant mapping remains mandatory.
- Live evidence is still required for account capability, actual item partitions and identity mapping, but the official field-compatibility investigation is complete.
- The exact product/basket fixtures remain owned by EO-07-C; no product UI is activated by this documentation alone.

## Acceptance sequence

### Gate 1 — accepted documentation decision

This brief and executable contract are accepted. This authorizes durable documentation only.

### Gate 2 — repository implementation

Implementation is CI-PASS (run `38127917558`, 192/192 tests, typecheck and production build) at `app/lib/providers/google-ads-adapter.server.js`, with strict types and deterministic fixtures. It freezes the two-part canonical query plan (base performance plus conversion actions), the four native request families, serving-account enforcement, Standard Ad and PMax Asset Group leaves, explicit zero/absence, opaque pagination, bounded retry and fail-closed scope. The transport remains injected; this gate performs no live Google call.

### Gate 3 — separately authorized live evidence

Live evidence must prove account discovery, Standard Ad structure, PMax Asset Group structure, metric response shapes, conversion categories, time/currency, complete pagination and—when cart data exists—the deepest sold-product grain. The product owner authorized this read-only gate on 11 October 2026, but preflight stopped before OAuth or a live request: the clean Vercel project lacks the three inventoried Google OAuth entries and provider-token-key recovery custody is not evidenced. Legacy masked entries are neither readable nor transferable.

A read-only Supabase count on 11 October 2026 proved that both `integrations.provider_credential_envelopes` and `integrations.oauth_pkce_envelopes` contain zero rows and no key version is in use. Therefore the provider-token key can be replaced without ciphertext loss, but only together with an independent recovery copy. This evidence does not authorize a secret mutation.

### Gate 4 — closure

Repository CI, durable sanitized evidence and explicit product-owner acceptance are required before EO-04-C closes.

## Official sources checked 11 October 2026

- Account types: https://developers.google.com/google-ads/api/docs/concepts/account-types
- Account hierarchy: https://developers.google.com/google-ads/api/docs/account-management/get-account-hierarchy
- API call structure: https://developers.google.com/google-ads/api/docs/concepts/call-structure
- Paging: https://developers.google.com/google-ads/api/docs/reporting/paging
- Segmentation: https://developers.google.com/google-ads/api/docs/reporting/segmentation
- Zero metrics: https://developers.google.com/google-ads/api/docs/reporting/zero-metrics
- Conversion reporting: https://developers.google.com/google-ads/api/docs/conversions/reporting
- Conversion categories: https://developers.google.com/google-ads/api/reference/rpc/v25/ConversionActionCategoryEnum.ConversionActionCategory
- PMax Asset Group reporting: https://developers.google.com/google-ads/api/performance-max/asset-group-reporting
- Cart data sales view: https://developers.google.com/google-ads/api/fields/v25/cart_data_sales_view
- PMax retail reporting: https://developers.google.com/google-ads/api/performance-max/retail-reporting
- Quotas: https://developers.google.com/google-ads/api/docs/best-practices/quotas
- API errors: https://developers.google.com/google-ads/api/docs/best-practices/understand-api-errors
- Data freshness: https://support.google.com/google-ads/answer/2544985
- Conversion windows: https://support.google.com/google-ads/answer/3123169
- Developer-token sunset: https://developers.google.com/google-ads/api/docs/api-policy/developer-token
- Versioning: https://developers.google.com/google-ads/api/docs/concepts/versioning


Additional product-reporting references checked 11 October 2026:

- Shopping performance view: https://developers.google.com/google-ads/api/fields/v25/shopping_performance_view
- Asset Group product-group view: https://developers.google.com/google-ads/api/fields/v25/asset_group_product_group_view
- Asset Group listing-group filter: https://developers.google.com/google-ads/api/fields/v25/asset_group_listing_group_filter

## 11 October 2026 — Production credential and OAuth/REST preflight

- The clean Vercel project contains `GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET` and `GOOGLE_ADS_OAUTH_REDIRECT_URI` in Production only. Vercel returned names and masked metadata only; no value was read into repository evidence.
- The redirect contract is exactly `https://embedded.adstable.app/auth/google-ads/callback`.
- `ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1` was replaced only after read-only Supabase evidence proved zero provider credential and PKCE envelopes. The product owner confirmed an independent encrypted recovery-vault copy.
- `app/lib/providers/google-ads-rest.server.js` now provides the tested server-only boundary for PKCE authorization, offline code exchange, refresh, `ListAccessibleCustomers` and direct v25 REST search. It never adds a developer-token header.
- GitHub Actions run `38131663609` passed 201/201 tests, TypeScript verification and production build.
- No Google authorization, provider request, account selection, database credential write, redeploy or Dataset V2 write occurred. The next gate is route wiring, encrypted refresh-token persistence, deployment and controlled read-only live evidence.

## 11 October 2026 — Pending authorization handoff finding

Route review found a critical fail-closed gap: after code exchange, the encrypted credential envelope is not yet linked to the claimed OAuth transaction through a short-lived server-side handoff while the merchant selects one to three accounts. A credential UUID through a URL, browser form or ordinary cookie cannot become authority.

Binding gate: `docs/EO_04C_GOOGLE_OAUTH_SELECTION_HANDOFF_GATE.md` and `contracts/eo-04c-google-oauth-selection-handoff-gate-v1.json`. The product owner accepted the gate; repository implementation, CI and separately approved live Supabase migrations passed on 11 October 2026. Route wiring, deployment and controlled Google evidence remain separate gates.
