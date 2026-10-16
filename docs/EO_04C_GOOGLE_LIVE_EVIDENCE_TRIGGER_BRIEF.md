# EO-04-C Google live evidence trigger analyst brief

## Status and authority

- Package: `A6-EO-04-C`
- Analyst brief accepted by product owner: **16 October 2026**
- Repository implementation authorized: **16 October 2026**
- Deployment and real Shopify Admin visual acceptance: **completed 16 October 2026**
- First live Google Ads request: **authorized and stopped on its first failure 16 October 2026**
- Safe failure logging correction: **authorized 16 October 2026**
- Single preflight access-token refresh: **authorized 16 October 2026**
- Successful complete empty live execution: **recorded 16 October 2026**
- Account/campaign context correction implementation: **authorized 16 October 2026**
- Account/campaign context correction production deployment: **completed 16 October 2026**
- Test-account review semantics: **accepted and repository implementation authorized 16 October 2026**
- Test-account review semantics repository verification: **289/289 tests, typecheck and production build passed 16 October 2026; deployment pending separate approval**
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

Before any query family starts, the request uses the stored refresh token exactly
once to obtain one temporary access token. A refresh failure stops the execution
with zero Google Ads query calls. A successful refresh is reused in memory for
every family and page in that execution; it is not persisted. There is no
refresh-after-401 path.

The button then starts these query families sequentially and stops at the first error:

1. `account_identity` (`FROM customer`);
2. `campaign_context` (`FROM campaign`);
3. `cart_data_product_sales_daily`;
4. `shopping_product_daily`;
5. `pmax_listing_tree_current`;
6. `pmax_asset_group_channel_daily`.

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
| Successful test-account demo | `Google test account verified. Read-only reporting queries completed: campaign context {count}; Cart Data {count}; product performance {count}; current listing tree {count}; PMax Asset Group performance {count}. Test accounts do not serve ads, so these results are not production performance evidence. Production validation remains pending Google Ads API Explorer access.` | None | Button reads `Google test account checked` and stays disabled |
| Success with production evidence | `Google evidence received.` followed by bounded row and Sales Role counts | None | Button reads `Google evidence received` and stays disabled |
| Successful empty evidence | `Google returned no product or PMax evidence in this execution. This is not zero or unsupported.` | None | Button reads `Google evidence received` and stays disabled |
| Provider or runtime error | `Google evidence stopped. No retry was performed. Error code: {code}` | None | Button reads `Google evidence stopped` and stays disabled |
| Reauthorization | Same stopped copy with the returned reauthorization code/class | Existing Google reconnect flow remains separate | No automatic OAuth restart |
| Cancel | Not applicable; the action has no modal, form or intermediate confirmation | None | No cancel control is invented |

## Shopify component mapping

| Visible element | Shopify component | Property / variant / tone | Official source | Checked |
|---|---|---|---|---|
| Existing Google section and stack | `s-section`, `s-stack` | Existing native layout | App Home web components | 2026-10-16 |
| Evidence action | `s-button` | `loading`; `disabled` after complete or failure | <https://shopify.dev/docs/api/app-home/latest/web-components/actions/button> | 2026-10-16 |
| Successful test-account result | `s-banner` | `tone="info"` | <https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/banner> | 2026-10-16 |
| Successful production result | `s-banner` | `tone="success"` | Same Banner reference | 2026-10-16 |
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

The first authorized live request proved an observability gap: the route returned
`GOOGLE_LIVE_EVIDENCE_FAILED`, while the server log contained no bounded failure
evidence. Failure logs must now record only the execution stage, query family,
safe source/provider code, provider HTTP status and whether a provider response
was observed. Raw error messages and identifiers remain prohibited. This
diagnostic record does not enable retry or start the next query family.

The successful production execution is retained at
`docs/evidence/EO_04C_GOOGLE_PROVIDER_LIVE_EVIDENCE_2026-10-16.json`. All five
families completed, but no provider rows were observed. This does not prove zero,
global unsupported behavior, Product ID support or Sales Role support.

The combined account/campaign query uses `FROM campaign`. When it returns no
campaign rows it also cannot expose `customer.test_account`; therefore the
selected account remains unclassified as test or production. Before another
live call, account identity must be read independently from `FROM customer` and
campaign inventory must remain a separate `FROM campaign` concern.

The product owner authorized this narrow correction on 16 October 2026. The
repository now reads account identity before campaign inventory. A successful
empty campaign inventory can therefore no longer suppress the selected
account's `customer.test_account` evidence. Exact commit
`53730bee401c79600570f199bd9967cf2d560c8a` was deployed to Production as
`dpl_GFNme3aUQUJ25723fwU3e7HU235p`. The deployment was `READY`, carried the
`embedded.adstable.app` alias, and its initial error/fatal scan was clean. This
deployment does not authorize another live request.

The separately authorized follow-up request successfully returned
`customer.test_account=true` for the selected Reporting Account. Google did not
return a provider error; the deployed runtime converted that successful account
classification into the internal
`GOOGLE_LIVE_EVIDENCE_TEST_ACCOUNT_NOT_ELIGIBLE` failure. The product owner
accepted a review-aligned correction on 16 October 2026: retain the separate
account identity query, classify the account as `test_observed`, complete the
same bounded read-only query families, and present their actual row counts as a
successful test-account demo result. The result never becomes production
serving evidence, Product ID support evidence, Sales Role support evidence or
Dataset V2 authority. The same runtime remains in place after review; connecting
a production account after Explorer access changes the observed account/data,
not the implementation path.

## Unchanged behavior and out of scope

- No Google campaign, account, budget, listing tree or conversion configuration
  mutation.
- No OAuth consent, scope, secret, environment or persisted credential mutation.
- The authorized preflight access-token refresh is temporary and request-scoped.
- No database write, Dataset V2 publication, scheduler or product identity mapping.
- No historical PMax Channel is resolved from the current listing tree.
- No additional live provider request is authorized by the safe logging correction.
- No additional live provider request is authorized by the account-context correction.
- No additional live provider request is authorized by the test-account review correction.
- Test-account rows or empty responses are never promoted to production serving evidence.
- No review-only branch, fabricated provider row or post-review runtime swap is introduced.
- The existing Meta evidence route and behavior remain unchanged.

## Acceptance plan

- Repository tests prove exact family order, 30 completed business dates,
  complete bounded pagination, first-error stop, no retry and safe summaries.
- Constitution guard, full tests, typecheck and build must pass.
- Deployment requires a separate product-owner approval.
- Desktop Shopify Admin and at least 320 px real mobile evidence are required
  before the UI can be accepted or merged.
- Any additional live request requires a separate explicit product-owner approval
  after the safe failure logging correction is deployed.

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
- Google Ads API v25 Customer fields: <https://developers.google.com/google-ads/api/fields/v25/customer>
- Google Ads API v25 Campaign fields: <https://developers.google.com/google-ads/api/fields/v25/campaign>
- Google Ads API access levels: <https://developers.google.com/google-ads/api/docs/api-policy/access-levels>
- Google OAuth restricted-scope verification: <https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification>
- Google Ads API policies and demo-account rule: <https://support.google.com/adspolicy/answer/6169371>
- Google Ads credential management: <https://developers.google.com/google-ads/api/docs/oauth/credential-management>
- Google Ads OAuth internals: <https://developers.google.com/google-ads/api/docs/oauth/internals>
