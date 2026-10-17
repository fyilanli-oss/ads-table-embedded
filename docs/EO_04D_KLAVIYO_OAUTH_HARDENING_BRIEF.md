# A6-EO-04-D Klaviyo OAuth hardening brief

**Status:** Repository implementation ready for review
**Checked:** 17 October 2026

## Analyst outcome

Klaviyo reporting must not discover that a token expired only after spending a
provider request. AdsTable therefore records the provider expiry in the
encrypted token set and renews an expired, near-expiry or legacy token before
the intended Klaviyo request. The renewed credential is persisted before that
request so a rotating refresh credential is not held only in memory.

The opposite boundary is equally important: once Klaviyo answers a provider
request with an error, AdsTable stops. It does not refresh and repeat that
failed request. An authorization-code expiry, invalid refresh authorization,
Accounts authentication failure, permission denial and unknown provider failure
remain different states.

## User and operational outcome

- Opening Settings for an already connected account remains a local read. A
  temporary Klaviyo outage cannot by itself break the connected Settings view.
- Explicit work that needs Klaviyo prepares the credential first and then makes
  one provider request.
- Accounts `401` and refresh `invalid_grant` remove reporting authority by
  requiring reauthorization; they do not invent a successful connection.
- Accounts `403` remains permission denied and is not mislabelled as token
  expiry.
- An unexplained provider failure is returned as failure without retry.

## K-1 separation decision

PR #91 mixes backend credential hardening with a new Klaviyo-origin installation
screen. Its backend ideas remain necessary, but the PR is based on pre-K-2
`main`, now conflicts with the accepted reporting runtime, and its runtime
changes were not protected by sufficient behavior tests.

This package therefore rebuilds only backend hardening from current `main`.
The `/auth/klaviyo/install` transport remains deferred until isolated Shopify
preproduction exists and desktop plus real-mobile visual acceptance can be
performed. No route, Settings copy or action control changes in this package.

## Verification contract

Behavior tests execute token and Accounts HTTP outcomes through injected fakes.
They prove refresh-before-request ordering, encrypted-vault persistence,
pending/connected authority renewal, one Accounts request only, and terminal
first-error behavior. Source-text matching is not accepted as proof of these
runtime behaviors.

## Scope boundary

This package authorizes repository code, tests, contract and documentation only.
It authorizes no live Klaviyo call, OAuth execution, provider-console change,
secret, environment variable, database/migration, deployment or UI mutation.

## Official sources

- [Make API calls using OAuth](https://developers.klaviyo.com/en/docs/set_up_oauth)
- [Handle your app's OAuth flow](https://developers.klaviyo.com/en/docs/handle_your_apps_oauth_flow)
- [Submit your app for review](https://developers.klaviyo.com/en/docs/submit_your_app_for_review)

The sources were rechecked on 17 October 2026.

## Repository verification

- Complete tests: 333/333 PASS
- TypeScript verification: PASS
- Production build: PASS
- Diff whitespace validation: PASS
- Live provider or infrastructure mutation: none
