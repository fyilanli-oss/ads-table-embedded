# A6-EO-04-B Meta Channel Data Contract

Status: product-owner analyst contract accepted; repository implementation in progress  
Checked: 13 October 2026

## Analyst outcome

AdsTable reads Meta only from the single canonical Reporting Account. Other
connected Meta advertiser accounts remain selectable connection scope, but their
facts are not mixed into the report. The hierarchy is
`Meta / Campaign / Ad Set / Ad`; the real provider Ad is the product-facing
Channel. No synthetic common leaf is created.

The daily fact request uses Meta Insights `level=ad`, `time_increment=1`, the
explicit requested date window and opaque cursor pagination. Every page must
finish before a result is publishable. The base query has no breakdown.
Every returned `account_id` must match the canonical Reporting Account. Daily
source time uses the provider-verified Meta Ad Account timezone; the Installed
Shopify Store timezone cannot silently replace it.

## Canonical mapping

| Canonical fact | Meta source |
| --- | --- |
| Impression | `impressions` |
| Ad click | `actions.link_click` |
| Session | unsupported by Meta Ads reporting |
| Spend | `spend` |
| Add to cart count/value | `actions` / `action_values`; standard then omni fallback |
| Checkout count/value | `actions` / `action_values`; standard then omni fallback |
| Purchase count/value | `actions` / `action_values`; standard then omni fallback |

Aliases are never summed. A standard action wins over its omni fallback. A
missing action type, `actions: []` or `action_values: []` stays `null/unknown`;
only an explicit numeric provider zero becomes zero. Meta `clicks` and
`outbound_clicks` remain raw evidence and do not replace the accepted canonical
`actions.link_click` decision.

No attribution parameter is guessed in the first implementation. Exact
`action_report_time` or unified-attribution behavior requires a later bounded
read-only comparison against a real account with conversion evidence.

## Product detail boundary

Meta accepts the candidate `product_id` breakdown and converted-product fields,
but the current account does not provide the real Catalog + Pixel/CAPI purchase
evidence required to activate them. Product detail therefore remains
`api_supported_runtime_unverified` and is excluded from the base query. SKU and
product name are not guaranteed by the current contract.

## Safety boundary

This slice introduces a read-only query builder, mapper, provider page reader,
error classifier and deterministic synthetic tests. It does not write Dataset
V2, start a scheduler/backfill, infer orders from Shopify/URL/UTM/click IDs, or
activate product analysis. The next live gate is a bounded raw-response read
from the Reporting Account, followed by explicit product-owner review.

## Official sources

- Meta Insights: https://developers.facebook.com/docs/marketing-api/insights
- Meta official Ad Insights request: https://www.postman.com/meta/facebook-marketing-api/request/u07tack/get-ad-insights-l1
- Meta official Marketing API collection: https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi

