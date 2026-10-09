# A6-EO Demo Fixture, Export Reference and Shopify Dev Store Boundary

**Status:** Decision frozen; extraction and implementation pending  
**Decision date:** 7 October 2026  
**Executable contract:** `contracts/a6-eo-demo-fixture-export-reference-v1.json`

## Decision

The legacy dashboard demo is valuable raw material, not an application module and not provider evidence. AdsTable will extract a clean, versioned fixture from it instead of copying the HTML or JavaScript into the embedded-only runtime.

The fixture has four approved purposes:

1. Funnel and Ad Analysis UI acceptance.
2. Future CSV/XLSX export contract reference.
3. An isolated Shopify dev-store demo workspace.
4. A deterministic seed for the 2,000/4,000-workspace capacity generator.

It cannot prove Meta, Google Ads or Klaviyo API behavior, native attribution, finality, real zero, product attribution or cross-sell.

## Provenance

- Repository: `fyilanli-oss/ads-table-dev`
- Ref: `main`
- Path: `codex-input/adstable_one_funnel_compare_all_v2_75_safe_clean_pass8_markup_cleanup-1.html`
- Git blob: `87413af1318cbdb3efbe1104e283d7294bc0c219`
- SHA-256: `fece0e65ac8c2d20c440d0f98cd510449bd170cf5beccf33e4a6c2cab4db9c35`
- File size: 751,960 bytes
- Carry rule: reference/fixture raw material only; no as-is source carry and no runtime dependency.

## Inspected inventory

The embedded `SOURCE_ROWS` dataset contains:

- 1,000 rows and approximately 458,500 bytes of JSON.
- 50 calendar days from 1 June through 20 July 2026.
- USD-only source rows.
- Meta 250, Google 250, Klaviyo 150, TikTok 250, Direct 50 and Others 50 rows.
- 700 paid and 300 provider-labelled organic rows.
- Date/platform/traffic/campaign/group/ad dimensions.
- Impression, ad click, spend, add-to-cart, checkout, purchase and value inputs.
- Legacy abandoned, profit, CTR, CPC, CPS and ROAS expected results.

The legacy page also contains Funnel, Funnel Table, Intent Analysis and Top Selling Ads CSV/XLSX behavior.

## Mandatory repair boundary

The source shape is not Dataset V2:

- TikTok, Direct and Others are outside the active three-provider product boundary.
- Provider-labelled organic traffic is not silently presented as native paid-provider reporting.
- Klaviyo cannot remain forced into generic Campaign/AdGroup/Ad.
- Google Standard and Performance Max need distinct native hierarchy.
- Meta needs Campaign/Ad Set/Ad.
- Workspace, installed Shopify shop, provider account, timezone, support, freshness, finality, FX and provenance fields must be added.
- Legacy calculated metrics are not copied as truth; EO-06 recalculates them from raw fixture inputs.
- Synthetic zero is forbidden. A value is zero only when the fixture explicitly asserts a supported zero; otherwise it is unknown or unsupported.
- All identifiers are fixture/workspace/provider namespaced.

Every normalized demo row is visibly and structurally marked:

```text
data_origin = synthetic_demo
provider_truth = false
workspace_kind = demo
```

## Two fixture modes

### Immutable golden fixture

The original fixed date range is retained for contract tests, formula golden tests, export snapshots and UI regression. It never shifts dates.

### Rolling demo fixture

A deterministic projection maps the golden fixture onto a demo clock while preserving relative intervals and compare relationships. It exists only for the Shopify demo store and never mutates the golden fixture. The UI must visibly label it as synthetic demo data.

## Export reference

Export remains outside the first Shopify review implementation scope. Capturing the reference now does not activate export work.

Candidate behavior retained for the future contract:

- CSV: machine-readable long rows with explicit period, hierarchy/entity, metric, previous, current and delta.
- XLSX: human-readable current-view or wide analysis matrix.
- Funnel Table CSV/XLSX: the same visible matrix.

The final schema is deliberately not frozen here. Future implementation requires explicit approval, formula/UI parity, typed numeric XLSX cells, CSV injection protection, authorization, bounded asynchronous generation, audit/expiry and no hidden provider payload.

## Shopify dev-store acceptance

Shopify officially supports development stores for realistic app testing, optional generated demo commerce data and installation of an organization-owned app. AdsTable will use a dedicated dev shop and a dedicated demo workspace.

The demo workspace:

- never reuses a merchant workspace;
- needs no real provider token;
- never fakes a connected provider state;
- labels all analytical data as synthetic;
- keeps Settings truthful about real connections versus demo fixtures;
- supports idempotent seed/reset;
- contains no protected real customer data;
- proves embedded UI and lifecycle behavior, not live provider accuracy.

Shopify-generated store data and AdsTable’s analytical fixture are separate datasets. Product IDs or images may be mapped later only through an explicit fixture contract.

## Product and cross-sell limitation

The source has no product ID, image, order-line quantity or advertised-versus-other-product evidence. It cannot cover the earring/cross-sell scenario. EO-07-C owns a separate evidence-bound product fixture. Synthetic product data may test UI presentation, but provider-native acceptance still requires live redacted raw evidence.

## Capacity use

The 1,000 rows are a generator seed, not a capacity test. A deterministic generator will namespace workspace/store/account/hierarchy identifiers and preserve rows-per-refresh, date density, hierarchy width, sparsity and value distributions.

It generates 2,000-workspace certification and 4,000-workspace stress workloads under the existing capacity contract. Cross-tenant identifier collision is a hard failure.

## Package routing

- EO-05-B: extract, validate and normalize golden/rolling Dataset V2 fixtures.
- EO-06-A/B: formula, date, filter and compare assertions.
- EO-07-B: Funnel UI acceptance.
- EO-07-C: separate product/cross-sell fixture.
- EO-07-D: Ad Analysis UI acceptance.
- EO-08-C: capacity generator plus restore/load rehearsal.
- EO-08-D: Shopify dev-store embedded end-to-end acceptance.
- Export: future, explicit post-review package.

This decision creates no parent package, changes no current package status, and authorizes no fixture extraction, UI/export implementation, dev-store creation/install or live mutation by itself.

## Official sources checked 7 October 2026

- [Shopify dev stores](https://shopify.dev/docs/apps/build/stores/development-stores)
- [Shopify generated test data](https://shopify.dev/docs/storefronts/themes/tools/development-stores/generated-data)
- [Install and test an app for review](https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review)
- [Test a deployed app on a dev store](https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service)
