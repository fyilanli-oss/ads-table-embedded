# A6-OPS-SHOPIFY-01 — Isolated Shopify embedded pre-production

**Decision date:** 17 October 2026
**Status:** Planned; trigger not reached; implementation not started
**Type:** Independent prerequisite package; does not advance the active EO parent
**Activation deadline:** Before either a real merchant store is migrated to Shopify for AdsTable use or the first external/non-team user is invited, whichever happens first

## Analyst brief

AdsTable currently has a working Production Shopify application identity and Production hosting boundary. A generic Vercel Preview URL alone is not a truthful embedded Shopify acceptance environment because Shopify loads the configured application URL and validates the application identity and redirect URLs.

This package creates an isolated place where the same repository revision can be tested inside real Shopify Admin without turning a merchant's live store or the Production application into the development environment.

The package is intentionally planned now and opened later. Planning it authorizes no Shopify app or store creation, Vercel or Supabase mutation, secret creation/copy, provider configuration, deployment, installation, live API call or real-data carry.

## Official baseline checked on 17 October 2026

- Shopify, **Manage app config files**: one codebase can link named configuration files to separate development, staging and production apps; Shopify advises avoiding active development against an app installed on a live store. <https://shopify.dev/docs/apps/build/cli-for-apps/manage-app-config-files>
- Shopify, **Dev stores**: dev stores are owned testing environments intended for realistic app development without affecting a live store. <https://shopify.dev/docs/apps/build/stores/development-stores>
- Shopify, **App configuration**: `application_url`, embedded mode and authorization redirect URLs belong to the selected Shopify app configuration. <https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration>
- Vercel, **Environments** and **Environment variables**: Preview and Production are separate deployment environments and can carry distinct configuration. <https://vercel.com/docs/deployments/environments> and <https://vercel.com/docs/environment-variables>

These sources must be rechecked when implementation is opened. Current documentation is evidence for the plan, not permission to assume future provider behavior.

## Business outcome

The product team can validate desktop and mobile embedded behavior, OAuth return paths, installation/session boundaries and approved read-only provider scenarios before affecting a merchant's live Shopify store or the Production AdsTable application.

## Mandatory scope

1. Create or designate a dedicated Shopify development app owned by the authorized organization.
2. Create or designate a Shopify dev store; a merchant production store cannot substitute for it.
3. Add a named non-production Shopify configuration linked to that development app without replacing the Production configuration.
4. Provide a stable HTTPS Preview/Staging application URL and exact redirect URL allowlist suitable for Shopify Admin embedding.
5. Use Preview-specific Shopify credentials and non-production secrets. Production credential values cannot be copied into Preview or Development.
6. Isolate non-production persistence from Production business data. A Preview installation, session, provider token, job or dataset row cannot write into the Production data boundary.
7. Keep provider access separately gated. Any real provider account acceptance must be read-only, role/ownership-authorized, exact-account-bound and explicitly approved for that execution.
8. Prove desktop and mobile Shopify Admin behavior, initial load, reload, OAuth return, session continuity and fail-closed configuration before closure.
9. Record rollback/removal steps for the development app installation, Preview aliases/configuration and non-production credentials without deleting Production state.
10. Hand reusable evidence to A6-EO-08-D; this package does not itself declare the application review-ready.

## Explicitly outside this package at planning time

- Production deployment or domain change
- Production Shopify app configuration change
- Real merchant store migration
- External user invitation
- Production secret copying
- Production database or merchant-data carry
- Meta, Google Ads or Klaviyo mutation/live request
- Shopify, Meta, Google or Klaviyo review submission
- Cutover, merge or legacy deletion

## Work steps

### A6-OPS-SHOPIFY-01-A — Revalidation and exact inventory

Recheck current official documentation and inventory the Production Shopify app/configuration, Vercel environment names, database boundaries and provider callback dependencies without reading secret values or mutating providers.

### A6-OPS-SHOPIFY-01-B — Isolation design and mutation approvals

Freeze the exact dev app, dev store, stable URL, redirect allowlists, Preview environment keys, non-production persistence boundary, ownership, cost and rollback plan. Every external mutation remains individually approval-gated.

### A6-OPS-SHOPIFY-01-C — Separately approved provisioning and embedded acceptance

Only after explicit approval, provision the accepted boundaries and verify the application inside the dedicated dev store on desktop and mobile. Stop at the first explicit or unexplained provider error; do not retry or change route without a new explanation and approval.

### A6-OPS-SHOPIFY-01-D — Closure and handoff

Prove Production was not changed, Preview cannot write Production data, no Production credential was copied, required embedded scenarios passed and rollback evidence exists. Record evidence reusable by A6-EO-08-D.

## Closure rule

The package closes only with repository/CI evidence, exact non-secret environment inventory, desktop and mobile user acceptance, isolation proof, rollback proof and explicit product-owner acceptance. Code, configuration, deployment or a working URL alone is not Done.

