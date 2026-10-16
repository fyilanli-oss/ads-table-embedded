# EO-04-B Meta reporting runtime — first slice

## Status

- Product-owner runtime start authorization: **recorded 16 October 2026**
- Scope: **Meta Ad Channel daily raw Insights page only**
- Live Meta request: **not authorized by this slice**
- Dataset V2, database, scheduler, UI, OAuth scope, secret, environment and deployment mutation: **forbidden**

## Why this slice is intentionally narrow

Meta's real Channel is the Ad. The first runtime slice therefore proves only the provider-native daily Ad-level request and opaque cursor boundary. It does not infer a product row, Sales Role or product Ad Cost.

The accepted product contract requires a real catalog response before product-breakdown impression, click and spend may be treated as exact provider product evidence. Product breakdown, Creative advertised-product evidence and Shopify product/variant verification remain separate next gates.

## Exact request

- Endpoint: `/{graph-version}/{ad-account-id}/insights`
- Graph version: `v26.0`
- OAuth scope remains exactly `ads_read`
- `level=ad`
- `time_increment=1`
- bounded inclusive `time_range`
- opaque `after` cursor only
- fields: account, Campaign, Ad Set and Ad identity/name; business dates; impressions, clicks, inline link clicks, outbound clicks, spend, actions and action values
- no `product_id` breakdown in this slice

## Output boundary

The runtime returns a provider-native page envelope:

- `fact_family=ad_channel_daily_insights`
- `channel_type=ad`
- untouched provider rows for later contract-controlled normalization
- next opaque cursor
- provider request ID
- query evidence without token or secret

This is not Dataset V2 and is not persisted.

## Failure rules

- Meta error `190` is `reauthorization_required` and is never retried.
- documented rate-limit classes are retryable classifications.
- provider/server transient failures are retryable classifications.
- malformed successful JSON or missing `data` fails closed as `provider_schema_changed`.
- a next page without a valid opaque cursor fails closed.
- an empty `data` array is a valid empty provider page; it is not fabricated as zero.

## Next gate

After repository tests and product-owner review, the next Meta-only slice may add:

1. `product_id` breakdown raw evidence;
2. Creative/promoted-object exact advertised-product evidence;
3. Sales Role classification;
4. official Shopify Facebook & Instagram identity candidate verification.

No Google or Klaviyo runtime begins before the Meta provider slice is accepted.

## Official sources

Checked 16 October 2026:

- Meta official Business SDK — Ads Insights fields: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py>
- Meta official Business SDK — Ad Insights request parameters: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py>
- Shopify Admin GraphQL 2026-10 ProductVariant: <https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariant>
- Shopify Admin GraphQL `productVariant` query: <https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariant>
