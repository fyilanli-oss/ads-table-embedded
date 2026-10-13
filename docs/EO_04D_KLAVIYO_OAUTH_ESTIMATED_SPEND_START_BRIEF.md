# A6-EO-04-D Klaviyo OAuth and Estimated Email Spend Start Brief

Status: Accepted — implementation in progress  
Checked: 13 October 2026

Product-owner acceptance was received on 13 October 2026 after the OAuth,
single-account and effective-dated spend boundaries below were reviewed. This
acceptance authorizes repository implementation only; live provider-console,
Vercel, deployment and database-schema mutations remain separate gates.

## Official sources

- Klaviyo OAuth: https://developers.klaviyo.com/en/docs/set_up_oauth
- Klaviyo Get Accounts: https://developers.klaviyo.com/en/reference/get_accounts
- Klaviyo API overview and revisions: https://developers.klaviyo.com/en/v2026-07-15/reference/api_overview
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase changelog: https://supabase.com/changelog
- Shopify App Home 2.0 RC: https://shopify.dev/docs/api/app-home/v2.0-rc
- Shopify number field: https://shopify.dev/docs/api/app-home/latest/web-components/forms/number-field
- Shopify modal: https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal
- Shopify button: https://shopify.dev/docs/api/app-home/latest/web-components/actions/button

## Business outcome

The merchant connects exactly one provider-verified Klaviyo Account beneath the
immutable installed Shopify Store, confirms that account and records an
Estimated 30-Day Klaviyo Email Spend in the account's provider currency. The
merchant can later start a new effective spend period or correct the value of an
existing period without changing its date.

This package preserves the proven legacy product behavior while rebuilding it on
the new repository's EO-03 transaction, encrypted-token, provider-account and
connection-lifecycle foundations. Legacy source code and public-schema access
patterns are not copied.

## Accepted implementation boundary proposed by this brief

1. **Connect Klaviyo** opens a Shopify confirmation modal.
2. **Continue to Klaviyo** creates the server-owned OAuth transaction, generates
   an S256 PKCE verifier/challenge and navigates at the top level.
3. The callback consumes the one-time transaction, exchanges the code at
   `https://a.klaviyo.com/oauth/token`, encrypts the returned token set and moves
   the connection to pending account selection.
4. AdsTable calls `GET https://a.klaviyo.com/api/accounts/` with
   `accounts:read`. Exactly one valid account object is required.
5. OAuth return follows the accepted Meta/Google setup behavior: the account
   selection modal opens, and **Resume setup** reopens that same account step
   without restarting OAuth. The merchant must explicitly select the
   provider-returned account; AdsTable never silently assigns it.
6. **Continue** advances the same modal to a separate estimated-spend step. The
   account name, currency and timezone are then read-only. There is no Ad
   Account or Reporting Account concept for Klaviyo.
7. The second step collects **Estimated 30-Day Klaviyo Email Spend**.
   Currency is read-only and provider-authoritative. The initial effective date
   is the server-calculated business date in the verified account timezone.
8. **Save and connect** submits both the selected account ID and spend. The
   server reloads the pending credential, re-fetches the account list and rejects
   a missing or stale selection before it atomically persists the verified
   account, the initial
   spend period and the connected lifecycle state. Partial success is forbidden.
9. Dismissing either modal step preserves pending state. The next **Resume
   setup** always begins again at account selection.
10. Connected state exposes **Update spend**, **Change value** and
   revoke-first **Disconnect**.

## Estimated-spend ledger

Estimated spend is operational merchant configuration with its own effective-
dated ledger. It is not stored inside provider tokens or a reporting fact row.

The proposed private table is
`integrations.klaviyo_email_spend_periods` with these authoritative fields:

- `id`: immutable UUID primary key.
- `connection_id`: EO-03 provider connection foreign key.
- `account_id`: verified `integrations.provider_accounts` foreign key.
- `workspace_id` and `install_generation`: installed-shop authority boundary.
- `provider_account_id`: server-verified Klaviyo account identity.
- `source_currency`: verified three-letter Klaviyo account currency.
- `estimated_30_day_email_spend`: `numeric(10,2)`, from `0.00` through
  `99999999.99`.
- `effective_from`: verified-account-timezone business date.
- `provenance`: exact value `user_estimated`.
- `correction_version`: positive integer beginning at 1.
- `created_at` and `updated_at`: server timestamps.

There is exactly one entry per connection/account/effective start date. The
table lives in the private `integrations` schema, has RLS enabled and forced,
grants no browser, `anon`, `authenticated` or generic `service_role` access, and
is reachable only through narrowly granted `adstable_runtime` functions.

### Update spend

- Revalidate the current Klaviyo account, currency and timezone first.
- Compute the new effective date on the server from the account timezone.
- Insert a new ledger row; do not overwrite a previous period.
- Reject a duplicate effective start with `DUPLICATE_EFFECTIVE_START`.
- Use optimistic connection-version locking so reconnect/disconnect races fail
  closed.
- Preserve the accepted legacy Settings presentation exactly: the connected
  action is **Update spend**; the modal heading is **Update Klaviyo email
  spend**; its explanation is **Enter the new estimated Klaviyo email cost for
  the next 30-day period starting today. SMS costs are not included.**; the
  field label is **Estimated 30-Day Klaviyo Email Spend**; and the primary
  action is **Save new value**.

### Change value

- Target one existing ledger row by its immutable effective date.
- Change the amount only.
- Preserve account, currency and effective date.
- Increment `correction_version` and update the server timestamp.
- Reject a missing entry with `SPEND_HISTORY_ENTRY_NOT_FOUND`.
- The displayed current value is derived from the latest effective period; no
  second mutable current-cost authority is created.
- Preserve the accepted legacy Settings presentation exactly: **Change value**
  is one connected-state action rather than one action repeated beside every
  history row. Its modal heading is **Change Klaviyo email spend**; its
  explanation is **Change a previously saved amount. Its original start date
  will not change.**; the merchant chooses one **Saved period**; the selected
  period's amount pre-fills **Updated 30-Day Klaviyo Email Spend**; and the
  primary action is **Save change**.

## Input and authority rules

- Accepted textual amount: `0` or a non-negative decimal with at most eight
  integer digits and two fractional digits.
- Scientific notation, signs, commas, NaN, Infinity and more than two decimal
  places are rejected.
- `0.00` explicitly supports Klaviyo's free plan.
- Account ID, account name, currency, timezone and effective date are never
  accepted from merchant-authored hidden fields as authority.
- Currency and timezone must be freshly revalidated for initial completion and
  Update spend. Change value may only correct an existing server-owned period.
- SMS, MMS and WhatsApp cost are outside this email-spend input.

## Token and disconnect rules

- Authorization URL: `https://www.klaviyo.com/oauth/authorize`.
- Token and refresh URL: `https://a.klaviyo.com/oauth/token`.
- Revoke URL: `https://a.klaviyo.com/oauth/revoke`.
- PKCE method: exact `S256`.
- Authorization codes are treated as five-minute credentials.
- Token expiry follows `expires_in`; no fixed access-token lifetime is assumed.
- `invalid_grant` becomes reauthorization required.
- Refresh is bounded and never loops.
- Disconnect revokes the refresh token before clearing local active authority.
  Provider or network failure preserves the local connection and fails closed.
- Historical spend periods remain auditable after disconnect.

## Requested scopes

The proposed legacy-compatible scope set is:

- `accounts:read`
- `campaigns:read`
- `flows:read`
- `events:read`
- `metrics:read`

Only `accounts:read` is exercised by this OAuth/account/spend slice. The other
read scopes remain provisional until the subsequent Klaviyo reporting endpoint
contract proves each one necessary. No write scope is requested.

## User-visible state matrix

| State | Visible result | Action | Result |
| --- | --- | --- | --- |
| Loading | Klaviyo status is loading | none | duplicate actions disabled |
| Not connected | Klaviyo · Not connected | Connect | confirmation modal |
| Authorization | Continue to Klaviyo | Continue / Cancel | OAuth or unchanged state |
| Account selection required | Provider-returned Klaviyo account list | Continue / Cancel | separate spend step or pending |
| Estimated spend required | Selected account summary plus estimated spend field | Save and connect / Cancel | connected atomically or pending |
| Resume required | Setup incomplete | Resume setup | account selection modal; no OAuth restart |
| Connected | Connected account and `amount currency / 30 days` | Update spend / Change value / Disconnect | focused action |
| Reauthorization | Klaviyo authorization expired | Reconnect | fresh OAuth transaction |
| Provider error | Clear retryable provider message | Retry | no fabricated empty/success state |

## Shopify component mapping

| Need | Exact component and property |
| --- | --- |
| Page/provider section | `s-page`, `s-section`, `s-stack` |
| Status and errors | `s-badge`, `s-banner` |
| Actions | `s-button`; `loading` and `disabled` during submission |
| Confirmation/completion/history correction | `s-modal` |
| Explicit single-account selection | `s-choice-list`, `s-choice` |
| Estimated spend | `s-number-field`, `min=0`, `max=99999999.99`, `step=0.01`, `required`, currency `suffix` |
| Read-only account/currency/timezone | Shopify typography components inside the modal |

No raw form controls, custom CSS, literal visual tokens or `s-clickable` action
substitutes are permitted. Klaviyo uses the already accepted Meta/Google setup
pattern: callback state causes the account-selection modal to open, while
**Resume setup** is the user-triggered recovery path after dismissal. Account
selection and estimated spend are separate sequential views of the same modal;
they are never combined on one screen and no nested modal is introduced.

## Out of scope

- Campaign, Flow, Message or Variation reporting requests.
- Channel hierarchy and presentation rules.
- Recipient-weighted cost allocation or formula calculations.
- Reporting facts, backfill, scheduling, export or charts.
- Provider write operations.
- SMS, MMS or WhatsApp cost.
- Historical legacy-record carry or controlled reset tooling.
- Automatic activation of any 15 October Variation behavior.

## Acceptance and rollback

Implementation may start only after explicit product-owner acceptance of this
brief. Repository acceptance then requires deterministic OAuth, validation,
ledger, concurrency, revoke-first and UI-contract tests; typecheck; build; CI;
controlled database verification; desktop Shopify Admin evidence; real-mobile
Shopify Admin evidence; and explicit final product-owner acceptance.

Before live schema use, the migration must pass Supabase security and performance
advisors. Rollback disables the new Klaviyo actions and preserves the private
ledger and encrypted credentials; it does not delete auditable history.

## Live database gate — 13 October 2026

The product owner separately authorized the live Supabase migration. No new
secret, provider OAuth, provider API call, Vercel environment mutation or
deployment was included in this gate.

Migration `eo04d_klaviyo_spend_ledger` was applied to the healthy
`ads-table-embedded` Supabase project. Independent catalog checks verified the
private table owner, enabled and forced RLS, denied direct table privileges,
and function-only `adstable_runtime` access. Supabase Security Advisor remained
at zero findings and the package introduced no unindexed-foreign-key finding.

A rollback-scoped synthetic scenario passed atomic setup with initial spend,
configuration load, append, duplicate-date rejection, amount-only correction,
correction-version increment, disconnect and history preservation. The test
transaction rolled back and independent residue checks returned zero for every
synthetic workspace, installation, credential, connection, account, lifecycle
event and spend period. Durable evidence is
`docs/evidence/EO_04D_KLAVIYO_SPEND_LIVE_DATABASE_ACCEPTANCE_2026-10-13.json`.

This passes the database gate only. Environment values, deployment, live
Klaviyo OAuth, desktop/mobile Shopify acceptance, final product-owner acceptance
and merge remain open.


