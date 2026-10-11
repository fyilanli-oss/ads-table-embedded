# EO-04-D — Klaviyo Adapter Start Brief

Status: **Start brief accepted; repository implementation pending**  
Official documentation checked: **10 October 2026**  
Stable API revision baseline: **2026-07-15**

## Product decision

Klaviyo must produce truthful Campaign and Flow funnel facts without inventing unsupported zeros, spend or hierarchy leaves.

The Ad Analysis product requirement is deliberately narrow:

> Under the attributed Campaign Message, Flow Message or later-proven variation, show which products were sold using product ID, SKU, product name, purchase quantity and Sales.

AdsTable does **not** need to identify which product link was clicked. It must not infer the clicked product, and it does not classify the remaining basket as cross-sell merely from Klaviyo attribution.

## Reporting authority

Klaviyo Reporting API is the canonical funnel source because it follows Klaviyo UI attribution behavior and assigns conversions to the message send date. Query Metric Aggregates groups by event time and cannot silently replace the Reporting API for UI parity.

Each conversion metric requires a separate report call. Mapped Metrics discovers the account-specific metric IDs; metric-name guessing is forbidden.

## Truthful analytical hierarchy

Campaign performance:

```text
Klaviyo Account
└── Campaign
    └── Campaign Message
        └── Business Date
```

Flow performance and structure:

```text
Klaviyo Account
└── Flow
    └── Flow Action (structural metadata only)
        └── Flow Message (performance leaf)
            └── Business Date
```

Reporting supports variation group labels. Campaign Variation remains behind the 15 October 2026 GA and identity revalidation gate; beta is not a production dependency. Flow Variation remains behind an identity, persistence and live-evidence gate. No synthetic variation leaf is allowed.

## Canonical Dataset V2 mapping

| Dataset field | Klaviyo source |
|---|---|
| impression | delivered |
| ad_click | clicks_unique |
| session | null + unsupported |
| spend_value | channel-specific cost contract |
| add_to_cart / value | mapped Added to Cart conversion count/value |
| checkout / value | mapped Started Checkout conversion count/value |
| purchase / purchase_value | mapped Revenue or verified Placed Order conversion count/value |

Recipients drive email-cost allocation; recipients are not impressions. Opens, unique opens, bounce, failures, spam, unsubscribe and message segment counts remain provider diagnostics/evidence and do not replace funnel fields.

Missing report rows and provider nulls are not numeric zero. Only an explicit returned numeric zero is zero.

## Sold-product enrichment

The Events API may return event properties containing Shopify order line items and attribution relationships to Campaign, Campaign Message, Flow, Flow Message and Flow Message Variation.

EO-07-C may activate Klaviyo product rows only after one same event proves:

- the message/variation attribution relationship;
- product ID;
- SKU;
- product/variant name;
- purchased quantity;
- line or allocated Sales value.

Reporting API conversion totals remain canonical. Events API product enrichment must reconcile to those totals and must not create a second purchase count.

Clicked-product reconstruction, advertised-versus-cross-sell classification, URL matching and UTM inference are outside the requirement and forbidden as proof.

## Attribution and reconciliation

A five-day window must never be hardcoded. Klaviyo attribution windows are account-configurable. Documented defaults are guidance, not runtime configuration.

Conversions can take roughly three hours to attribute; late message interactions may update results while the configured window remains open. Attribution-setting changes can recalculate historical results for up to 36 hours. EO-05 therefore owns a configurable reconciliation/finality policy based on the account truth or an explicit safe configuration when no readable setting API exists.

## Cost

- Email: estimated 30-day email spend divided by 30, then allocated each provider business day across Campaign Message and Flow Message recipients.
- SMS: use native text-message spend/credit/ROI fields only when Klaviyo returns supported numeric values.
- Contracted-plan nulls and unsupported MMS/WhatsApp cost are not zero and are never fabricated.

## Quota architecture

Current Campaign Values limits are extremely restrictive: 1 request/second, 2/minute and 225/day per account/endpoint. The adapter therefore uses grouped bulk reports, not one request per message. Three mapped conversion metrics imply separate report calls; engagement and cost fields should share those bulk calls where possible.

Pagination must complete before publication. A 429 honors Retry-After and enters the shared bounded quota/backoff envelope.

## Live acceptance gates

Live access remains separately authorized. It must prove account discovery, both hierarchies, mapped metric provenance, delivered/unique-click and three conversion reports, zero/missing/null behavior, sold-product enrichment on the same attributed event, quota behavior, and sanitized raw evidence.

Campaign Variation is revalidated only after the scheduled 15 October GA. Flow Variation requires its own stable identity/persistence proof.

## Out of scope

- provider/OAuth/secret/database/Vercel/deployment mutation;
- Dataset V2 persistence, scheduling, FX and reconciliation implementation;
- product UI activation;
- clicked-product reconstruction;
- unsupported channel-cost invention.

## Official sources

- Reporting API overview: https://developers.klaviyo.com/en/reference/reporting_api_overview
- Mapped Metrics: https://developers.klaviyo.com/en/reference/get_mapped_metrics
- Events API: https://developers.klaviyo.com/en/reference/get_events
- Account: https://developers.klaviyo.com/en/reference/get_account
- Shopify event data: https://help.klaviyo.com/hc/en-us/articles/115005080447
- Event variables: https://help.klaviyo.com/hc/en-us/articles/115002779071
- Attribution: https://help.klaviyo.com/hc/en-us/articles/1260804504250
- Conversion attribution: https://help.klaviyo.com/hc/en-us/articles/115005248128
- Campaign Variation beta: https://developers.klaviyo.com/en/reference/get_variations_for_campaign_message_beta
