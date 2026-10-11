# A6-EO-04-C Google Ads OAuth Corrective Rebuild

Status: implementation contract  
Checked: 2026-10-11

## Official sources

- Google Ads API OAuth overview: https://developers.google.com/google-ads/api/docs/oauth/overview
- Google OAuth 2.0 web-server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Google Ads API access model: https://developers.google.com/google-ads/api/docs/oauth/access-model
- Google Ads API call structure: https://developers.google.com/google-ads/api/docs/concepts/call-structure
- Shopify authentication and authorization: https://shopify.dev/docs/apps/build/authentication-authorization
- Shopify App Home: https://shopify.dev/docs/api/app-home/latest
- Shopify Polaris 2.0 migration: https://shopify.dev/docs/apps/build/app-home/polaris2

## Corrective decision

The browser URL, Settings UI and reporting runtime MUST NOT depend on a Google setup reference, authorization handoff identifier or a second reporting-account concept.

There is one canonical Google Ads provider connection for the active Shopify installation generation. OAuth state is a short-lived, server-owned transaction used only to return the authorization result to that installation. After callback, all resumable state is read from the canonical provider connection.

The old working product flow is the behavioral reference:

1. The merchant selects **Connect Google Ads**.
2. Google OAuth opens through Shopify-supported navigation.
3. The callback stores the encrypted credential on the canonical connection with status `pending_account_selection`.
4. Settings reads that status and opens the advertiser-account selector.
5. The merchant selects one to three eligible advertiser accounts. Every selected account is equally authorized for AdsTable reporting; there is no second or hidden reporting-account choice.
6. **Save and connect** re-verifies the selected advertisers and changes the canonical connection to `connected`.
7. **Resume setup** opens only the account selector. It MUST NOT restart OAuth while the pending credential is valid.
8. **Disconnect** removes reporting authority, account bindings and the credential, then returns to a clean Settings URL.
9. Reconnect starts a fresh OAuth transaction from `disconnected`.

Manager accounts are traversal/login context only. They are never selectable reporting accounts and never appear as advertiser choices.

Only `connected` grants reporting authority. Every other state fails closed.

## State and action matrix

| Canonical state | Merchant sees | Allowed action | Forbidden behavior |
| --- | --- | --- | --- |
| no connection / `disconnected` | Google Ads, Not connected | Connect Google Ads | Loading accounts without OAuth |
| OAuth transaction in progress | Leaving AdsTable for Google | Cancel at Google / return | Creating reporting authority |
| `pending_account_selection` | Advertiser account selector | Save and connect, Cancel setup | Restarting OAuth from Resume setup |
| `connected` | Connected advertiser accounts | Change selection, Disconnect | Treating a manager or a hidden first account as reportable authority |
| `reauthorization_required` | Reauthorization required | Reconnect | Reusing invalid credential |
| disconnect confirmation | Shopify modal | Confirm disconnect, Cancel | URL-bound setup validation |
| `disconnected` after confirmation | Not connected | Connect Google Ads | Retaining credential or active bindings |
| provider/runtime error | Stable error banner and error code | Retry the failed bounded step | Silent loop or fabricated success |

## Shopify UI mapping

The Settings surface remains on Polaris 2.0 RC (`polaris-2.0-rc.js`, types `2.0.0-rc.2`).

| Need | Exact Shopify component |
| --- | --- |
| Page and section structure | `s-page`, `s-section`, `s-stack` |
| Status | `s-badge` |
| Errors and required action | `s-banner` |
| Connect, save, disconnect, retry | `s-button` |
| Account selection | `s-modal` with `s-choice-list` / `s-choice` after property verification |
| Provider authorization navigation | Shopify App Bridge Navigation API |

No raw HTML form control, custom button/card/modal imitation, inline CSS, literal color, shadow, border or radius is permitted.

## Acceptance gates

- No `google_setup`, handoff ID or equivalent browser query parameter exists.
- OAuth callback cannot bind to a workspace supplied by the browser; it consumes a server-owned transaction.
- A valid pending credential survives a Settings reload and resumes at account selection.
- Manager accounts are absent from selectable choices.
- Selection accepts one to three unique eligible advertiser accounts and grants equal reporting authority to all selected accounts.
- Repeating Save and connect is idempotent or returns a stable conflict; it never loops.
- Disconnect succeeds once, clears credential/accounts/binding and redirects to clean Settings.
- Refresh after disconnect remains disconnected and produces no setup-reference error.
- Reconnect requires a fresh OAuth transaction.
- Desktop and real mobile Shopify Admin acceptance remain mandatory before merge.
- No production deployment or database migration is part of this implementation commit.
