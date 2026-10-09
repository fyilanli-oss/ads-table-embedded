# EO-02 — Analysis–Design Book: Shopify foundation lifecycle

**Record date:** 9 October 2026  
**Status:** Accepted by product owner on 9 October 2026  
**Parent package:** A6-EO-02 — Shopify-native data, workspace, billing and privacy foundation

## 1. What EO-02 gives the product

EO-02 establishes the identity, billing and deletion foundation on which provider connections can safely live.

The governing business invariant is:

> **One verified Shopify app installation = one installed Shopify store = one AdsTable workspace = one Shopify subscription.**

The merchant does not select or change a “Reporting Store”. The installed Shopify store is verified server-side and is the immutable commerce authority of that workspace. Meta, Google Ads and Klaviyo accounts may later be connected beneath this authority, but cannot replace it.

## 2. Authorities and responsibilities

| Subject | Authority |
|---|---|
| Shopify embedded identity | Short-lived Shopify ID token verified by the backend |
| Installed commerce store | Shopify Shop GID + canonical myshopify domain + install generation |
| AdsTable tenant | Workspace ID created from the verified installation |
| Billing/trial | Shopify App Pricing and Partner API active-subscription result |
| Provider reporting account | Future EO-03 connection scoped beneath the installed store |
| Privacy lifecycle | Verified Shopify compliance webhooks plus merchant-authorized Delete My Data |
| Physical deletion execution | Durable, bounded database worker; never a browser or direct runtime delete |

## 3. Installation and workspace flow

1. Shopify opens AdsTable inside the installed store.
2. The backend verifies the Shopify ID token and obtains the store identity through the supported server-side authentication path.
3. The backend reads Shopify’s authoritative Shop GID and canonical domain.
4. If the ID-token store and Admin API store disagree, the request fails closed and no database mutation occurs.
5. The database acquires a lock for the verified Shop GID.
6. A first installation creates one workspace and installation generation 1 atomically.
7. Reopening the same active installation returns the same workspace and generation.
8. A verified domain change for the same Shop GID updates the canonical domain and records history; it does not create another workspace.
9. A second Shopify store requires its own installation, workspace and subscription.
10. WooCommerce, BigCommerce and Magento cannot be commerce sources inside this Shopify embedded workspace.

## 4. Billing and trial flow

1. Plan, price and 14-day trial are owned by Shopify App Pricing.
2. AdsTable does not manufacture a local subscription or reset the trial.
3. After plan selection and at reconciliation points, the backend asks the Shopify Partner API for the active subscription.
4. The provider response is projected into the workspace entitlement record.
5. A missing, trial, active, frozen or cancelled provider result remains distinct; a local row cannot overrule Shopify.
6. Runtime access is granted only from the verified Shopify result.
7. Uninstall/reinstall does not promise a fresh trial; Shopify remains the authority for used trial days.

## 5. Normal request path

1. A request arrives from Shopify Admin.
2. The backend validates the current Shopify identity.
3. The verified store is resolved to exactly one live workspace and installation generation.
4. The runtime uses narrowly granted database functions; it has no direct table DML authority.
5. The installed-store scope is carried forward to all later provider and dataset operations.
6. Caller-supplied workspace, shop or future reporting-account values cannot replace the verified authority.

## 6. Uninstall, privacy and deletion flow

Shopify does not need polling to announce these lifecycle events. It delivers configured webhooks to AdsTable.

1. AdsTable receives one of:
   - `app/uninstalled`
   - `customers/data_request`
   - `customers/redact`
   - `shop/redact`
2. The endpoint verifies the HMAC over the exact raw request body.
3. Invalid HMAC requests are rejected without durable mutation.
4. A valid webhook ID is claimed idempotently; duplicate delivery cannot create duplicate work.
5. Raw payloads and plaintext customer data are not stored in the privacy queue.
6. Uninstall suspends the workspace, removes runtime sessions and waits for the required privacy lifecycle.
7. Data-request processing produces the current truthful result. EO-02 stores no customer data, so the result is “no customer data”.
8. Redaction schedules a generation-locked deletion run.
9. Supabase Cron invokes a bounded deletion worker every five minutes.
10. The worker retries recoverable failures with capped backoff; exhausted failures remain visible rather than disappearing.
11. Completion writes a non-personal deletion manifest.

## 7. Reinstall and race safety

- Reinstall before redaction reactivates the same workspace and generation.
- A stale redaction event cannot delete a reinstalled active generation.
- Bootstrap while deletion is executing fails closed.
- Reinstall after completed deletion creates a new workspace and a higher generation.
- A deletion worker must match both workspace and generation; therefore old work cannot delete replacement state.

## 8. Security boundary

- Product tables live in private PostgreSQL schemas.
- Browser roles and Supabase Data API roles cannot access them.
- Tenant tables use enabled and forced RLS.
- Runtime receives function-only privileges and no direct DELETE authority.
- Shopify session/token material crosses a ciphertext-only persistence boundary.
- Secrets, plaintext tokens and raw webhook payloads are excluded from repository evidence and logs.
- Historical accepted migrations and evidence remain immutable; corrections are forward-only.

## 9. Failure behaviour

| Failure | Result |
|---|---|
| Missing or invalid Shopify identity | Reject; no write |
| Verified store mismatch | Reject; no write |
| Caller tries another workspace/store | Reject; installed-store authority wins |
| Duplicate webhook | Existing claim returned; no duplicate execution |
| Temporary deletion failure | Durable retry with bounded backoff |
| Deletion worker exhausted | Visible failed state; no false success |
| Reinstall races stale deletion | Generation lock protects the new installation |
| Billing response unavailable | No invented entitlement; reconciliation remains open/fail-closed |

## 10. Operations and evidence

EO-02 acceptance is supported by repository CI, live Supabase migrations, zero Security Advisor findings, Shopify plan/trial evidence, runtime-auth evidence, exact webhook subscription evidence and durable deletion-worker replay/cleanup evidence.

Primary package records:

- `docs/EO_02A_SUPABASE_FOUNDATION.md`
- `docs/EO_02B_WORKSPACE_INSTALLATION_AUTHORITY.md`
- `docs/EO_02BC_INSTALLED_SHOP_AUTHORITY_CORRECTION.md`
- `docs/EO_02C_SHOPIFY_APP_PRICING_ENTITLEMENT.md`
- `docs/EO_02C_SHOPIFY_RUNTIME_AUTH_BRIDGE.md`
- `docs/EO_02D_PRIVACY_LIFECYCLE.md`
- `docs/EO_02D_DURABLE_DELETION_WORKER.md`

## 11. EO-02 closure statement

EO-02 closed with explicit product-owner acceptance on 9 October 2026 after repository governance passed. The single next parent is **A6-EO-03 — Canonical OAuth, connection and token vault**.

EO-02 does not claim that provider OAuth, token storage, reporting-account selection, provider adapters or Dataset V2 exist. Those are later packages and remain closed by default.

## Contract section map

- business_purpose_and_actual_output
- actors_and_authorities
- end_to_end_happy_path
- negative_and_failure_paths
- persistent_state_and_data_ownership
- secret_and_security_boundaries
- operations_retries_and_observability
- rollback_recovery_or_safe_failure
- accepted_evidence_and_known_limits
- single_next_parent

