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

The browser URL and Settings UI MUST NOT depend on a Google setup reference or authorization handoff identifier. The connected-account set and the single Reporting Account are distinct canonical authorities.

There is one canonical Google Ads provider connection for the active Shopify installation generation. OAuth state is a short-lived, server-owned transaction used only to return the authorization result to that installation. After callback, all resumable state is read from the canonical provider connection.

The old working product flow is the behavioral reference:

1. The merchant selects **Connect Google Ads**.
2. Google OAuth opens through Shopify-supported navigation.
3. The callback stores the encrypted credential on the canonical connection with status `pending_account_selection`.
4. Settings reads that status and opens the advertiser-account selector.
5. The merchant selects one to three eligible advertiser accounts. These accounts form the connected-account set; exactly one of them must be the Reporting Account.
6. With one selected advertiser, **Save and connect** makes that sole advertiser the Reporting Account and changes the canonical connection to `connected`.
7. With two or three selected advertisers, **Save and connect** persists the verified connected-account set but keeps the canonical connection pending. The Reporting Account modal opens automatically, shows only that selected set, requires exactly one explicit choice, and **Save and finish** creates the initial binding and changes the connection to `connected`.
8. On callback return, pending account selection automatically opens the correct incomplete step. Dismissing either modal preserves the pending credential and staged selection. **Resume setup** reopens the account modal before connected accounts are staged, or the Reporting Account modal after a multi-account set is staged; it MUST NOT restart OAuth.
9. A connected merchant may change the single Reporting Account from the connected-account set without OAuth. Provider access is revalidated; failure preserves the previous binding.
10. **Disconnect** first revokes the Google OAuth grant with the encrypted refresh token. Only a provider `revoked` or `already_invalid` result permits removal of reporting authority, account bindings and the credential. A provider/network failure preserves the connected state and fails closed.
11. Reconnect starts a fresh OAuth transaction from `disconnected`.

Manager accounts are traversal/login context only. They are never selectable reporting accounts and never appear as advertiser choices.

Only `connected` grants reporting authority. Every other state fails closed.

## State and action matrix

| Canonical state | Merchant sees | Allowed action | Forbidden behavior |
| --- | --- | --- | --- |
| no connection / `disconnected` | Google Ads, Not connected | Connect Google Ads | Loading accounts without OAuth |
| OAuth transaction in progress | Leaving AdsTable for Google | Cancel at Google / return | Creating reporting authority |
| `pending_account_selection` before connected accounts are staged | Advertiser selector opens automatically; after dismissal, Resume setup remains | Save and connect, dismiss modal, Resume setup | Restarting OAuth or deleting the pending credential from Cancel/Resume |
| `pending_account_selection` after 2–3 connected accounts are staged | Reporting Account selector opens automatically; after dismissal, Resume setup remains | Select exactly one, Save and finish, dismiss modal, Resume setup | Automatically choosing the first account or granting reporting authority before explicit choice |
| `connected` | Connected advertiser accounts and exactly one Reporting Account | Change Reporting Account, Disconnect | Reporting from every connected account or restarting OAuth for preference changes |
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
- A valid pending credential survives a Settings reload and automatically opens account selection.\n- Modal Cancel only dismisses the selector; it does not delete the pending credential or restart OAuth.\n- Resume setup revalidates the existing pending account list and reopens the selector without OAuth.
- Manager accounts are absent from selectable choices.
- Selection accepts one to three unique eligible advertiser accounts, but exactly one Reporting Account grants view authority.
- One connected account becomes the Reporting Account automatically.
- Two or three connected accounts remain pending until the merchant explicitly chooses one Reporting Account from that selected set and uses Save and finish.
- Cancel preserves the incomplete step; Resume opens the correct selector without OAuth.
- A connected Reporting Account can be changed without OAuth only after provider access is revalidated; failure preserves the previous binding.
- Repeating Save and connect or Save and finish is idempotent or returns a stable conflict; it never loops.
- Disconnect sends the refresh token to Google’s official revocation endpoint before any local lifecycle mutation.\n- Provider `revoked` or `already_invalid` evidence permits local cleanup; every other revoke failure preserves credential/accounts/binding and returns a stable error.\n- Successful disconnect clears credential/accounts/binding and redirects to clean Settings.
- Refresh after disconnect remains disconnected and produces no setup-reference error.
- Reconnect requires a fresh OAuth transaction.
- Desktop and real mobile Shopify Admin acceptance remain mandatory before merge.
- No production deployment or database migration is part of this implementation commit.
