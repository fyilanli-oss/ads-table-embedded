# EO-04-C — Google OAuth account-selection handoff gate

**Control date:** 11 October 2026  
**Status:** Corrective lifecycle deployed; controlled Google and visual acceptance pending  
**Parent:** A6-EO-04-C

## Why this gate exists

The tested OAuth/REST client can exchange the callback code, encrypt the refresh token and discover Google Ads accounts. A secure cross-request bridge is still required between that callback and the later user choice of one to three advertiser accounts.

The encrypted credential envelope is bound to the claimed OAuth transaction, workspace, installation generation and provider through one durable server-side pending-selection authority. Passing the credential UUID through a URL, browser form or ordinary cookie remains forbidden because it would turn correlation data into authority and could orphan refresh-token ciphertext.

## Accepted design

1. The authenticated Shopify Admin begins OAuth with POST. The server creates state, PKCE and the transaction.
2. Google callback claims the one-time transaction and exchanges the code.
3. The refresh token is written only as versioned encrypted database ciphertext.
4. A durable server-side handoff links OAuth transaction, workspace, active installation generation, provider and credential envelope.
5. The browser receives only the transaction ID. It is correlation, never authorization.
6. Settings re-authenticates the Shopify Admin, resolves the handoff under the verified installed-shop authority and obtains a fresh provider account list.
7. The merchant selects one to three non-manager advertiser accounts; the first selected advertiser becomes the initial reporting account without a second setup prompt.
8. The server revalidates fresh Google evidence, atomically creates or reconnects the canonical provider connection and consumes the handoff.
9. Explicitly cancelled, superseded, revoked or installation-removed handoffs delete unreferenced encrypted credential envelopes.

No provider account evidence, refresh token, access token or credential ID is trusted from the browser. Manager accounts remain access paths only and are never reporting accounts.

## Database boundary

The table lives in private `integrations`, has forced RLS, no Data API/browser grant and is reachable by `adstable_runtime` only through narrow security-definer functions with an empty search path, fully qualified relations, row locks and explicit execute grants. A partial unique index enforces at most one `awaiting_selection` row per workspace/install-generation/provider. OAuth transaction expiry remains separate; account selection has no arbitrary timeout.

## Repository implementation result

The product owner accepted this gate on 11 October 2026. The repository now contains the private forced-RLS table migration, narrow SECURITY DEFINER functions, bounded orphan cleanup, database repository and server-only Google orchestration. Callback persistence keeps only the encrypted refresh-token payload; access tokens remain memory-only. Account discovery is repeated from Google and manager accounts cannot be selected as reporting accounts. Selection and connection establishment share one database transaction.

GitHub Actions run `38132951111` passed 211/211 tests, TypeScript verification and production build.

## Current authority

With separate explicit product-owner approvals, the base handoff migration and the corrective `installation_id` foreign-key index migration were applied to live Supabase on 11 October 2026. Forced RLS, owner-only policy, zero runtime table privileges, four narrow runtime functions and zero Security Advisor findings were verified. The corrective index returned unindexed-foreign-key findings to the preflight baseline; newly created zero-row indexes are expected to remain informationally unused until runtime traffic. Durable evidence: `docs/evidence/EO_04C_AUTHORIZATION_HANDOFF_LIVE_2026-10-11.json`. Routes are not wired, Vercel was not redeployed and no live Google OAuth or Ads request was sent.

## Corrective live result — 11 October 2026

Migration `20261011163811_eo04c_durable_selection_and_reconnect` is live. It deterministically retained the newest Google pending setup, marked the four older duplicates as `SUPERSEDED_BY_NEW_AUTHORIZATION`, removed only unreferenced credential ciphertext, and left one canonical pending setup. Duplicate pending groups are zero; the partial unique index and all five narrow runtime functions are present; Security Advisor reports zero findings.

Settings can now resolve the canonical pending setup without a URL transaction parameter. **Resume setup** refreshes Google evidence and opens account selection without OAuth. Google discovery matches the former working implementation: one `customer_client` query per directly accessible root, managers retained only as access paths, non-manager advertisers shown to the merchant.

Repository Governance run `38156170711` passed 233 tests, TypeScript and production build. Production deployment `dpl_J7Vb9w7mvcgffpUKrRJSUPxT1SLY` is READY on `embedded.adstable.app`. Controlled Google and real desktop/mobile acceptance remain open.

## Corrective parity decision — 11 October 2026

The successful OAuth exchange and the merchant's later account selection are separate states. OAuth state/PKCE keeps its bounded transaction lifetime. Pending account selection has no arbitrary ten-minute timeout; it persists until consumed, explicitly cancelled, revoked or removed with the Shopify installation. This restores the former working behavior while preserving encrypted-at-rest credentials, server-only authority and fresh Google discovery on every resume and save.
