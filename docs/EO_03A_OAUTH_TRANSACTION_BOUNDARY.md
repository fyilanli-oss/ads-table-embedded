# EO-03-A — OAuth transaction boundary

**Control date:** 9 October 2026  
**Status:** Verification — repository CI passed; product-owner closure pending  
**Parent:** A6-EO-03 — Canonical OAuth, connection and token vault

## Analyst result

EO-03-A creates one provider-neutral, server-owned authorization transaction before Meta, Google Ads or Klaviyo can redirect the merchant away from AdsTable.

The transaction belongs to the already verified AdsTable workspace and installed Shopify generation. A callback cannot choose a workspace, store or reporting account. It can only complete the exact unexpired transaction that AdsTable created.

This package does **not** connect a live provider, store a provider token or select a reporting account.

## Official documentation checked

Checked on 9 October 2026:

### Meta

- Manual Facebook Login flow, updated 30 June 2026:  
  https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow
- The redirect URI is configured in the app dashboard.
- `state` is returned unchanged and is required for CSRF protection.
- Server-handled authorization uses `response_type=code`.
- Code exchange is server-to-server because it requires the app secret.
- The app secret must never enter client code.
- Returned access tokens must be inspected and verified for the expected app/user before use.

### Google

- OAuth 2.0 web-server flow:  
  https://developers.google.com/identity/protocols/oauth2/web-server
- OAuth security and credential storage practices:  
  https://developers.google.com/identity/protocols/oauth2/resources/best-practices
- Redirect URI matching is exact.
- A cryptographically random `state` value must be verified.
- Client secrets stay outside source code and public clients.
- Offline access is requested only where background refresh is needed.
- Scopes are least-privilege and requested in context.
- Tokens must be encrypted at rest and revoked/deleted when no longer needed.

### Klaviyo

- OAuth setup:  
  https://developers.klaviyo.com/en/v2026-01-15/docs/set_up_oauth
- Authorization Code flow with PKCE S256 is required.
- Every authorization request uses a unique verifier/challenge pair.
- Redirect URI must exactly match an allowlisted URI.
- Authorization code lifetime is five minutes.
- Token and revoke endpoints use `https://a.klaviyo.com/oauth/token` and `https://a.klaviyo.com/oauth/revoke`.
- Client secret and code exchange remain server-side.
- Access and refresh tokens are account-scoped; expiry is taken from `expires_in`, not a hard-coded assumption.

### Shopify request authority

- ID token authentication:  
  https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens
- The initiating request must resolve to the verified installed Shopify shop and workspace before an OAuth transaction can be created.

## Canonical flow

1. A Shopify Admin request reaches the server.
2. AdsTable verifies the Shopify ID token and resolves the installed shop, workspace and current installation generation.
3. The server checks that the requested provider is supported and that the callback URI is the fixed allowlisted URI for that provider and environment.
4. The server creates:
   - a cryptographically random opaque state value;
   - a separate transaction nonce;
   - a PKCE verifier/challenge when required by the provider;
   - an absolute expiry timestamp.
5. Only the digest of the public state value is persisted. Any recoverable verifier material is reserved for the EO-03-B encrypted envelope and cannot be written in plaintext.
6. The browser is redirected to the provider with only the provider-supported public authorization parameters.
7. The callback hashes the returned state and atomically claims the matching transaction.
8. The transaction must be unexpired, unused, provider-matching, workspace-owned and tied to the still-current installation generation.
9. Provider denial or callback error closes the transaction truthfully without creating a connection.
10. Successful validation hands an in-memory authorization code to the provider-specific server exchange boundary. The raw code is not persisted.
11. A transaction is single-use. Replay, concurrent double callback or cross-provider substitution fails closed.

## State machine

`created → redirected → claimed → exchanged`

Terminal alternatives:

- `denied`
- `expired`
- `invalidated`
- `failed`

No terminal transaction can be reused.

## Proposed internal limits

- Transaction TTL: 10 minutes.
- Klaviyo code exchange must additionally honor Klaviyo’s five-minute code lifetime.
- State values: at least 256 bits of CSPRNG entropy.
- PKCE: S256 only; no `plain` fallback.
- Callback origins and paths: environment-specific static allowlist; no caller-supplied redirect.
- Retention: security metadata only after terminal completion; no authorization code, token or plaintext verifier.

## Fail-closed matrix

| Condition | Result |
|---|---|
| Missing/unknown state | Reject; no provider exchange |
| Expired state | Mark expired; reject |
| Already claimed state | Reject replay |
| Wrong provider callback | Reject substitution |
| Installation generation changed | Invalidate; merchant restarts authorization |
| Callback URI outside allowlist | Reject before redirect or exchange |
| Provider denied consent | Record denial reason class; no connection |
| PKCE required but verifier unavailable | Reject; no downgrade |
| EO-03-B vault unavailable | Do not start live authorization |
| Client secret unavailable | Do not start live authorization |

## Data boundary

EO-03-A may introduce an `integrations.oauth_transactions` record, but it cannot hold plaintext provider secrets, tokens, authorization codes or PKCE verifiers. Runtime access is function-only and workspace identity is derived from the verified Shopify session rather than request input.

The encrypted verifier field and all provider token envelopes remain disabled until EO-03-B establishes the key/version/startup guard.

## Scope

Included:

- provider-neutral transaction state machine;
- workspace/install-generation ownership;
- state digest, nonce, TTL, single-use claim;
- provider/environment callback allowlist;
- provider capability flags for PKCE;
- denial, expiry and replay semantics;
- negative tests and contract evidence.

Excluded:

- live Meta/Google/Klaviyo authorization;
- creation or entry of client secrets;
- provider token exchange and persistence;
- token refresh, revoke and disconnect;
- reporting-account discovery or selection;
- UI acceptance;
- Vercel or provider-console mutation.

## Acceptance gate

EO-03-A can be accepted only when:

1. the schema, runtime service and executable contract implement the same state machine;
2. state/replay/provider/workspace/generation tamper tests pass;
3. no secret or authorization code is persisted or logged;
4. callback URIs are static and exact;
5. live OAuth remains disabled until EO-03-B startup guard passes;
6. repository tests/build/CI pass;
7. product owner explicitly closes the child.


## Technical implementation — 9 October 2026

Repository implementation now contains:

- private, forced-RLS `integrations.oauth_transactions`;
- function-only runtime access; browser, service-role and runtime table access are revoked;
- exact production callback mapping derived by provider, never from request input;
- 256-bit public state whose SHA-256 digest alone is persisted;
- independent 256-bit transaction nonce;
- S256 PKCE for Google Ads and Klaviyo, with recoverable verifier material delegated to the EO-03-B vault interface;
- atomic single-use callback claim bound to the same active Shopify installation generation;
- denial, expiry, replay, provider-substitution and installation-change failure semantics;
- authorization code kept only in the in-memory exchange context;
- installation foreign key with `ON DELETE CASCADE`, placing this new workspace-associated security family inside the established privacy deletion path before use.

Implementation files:

- `supabase/migrations/20261009170000_eo03a_oauth_transaction_boundary.sql`
- `app/lib/database/oauth-transaction-repository.server.js`
- `app/lib/oauth/oauth-transaction.server.js`
- `tests/eo-03a-oauth-transaction-boundary.test.js`

No route invokes this boundary yet. No provider console, Vercel environment or live Supabase database was changed. Live authorization remains structurally blocked until EO-03-B supplies and proves the encrypted verifier/token vault startup guard.


## Repository verification

GitHub Actions run `37907571603` passed the full Repository Governance job on 9 October 2026:

- frozen dependency graph: PASS;
- repository governance tests: PASS;
- TypeScript contracts: PASS;
- preview-shell build: PASS.

This evidence verifies repository behavior only. It does not authorize or claim a live Supabase migration, provider configuration, Vercel secret change or live OAuth connection.


## Live-schema preflight — 9 October 2026

Read-only Supabase preflight ran before any live DDL:

- target project `ads-table-embedded` / `podpwkrpmjiksskxhwsu` is `ACTIVE_HEALTHY`;
- PostgreSQL is `17.11.0.003`;
- latest live migration is `20261009075721_eo02d_worker_conditional_expression_fix`;
- no `integrations.oauth_transactions` collision exists;
- live `shopify.installations.id` is `bigint`.

The preflight found the repository migration had declared `installation_id` as `uuid`. The live database was not changed. The pending migration was corrected to `bigint` and a regression assertion now locks this compatibility before the live migration gate.


## First live migration attempt — fail-safe result

The first authorized live migration attempt stopped with PostgreSQL SQLSTATE `42501` before any schema or data change. The whole migration transaction rolled back.

EO-02-A had already created and secured the `integrations` schema under `adstable_owner`. EO-03-A redundantly attempted `CREATE SCHEMA IF NOT EXISTS` after switching to the restricted owner role; PostgreSQL still required database-level create permission for that statement.

Correction: EO-03-A now reuses the constitutional EO-02-A foundation schema and creates no schema. A regression assertion forbids `CREATE SCHEMA` in this child migration. No privilege was broadened and no live workaround was applied.
