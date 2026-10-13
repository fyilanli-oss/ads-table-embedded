# A6-EO-04-B Meta Channel Data Contract

Status: product-owner analyst contract accepted; repository implementation and live read-only gate in progress  
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

## Live read-only acceptance surface

The operator-only Settings surface is enabled only with
`?gate=eo04b-meta-channel`. It never accepts an account or date from the
browser. The server re-resolves the active Installed Shopify Store, loads the
single persisted Meta Reporting Account, opens that connection's encrypted
token and derives the previous closed day from the provider-verified Meta Ad
Account timezone.

The check scans at most 31 closed provider days to locate the most recent
non-empty performance date, then reads that exact day again. Both scans use
bounded cursor/page and row limits. The result removes provider identifiers and
shows Campaign, Ad Set and Ad counts, impressions, canonical `link_click`, spend
and the provider-returned `actions` and `action_values` type/value inventory.
An empty result remains verified-empty; absent actions are not shown as zero.

### State and component contract

| State | Exact user outcome | Shopify component |
| --- | --- | --- |
| Ready | Explains the 31-day read-only boundary and zero writes | `s-section`, `s-stack`, `s-paragraph`, `s-button variant="secondary"` |
| Loading | Existing Meta working state; duplicate action unavailable | `s-badge tone="info"`, `s-paragraph` |
| Empty | PASS with scan dates and Dataset V2 writes 0 | `s-banner tone="success"`, `s-paragraph` |
| Non-empty | PASS with hierarchy/metric totals and raw action inventories | `s-banner tone="success"`, `s-stack`, `s-paragraph` |
| Error | Safe `META_*` code; no raw provider error | existing `s-banner tone="critical"` |

No raw HTML action control, custom CSS, literal color or custom component is
introduced. The exact component check used Shopify's current App Home Web
Components, Section and Text documentation on 13 October 2026.

## EO-04A identity correction found before live execution

The common adapter validator and TypeScript declaration currently model
`authority.installation_id` as a UUID/string. The canonical Shopify schema and
EO-03A evidence define `shopify.installations.id` as `bigint`. No fabricated UUID
will be used to force canonical publication. This live acceptance therefore
stops at raw, read-only provider evidence and performs no canonical Dataset row
publication. The type alignment must be corrected and regression-tested before
the first Dataset V2 write gate.

## Official sources

- Meta Insights: https://developers.facebook.com/docs/marketing-api/insights
- Meta official Ad Insights request: https://www.postman.com/meta/facebook-marketing-api/request/u07tack/get-ad-insights-l1
- Meta official Marketing API collection: https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi
- Shopify Polaris web components: https://shopify.dev/docs/api/polaris/using-polaris-web-components
- Shopify App Home Section: https://shopify.dev/docs/api/app-home/latest/web-components/layout-and-structure/section
- Shopify App Home Text: https://shopify.dev/docs/api/app-home-ui-extension/latest/web-components/typography-and-content/text
