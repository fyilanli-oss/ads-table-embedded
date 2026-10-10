# A6 — Official provider documentation registry and change-watch decision

**Status:** Approved product direction; scheduling and implementation pending  
**Decision date:** 10 October 2026  
**Scope:** Meta, Google Ads, Klaviyo and Shopify official developer sources

## Purpose

AdsTable must not depend on model memory, old task output or accidental discovery for provider behavior. Current official documentation remains the mandatory pre-implementation authority, while a future automated watch should detect meaningful provider changes before they become product, policy or review risk.

## Proposed capability

The future capability will maintain an official-source registry for each provider and classify detected changes as:

- informational;
- contract review required;
- approaching deprecation;
- critical compatibility change;
- security or platform-policy risk.

A no-change run stays silent and creates no repository churn. A detected change produces a reviewable finding with affected AdsTable contracts and packages. It never changes production code, provider requests, schemas or product behavior without the normal analyst brief, executable contract, CI and explicit product-owner acceptance gates.

## Minimum source families

- Meta: Marketing API versions/changelog, Insights fields and breakdowns, attribution, Catalog/Product Item, limits and errors.
- Google Ads: API release notes/deprecations, GAQL fields and compatibility, quotas and errors.
- Klaviyo: API changelog/versioning, reporting endpoints, metric availability, rate limits and errors.
- Shopify: developer changelog, Admin GraphQL versions, App Bridge/Polaris, billing, privacy and App Store review policy.

## Operating model

1. Mandatory current-document check remains in force before every provider package.
2. A future scheduled monitor checks the registry periodically, preferably weekly.
3. Only meaningful changes notify the product owner.
4. Evidence records source URL, API/doc version, checked timestamp, changed section and affected AdsTable decision.
5. Provider documentation may trigger a recommendation, never an autonomous production mutation.

## Scheduling constraint

`EO-GOV-01` is a proposed future identifier, not an active parallel package. The A6-EO single-line execution rule remains binding. Exact placement and automation scheduling require a later explicit planning decision and must not interrupt EO-04-B.

## Sources confirmed for the originating Meta finding

Checked 10 October 2026:

- https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights
- https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/best-practices
- https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/breakdowns
- https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/error-codes
- https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/
- https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/
- https://developers.facebook.com/docs/marketing-api/reference/product-item/
