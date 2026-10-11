# EO-04-C — Google OAuth account-selection handoff gate

**Control date:** 11 October 2026  
**Status:** Live database accepted; route wiring, deployment and controlled Google evidence pending  
**Parent:** A6-EO-04-C

## Why this gate exists

The tested OAuth/REST client can exchange the callback code, encrypt the refresh token and discover Google Ads accounts. A secure cross-request bridge is still required between that callback and the later user choice of one to three advertiser accounts.

Today the encrypted credential envelope is bound to workspace, installation generation and provider, but it is not bound to the claimed OAuth transaction through a short-lived pending-authorization record. Passing the credential UUID through a URL, browser form or ordinary cookie would turn correlation data into authority and would leave abandoned refresh-token ciphertext without a deterministic cleanup owner. Route wiring therefore stops here.

## Accepted design

1. The authenticated Shopify Admin begins OAuth with POST. The server creates state, PKCE and the transaction.
2. Google callback claims the one-time transaction and exchanges the code.
3. The refresh token is written only as versioned encrypted database ciphertext.
4. A ten-minute server-side handoff links OAuth transaction, workspace, active installation generation, provider and credential envelope.
5. The browser receives only the transaction ID. It is correlation, never authorization.
6. Settings re-authenticates the Shopify Admin, resolves the handoff under the verified installed-shop authority and obtains a fresh provider account list.
7. The merchant selects one to three non-manager advertiser accounts and one reporting account.
8. The server revalidates fresh Google evidence, atomically creates the provider connection and consumes the handoff.
9. Expired, failed or abandoned handoffs delete unreferenced encrypted credential envelopes.

No provider account evidence, refresh token, access token or credential ID is trusted from the browser. Manager accounts remain access paths only and are never reporting accounts.

## Database boundary

The proposed table lives in private `integrations`, has forced RLS, no Data API/browser grant and is reachable by `adstable_runtime` only through narrow security-definer functions with an empty search path, fully qualified relations, row locks, expiry checks and explicit execute grants. Required indexes cover the unique credential link, workspace/generation/provider/status lookup and pending expiry cleanup.

## Repository implementation result

The product owner accepted this gate on 11 October 2026. The repository now contains the private forced-RLS table migration, narrow SECURITY DEFINER functions, bounded orphan cleanup, database repository and server-only Google orchestration. Callback persistence keeps only the encrypted refresh-token payload; access tokens remain memory-only. Account discovery is repeated from Google and manager accounts cannot be selected as reporting accounts. Selection and connection establishment share one database transaction.

GitHub Actions run `38132951111` passed 211/211 tests, TypeScript verification and production build.

## Current authority

With separate explicit product-owner approvals, the base handoff migration and the corrective `installation_id` foreign-key index migration were applied to live Supabase on 11 October 2026. Forced RLS, owner-only policy, zero runtime table privileges, four narrow runtime functions and zero Security Advisor findings were verified. The corrective index returned unindexed-foreign-key findings to the preflight baseline; newly created zero-row indexes are expected to remain informationally unused until runtime traffic. Durable evidence: `docs/evidence/EO_04C_AUTHORIZATION_HANDOFF_LIVE_2026-10-11.json`. Routes are not wired, Vercel was not redeployed and no live Google OAuth or Ads request was sent.
