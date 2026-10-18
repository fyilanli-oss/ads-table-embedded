# EO-04-C Google Ads reporting runtime start brief

## Status and authority

- Package: `A6-EO-04-C`
- Product-owner analyst-brief acceptance: **16 October 2026**
- Runtime implementation: **accepted and merged on 16 October 2026**
- Live Google Ads request: **not authorized by this brief**
- Dataset V2, database, scheduler, UI, OAuth, secret, environment and deployment mutation: **forbidden**
- Parent product contract: `contracts/eo-04e-three-provider-channel-product-economics-v1.json`

This brief freezes what the Google reporting runtime may request and how it must preserve Google evidence. The repository runtime and synthetic tests are implemented separately from any live request.

## Business outcome

Google must return two truthful layers without mixing them:

1. daily Ad/Channel performance at the real Google reporting leaf;
2. product-level advertised-product and sold-product evidence, including Sales Role when Cart Data supports it.

The accepted Channel leaves remain:

- Standard Shopping: `Ad Group`;
- Search: `Ad Group`;
- Performance Max Retail: `Asset Group`.

## PMax broad listing rule

`cart_data_sales_view` can preserve the advertised product, sold product, units and revenue, but it does not segment PMax sales by Asset Group. The existing listing-tree solution remains binding:

1. resolve the candidate Asset Groups from the **advertised** `segments.product_item_id` and the Asset Group listing trees;
2. if exactly one eligible Asset Group matches, use that exact Asset Group as Channel;
3. if more than one Asset Group matches, retain the product sale under `Unclassified Channel`;
4. never choose Channel from the sold product;
5. never distribute an ambiguous sale across candidate Asset Groups;
6. use only listing-tree evidence proven valid for the sale's business-date reporting window.

This applies equally to item-ID, category, brand, product-type, custom-label and `All products` trees:

- one eligible `All products` Asset Group is exact;
- multiple overlapping `All products` or category trees are `Unclassified Channel`;
- product sale and Sales Role remain available even when Channel is unknown.

### Historical listing-tree safety

A listing tree observed today does not prove the tree that was active on an earlier sale date. A historical product sale may receive an exact Asset Group only when versioned evidence proves that the matching listing-tree state was valid for the complete business-date reporting window in the Reporting Account timezone.

- current listing-tree state cannot be applied retroactively to an earlier sale;
- a tree change inside the business-date window makes exact daily Channel resolution unavailable;
- missing, partial or conflicting temporal evidence results in `Unclassified Channel`;
- the product sale, units, revenue and Sales Role are still retained;
- every exact resolution must retain the sale business date, account timezone, listing-tree evidence version/hash and validity window.

## Sales Role

The only term is `Sales Role`.

- `Advertised`: advertised and sold product are the same, supported by Google's lead-product evidence.
- `Cross-sell`: advertised and sold product differ, supported by Google's cross-sell evidence.
- `Assisted`: sold product is provider-attributed but exact advertised-product evidence is unavailable.
- `Unclassified`: provider identities or lead/cross-sell evidence genuinely conflict.

`Unclassified Channel` is not a Sales Role. `Zero Value` is not a Sales Role.

## Provider request families

Later runtime implementation must keep these provider-native families separate:

### Account and campaign context

- Reporting Account identity;
- account currency and timezone;
- campaign ID, name, status, advertising channel type and subtype;
- Merchant Center linkage evidence;
- Google Ads API revision and exact GAQL provenance.

### Daily Channel performance

- Standard Shopping and Search: Ad Group identity plus daily impressions, clicks, cost and conversion evidence;
- PMax Retail: Asset Group identity plus daily impressions, clicks, cost and conversion evidence;
- purchase/add-to-cart/checkout evidence remains conversion-action/category evidence and is not inferred from generic conversions.

### Product performance

`shopping_performance_view` preserves historical product performance by `segments.product_item_id`, including impressions, product clicks, provider-attributed `cost_micros`, conversions and conversion value.

Product impressions do not reconstruct Channel impressions. Provider Product Ad Cost is not Channel Ad Cost and is not Allocated Ad Cost.

### Product sales and Sales Role

`cart_data_sales_view` requests, when available:

- `segments.product_item_id`;
- `segments.product_sold_item_id` and sold-product attributes;
- `metrics.units_sold` and `metrics.revenue_micros`;
- lead units/revenue;
- cross-sell units/revenue;
- equivalent `all_*` metrics as separate raw evidence.

Cart Data requires account-side Conversions with Cart Data and Merchant Center configuration. Missing configuration, an empty successful page, an absent field and an explicit numeric zero remain different states.

### PMax listing evidence

- Asset Group identity and status;
- listing-tree node, parent and path;
- included/excluded and unit/subdivision state;
- item ID, brand, category, product type, custom attribute/label and `All products` dimensions;
- listing-tree evidence version/hash, observation time and proven validity window;
- `asset_group_product_group_view` aggregate evidence retained separately from exact product-sale rows.

Aggregate Asset Group product-group metrics cannot be joined to a sold-product row by arithmetic, proportional allocation or matching totals.

## Product identity and cost boundaries

The provider product key preserves Merchant Center ID, feed label and item ID. Shopify product/variant, SKU or title is not published until the candidate identity is verified through Shopify Admin API under the accepted official Google & YouTube sync path.

For Cross-sell:

- product performance cost belongs to the advertised product;
- units and revenue belong to the sold product;
- advertised-product cost is never moved onto the sold product;
- any later allocated product cost belongs to EO-05.

## First-error and completeness rules

- The first Google provider error stops the execution and all remaining Google query families.
- There is no automatic retry, alternate endpoint, API-version change or authentication fallback in the first evidence execution.
- A partial multi-query execution is not complete and cannot publish canonical facts.
- Empty success is not zero and is not global unsupported evidence.
- Provider rows and support states remain private, bounded and sanitized; no token, credential or unrestricted raw payload enters logs or repository evidence.

## Test-account and synthetic-fixture boundary

Google test accounts do not serve ads and therefore do not generate the performance, cost, conversion or Cart Data sales evidence required by this package. The runtime never treats a test account as product-level reporting acceptance evidence.

Repository fixtures are controlled examples owned by AdsTable. They verify only our implementation:

- exact GAQL family and date-window construction;
- raw page, request ID and opaque pagination preservation;
- `Advertised`, `Cross-sell`, `Assisted` and `Unclassified` Sales Role rules;
- one-versus-many broad listing-tree behavior;
- advertised-product-only Channel resolution;
- historical listing-tree validity and fail-closed `Unclassified Channel` behavior;
- empty, missing, unsupported and explicit zero separation;
- first provider error without automatic retry.

Every runtime page is resolved through the verified active Shopify installation, the connected Google advertiser selected as canonical Reporting Account, its retained manager login path when present, and the encrypted provider-token vault. A manager account can provide the access path but can never become the Reporting Account.

Fixture success never proves that Google returned a field, that an account has Cart Data, or that a real product sale exists. Those questions remain exclusively within a separately approved read-only production evidence execution.

## Separate next gates

This accepted brief authorizes only the repository contract package. Each of the following requires separate product-owner approval:

1. product-owner acceptance and merge of the runtime implementation;
2. deployment or environment change;
3. the first live Google Ads reporting execution;
4. Dataset V2 persistence or mapping;
5. Shopify product identity publication.

The runtime implementation was accepted and squash-merged as
`752cc1988323c238297d00516e7b7009432032c2`. The separately accepted repository
implementation scope for the first evidence trigger is governed by
`docs/EO_04C_GOOGLE_LIVE_EVIDENCE_TRIGGER_BRIEF.md`; that authorization does not
include deployment or a live Google request.

## Official sources

Checked 16 October 2026:

- Google Ads API v25 Cart Data Sales View: <https://developers.google.com/google-ads/api/fields/v25/cart_data_sales_view>
- Google Ads API product reporting for Shopping ads: <https://developers.google.com/google-ads/api/docs/shopping-ads/reporting>
- Google Ads API Performance Max retail reporting: <https://developers.google.com/google-ads/api/performance-max/retail-reporting>
- Google Ads API Asset Group reporting: <https://developers.google.com/google-ads/api/performance-max/asset-group-reporting>
- Google Ads API PMax listing groups: <https://developers.google.com/google-ads/api/performance-max/listing-groups>
- Google Ads API v25 Asset Group Listing Group Filter: <https://developers.google.com/google-ads/api/fields/v25/asset_group_listing_group_filter>
- Google Ads API deprecation and sunset schedule: <https://developers.google.com/google-ads/api/docs/sunset-dates>
- Google Ads API test accounts: <https://developers.google.com/google-ads/api/docs/best-practices/test-accounts>
- Google Ads API testing best practices: <https://developers.google.com/google-ads/api/docs/best-practices/testing>
