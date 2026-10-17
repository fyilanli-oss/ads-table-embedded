# EO-04-B Meta App Role readiness

## Status

- Product-owner implementation authorization: **17 October 2026**
- Repository implementation: **ready; 300 tests, typecheck and production build passed**
- Production deployment: **READY on `ed1b12f`; separately authorized 17 October 2026**
- Desktop and mobile visual acceptance: **PASS in real Shopify Admin on 17 October 2026**
- Meta role, account, token, secret or live-call mutation: **not authorized by this package**
- Real-account acceptance: **pending an accepted App Tester role and a separately approved live call**
- Merge: **pending separate explicit product-owner authorization**

## Analyst outcome

This package prepares the existing Meta connection and read-only reporting runtime for the day an authorized real person is added to the Meta app as a Tester. App Role is a provider-side access gate, not a new OAuth scope and not a reason to bypass the existing installation, account or token authorities.

The connected Settings state stops exposing the temporary internal `Run Meta evidence` action. It continues to show the selected Reporting Account and Disconnect actions only. The authenticated server-side evidence route remains available as a controlled acceptance transport; removing the button does not change OAuth, token storage, reporting queries or data semantics.

## App Role operating model

Stage 1 is restricted development acceptance:

1. the invited person accepts the Meta App Tester role;
2. the same person already has legitimate access to the selected real Meta ad account;
3. OAuth requests only `ads_read`;
4. the account contains delivered catalog ads for the chosen acceptance date;
5. no public merchant or unrelated customer account is connected;
6. each live provider call still requires explicit product-owner authorization;
7. the Tester role is removed when the restricted acceptance work is complete.

Stage 2 is production access and is deliberately separate: company/business verification, any required technology-provider verification, Advanced Access/App Review and public-customer operation remain later gates.

## Real-account acceptance prerequisites

- Shopify migration and the official Facebook & Instagram catalog synchronization are complete.
- Shopify product/variant identifiers and Meta catalog `product_id` continuity are recorded.
- The exact business date has real delivered catalog-ad activity.
- App Tester invitation and any required narrow tester agreement are accepted.
- The tester's access to the target ad account is confirmed in Meta.
- The app is reauthorized with `ads_read`, then exactly one Reporting Account is selected in AdsTable.
- The product owner authorizes the exact live acceptance call.

If any provider call returns an explicit or unexplained error, the call stops at the first failure. It is not retried and no alternate account, browser, token, authentication method or endpoint is used without a new explanation and approval.

## Repository readiness requirements

- Every server-side Graph request carries `appsecret_proof`; the access token and proof never enter UI, result evidence or logs.
- An expired local token or Meta authorization rejection changes the canonical connection lifecycle to `reauthorization_required`.
- A reporting acceptance run follows opaque cursors to a bounded complete snapshot, detects cursor loops and publishes neither fact family unless both complete.
- HTTP `Retry-After` and bounded, identifier-free Meta usage signals are retained as recovery evidence.
- No account ID may be accepted from a merchant-supplied reporting request.
- Missing, unsupported, partial, stale, real zero and valid empty provider pages remain distinct states.

## UI task contract

- Surface: `/settings`
- State changed: Meta `connected`
- Removed copy/action: `Run Meta evidence`, `Meta evidence received`, `Meta evidence failed`
- Remaining visible actions: `Change` for Reporting Account and `Disconnect`
- Components: existing stable Polaris web components; no raw HTML control, custom CSS, inline style or literal color is introduced.
- Desktop and mobile visual acceptance: **PASS in real Shopify Admin on Production, explicitly confirmed by the product owner on 17 October 2026**
- Visual acceptance evidence: `docs/evidence/EO_04B_META_APP_ROLE_VISUAL_ACCEPTANCE_2026-10-17.json`

## Acceptance evidence

A successful real-account acceptance must record, without raw tokens or business identifiers:

- app-role and ad-account-access precondition confirmations;
- selected connection/account authority fingerprints;
- requested business date and Graph version;
- completed channel and product page/row counts;
- provider request IDs or their safe hashes;
- product IDs observed as provider-native values;
- valid-empty versus non-empty state;
- bounded rate-limit/recovery evidence;
- first provider error, if one occurs, with no retry.

The real response decides whether product-level impression, click, spend and conversion fields can be standardized. Creative advertised-product evidence, Sales Role and exact Shopify identity verification remain separate evidence gates; repository readiness must not mislabel them as proven.

## Official sources

Checked 17 October 2026:

- Meta App Roles: <https://developers.facebook.com/documentation/development/build-and-test/app-roles>
- Meta Graph API access levels: <https://developers.facebook.com/docs/graph-api/overview/access-levels/>
- Meta `ads_read`: <https://developers.facebook.com/docs/permissions/reference/ads_read>
- Meta official Business SDK configuration (`v26.0`): <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py>
- Meta official Business SDK security guidance and `appsecret_proof`: <https://github.com/facebook/facebook-python-business-sdk/blob/main/README.md>
- Meta official Business SDK session proof implementation: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/session.py>
- Shopify Button web component: <https://shopify.dev/docs/api/app-home/using-polaris-components/components/actions/button>
