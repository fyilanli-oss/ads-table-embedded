# A6-EO-04-D Klaviyo review-safe foundation brief

**Status:** Accepted for repository implementation

**Checked:** 17 October 2026

**Product-owner approval:** “Onaylıyorum” — 17 October 2026

## Analyst outcome

AdsTable's existing Klaviyo OAuth, single-account, encrypted-token and estimated
email-spend foundation remains authoritative. This corrective package makes that
foundation safe for a real customer installation and the later Klaviyo
Marketplace review. It does not start reporting collection and does not submit
the app for review.

## Current official sources

- [Make API calls using OAuth](https://developers.klaviyo.com/en/docs/set_up_oauth)
- [Handle your app's OAuth flow](https://developers.klaviyo.com/en/docs/handle_your_apps_oauth_flow)
- [Submit your app for review](https://developers.klaviyo.com/en/docs/submit_your_app_for_review)
- [Klaviyo changelog](https://developers.klaviyo.com/en/docs/changelog_)
- [Shopify React Router admin authentication](https://shopify.dev/docs/api/shopify-app-react-router/latest/guide-admin)
- [Shopify App Home text field](https://shopify.dev/docs/api/app-home/latest/web-components/forms/text-field)
- [Shopify App Home button](https://shopify.dev/docs/api/app-home/latest/web-components/actions/button)

The sources above were checked on 17 October 2026. Klaviyo's stable API revision
for this package is `2026-10-15`. Beta Applications API endpoints are not used.

## User and business outcome

1. A merchant can begin Klaviyo installation either from AdsTable Settings or
   from Klaviyo.
2. A Klaviyo-origin installation asks only for the canonical
   `.myshopify.com` domain needed to locate the Shopify-hosted app.
3. Merchant-entered text never creates, selects or switches a workspace. Shopify
   authentication, verified Admin identity and the active installation remain
   the only authority.
4. After Shopify authentication the merchant proceeds directly to Klaviyo OAuth;
   no second AdsTable Connect click is required.
5. A denied permission request, expired five-minute authorization code,
   invalid authorization and insufficient permission are distinct states.
6. A provider failure is never converted into success, empty data or an
   automatic repeat of the failed provider request.

## OAuth and error decisions

- Authorization remains `https://www.klaviyo.com/oauth/authorize`.
- Token and revoke traffic remains on `https://a.klaviyo.com`.
- S256 PKCE and the accepted five read-only scopes remain mandatory.
- New token envelopes retain the provider expiry as an exact ISO timestamp.
- Before an account/reporting request, an expired, near-expiry or legacy token
  without expiry metadata is refreshed once as the initial credential operation.
- A successful proactive refresh is persisted before the account request so a
  rotating refresh token is never discarded.
- No failed Accounts request is followed by refresh and a repeated Accounts
  request.
- `401` means the authorization is no longer usable. Connected lifecycle
  authority becomes `reauthorization_required`; the failed request is not
  retried.
- `403` means permission denied. It is not treated as token expiry, is not
  refreshed and is not retried.
- Refresh `invalid_grant` is stable provider evidence that the installation is
  no longer usable. Connected lifecycle authority becomes
  `reauthorization_required` and Settings must not display Connected.
- Authorization-code `invalid_grant` is an expired/invalid setup session, not a
  connected-account uninstall signal.
- Any other explicit or unexplained provider failure stops at the first result.

## Klaviyo-origin installation transport

`/auth/klaviyo/install` is the public installation entry URL later supplied to
Klaviyo. It is an authentication transport, not a fourth product surface.

- It collects one value: **Shopify store domain**.
- Exact supporting text: **Enter the .myshopify.com domain of the Shopify store
  where AdsTable is installed.**
- Placeholder: **store-name.myshopify.com**
- Invalid input: **Enter a valid .myshopify.com store domain.**
- Primary action: **Continue to Shopify**
- The normalized domain is used only to construct the Shopify Admin app URL.
- `/auth/klaviyo/start` must pass `authenticate.admin`, verified Shopify Admin
  identity and active-installation resolution before it creates an OAuth
  transaction.
- The verified installation, never the typed domain, owns the OAuth transaction.
- After verification, the route redirects at the top level directly into the
  Klaviyo authorization flow.

The future Klaviyo console mutation that registers the installation URL is a
separate explicit approval gate.

## State matrix

| State | Exact visible result | Action | Result |
| --- | --- | --- | --- |
| Klaviyo-origin entry | Connect AdsTable to Klaviyo; store-domain instruction | Continue to Shopify | Shopify login/install/authentication route |
| Invalid store domain | Enter a valid .myshopify.com store domain. | Correct and continue | No workspace or OAuth transaction exists |
| Starting | Continuing to Shopify… | none | Duplicate action prevented |
| Permission denied | Klaviyo setup was cancelled. No account was connected. | Connect Klaviyo | A later explicit retry can start a new transaction |
| Expired setup session | This Klaviyo setup session expired. Start Klaviyo setup again. | Restart Klaviyo setup | A new transaction begins only on click |
| Permission failure | Klaviyo did not grant the required read-only permissions. No connection was changed. | Restart Klaviyo setup | A new transaction begins only on click |
| Authorization invalid | Klaviyo authorization is no longer valid. Reconnect to continue. | Reconnect Klaviyo | Connected authority remains unavailable until fresh OAuth |
| Other provider error | Klaviyo could not be connected. Try again. If the problem continues, share the safe error code. | Explicit retry | No automatic provider retry |
| Connected | Existing accepted account and spend presentation | Existing actions | Existing behavior remains |

## Shopify component mapping

| Visible need | Exact component | Properties | Official source | Checked |
| --- | --- | --- | --- | --- |
| Public installation transport | `s-page`, `s-section`, `s-stack` | native layout | App Home web components | 17 October 2026 |
| Store identifier | `s-text-field` | `label`, `placeholder`, `required`, `autocomplete`, `maxLength`, `error` | Text field | 17 October 2026 |
| Continue action | `s-button` | `variant="primary"`, `loading` | Button | 17 October 2026 |
| Exact provider states | existing `s-banner`, `s-badge` | `tone="critical"` or warning state already accepted | App Home web components | 17 October 2026 |

There is no raw HTML action control, custom CSS, literal color, custom Shopify
look, nested modal or `s-clickable` action substitute. Desktop and mobile use
the same natural Polaris layout.

## Unchanged behavior

- Installed Shopify Store remains immutable authority.
- Exactly one provider-verified Klaviyo Account is required.
- Account selection and estimated spend remain separate steps.
- Estimated-spend history and its private database contract do not change.
- Disconnect remains revoke-first and historical spend is preserved.
- The accepted Channel and Sales Role contracts do not change.

## Out of scope

- Campaign, Flow, Events or reporting runtime
- Dataset V2, scheduling, reconciliation or cost allocation
- Klaviyo Applications API beta endpoints
- Klaviyo console, redirect URL, installation URL or Marketplace mutation
- Live OAuth or live provider request
- Secret, Vercel environment, deployment or database-schema mutation
- Marketplace assets, five-customer evidence or review submission

## Acceptance plan

- Deterministic contract, token, error and installation-entry tests
- Existing OAuth/spend regression tests
- Complete repository test suite
- Typecheck and production build
- CI after PR creation
- Desktop and real-mobile visual acceptance before merge because visible copy and
  an installation transport screen changed
- Explicit product-owner merge approval
