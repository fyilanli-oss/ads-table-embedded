# A6 — Channel reporting terminology and truth boundary

**Status:** Boundary accepted; reporting-sheet design pending  
**Decision date:** 11 October 2026  
**Owners:** A6-EO-04, A6-EO-05, A6-EO-06 and A6-EO-07

## Product direction

The merchant-facing reporting language may use **Platform → Channel** to answer the commercial questions a Shopify merchant actually asks: what did this advertising path cost, what products did it sell, what advertising burden landed on each product, and which additional products entered the basket.

Channel is not a provider object and is not a new Dataset V2 entity. It is a derived display path assembled only from provider-native nodes.

Examples:

- Meta: Campaign / Ad Set / Ad
- Google Search: Campaign / Ad Group / Ad
- Google Shopping product reporting: Campaign / Ad Group / Product Item
- Google Performance Max: Campaign / Asset Group; Product Item appears only when a real item-ID listing partition exists
- Klaviyo Campaign: Campaign / Campaign Message / verified Variation
- Klaviyo Flow: Flow / Flow Message / verified Variation

## Dataset collision prevention

The word `channel` has also been used for a delivery medium such as email or SMS. The two meanings must never share one technical field.

- User-facing **Channel** means the derived reporting path.
- The technical delivery-medium field is `delivery_channel` with values such as `email`, `sms`, `mms`, `whatsapp` or null.
- A canonical identity field named only `channel` is forbidden.
- Provider-native fields containing the word channel remain provider-namespaced raw evidence; they do not become the UI Channel.
- Every display-path node retains its real provider type, ID and name.
- Missing or unsupported nodes are not manufactured.

## Google truth boundary

Shopping Product Item and PMax Asset Group Product Item may be displayed in a Channel path when their native reporting grain exists, but neither is renamed or persisted as a Google Ad. Search sold-product linkage at Ad grain remains unsupported by the current native Google reporting contract.

## Pending decisions

The product owner's Excel reporting sheets will define the final columns, filters, ranking, Sales/Revenue/product-cost presentation and the final relationship between Funnel and analytics surfaces. This decision does not pre-approve those layouts.

## Non-effect

This record authorizes no provider call, OAuth/secret change, Dataset migration, UI implementation, deployment or package-status advancement.
