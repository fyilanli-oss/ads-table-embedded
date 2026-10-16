# EO-04 — Temporary Provider Live Acceptance trigger

**Control date:** 16 October 2026  
**Product-owner analyst-brief acceptance:** recorded 16 October 2026  
**Repository implementation authorization:** recorded 16 October 2026  
**Live provider call, deployment, database/secret mutation and merge:** not authorized

## Analyst result

EO-04 needs a narrow way to inspect real provider response shapes before Dataset V2 and EO-05 scheduling exist. The accepted solution is a temporary authenticated HTTP resource beneath the existing Settings URL family. It is not a fourth visual product surface or a merchant workflow.

On 16 October 2026 the product owner authorized one minimal temporary button in the existing connected Meta section because the authenticated resource could not be operated through the available browser control. The button has no modal, date input, new section or custom styling. It submits the fixed accepted evidence date `2026-10-01`, permits one attempt per page load, and becomes non-interactive after either success or failure. It does not authorize deployment or perform a live provider call merely by existing in the repository.

Two separately authorized production executions completed successfully on 16 October 2026, but the embedded iframe console was not observable through the available Codex browser log channel, so neither safe response payload was retained. This proves the authenticated execution path only; it does not prove any product-level field result. The product owner then authorized a repository-only correction that writes one allowlisted safe summary to the server log after a complete response. The log contains field names, state counts, row counts, bounded action types and control flags. It excludes raw rows, names, numeric commercial values, raw identifiers, identifier hashes, provider request IDs, cursors, cursor hashes, tokens and credentials. The obsolete browser-console copy is removed so the server log is the single evidence channel; the existing button copy, layout and state behavior do not change. Merge, deployment and another live call remain separate gates.

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

The route writes no provider fact, Dataset V2 row, installation, connection, token or evidence record. Deployment and the first live request remain separately authorized gates.

## Accepted Meta evidence behavior

One request date produces one Ad/Channel page followed by one `product_id` page. There is no automatic retry. A failure stops the operation and no later provider begins. If the product request fails, neither page is returned.

Ad/Channel is the standardized AdsTable dataset family, but the first live response is an evidence gate rather than a numeric publication. `impressions` and `spend` are inspected as direct evidence. The response inventories `clicks`, `inline_link_clicks`, `outbound_clicks`, and every returned `actions/action_values.action_type` without choosing a canonical click, session, add-to-cart, checkout or purchase mapping. That mapping requires a separate product-owner decision after the real response is reviewed.

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

## Repository implementation — 16 October 2026

The product-owner-authorized repository slice is implemented. It adds the bounded evidence runtime, strict types, the authenticated non-visual resource route, a read-only existing-installation authority resolver and synthetic security/contract tests. No provider call, deployment, Dataset V2 write, database mutation or secret/environment mutation occurred.

## Official sources checked on 16 October 2026

- Shopify Admin authentication: https://shopify.dev/docs/api/shopify-app-react-router/latest/authenticate/admin
- Shopify embedded Admin routes: https://shopify.dev/docs/api/shopify-app-react-router/latest/guide-admin
- Meta official Business SDK Ads Insights fields: https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py
- Meta official Business SDK Ad Insights request parameters: https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py
