# A6-EO-07 — Three-surface UI product freeze

**Status:** Product decision frozen; implementation and acceptance pending  
**Decision date:** 7 October 2026  
**Scope:** Funnel App Home, Ad Analysis and Settings  
**Authority:** Execution Plan, Shopify Embedded UI Constitution and explicit product-owner decisions

## 1. Purpose and non-effect

This package freezes the user-visible behavior that later A6-EO-07 implementation must follow. It does not implement UI, change a live route, mutate provider data, deploy, or accept any screen.

Only three product surfaces exist:

1. `/` — Funnel App Home
2. `/ad-analysis` — Ad Analysis
3. `/settings` — Settings

Dashboard is contextual visualization inside Funnel or Ad Analysis. Platforms is a Settings section. Attribution Differences is a future nested Ad Analysis view after A6-EO-07-C and A6-EO-07-D pass.

## 2. Official Shopify boundary

Official Shopify sources checked on 7 October 2026:

- App Home: https://shopify.dev/docs/api/app-home/latest
- Web components: https://shopify.dev/docs/api/app-home/latest/web-components
- Table: https://shopify.dev/docs/api/app-home/latest/web-components/layout-and-structure/table
- Modal: https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal
- Modal API: https://shopify.dev/docs/api/app-home/latest/apis/user-interface-and-interactions/modal-api
- Date picker: https://shopify.dev/docs/api/app-home/latest/web-components/forms/date-picker
- Select: https://shopify.dev/docs/api/app-home/latest/web-components/forms/select
- Button: https://shopify.dev/docs/api/app-home/latest/web-components/actions/button
- Settings pattern: https://shopify.dev/docs/api/app-home/latest/patterns/templates/settings
- Shopify App Pricing: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- Privacy compliance: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance

Implementation rechecks the exact approved Polaris runtime and every component/property on its start date. The repository's approved development runtime remains `polaris-2.0-rc.js` until a separate stable-transition decision passes.

Only official Shopify App Bridge and Polaris web components may render controls, tables, sections, statuses, forms and modals. Reference mockups define product intent, not permission to reproduce custom styling.

## 3. Shared three-surface rules

- Active providers are Meta, Google Ads and Klaviyo only.
- UI consumes same-origin BFF DTOs only. Browser code never becomes provider, database, workspace, billing or deletion authority.
- `zero`, `unknown`, `unsupported`, `partial`, `stale` and `provisional` are distinct states.
- Provider-specific hierarchy and leaf identity remain truthful. A common visual table never fabricates common provider capability.
- Monetary aggregation requires compatible reporting currency and FX lineage.
- Ratios are recomputed aggregate-first; row percentages are never averaged.
- Positive/negative color is used only when the metric contract defines desirable direction. A numeric increase is not automatically good.
- Hourly refresh is system-owned. There is no manual or page-open refresh control.
- Desktop and real Shopify Admin mobile at 320 px carry the same information architecture.
- Loading, empty, error, partial, unsupported, stale, provisional and success states require explicit copy and acceptance evidence.


### 3.1 Visualization decision state

- Funnel dashboard visualizations use the accepted relationship-oriented reference in `docs/A6_EO_07_FUNNEL_VISUALIZATION_REFERENCE.md`: Performance relates Sales, Revenue and Spend; Intent relates Add to Cart, Checkout, Abandoned and Purchase. The reference freezes product intent and renderer boundary, but does not authorize implementation or advance A6-EO-07-B.
- Ad Analysis visualization design and implementation are blocked until A6-EO-07-C verifies the deepest available analytical leaf and the two exact earring/cross-sell fixtures independently for Meta, Google Ads and Klaviyo. A provider with no verified product-level capability must not receive an inferred product chart.
- Settings has no dashboard or analytical chart surface.
- These waiting states do not block the already frozen non-chart table, control and workflow decisions, and do not advance A6-EO-07 status.

## 4. Funnel App Home analyst brief

### 4.1 User result

The merchant sees the selected reporting scope as a funnel or a metric table, can move between summary and daily presentation, can filter through provider-native hierarchy, and can compare valid periods without false parity or false zero. Relationship-oriented Funnel charts remain a separate pending analyst-input layer.

### 4.2 Controls

The header contains:

- Time range
- Compare time range
- Filters
- Presentation: Summary or Daily
- View: Funnel or Table

`Funnel/Table` and `Summary/Daily` are independent dimensions. Funnel/Table changes metric orientation; Summary/Daily changes time presentation.

### 4.3 Hierarchy

- Meta: Campaign → Ad Set → Ad
- Google Search: Campaign → Ad Group → Ad
- Google Performance Max: Campaign → Asset Group → only an A6-EO-07-C verified deeper leaf
- Klaviyo Campaign: Campaign → Campaign Message → only a verified Variation
- Klaviyo Flow: Flow → Flow Message → only a verified Variation

Filters use the same canonical hierarchy. Reporting Account and Reporting Store are changed only in Settings.

### 4.4 Compare

- Custom comparison is allowed.
- Current and compare ranges must contain the same number of calendar days, must not overlap, and use the same workspace timezone and reporting currency rules.
- Funnel compare presents current, comparison and delta without treating unknown as zero.
- Table compare expands only explicitly selected metrics. One metric is expanded by default; desktop may expand more, mobile only one.
- Zero-based and unavailable percentage deltas use an explicit non-percentage state rather than invented infinity or 100%.

### 4.5 Component mapping

| Visible element | Shopify component/API | Binding |
|---|---|---|
| Page | `s-page` | App Home root; no duplicate Funnel nav item |
| Date and compare launch | `s-button` | Opens focused range modal |
| Date range | `s-date-picker` | `type="range"`; server-validates range |
| Compare configuration | `s-modal`, `s-date-picker` | One modal visible at a time |
| Filters | `s-button`, `s-modal`, official choice/form components | Canonical hierarchy only |
| View/presentation controls | `s-button-group`, `s-button` | Two independent dimensions |
| Table | `s-table` | Native responsive table-to-list behavior |
| Status/freshness | `s-badge`, `s-banner`, `s-text` | State is never color-only |

## 5. Ad Analysis analyst brief

### 5.1 User result

The merchant ranks the deepest verified analytical items for the selected period and opens focused intent, performance and product evidence without turning the main table into an unreadable matrix.

Ad Analysis is one aggregate table for the selected range. It has no Funnel/Table or Summary/Daily switch. Its chart layer remains blocked until A6-EO-07-C verifies provider leaf and product/cross-sell capability.

### 5.2 Truthful analytical leaf

The UI label is `Analysis item`, not universally `Ad name`.

- Meta uses Ad only when verified at ad grain.
- Google Search uses Ad only when verified at ad grain.
- Google Performance Max uses Asset Group or a deeper leaf only after A6-EO-07-C proves it.
- Klaviyo uses Campaign Message, Flow Message or Variation only when that leaf is verified.

Each row carries provider, entity type, canonical ID and parent path. Same names never collapse identity.

### 5.3 Ranking

Primary ranking choices are:

- Purchase
- Sales
- Revenue
- Revenue Margin

The canonical user-facing label is `Sales`; an internal key may remain `sales_value`. The exact distinction and formulas for Sales, Revenue, Revenue Margin Value and Revenue Margin % belong to A6-EO-06. No UI label may contradict that formula contract.

The merchant can choose descending or ascending order. Verified numeric values rank first; `partial`, `unknown` and `unsupported` are not coerced to zero and are ordered in separate state groups. The total row is not rankable. Ties use a stable canonical identity order.

### 5.4 Intent and performance detail

The main row exposes two accessible official actions: `View intent metrics` and `View performance metrics`. Both open one `Analysis details` modal focused on the selected section. Two modals are never visible simultaneously.

Intent candidates include Add to Cart Rate, Checkout Rate, Abandoned Rate and Purchase Rate. Performance candidates include CTR, CPC, ROAS and CPS. Every numerator, denominator, support state and desirable direction comes from A6-EO-06.

In compare mode the main table expands only the selected ranking/compare metrics. The focused details modal may show comparison, current value, absolute delta and valid percentage delta for all supported metrics of the selected row.

### 5.5 Creative and product evidence

Creative preview and attributed/sold products are separate concepts.

- A main-row thumbnail is allowed only from verified provider creative/asset media; otherwise an explicit fallback is shown.
- A product appears only when A6-EO-07-C proves provider-returned product/catalog identity and it maps deterministically to the active Reporting Store product/variant.
- Shopify may supply the image after that verified identity mapping; the image does not create attribution.
- Product name, destination URL, UTM, `fbclid`, `fbc` or an arbitrary Shopify order join cannot infer the relationship.
- A non-advertised cross-sell product appears only if the provider natively returns it for that analytical leaf.
- Unsupported product evidence is labelled unsupported, never hidden as zero.

Products live in the single details modal as a compact list with image, product/variant identity, quantity, value, source and support state. They do not expand every table row inline.

### 5.6 Component mapping

| Visible element | Shopify component/API | Binding |
|---|---|---|
| Page | `s-page` | `/ad-analysis` |
| Range/compare/filter launch | `s-button` | Same semantics as Funnel |
| Ranking metric | `s-select` | Four contract-backed choices |
| Sort direction | `s-button` | Accessible ascending/descending label |
| Main results | `s-table` | Responsive list on small screens |
| Intent/performance action | `s-button` | Icon may supplement but never replace label |
| Details | one `s-modal` | Focused section; never simultaneous modals |
| State | `s-badge`, `s-banner`, `s-text` | Support/freshness/provisional copy |

## 6. Settings analyst brief

### 6.1 Reference behavior

The working legacy `ads-table-dev` Settings user flow is the interaction reference. Its source code, custom styling, old navigation, test/acceptance panels and retired providers are not carry-as-is assets.

The following working behavior must not regress:

- Connect and provider explanation
- OAuth return to Settings
- Resume setup
- Verified account selection
- Connected, reconnect and disconnect states
- Reporting Account selection
- Klaviyo Email Monthly Plan Cost history and correction behavior

No implementation may redesign, rename or remove a proven step without a separate product decision and characterization evidence. Settings has no chart requirement.

### 6.2 Section order

1. Reporting Currency
2. Provider Connections and Reporting Accounts
3. Reporting Store
4. Subscription
5. Data & Privacy

Reporting Store is not placed above its provider-account dependencies.

### 6.3 Reporting Account and Reporting Store transaction

A Reporting Account change is staged, not immediately activated.

1. Discover and verify store topology under the proposed account.
2. If the current active Reporting Store is verified, atomically activate the account while preserving the store.
3. If the current store is absent but verified candidates exist, require explicit store selection and atomically activate account plus effective-dated store binding.
4. If multiple candidates exist, selection is mandatory.
5. If no verified candidate exists, keep the old active account/store pair. The new account may remain connected but cannot become reporting authority.

Before atomic activation, the proposed account cannot write Dataset V2 or receive SnapshotJobs. Historical data is preserved and never relabelled. `unknown store` is not a valid silent state.

A read-only reporting-scope summary may appear, but editable Reporting Store controls remain after provider-account controls.

### 6.4 Subscription

Settings displays the Shopify-authoritative plan, `$24.99/month` public-plan price, 14-day trial state/end, current billing period and entitlement status. One active Reporting Store is included; candidate detection and active-store switching do not create a charge.

AdsTable does not imitate Shopify checkout or host a custom pricing transaction. `Manage subscription` navigates to Shopify's hosted plan surface. Subscription state is verified through the current Shopify App Pricing authority; redirect parameters alone are not entitlement authority.

### 6.5 Data & Privacy

`Delete my data` is available while installed and is separate from disconnect and uninstall.

- First confirmation explains scope, access shutdown, credential removal, Dataset deletion, legal-retention exceptions and irreversibility after execution begins.
- A second explicit server-verified confirmation is required.
- The two confirmations are sequential; two modals are never open together.
- Once accepted, new provider operations and SnapshotJobs stop before asynchronous manifest execution.
- Progress and terminal completion are visible to the merchant.
- Workspace identity comes only from the verified Shopify session.

Uninstall remains an access-stop event. Shopify compliance webhooks and the approved retention/deletion manifest govern redaction; uninstall is not presented as immediate Delete my data completion.

### 6.6 Component mapping

| Visible element | Shopify component/API | Binding |
|---|---|---|
| Page/sections | `s-page`, `s-section`, `s-stack`, `s-grid` | Official Settings pattern |
| Provider/store/subscription state | `s-badge`, `s-banner`, `s-text` | Text plus tone, never color-only |
| Provider/account/store actions | `s-button`, `s-select` and official choice controls | Server allowlist and ownership revalidation |
| Klaviyo cost | official number/select/form components | Effective-dated server contract |
| Subscription management | `s-button` navigation | Shopify-hosted plan surface |
| Delete my data | `s-button tone="critical"`, sequential `s-modal` | Two explicit confirmations |

## 7. State matrix

| State | Funnel | Ad Analysis | Settings |
|---|---|---|---|
| Loading | Skeleton/loading status without fake values | Loading table/list | Loading verified workspace state |
| Empty | No rows for selected scope/range | No verified analytical items | Required setup action |
| Partial | Exact provider/metric coverage warning | Row/metric support state | Incomplete provider/store topology |
| Unsupported | Unsupported metric/entity is labelled | Provider leaf/product unsupported | Control omitted or disabled with reason |
| Stale/provisional | Freshness/finality shown | Freshness/finality shown | Connection/job review message |
| Error | Safe retry/reference; no raw provider error | Safe retry/reference | Existing authority preserved on failed mutation |
| Success | Data and scope visible | Ranked verified leaves visible | Saved server-authoritative state visible |

## 8. Acceptance and sequencing

- This freeze does not make A6-EO-07 Ready or Done and does not bypass A6-EO-01 through A6-EO-06.
- A6-EO-07-A implements Settings using legacy flow characterization, not source-code carry.
- A6-EO-07-B implements Funnel only after its BFF/query/formula contracts exist; relationship-chart implementation additionally waits for the approved product-owner graph package.
- A6-EO-07-C must freeze deepest-grain and cross-sell capability before A6-EO-07-D.
- A6-EO-07-D implements only verified leaf/product capability; its chart layer remains blocked until A6-EO-07-C closes the two exact earring/cross-sell fixtures per provider.
- A6-EO-07-F requires constitution/contract tests, desktop Shopify Admin, real 320 px mobile, accessibility and explicit product-owner acceptance.
- No surface is accepted merely because it renders or a happy path works.

## 9. Explicitly out of scope

- UI source changes
- Backend/BFF/provider implementation
- Database migration
- Billing activation
- Privacy deletion execution
- Deployment or production mutation
- A6-EO-07 status advancement
- Legacy retirement


## 9. Accepted Funnel visualization reference

The binding reference is `docs/A6_EO_07_FUNNEL_VISUALIZATION_REFERENCE.md` with executable contract `contracts/shopify/a6-eo-07-funnel-visualization-reference-v1.json`.

- Performance relationship: Sales, Revenue and Spend.
- Intent relationship: Add to Cart, Checkout, Abandoned and Purchase; count and value remain separate fields.
- Current series are solid; comparison series are dashed.
- Directional color/arrow meaning comes from the A6-EO-06 metric contract, never numeric sign alone. Spend is neutral without outcome context; lower CPC, CPS and Abandoned metrics are favorable.
- Chart, selected-point detail, KPI summary and table share one BFF/query/formula authority.
- Only the graph data plane may use SVG or Canvas. Every surrounding UI element remains official Polaris/App Bridge.
- Ad Analysis graph work remains blocked by A6-EO-07-C and its provider-specific product/cross-sell evidence.
- This reference creates no new package, changes no package status and authorizes no implementation or live mutation.
