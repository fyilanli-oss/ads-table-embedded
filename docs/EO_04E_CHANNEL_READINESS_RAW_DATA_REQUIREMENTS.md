# EO-04-E — Channel-readiness raw data requirements

**Control date:** 14 October 2026  
**Status:** Draft factual inventory — product acceptance and implementation not authorized  
**Parent:** A6-EO-04 — Meta, Google Ads and Klaviyo adapters  
**Next mandatory provider gate:** Klaviyo 2026-10-15 GA documentation revalidation

## Analyst result

EO-04-E does not create Channel or Dataset V2. It must prove that each provider adapter can return the provider-native identities, hierarchy links, raw metrics, support state and completeness evidence that EO-05-B will need when the product owner designs Dataset V2 and the Channel analytical layer.

The purpose of this inventory is to prevent EO-05-B from discovering that a stable provider ID, parent relationship, campaign type, product identity or metric grain was never requested or preserved.

No row in this document authorizes a provider request, Dataset V2 write, schema change, scheduler, backfill, formula, Channel mapping, UI behavior, secret, deployment or live mutation.

## Layer boundary

```text
Provider API
  -> EO-04 provider-native raw evidence
  -> EO-04-E isolated and combined non-fabrication acceptance
  -> EO-05-B Dataset V2 plus Channel identity/mapping
  -> EO-06 Formula and Query
  -> EO-07 Funnel and Ad Analysis presentation
```

EO-04-E may preserve a native entity type such as Meta Ad, Google Ad Group, Google Asset Group, Klaviyo Campaign Message or Klaviyo Campaign Variation. It may not rename those entities to `Channel`, force providers to a common fictional leaf, allocate metrics to an unsupported leaf, or invent product attribution.

## Product-owner-approved investigation sequence

EO-04-E must perform the investigation in this order:

1. classify the truthful native Channel candidates separately for every provider and campaign/report family;
2. prove whether product rows exist beneath each candidate at the same supported reporting grain;
3. inventory product identity, quantity and value facts without inferring a product role;
4. calculate the three-provider semantic intersection;
5. admit only that intersection into the future Channel Core Contract;
6. preserve richer provider-only evidence as an extension without changing common UI semantics.

A Channel candidate is selected from the provider's real hierarchy and supported reporting grain. Product availability cannot create or rename an entity. A product row that is available only at a higher aggregate grain cannot be pushed down to a lower Channel candidate.

## Common raw requirements

Every provider result eligible for EO-04-E acceptance must preserve the following classes of information.

### Authority and request identity

- workspace and active Shopify installation generation;
- provider connection and verified provider account ID;
- Reporting Account ID where that provider model uses one;
- provider API/revision version;
- exact request operation, date coverage and query fingerprint;
- account timezone and source currency;
- attempt ID, page/partition coverage and completion state.

### Native hierarchy identity

For every returned reporting row:

- native entity type;
- stable native entity ID;
- native entity name where provided;
- native status where provided;
- stable parent IDs needed to reconstruct the truthful hierarchy;
- campaign ID, name and provider-native campaign type;
- the exact reporting grain at which every metric was returned.

Names are display metadata, never identity. Missing IDs are not reconstructed from names.

### Candidate raw fact inventory and common-core admission

The investigation asks every provider about the following candidate facts:

- `impression`
- `ad_click`
- `session`
- `spend_value`
- `add_to_cart`
- `add_to_cart_value`
- `checkout`
- `checkout_value`
- `purchase`
- `purchase_value`

This list is an investigation inventory, not a claim that every field is part of the common contract. A fact enters the future Channel Core Contract only when Meta, Google Ads and Klaviyo provide it with the same business meaning, compatible time semantics and the accepted Channel grain. A provider-specific source field and its actual reporting grain must accompany every candidate mapping.

A richer provider field may be retained as provider-qualified evidence, but it cannot silently become a common metric, alter cross-provider ranking or produce a different shared UI meaning. EO-04-E does not calculate CTR, CPC, CPS, ROAS, Revenue, Revenue Margin, Abandoned or rates.

### Product evidence and semantic intersection

The product investigation begins with candidates, not assumed common fields:

- provider-native product/item ID;
- title/name where returned;
- SKU or merchant item ID only where its meaning is officially defined;
- sold quantity or provider-defined conversion count at the provider-supported grain;
- sold value or provider-defined conversion value at the provider-supported grain;
- catalog/feed/store identity needed to interpret the product ID;
- provider-declared advertised item, sold item or another provider-defined role.

Each candidate field must be classified independently for Meta, Google Ads and Klaviyo as:

- `supported_exact`: same entity, meaning and Channel grain are officially supported;
- `supported_aggregate_only`: the field exists only above the candidate Channel;
- `provider_extension`: useful official evidence exists but no three-provider semantic equivalent exists;
- `unsupported`;
- `unknown_pending_proof`.

Only fields that reach `supported_exact` for all three providers may become mandatory Channel Core product fields. SKU, name, quantity and sales are candidates until that proof is complete; none is common merely because Google exposes it.

Product name or SKU must not be recovered by label matching. An aggregate conversion total must not be distributed among products. An unsupported ad-to-sold-product relationship remains unsupported.

### Product relationship and value status

Product relationship and monetary value are separate axes:

- `product_relationship = advertised | cross_sell | unclassified`
- `sales_value_status = positive_value | zero_value | unknown`

`advertised` and `cross_sell` require explicit provider evidence or a deterministic advertised-versus-sold identity comparison at the same accepted grain. A provider that cannot prove the relationship returns `unclassified`; another provider's richer semantics cannot be copied to it.

A returned product value of exactly zero is labelled only `zero_value`. It is not labelled Promotion, gift, discount or data error. Shopify order-line enrichment, order-ID joining and Promotion classification are deferred; EO-04-E performs no Shopify order retrieval or order-level join.

### Truth and completeness

Every requested field must retain:

- stable capability state: `supported | unsupported | unknown`;
- per-attempt observation state;
- explicit zero versus absent/null distinction;
- pagination/partition completion;
- provider request/trace ID where supplied;
- bounded sanitized raw-evidence reference and hash;
- source confidence based on evidence, never optimism.

A partial, fallback, synthetic or malformed provider result cannot become a canonical fact.

## Provider readiness matrix

### Preliminary Channel candidate and product-proof map

This table records investigation targets, not accepted Channel mappings.

| Provider/report family | Truthful native leaf candidate | Product proof target | Current state |
|---|---|---|---|
| Meta paid ads | Ad | Prove `product_id`, quantity/count and value compatibility at ad grain | Product role and common-field eligibility remain unknown |
| Google Search and other non-feed ads | Ad Group for the product-oriented analysis boundary | No product child is assumed | Product relationship is unsupported unless an exact official query proves otherwise |
| Google Standard Shopping | Ad Group plus provider-native product report rows | Prove advertised/sold item identities, units and revenue at compatible query grains | Google-rich evidence; common-core eligibility depends on Meta and Klaviyo |
| Google retail Performance Max | Asset Group plus provider-native product/listing rows | Prove whether sold-product and cart metrics remain exact at Asset Group grain | Candidate pending exact GAQL validation |
| Klaviyo Campaign | Campaign Variation after the 2026-10-15 GA gate | Prove attributed variation plus product event identity/value at one deterministic grain | Candidate pending GA documentation and controlled evidence |
| Klaviyo Flow | Flow Message, with variation only where stable identity is proven | Prove attributed message/variation plus product event identity/value | Candidate pending controlled evidence |

### Preliminary three-provider product intersection

No product field is admitted to the Channel Core Contract on 14 October. The table records the evidence still required.

| Candidate semantic | Meta | Google Ads | Klaviyo | Common-core state |
|---|---|---|---|---|
| Provider-native product ID | Ad-level `product_id` breakdown request exists; returned meaning requires proof | Item and sold-item IDs are documented for product-feed reports | Ordered Product examples expose integration-defined `ProductID`; Channel attribution requires proof | `unknown_pending_proof` |
| Product name/title | Not proven in the same Insights row; a separate catalog lookup and permission model are not accepted | Product and sold-product titles are documented | Ordered Product examples expose integration-defined `ProductName` | `unknown_pending_proof` |
| SKU/merchant item ID | No accepted same-grain SKU mapping | Merchant item identity is documented but feed semantics must be retained | Ordered Product examples expose integration-defined `SKU` | `unknown_pending_proof` |
| Product quantity | Sold-product quantity candidate is not re-proven | Cart data exposes units sold and lead/cross-sell units where supported | Ordered Product examples expose integration-defined `Quantity` | `unknown_pending_proof` |
| Product sales value | Compatibility of product breakdown with accepted purchase value requires controlled evidence | Cart data revenue and conversion value are documented at supported query grains | Event value exists; deterministic Message/Variation linkage remains unproven | `unknown_pending_proof` |
| Advertised versus sold role | Not proven | Google documents advertised, sold, lead and cross-sell semantics | Not proven at product-plus-Variation grain | Provider extension only; no common classification |
| Explicit zero value | Presence versus absence requires response evidence | Metric zero is queryable where the report returns the row | Event value and ordinary property zero/missing semantics differ | `unknown_pending_proof` |

Until a row reaches `supported_exact` across all three providers, the shared product analysis must not depend on it. A provider extension can be retained for later Google-specific analysis but cannot change the common Channel surface.

### Meta

| Requirement | 14 October status | EO-04-E evidence needed |
|---|---|---|
| Account -> Campaign -> Ad Set -> Ad stable IDs and names | Official hierarchy and ad-level Insights request shape available | Prove IDs, names, status, campaign objective/type and parent links in one bounded fixture or live read-only response |
| Daily reporting grain | Ad-level Insights supports `level=ad` and daily `time_increment` request shape | Preserve date coverage, account timezone and exact requested level |
| Impressions and spend | Official Insights fields | Prove explicit values/zeros and currency |
| Click candidate fields | `clicks`, `inline_link_clicks` and `outbound_clicks` are distinct provider fields | Freeze canonical `ad_click` mapping only after exact returned shapes and product-owner acceptance; do not sum candidates |
| Conversion counts and values | `actions` and `action_values` are provider action arrays | Preserve every returned `action_type` and value before selecting purchase/cart/checkout mappings |
| Product breakdown | Official Meta request examples expose ad-level `breakdowns=product_id` | Prove returned `product_id` semantics and compatibility with required action fields on a real eligible account; no SKU/name inference |
| Sold-product quantity/value candidates | Previously researched but not re-proven in the accessible 14 October official surface | `unknown` until exact official field definition and compatible response are recorded |
| Pagination | Official Meta workspace describes cursor/next traversal | Follow opaque provider links/cursors; prove no partial publish |
| Store isolation | Provider evidence may describe scope but cannot replace Installed Shopify Store authority | Reject or mark ambiguous where deterministic installed-store isolation cannot be proven |

Official sources checked 14 October 2026:

- https://www.postman.com/meta/facebook-marketing-api/overview
- https://www.postman.com/meta/facebook-marketing-api/folder/zzd6d5p/insights-api
- https://www.postman.com/meta/facebook-marketing-api/request/u07tack/get-ad-insights-l1
- https://www.postman.com/meta/facebook-marketing-api/request/5wdl62t/attributionsetting
- https://developers.facebook.com/docs/marketing-api/insights — direct page access remained rate-limited during this control check; no inaccessible detail is frozen from memory.

### Google Ads

Google must be classified by campaign/report family. One universal Google leaf is forbidden.

| Family | Native structure required | Performance grain to prove | Product evidence to prove | Current boundary |
|---|---|---|---|---|
| Search and other standard ad campaigns | Customer -> Campaign -> Ad Group -> Ad | Ad metrics may be requested at `ad_group_ad`; the Channel candidate is not decided here | Sold-product relationship beneath a Search Ad is unsupported unless an official compatible query proves otherwise | Preserve Campaign, Ad Group and Ad identities; EO-05-B decides Channel |
| Standard Shopping | Customer -> Campaign -> Ad Group plus listing/product reporting resources | Prove compatible campaign/ad-group/product reporting grains separately | `shopping_performance_view`, product/listing fields and cart-data sold-product fields are candidates | Never force product facts onto an Ad identity |
| Retail Performance Max | Customer -> Campaign -> Asset Group plus product/listing resources | Asset Group and product performance must remain distinct native grains | Product item/sold-item IDs, titles, quantities and values only where the exact query supports them | No synthetic Ad entity |
| Non-retail Performance Max | Customer -> Campaign -> Asset Group and supported asset reporting | Prove only officially queryable asset/asset-group performance | No retail product assumption | Outside product-reporting acceptance unless evidence exists |
| Cart-data sales | Provider resource/query compatibility controls grain | Preserve campaign/ad-group association exactly as returned | Preserve `product_sold_item_id`, `product_sold_title`, units and revenue fields where query-compatible | Do not claim Ad-level sold-product attribution from field selectability alone |

Required Google-native fields include:

- customer ID, timezone and currency;
- campaign ID, name, status and advertising channel/type/subtype;
- ad group ID, name and status where applicable;
- ad ID/name/status where applicable;
- asset group ID/name/status where applicable;
- product/feed/merchant/store identifiers needed to interpret item IDs;
- date, impressions, clicks, cost and conversion count/value fields at their exact query grain;
- cart-data quantity/value and sold-product fields only in validated compatible query families.

A field appearing in the Google field catalog as “selectable with” another resource is not by itself proof that the desired combined segmentation and reporting grain is valid. EO-04-E requires Query Validator or controlled read-only evidence for every query family.

Official sources checked 14 October 2026:

- https://developers.google.com/google-ads/api/docs/query/overview
- https://developers.google.com/google-ads/api/docs/shopping-ads/reporting
- https://developers.google.com/google-ads/api/fields/v25/campaign
- https://developers.google.com/google-ads/api/fields/v25/ad_group_ad
- https://developers.google.com/google-ads/api/fields/v25/asset_group_product_group_view
- https://developers.google.com/google-ads/api/fields/v25/cart_data_sales_view

### Klaviyo

Klaviyo has two separate evidence families: resource identity/hierarchy and Reporting API performance. Their identities must be proven compatible; matching labels are insufficient.

| Requirement | 14 October status | EO-04-E evidence needed |
|---|---|---|
| Account identity, timezone and currency | Provider-verified during connection | Preserve verified account ID and source settings |
| Campaign -> Campaign Message | Stable resource relationship exists in current revision | Prove IDs and relationship traversal |
| Campaign Message -> Campaign Variation | Available under `2026-07-15.pre`; documentation states GA target 15 October 2026 | Re-read 2026-10-15 GA docs; record final resource fields, relationship endpoints, pagination and revision |
| Flow -> Flow Message | Reporting API groups by required `flow_id` and `flow_message_id` | Preserve IDs/names and exact reporting grouping |
| Campaign reporting | Values report returns campaign performance and requires conversion metric selection | Preserve report grouping keys, conversion metric ID, timeframe and statistics |
| Flow reporting | Values/series report supports flow/message grouping and optional variation labels | Prove whether reporting `variation` is a stable resource identity or only a reporting dimension |
| Performance statistics | Recipients, delivered, opens, clicks, conversions and conversion value are documented statistics | Preserve raw provider statistics; do not store provider-calculated rates as canonical raw facts |
| Purchase and sales | `conversions` and `conversion_value` depend on the supplied conversion metric ID | Prove the selected Placed Order metric and exact message/variation grain |
| Product event identity and value candidates | Official Events API examples expose `ProductID`, `SKU`, `ProductName`, `Quantity` and event `value` for Ordered Product events | Preserve as candidates only; field names can be integration-specific |
| Product beneath message or variation | Metric Aggregates supports attributed message/variation dimensions, but the current official evidence does not prove a product property and attributed variation can be returned at one deterministic aggregate grain | Requires controlled read-only evidence after the GA gate; otherwise unsupported |
| Explicit zero product value | Klaviyo documents different missing/zero behavior for event value and ordinary event properties | Prove presence semantics; absent value cannot be converted to `zero_value` |
| Email cost | Not returned as actual email spend by the provider contract used here | Preserve user-estimated 30-day email spend separately; allocation belongs to EO-05-B |
| SMS/MMS/WhatsApp | Outside accepted email scope | Must not enter Channel through fallback |

Official sources checked 14 October 2026:

- https://developers.klaviyo.com/en/reference/reporting_api_overview
- https://developers.klaviyo.com/en/reference/query_campaign_values
- https://developers.klaviyo.com/en/reference/get_campaign_message
- https://developers.klaviyo.com/en/reference/get_campaign_messages_beta
- https://developers.klaviyo.com/en/reference/get_variations_for_campaign_message_beta
- https://developers.klaviyo.com/en/reference/get_variation_ids_for_campaign_message_beta
- https://developers.klaviyo.com/en/reference/get_message_for_campaign_variation_beta
- https://developers.klaviyo.com/en/reference/events_api_overview
- https://developers.klaviyo.com/en/docs/using_the_query_metric_aggregates_endpoint
- https://developers.klaviyo.com/en/v2026-07-15/docs/supported_metrics_and_attributes

## Mandatory 15 October Klaviyo gate

The date alone does not activate anything. Before EO-04-D or EO-04-E acceptance:

1. Read the published 2026-10-15 GA documentation and changelog.
2. Confirm that Campaign Variation endpoints actually became GA and record the required revision header.
3. Re-read Campaign, Campaign Message and Campaign Variation fields and relationships.
4. Prove whether Reporting API variation grouping maps to the stable Campaign Variation resource ID.
5. Confirm pagination and rate limits.
6. Confirm the campaign/flow statistics and conversion metric behavior used by AdsTable.
7. Classify product/SKU/name availability without profile-level or synthetic joins.
8. Update this inventory with exact evidence and remove every resolved `unknown`.
9. Obtain product-owner acceptance before adapter/runtime changes or live provider calls.

## EO-04-E acceptance scenarios to prepare after the GA gate

### Provider-isolated

For each provider independently:

- one complete zero-result response remains truthful zero/empty evidence;
- one supported non-empty response preserves native hierarchy and metric grain;
- unsupported and absent fields remain null with explicit state;
- pagination completes or the whole attempt is non-publishable;
- no provider result writes Dataset V2;
- no native entity is renamed or fabricated as Channel.

### Combined three-provider

- identical numeric IDs from different providers never collide;
- account timezone/currency and business date do not leak across providers;
- one failed/partial provider cannot zero or invalidate another provider;
- native hierarchy types remain provider-qualified;
- product identifiers remain provider-qualified;
- totals are not calculated in EO-04-E;
- no Dataset V2, Formula, Query or UI output is produced.

## Explicitly deferred to EO-05-B

- final `Channel` name and user-facing meaning;
- Channel type and identity columns;
- provider-native entity to Channel mapping;
- Dataset V2 table/schema/index/RLS/migration design;
- product child-row structure;
- Shopify order-line enrichment and order-ID joins;
- Promotion, gift, discount or bundle classification;
- Klaviyo email-cost allocation;
- FX persistence and lineage;
- aggregation and no-double-count rules;
- Channel history/versioning;
- any correction/backfill of persisted facts.

## Draft exit condition

This draft can become an accepted EO-04-E input only after:

- the 2026-10-15 Klaviyo GA gate is completed;
- Meta and Google unknown/candidate fields are explicitly accepted, rejected or assigned a controlled proof;
- product-owner review confirms that the preserved raw inputs are sufficient to design Channel in EO-05-B;
- the repository stabilization preflight confirms the work starts from current authoritative `main`;
- an executable contract and deterministic tests encode the accepted boundary;
- required GitHub CI passes;
- merge receives separate explicit product-owner approval.
