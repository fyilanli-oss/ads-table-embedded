# EO-04-C Google live evidence trigger analyst brief

## Status and authority

- Package: `A6-EO-04-C`
- Analyst brief accepted by product owner: **16 October 2026**
- Repository implementation authorized: **16 October 2026**
- Deployment: **not authorized**
- First live Google Ads request: **not authorized**
- Binding runtime contract: `contracts/eo-04c-google-reporting-runtime-v1.json`
- Trigger contract: `contracts/eo-04c-google-live-evidence-trigger-v1.json`

## User purpose and outcome

The connected merchant can start one bounded, read-only Google Ads evidence
execution from the existing Google Ads section in Settings. The execution answers
whether the selected production Reporting Account returns product performance,
Cart Data product sales and Sales Role evidence, current PMax listing-tree evidence,
and PMax Asset Group performance.

The result is evidence only. It never publishes Dataset V2 facts and never treats
an empty response as zero or globally unsupported.

## Exact execution

The button starts these query families sequentially and stops at the first error:

1. `account_campaign_context`;
2. `cart_data_product_sales_daily`;
3. `shopping_product_daily`;
4. `pmax_listing_tree_current`;
5. `pmax_asset_group_channel_daily`.

The dated families use the last 30 completed business dates in the Reporting
Account timezone. All pages are read before an execution is complete. Pagination
is bounded; reaching a safety limit fails the execution instead of publishing a
partial result. There is no retry, endpoint fallback, API-version fallback or
authentication fallback.

## State matrix and exact copy

| State | Visible copy | Action | Expected result |
|---|---|---|---|
| Not connected / setup incomplete | Existing Google connection/setup controls only | None | Evidence action is unavailable |
| Connected / idle | `Run Google evidence` | Press once | Starts one read-only execution |
| Loading | `Reading Google evidence…` | No second action | Native loading state prevents duplicate submission |
| Success with evidence | `Google evidence received.` followed by bounded row and Sales Role counts | None | Button reads `Google evidence received` and stays disabled |
| Successful empty evidence | `Google returned no product or PMax evidence in this execution. This is not zero or unsupported.` | None | Button reads `Google evidence received` and stays disabled |
| Provider or runtime error | `Google evidence stopped. No retry was performed. Error code: {code}` | None | Button reads `Google evidence stopped` and stays disabled |
| Reauthorization | Same stopped copy with the returned reauthorization code/class | Existing Google reconnect flow remains separate | No automatic OAuth restart |
| Cancel | Not applicable; the action has no modal, form or intermediate confirmation | None | No cancel control is invented |

## Shopify component mapping

| Visible element | Shopify component | Property / variant / tone | Official source | Checked |
|---|---|---|---|---|
| Existing Google section and stack | `s-section`, `s-stack` | Existing native layout | App Home web components | 2026-10-16 |
| Evidence action | `s-button` | `loading`; `disabled` after complete or failure | <https://shopify.dev/docs/api/app-home/latest/web-components/actions/button> | 2026-10-16 |
| Successful result | `s-banner` | `tone="success"` | <https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/banner> | 2026-10-16 |
| Empty result | `s-banner` | `tone="warning"` | Same Banner reference | 2026-10-16 |
| Failure result | `s-banner` | `tone="critical"` | Same Banner reference | 2026-10-16 |

No raw HTML action control, custom CSS, inline style, literal color, modal, date
input, new section or `s-clickable` is introduced. Desktop and mobile use the
same native block stack and Shopify's responsive behavior.

## Safe result boundary

The browser and server log may receive only bounded summaries:

- reporting window and timezone;
- row counts and observation states by query family;
- field-presence counts for accepted product and sales fields;
- `Advertised`, `Cross-sell`, `Assisted` and `Unclassified` counts;
- the statement that current listing-tree evidence does not resolve historical
  Channel without versioned full-day evidence.

Raw provider rows, names, product IDs, campaign IDs, account IDs, tokens,
credentials, cursors and provider request IDs are not exposed or logged.

## Unchanged behavior and out of scope

- No Google campaign, account, budget, listing tree or conversion configuration
  mutation.
- No OAuth, scope, token, secret or environment mutation.
- No database write, Dataset V2 publication, scheduler or product identity mapping.
- No historical PMax Channel is resolved from the current listing tree.
- No deployment and no live provider request under this authorization.
- The existing Meta evidence route and behavior remain unchanged.

## Acceptance plan

- Repository tests prove exact family order, 30 completed business dates,
  complete bounded pagination, first-error stop, no retry and safe summaries.
- Constitution guard, full tests, typecheck and build must pass.
- Deployment requires a separate product-owner approval.
- Desktop Shopify Admin and at least 320 px real mobile evidence are required
  before the UI can be accepted or merged.
- The first live request requires a separate explicit product-owner approval
  after deployment and visual acceptance.

## Official sources

Checked 16 October 2026:

- Shopify Button: <https://shopify.dev/docs/api/app-home/latest/web-components/actions/button>
- Shopify Banner: <https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/banner>
- Shopify Polaris 2 migration: <https://shopify.dev/docs/apps/build/app-home/polaris2>
- Shopify web-component versioning: <https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/versioning>
- Google Ads API test accounts: <https://developers.google.com/google-ads/api/docs/best-practices/test-accounts>
- Google Ads API v25 Cart Data Sales View: <https://developers.google.com/google-ads/api/fields/v25/cart_data_sales_view>
- Google Ads API PMax listing groups: <https://developers.google.com/google-ads/api/performance-max/listing-groups>
- Google Ads Query Language: <https://developers.google.com/google-ads/api/docs/query/overview>
