# A6-EO-07-B — Funnel visualization reference

**Status:** Product intent accepted; implementation and visual acceptance pending  
**Decision date:** 7 October 2026  
**Owner:** A6-EO-07-B  
**Non-effect:** No route, code, provider, database, deployment or package status changes are authorized by this reference.

## Product intent

Funnel App Home contains two relationship-oriented visualization modes rather than a collection of disconnected charts.

### Performance

Primary plotted series:

- Sales
- Revenue
- Spend

Supporting KPI and selected-point detail fields:

- Impressions
- Clicks
- Spend
- CTR
- CPC
- Sales
- ROAS
- CPS
- Revenue
- Revenue Margin

The canonical user-facing term is **Sales**. The internal metric key may remain `sales_value`.

### Intent

Primary plotted count series:

- Add to Cart
- Checkout
- Abandoned
- Purchase

Selected-point detail and summaries may show paired count and value fields. Clicks and Spend may appear as supporting context. Count and value are never conflated.

## Compare behavior

- Current period is rendered with a solid line; comparison period with a dashed line.
- Compare inherits A6-EO-06 rules: equal calendar-day count, non-overlap, same workspace timezone and compatible currency lineage.
- Daily visualization is bounded by the existing 31-day query limit.
- `zero`, `unknown`, `unsupported`, `partial`, `stale` and `provisional` remain distinct.
- Direction is metric-contract-driven: higher Sales, Revenue, ROAS, Revenue Margin, CTR, Purchase, Add to Cart and Checkout is favorable only when the A6-EO-06 contract confirms that meaning; lower CPC, CPS, Abandoned and Abandoned Value is favorable; Spend change is neutral without outcome context.
- A zero or unavailable denominator never becomes an invented percentage.

## One data authority

Chart, selected-point detail, KPI cards/summaries and the corresponding Funnel table must be projections of the same BFF/query result and formula authority. Their filters, dates, timezone, currency, support state and freshness lineage must match. Any parity mismatch fails acceptance.

## Shopify component and renderer boundary

Shopify official App Bridge and Polaris 2.0 RC components remain mandatory for the entire surface. SVG or Canvas is allowed only inside the chart data plane for axes, series, marks, guides, chart legends, direct data labels and accessible selection targets.

SVG/Canvas must not implement the page shell, controls, KPI summaries, sections/cards, tables, filters, modal/popover, buttons, forms, status/freshness, navigation or loading/empty/error UI. These use exact official Polaris components.

Essential information cannot be hover-only. Keyboard, touch, screen-reader title/description or tabular equivalence, non-color series encoding, reduced motion and real Shopify Admin mobile acceptance at 320 px are required.

## Ad Analysis boundary

This reference does not authorize an Ad Analysis chart. Ad Analysis remains blocked until A6-EO-07-C proves the deepest analytical leaf and both product/cross-sell fixtures per provider. A later accepted chart brief may reuse this narrow renderer boundary.

## Official sources checked 7 October 2026

- https://shopify.dev/docs/api/app-home/latest
- https://shopify.dev/docs/api/app-home/latest/web-components
- https://shopify.dev/docs/apps/build/app-home/polaris2
- https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/tooltip

## Acceptance gates

Implementation remains pending. Acceptance requires contract tests, exact implementation-day component verification, graph/table/KPI parity, state coverage, accessibility, desktop and real 320 px Shopify Admin evidence, and explicit product-owner approval.
