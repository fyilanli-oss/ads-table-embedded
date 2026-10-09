# EO-03-B — Token envelope and startup guard

**Control date:** 9 October 2026  
**Status:** Accepted — repository, live database, production startup and product-owner gates passed  
**Parent:** A6-EO-03 — Canonical OAuth, connection and token vault

## Analyst result

EO-03-B ensures that a recoverable OAuth PKCE verifier or future provider token set is never stored as readable database text. AdsTable encrypts the value server-side, binds it to the exact workspace, Shopify installation generation, provider, purpose and record, and persists only the authenticated ciphertext envelope.

Before a provider authorization can begin, the runtime must prove that the database contract is the expected version, every key version already used by stored records is still available, the active provider-token key exists and differs from the Shopify session key, and an authenticated-encryption self-test succeeds. Any failure stops authorization rather than falling back to plaintext, another key or an unverified store.

The accepted package provisions the dedicated production key, applies the approved Supabase migrations and verifies the production startup guard. It still does not connect a provider, carry a real provider token or authorize live provider OAuth.

## Official documentation checked

Checked on 9 October 2026:

- Node.js Crypto — authenticated encryption, `createCipheriv`, `setAAD`, `getAuthTag` and `setAuthTag`:  
  https://nodejs.org/api/crypto.html
- Supabase Database Security — private schemas, RLS and database-function security boundary:  
  https://supabase.com/docs/guides/database/database-security
- Supabase Vault — currently public alpha and exposes a decrypted view to sufficiently privileged database actors:  
  https://supabase.com/docs/guides/database/vault
- Supabase pgcrypto deprecation/migration guidance — PostgreSQL 17 change concerns legacy `pgcrypto` encryption functions; EO-03-B uses application-level Node AES-GCM instead:  
  https://supabase.com/docs/guides/troubleshooting/pgcrypto-deprecation-and-data-migration-guide
- Vercel environment variables — sensitive server-only environment values and environment scoping:  
  https://vercel.com/docs/environment-variables

## Security decision

### Root key

- The provider-token root key is a dedicated 32-byte random key.
- It is not the Shopify session-encryption key and reuse is rejected.
- Production values live only as Vercel Sensitive environment variables.
- The database never stores or returns a root key.
- The active version is selected by `ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION`.
- Key material uses `ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V<n>`.
- New writes use the active version; old versions remain readable until every envelope has been rotated.

Supabase Vault is not the primary key store because its current public-alpha and decrypted-view model would not improve this product's separation of duties.

### Envelope

- Algorithm: AES-256-GCM.
- Nonce: 12 random bytes per envelope.
- Authentication tag: 16 bytes.
- Associated data binds contract version, key version, record ID, workspace ID, installation generation, provider and purpose.
- Moving ciphertext to another tenant, generation, provider, purpose or record makes authentication fail.
- Decryption failures return a generic vault-authentication error; secret material is not logged.

## Database model

### PKCE envelopes

`integrations.oauth_pkce_envelopes` stores only ciphertext metadata for Google Ads and Klaviyo PKCE verifiers.

The record is bound one-to-one to the OAuth transaction and exact active Shopify installation authority. After EO-03-A atomically claims the callback, EO-03-B atomically validates and deletes the envelope while returning it to the server. A second take returns nothing. Expired or authority-mismatched records are not returned.

### Provider credential envelopes

`integrations.provider_credential_envelopes` is the ciphertext-only persistence boundary for future Meta, Google Ads and Klaviyo token sets. EO-03-B prepares the boundary; EO-03-C/D and provider packages own connection activation, exchange, refresh and revoke behavior.

Both tables:

- are in the private `integrations` schema;
- enable and force RLS;
- deny direct access to browser roles, `service_role` and `adstable_runtime`;
- are reachable by runtime only through exact `SECURITY DEFINER` functions with empty `search_path`;
- cascade from the exact Shopify installation generation;
- contain no plaintext token, refresh token or PKCE verifier column.

## Startup guard

The runtime refuses provider authorization or token use unless:

1. the database contract version is exactly 1;
2. the active key version exists;
3. every key version referenced by stored envelopes is readable;
4. provider-token and Shopify-session keys differ;
5. an in-memory AES-GCM seal/open self-test passes.

The guard is cached only after success. A failed guard is not cached as success and cannot silently downgrade.

## Environment contract

```text
ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION=1
ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1=<32 random bytes, base64url>
```

The version number is configuration. Every `...ENCRYPTION_KEY...` value is a secret and must never be committed, printed, returned to the browser or copied into Supabase rows.

## Scope

Included:

- versioned server-only keyring;
- authenticated encryption and contextual binding;
- ciphertext-only PKCE and token-set schema;
- atomic single-use PKCE retrieval;
- active-installation authority checks;
- function-only runtime access;
- startup guard;
- repository tests and executable contract.

Excluded:

- live database migration;
- Vercel secret creation;
- live provider credentials or OAuth;
- provider exchange, refresh, revoke and disconnect;
- reporting-account selection;
- production deployment.

## Acceptance sequence

1. Repository implementation, tests, typecheck, build and CI pass.
2. Product owner reviews the repository result and separately authorizes or declines the live gate.
3. If authorized, generate a fresh production provider-token key outside source control and store it as a Vercel Sensitive value.
4. Apply the exact migration to the approved Supabase project.
5. Run read-only schema, privilege, RLS, key-version and advisor checks.
6. Run a synthetic ciphertext-only vault probe without a real provider token, then remove all probe rows.
7. Verify the deployed startup guard.
8. Record durable evidence and require explicit product-owner closure.

Repository merge alone does not make EO-03-B Accepted and does not authorize steps 3–7.


## Production acceptance — 9 October 2026

The separately approved live gate completed without a real provider token or live OAuth:

- Supabase migrations `20261009113645_eo03b_token_vault` and `20261009115314_eo03b_pkce_workspace_fk_index` are live.
- The dedicated provider-token key and active key version exist only as Vercel production Sensitive environment values; neither value was read back, printed or committed.
- Production deployment `dpl_JDGeSSRYZNshT5m5bMHYHS4bBtts` for commit `07e5396badb839b6d8bac290afa2bf058c193485` reached `READY` with no alias error.
- Both the unique deployment URL and `embedded.adstable.app` initialized the Shopify runtime; Vercel reported zero runtime errors in the verification windows.
- The expected unauthenticated root response is HTTP 410 after successful runtime initialization; it is not a startup-guard failure.

## Synthetic ciphertext-only vault probe — 9 October 2026

A separately approved, single PostgreSQL transaction exercised the production database function boundary without a provider credential:

1. The preflight proved the management caller could not execute the runtime functions and could not assume `adstable_runtime`.
2. Inside one controlled transaction, role membership was granted only long enough to execute as the exact runtime role.
3. A fixed synthetic credential ID and opaque ciphertext/nonce/tag were stored under the one active installation authority.
4. Correct-context load returned exactly one envelope.
5. Provider substitution returned zero envelopes.
6. Delete returned true and the second load returned zero envelopes.
7. The transaction removed the temporary role membership before commit.
8. Independent verification proved:
   - `postgres` is not a member of `adstable_runtime`;
   - `postgres` still cannot execute the guard;
   - `adstable_runtime` still can;
   - PKCE envelope rows: 0;
   - provider credential envelope rows: 0;
   - Supabase Security Advisor findings: 0.

The probe did not contain a real access token, refresh token, authorization code, PKCE verifier, customer record or personal data. The application-level production startup guard separately proved the real Vercel keyring and AES-GCM self-test; the database probe proved the function-only persistence boundary.

Machine-readable evidence: `docs/evidence/EO_03B_PRODUCTION_ACCEPTANCE_2026-10-09.json`.

## Product-owner closure — 9 October 2026

After the repository, live-schema, Vercel startup and synthetic ciphertext-only evidence passed, the product owner explicitly accepted EO-03-B.

EO-03-B is **Accepted**. The single next child is **EO-03-C — Connection and reporting-account authority**, now **Ready**. Live provider authorization remains disabled until EO-03-C/D establish and accept the corresponding connection lifecycle.
