# EO-03-D — Reconnect, disconnect and renewal lifecycle

**Control date:** 9 October 2026  
**Status:** Implementation  
**Parent:** A6-EO-03 — Canonical OAuth, connection and token vault

## Analyst result

EO-03-D gives each Meta, Google Ads and Klaviyo connection an independent, truthful lifecycle beneath the immutable installed Shopify shop.

A provider authorization failure never becomes zero data or a silently connected state. Refresh failure stops new provider work and becomes `reauthorization_required`. A merchant disconnect first stops new work, then remains `disconnect_pending` until provider revoke evidence is classified. Historical analytics are never deleted by Disconnect; privacy deletion remains the only deletion lifecycle.

## Official documentation checked

Checked on 9 October 2026:

- Shopify access-token refresh, retirement and revocation: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
- Shopify app-uninstalled webhooks: https://shopify.dev/docs/api/shopify-app-react-router/latest/guide-webhooks
- Meta official Marketing API collection and access-token baseline: https://www.postman.com/meta/facebook-marketing-api/collection/0zr4mes/facebook-marketing-api-mapi
- Google Ads credential management: https://developers.google.com/google-ads/api/docs/oauth/credential-management
- Google OAuth web-server refresh and revoke: https://developers.google.com/identity/protocols/oauth2/web-server
- Klaviyo OAuth refresh, invalid_grant and revoke: https://developers.klaviyo.com/en/v2026-01-15/docs/set_up_oauth
- Supabase changelog: https://supabase.com/changelog
- Supabase RLS and function security: https://supabase.com/docs/guides/database/postgres/row-level-security

## State machine

`connected → reauthorization_required → connected`

`connected | reauthorization_required → disconnect_pending → disconnected → connected`

Rules:

- `connected` is the only state eligible for provider reads, SnapshotJob or account-authority load.
- `reauthorization_required` keeps the encrypted credential only long enough to support a safe replacement; it cannot produce new reporting data.
- `disconnect_pending` stops new work immediately but does not claim provider revoke success.
- `disconnected` has no credential reference and no active provider account or Reporting Account binding.
- Reconnect reuses the same canonical connection row, increments `connection_version`, revalidates accounts and creates a new effective-dated Reporting Account binding when applicable.
- Every mutation requires the expected connection version and a unique event ID.

## Provider rules

### Shopify

Shopify installation/session tokens are a separate authority. Provider reconnect cannot change the installed shop. App uninstall and privacy deletion remain EO-02-D responsibilities.

### Meta

EO-03-D does not invent a refresh-token grant. A verified replacement authorization can reconnect Meta. Provider-specific token inspection and revoke calls remain adapter work.

### Google Ads

Access tokens are short-lived and normally renewed using the encrypted refresh token. `invalid_grant`, revoked access or lost scopes becomes `reauthorization_required`. A missing refresh token is never replaced with an empty value.

### Klaviyo

Token refresh and revoke use `https://a.klaviyo.com/oauth/token` and `https://a.klaviyo.com/oauth/revoke`. Any refresh `invalid_grant` is treated as lost authorization and requires reconnect.

## Atomic credential rules

- A new encrypted credential envelope must exist for the same workspace, installation generation and provider before rotation or reconnect.
- Renewal compares the expected old credential and expected connection version.
- The connection moves to the new credential and the old ciphertext envelope is deleted in one database transaction.
- Reconnect performs the same atomic replacement and never exposes plaintext.
- Retry with the same event ID is idempotent; reuse of an event ID for another connection fails closed.

## Disconnect rules

1. Verified merchant intent requests disconnect and immediately stops new provider work.
2. The adapter attempts the provider-specific revoke policy.
3. Only classified evidence `revoked`, `already_invalid`, `not_supported` or explicitly approved `local_authority_removed` can finalize.
4. A transient timeout or unknown provider response remains `disconnect_pending`.
5. Finalization clears the credential reference, deletes the ciphertext envelope, makes connected accounts inactive and closes the active Reporting Account binding.
6. Historical bindings and Dataset V2 facts remain intact.
7. Disconnect is independent per provider and never implies Delete My Data.

## Repository scope

Included:

- lifecycle state and optimistic version;
- append-only non-secret lifecycle events;
- renewal, reauthorization-required, disconnect request/finalization and reconnect database operations;
- provider-neutral server validation and repository boundary;
- account/binding preservation;
- forced-RLS, function-only access and negative tests.

Excluded:

- live provider HTTP refresh or revoke calls;
- live OAuth;
- Settings UI;
- SnapshotJob and Dataset V2 implementation;
- live Supabase migration;
- production deployment.

## Acceptance sequence

1. Repository implementation, contract, tests, typecheck, build and CI pass.
2. Product owner separately approves or declines live database migration.
3. If approved, apply the exact migration and run schema, privilege, RLS, index and advisor checks.
4. Run rollback-scoped synthetic lifecycle acceptance without a real provider token.
5. Verify all synthetic rows and temporary privileges are removed.
6. Record durable evidence.
7. Product owner explicitly closes EO-03-D and A6-EO-03.

## Live database evidence — 9 October 2026

The product owner explicitly approved the live database migration and rollback-scoped synthetic acceptance.

Applied to Supabase project `podpwkrpmjiksskxhwsu`:

- PostgreSQL: `17.11.0.003`;
- migration record: `20261009141549 / eo03d_provider_connection_lifecycle`;
- source commit: `3abcac35c31d7eecf75ba10f044a8bd059133df5`;
- migration blob: `a6e1403345de48d5dbdf8045256bc9a07a63c547`.

Verified live:

- lifecycle columns, event table and six required lifecycle/reporting functions exist;
- provider authority tables have forced RLS;
- `anon`, `authenticated`, `service_role` and `adstable_runtime` have no direct table access;
- all critical functions are `SECURITY DEFINER` with an empty `search_path`;
- reporting authority requires `connected`, a non-null credential and an active Shopify installation;
- Supabase security advisor returned zero findings;
- no provider connection, credential or lifecycle-event test rows exist.

Synthetic runtime acceptance remains **OPEN**. Supabase Connector rejected mutation, so the same rollback-scoped scenario was run through Supabase SQL Editor under the existing `adstable_owner` role without expanding privileges. The first lifecycle transition reached the live function and failed with PostgreSQL `42702`: the unqualified `connection_id` lifecycle-event column conflicts with the function's `RETURNS TABLE` output variable. The transaction rolled back; connection, credential, account and event residue is zero.

The corrective migration `20261009211000_eo03d_qualify_lifecycle_event_columns.sql` qualifies lifecycle-event columns in all four mutation functions. It must pass repository CI, receive explicit merge/live-migration approval, be applied exactly, and complete the rollback-scoped runtime scenario before EO-03-D can be accepted.


## Second rollback-scoped acceptance finding — 9 October 2026

The first corrective migration was merged and applied as Supabase migration `20261009145154 / eo03d_qualify_lifecycle_event_columns`. The rerun passed the previously ambiguous lifecycle-event query, then PostgreSQL raised `42702` at the first connection update because the unqualified expression `connection_version = connection_version + 1` conflicts with the function's `RETURNS TABLE` output variable.

The entire synthetic transaction rolled back again. Verified residue remains zero for synthetic connection, credential, account and lifecycle-event rows. The forward-only migration `20261009212000_eo03d_qualify_lifecycle_update_columns.sql` aliases all four `provider_connections` updates and qualifies the source `connection_version`. EO-03-D remains open until this second correction passes CI, receives explicit merge/live approval, and the complete rollback-scoped lifecycle scenario passes.

## Third rollback-scoped acceptance finding — 9 October 2026

The second corrective migration was merged and applied as Supabase migration `20261009150114 / eo03d_qualify_lifecycle_update_columns`. The complete rerun passed reauthorization, transition idempotency, atomic credential renewal and disconnect-pending. During final disconnect PostgreSQL raised `42702` because `reporting_account_bindings.connection_id` remained unqualified and collided with the function output variable.

A static review of all four function bodies found the two remaining output-variable collision points in final-disconnect updates: the Reporting Account binding and provider-account predicates. The forward-only migration `20261009213000_eo03d_qualify_finalize_update_columns.sql` aliases and qualifies both together. The failed transaction rolled back and synthetic residue remains zero. EO-03-D remains open pending CI, explicit merge/live approval and a complete passing rerun.
