# EO-04-C — Google Ads adapter analyst start brief

**Control date:** 10 October 2026  
**Status:** Start brief accepted; repository implementation not started  
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

## Sold products, cart data and cross-sell

When conversions with cart data are implemented, Google can expose sold-product identity/title, units, revenue, gross profit and cross-sell metrics. For Shopping-click attribution, clicked and sold product dimensions may be examined together.

The current truthful boundary is:

```text
Campaign
└── Ad Group
    └── sold products and cart/cross-sell metrics
```

The official `cart_data_sales_view` documents Campaign and Ad Group as its segmenting resources. It does not currently guarantee that every sold-product row can be attached to one Standard Ad ID. Performance Max has no individual Ad leaf at all.

For retail PMax, `shopping_performance_view` and `asset_group_product_group_view` can report advertised/listing-product performance. That is not automatically proof of which other basket products were sold.

Therefore:

- sold products exist as native Google evidence only when cart data is implemented;
- Ad-level sold-product attribution remains a mandatory deeper field-compatibility and live-query investigation;
- `product_sold_item_id` is a Merchant Center item ID, not presumed Shopify SKU or variant ID;
- deterministic Merchant item → Installed Shopify Store product/variant mapping is required;
- the exact two earring/cross-sell fixtures remain owned by EO-07-C;
- no product row or chart is activated from this documentation alone.

## Acceptance sequence

### Gate 1 — accepted documentation decision

This brief and executable contract are accepted. This authorizes durable documentation only.

### Gate 2 — repository implementation

After Google and Klaviyo documentation discovery is complete, implement the adapter with deterministic fixtures for account discovery, manager exclusion, both hierarchies, conversion categories, zero/absence, pagination, retry and fail-closed scope.

### Gate 3 — separately authorized live evidence

Live evidence must prove account discovery, Standard Ad structure, PMax Asset Group structure, metric response shapes, conversion categories, time/currency, complete pagination and—when cart data exists—the deepest sold-product grain. Secrets, OAuth and live provider calls require their own accepted gate.

### Gate 4 — closure

Repository CI, durable sanitized evidence and explicit product-owner acceptance are required before EO-04-C closes.

## Official sources checked 10 October 2026

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
