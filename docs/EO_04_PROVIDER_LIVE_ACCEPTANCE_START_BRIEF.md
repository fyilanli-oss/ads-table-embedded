# EO-04 — Temporary Provider Live Acceptance trigger

**Control date:** 16 October 2026  
**Product-owner analyst-brief acceptance:** recorded 16 October 2026  
**Repository implementation authorization:** recorded 16 October 2026  
**Accepted live evidence:** recorded 16 October 2026
**Further live call, database/secret mutation and evidence-closure merge:** not authorized

## Analyst result

EO-04 needs a narrow way to inspect real provider response shapes before Dataset V2 and EO-05 scheduling exist. The accepted solution is a temporary authenticated HTTP resource beneath the existing Settings URL family. It is not a fourth visual product surface or a merchant workflow.

On 16 October 2026 the product owner authorized one minimal temporary button in the existing connected Meta section because the authenticated resource could not be operated through the available browser control. The button has no modal, date input, new section or custom styling. It submits the fixed accepted evidence date `2026-10-01`, permits one attempt per page load, and becomes non-interactive after either success or failure. It does not authorize deployment or perform a live provider call merely by existing in the repository.

On 17 October 2026 the product owner closed that temporary visual transport. The connected Settings state now exposes only Reporting Account and Disconnect; the authenticated server-side route is retained for a separately authorized App Role acceptance run. This changes no OAuth scope, reporting query or provider authority.

Two separately authorized production executions completed successfully on 16 October 2026, but the embedded iframe console was not observable through the available Codex browser log channel, so neither safe response payload was retained. The product owner then authorized, merged and deployed a repository-only correction that writes one allowlisted safe summary to the server log after a complete response. A third separately authorized execution completed at `2026-10-16T15:14:07.104Z`; its safe summary was retained and no runtime error was observed. The log contains field names, state counts, row counts, bounded action types and control flags. It excludes raw rows, names, numeric commercial values, raw identifiers, identifier hashes, provider request IDs, cursors, cursor hashes, tokens and credentials. The obsolete browser-console copy was removed so the server log is the single evidence channel; the existing button copy, layout and state behavior did not change.

## Accepted live analyst result — 16 October 2026

The Ad/Channel request completed with one Ad row. `impressions`, `spend`, `clicks` and `inline_link_clicks` were present as numeric provider evidence; `outbound_clicks` and `actions` were arrays, while `action_values` was absent. The returned action-type inventory contained landing-page, link and engagement interactions, but no purchase, checkout or add-to-cart action.

`impressions` and `spend` are accepted as direct provider evidence. A canonical Ad Click is not selected: `clicks`, `inline_link_clicks` and `outbound_clicks` remain distinct candidates. `landing_page_view` is not promoted to Session without a separate accepted mapping. No funnel event is inferred from the absence of purchase, checkout and add-to-cart evidence.

The `product_id` request completed successfully with zero rows. This is classified as `not_observed_in_this_execution`: it is not a real product zero and does not prove that Meta globally lacks `product_id` support. With no product row, no field state, Shopify product/variant identity, Sales Role or product Ad Cost can be produced. The product owner's contextual statement that the observed Instagram ad links to an Amazon product page is recorded separately from provider-authored evidence. It is consistent with the missing Meta catalog identity but does not prove causation. Repeating the same flow is not required; a later product evidence gate needs a Meta catalog-linked product ad and separate live-call authorization.

Durable sanitized evidence: `docs/evidence/EO_04_META_PROVIDER_LIVE_EVIDENCE_2026-10-16.json`.

The trigger reuses the permanent Meta reporting runtime at the non-visual resource URL `/settings/provider-live-evidence`. It accepts only `provider` and one `business_date`; it never accepts a store, workspace, account, token, provider URL, cursor, field list or API version from the caller.

## Authority and mutation boundary

The request must pass Shopify Admin authentication, verified Admin shop identity and an existing active installation lookup. The lookup is read-only; this acceptance route does not bootstrap, create or reactivate an installation. Meta authority then remains:

```text
Installed Shopify Store
→ active installation generation
→ connected Meta authority
→ canonical Reporting Account
→ encrypted server-only token vault
```

The route writes no provider fact, Dataset V2 row, installation, connection, token or evidence record. The durable repository evidence is a separately approved sanitized analyst record, not an application database write.

## Accepted Meta evidence behavior

One request date produces one Ad/Channel page followed by one `product_id` page. There is no automatic retry. A failure stops the operation and no later provider begins. If the product request fails, neither page is returned.

Ad/Channel is the standardized AdsTable dataset family, but the first live response is an evidence gate rather than a numeric publication. `impressions` and `spend` are accepted as direct evidence. The response inventories `clicks`, `inline_link_clicks`, `outbound_clicks`, and every returned `actions/action_values.action_type` without choosing a canonical click, session, add-to-cart, checkout or purchase mapping. The retained live result keeps Ad Click unresolved, keeps Session unmapped and records funnel evidence as absent. Any later canonical mapping requires a separate product-owner decision.

The product breakdown remains raw provider evidence and requests only the currently accepted product facts:

- `product_id`
- `impressions`
- `clicks`
- `spend`
- `converted_product_quantity`
- `converted_product_value`

It does not standardize product facts, assign Sales Role, map Shopify product/variant identity or publish product `Ad Cost`.

## Safe response

The response contains row counts, per-field state counts, action-type inventories, request IDs, pagination presence, cursor hashes and row-identity hashes. It does not expose provider rows, account/ad/product names, raw authority IDs, token material or credential IDs. It is explicitly not publishable to Dataset V2.

## Lifecycle

The HTTP trigger is temporary. The permanent provider runtime remains reusable. When EO-05's job/scheduler path is accepted, this route and only its temporary transport are removed atomically.

## Repository and live acceptance — 16 October 2026

The product-owner-authorized repository slice, safe server-log correction and production deployment are complete. Three successful route executions occurred; only the final separately authorized execution retained allowlisted live shape evidence. No Dataset V2 write, database mutation or secret/environment mutation occurred.

## Official sources checked on 16 October 2026

- Shopify Admin authentication: https://shopify.dev/docs/api/shopify-app-react-router/latest/authenticate/admin
- Shopify embedded Admin routes: https://shopify.dev/docs/api/shopify-app-react-router/latest/guide-admin
- Meta official Business SDK Ads Insights fields: https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py
- Meta official Business SDK Ad Insights request parameters: https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py
