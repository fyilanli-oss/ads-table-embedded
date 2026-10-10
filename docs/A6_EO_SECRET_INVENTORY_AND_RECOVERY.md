# A6-EO Secret inventory, custody and recovery

**Control date:** 10 October 2026  
**Status:** Ready for product-owner acceptance  
**Scope:** Current Production Vercel environment and GitHub Actions secret inventory  
**Binding contract:** `contracts/a6-eo-secret-inventory-recovery-v1.json`  
**CI enforcement:** `tests/a6-eo-secret-inventory-recovery.test.js`

## Analyst result

AdsTable currently has eleven Vercel environment entries and one GitHub Actions secret. Vercel stores six entries as Secret, but one of those is the non-confidential active-key version selector; the other five Vercel entries and the GitHub token are confidential credentials or key material. Five Vercel entries are reconstructible Config. No secret value is stored in this document, the repository, chat evidence or a local project file.

A masked value in Vercel or GitHub is not deleted. Both systems deliberately prevent plaintext read-back. The canonical runtime copy remains in the provider secret store. A second copy is allowed only in one product-owner-controlled encrypted recovery vault. A browser download, note, screenshot, repository file, chat message, desktop text file or machine backup is not an approved recovery vault.

This contract inventories names and recovery procedures. It authorizes no rotation, deletion, rename, provider mutation, database mutation, environment change or deployment.

## Current inventory

| Name | Location / type | Authority and purpose | Product-owner custody | If unavailable |
|---|---|---|---|---|
| `SHOPIFY_API_KEY` | Vercel Production / Config | Shopify permanent client ID | Plaintext backup unnecessary; reconstruct from Shopify Dev Dashboard | Copy the client ID again; no rotation |
| `SHOPIFY_API_SECRET` | Vercel Production / Secret | Shopify app authentication and webhook verification | Encrypted recovery copy required for continuity | Create/rotate a Shopify client secret, update Vercel, redeploy, verify OAuth and webhooks, then revoke the old secret |
| `SHOPIFY_APP_URL` | Vercel Production / Config | Canonical embedded application URL | Repository/provider record is sufficient | Reconstruct from the approved production domain |
| `SCOPES` | Vercel Production / Config | Shopify least-privilege scope set; currently intentionally empty | Repository contract is sufficient | Reconstruct only from the accepted scope contract |
| `SHOPIFY_PARTNER_ORG_ID` | Vercel Production / Config | Shopify Partner organization identity | Provider record is sufficient | Copy from Shopify Partner/Dev Dashboard |
| `SHOPIFY_APP_GID` | Vercel Production / Config | Shopify managed-pricing app identity | Provider record is sufficient | Re-query/copy from Shopify authority |
| `SHOPIFY_PARTNER_API_ACCESS_TOKEN` | Vercel Production / Secret | Partner API subscription authority | Encrypted recovery copy required | Generate a secondary Partner API token, update Vercel, redeploy and verify subscription reconciliation before revoking the old token |
| `ADSTABLE_RUNTIME_DATABASE_URL` | Vercel Production / Secret | Supabase transaction-pooler URL for the least-privilege `adstable_runtime` role | Encrypted recovery copy required; never store a broader database credential | Rotate the exact runtime role through an approved database playbook, reconstruct the copied pooler URL, update Vercel, redeploy and verify direct/pooler behavior with bounded retries |
| `ADSTABLE_SESSION_ENCRYPTION_KEY_V1` | Vercel Production / Secret | AES-256-GCM Shopify session encryption key | Encrypted recovery copy required; current external copy is not proven | The same key cannot be regenerated. Without it, old session ciphertext is unreadable; use an approved session-reset/reinstallation plan. Blind replacement is forbidden |
| `ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION` | Vercel Production / Secret (classification debt) | Selects the provider-token write key; current logical value is version 1 | No plaintext secret backup needed; contract is authority | Restore the accepted version number. Reclassifying it as Config is a separately approved cleanup |
| `ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1` | Vercel Production / Secret | AES-256-GCM provider token/PKCE envelope key | Encrypted recovery copy required before the first real provider authorization | The same key cannot be regenerated. Add a new version, keep all referenced old versions readable, rotate envelopes, verify zero references, then remove an old key |
| `SHOPIFY_APP_AUTOMATION_TOKEN` | GitHub repository Actions Secret | App-scoped Shopify CLI validation/deployment token | Encrypted recovery copy and exact expiry record required | Generate a replacement in Shopify Dev Dashboard, update GitHub Actions Secret and validate through the approved workflow before expiry |

## What remains under product-owner control

The product owner retains:

1. administrator access to Shopify Dev/Partner Dashboard, Vercel, Supabase and GitHub;
2. one encrypted recovery-vault entry for every non-reconstructible secret;
3. the source authority, owner, creation/rotation date and exact expiry metadata for every credential;
4. explicit approval authority for every secret create, update, rename, delete, scope change and revocation;
5. the recovery decision when a non-reissuable encryption key is unavailable.

The product owner does not need to keep duplicate plaintext configuration values that can be reconstructed from accepted contracts or provider dashboards.

### Recovery-vault status today

The provider stores prove the runtime copies exist, but an independent encrypted product-owner recovery copy has not been evidenced for the existing write-only values. Therefore the contract does not claim that those plaintext copies are currently recoverable.

- Before the first real Meta, Google Ads or Klaviyo authorization, the provider-token key must either be placed in the approved encrypted recovery vault or be deliberately replaced while the vault tables contain no real credentials.
- Before external customer onboarding, the Shopify session-key disaster path must be accepted: either escrow the then-active key through an approved controlled rotation or explicitly accept forced session invalidation/reinstallation as recovery.
- Before the next Shopify configuration deployment, record the exact automation-token expiry shown by Shopify. The user reports a 60-day lifetime; the exact calendar date is not yet independently verified.
- Selecting the encrypted recovery-vault product is an operational decision; this repository never stores the vault contents.

## Touch policy

No agent, developer or operator may create, reveal, rotate, replace, rename, delete, re-scope or revoke an inventory item merely because a value is masked, unavailable for read-back or inconvenient.

Every secret mutation requires, before the mutation:

1. explicit product-owner approval naming the exact key and environment;
2. current official provider documentation;
3. impact map: readers, writers, encrypted records, webhooks, deployments and workflows;
4. recovery/rollback procedure and validation query;
5. confirmation that the new plaintext is captured only in the approved encrypted recovery vault;
6. a new deployment or workflow run when required;
7. post-change evidence without secret values;
8. revocation/removal of the old credential only after successful verification.

Production credentials cannot be copied to Preview or Development. Those environments require independent non-production credentials and data.

## Recovery playbooks

### Shopify client secret

Use Shopify's supported rotation flow. Keep the oldest unrevoked secret available while the new Vercel secret and deployment are verified, because webhook signing can continue with the old secret during rotation. Verify embedded authentication, OAuth and webhook HMAC before revocation.

### Shopify Partner API token

Generate a secondary organization-scoped token. Update only the Production Vercel secret, redeploy, verify the exact `activeSubscription` reconciliation and logs, then revoke the prior token.

### Shopify App Automation Token

The token is app-scoped and time-limited. Generate the successor before expiration, capture it once in the encrypted recovery vault, update the GitHub repository secret, and run only the explicitly approved validation/deployment workflow. The workflow file contains only the secret name.

### Supabase runtime connection

The connection string contains a credential for the function-only custom role. Never substitute `postgres`, `service_role` or another broader identity. Copy the exact transaction-pooler endpoint from Supabase rather than constructing its host. Password changes can be cached briefly by Supavisor, so verify the new credential directly where applicable and retry the pooler only with bounded attempts. Repeated blind retries are forbidden.

### Shopify session encryption key

The current application consumes only `ADSTABLE_SESSION_ENCRYPTION_KEY_V1`; it does not yet provide a multi-version session keyring. Consequently a blind replacement makes stored sessions unreadable. Planned rotation requires either a versioned migration path or a controlled purge followed by merchant reauthentication/reinstallation and a production acceptance check.

### Provider-token encryption key

This key family is versioned. New writes use the active version and reads must retain every version referenced by ciphertext rows. The safe order is add V2, deploy/read V1+V2, switch the active version, rotate envelopes, prove no row references V1, and only then remove V1. A newly generated value can never decrypt ciphertext created with a lost value.

## EO-04 extension gate

EO-04 must not invent or provision Meta, Google Ads or Klaviyo client secrets from memory. Before each provider child creates a credential, its current official documentation must define:

- exact environment-variable name and consuming code/workflow;
- issuing authority, scopes, app/project identity and environment;
- whether it expires or is revoked/rotated;
- plaintext read-back behavior and encrypted recovery-vault requirement;
- deployment, reconnection and rollback sequence;
- product-owner approval and secret-free acceptance evidence.

The machine-readable inventory and its test must be extended in the same change that introduces a new credential.

## Official sources checked on 10 October 2026

- Shopify app credentials: https://shopify.dev/docs/apps/build/authentication-authorization/manage-credentials
- Shopify App Automation Tokens: https://shopify.dev/docs/apps/build/dev-dashboard/app-automation-tokens
- Shopify Partner API: https://shopify.dev/docs/api/partner/2026-01
- Vercel Config and Secret types: https://vercel.com/changelog/environment-variables-now-use-config-and-secret-types
- Vercel environment management: https://vercel.com/docs/environment-variables/manage-across-environments
- Vercel secret rotation: https://vercel.com/docs/environment-variables/rotating-secrets
- GitHub Actions secret types: https://docs.github.com/en/code-security/reference/secret-security/secret-types
- GitHub Actions secrets reference: https://docs.github.com/en/actions/reference/security/secrets
- Supabase connection selection: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase pool limits: https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits
- Supabase password-rotation cache behavior: https://supabase.com/docs/guides/troubleshooting/supavisor-error-password-authentication-failed-after-password-rotation
- Supabase changelog: https://supabase.com/changelog
