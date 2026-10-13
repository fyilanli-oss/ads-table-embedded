# A6-EO-04-B Meta OAuth and Account Selection

Status: Accepted; merge pending  
Checked: 13 October 2026

## Official sources

- Meta Graph API changelog: https://developers.facebook.com/docs/graph-api/changelog
- Meta Graph API versions: https://developers.facebook.com/docs/graph-api/changelog/versions/
- Meta app versioning: https://developers.facebook.com/docs/apps/versions
- Meta Facebook Login: https://developers.facebook.com/docs/facebook-login
- Meta Marketing API official collection: https://www.postman.com/meta/facebook-marketing-api/collection/0zr4mes/facebook-marketing-api-mapi
- Meta Ad Account reference: https://developers.facebook.com/docs/marketing-api/reference/ad-account
- Shopify App Home web components: https://shopify.dev/docs/api/app-home/latest/web-components

The repository's accepted Shopify UI baseline remains `polaris-2.0-rc.js` with
`@shopify/polaris-types@2.0.0-rc.2`. This product decision is not downgraded by
the current Shopify documentation page displaying the stable 1.1 surface.

## Business outcome

The merchant connects Meta from the installed Shopify workspace, authorizes
read-only advertising access, selects one to three real advertiser accounts and
ends with exactly one explicit Reporting Account. The installed Shopify Store
remains the immutable commerce authority. A Meta account, pixel, domain or
browser identity cannot select or change the store.

## Accepted flow

1. **Connect Meta** opens a Shopify confirmation modal.
2. **Continue to Meta** starts a short-lived server-owned OAuth transaction and
   navigates at the top-level window.
3. Meta handles login and any required verification. The mobile device does not
   need the Facebook app or an existing Facebook browser session beforehand.
4. After callback, AdsTable exchanges the short-lived token for a long-lived
   token, validates it with Meta, encrypts it and discovers `/me/adaccounts`.
5. Settings automatically opens the advertiser-account selector. The merchant
   selects one to three provider-returned ad accounts.
6. One selected account becomes the Reporting Account automatically.
7. For two or three selected accounts, the Reporting Account modal opens
   automatically and requires exactly one explicit choice from that set.
8. Dismissing either selector preserves pending state. **Resume setup** reloads
   and opens the correct selector; it never starts OAuth again.
9. A connected merchant may change the Reporting Account from the selected set
   without OAuth. Meta access is revalidated first.
10. **Disconnect** revokes Meta permissions first. Only `revoked` or
    `already_invalid` permits local authority and encrypted credential removal.
    Provider/network failure preserves the connection and fails closed.

Only `connected` grants reporting authority. OAuth and account selection do not
write Dataset V2, start backfill or schedule data jobs.

## Runtime contract

- Graph and Login version: exact `v26.0`.
- Requested scope: exact `ads_read`.
- Callback: `https://embedded.adstable.app/auth/meta/callback`.
- Account discovery: cursor-paginated `/me/adaccounts`, bounded to 20 pages and
  1,000 distinct accounts, with loop and malformed-response rejection.
- Token validation: `is_valid`, exact app identity, `ads_read` and bounded expiry.
- Credential storage: existing EO-03-B encrypted provider-token vault only.
- Provider error `190`, HTTP 401 or HTTP 403 during account discovery means
  reauthorization; it is never converted to an empty account list.

## Shopify component mapping

| Need | Exact component |
| --- | --- |
| Page and provider section | `s-page`, `s-section`, `s-stack` |
| Status and errors | `s-badge`, `s-banner` |
| Actions | `s-button` |
| Account and Reporting Account selection | `s-modal`, `s-choice-list`, `s-choice` |
| Provider authorization navigation | top-level Shopify embedded navigation |

No raw form controls, custom component imitation, inline CSS or literal visual
tokens are introduced.

## Acceptance and mutation gates

Repository acceptance requires deterministic tests, TypeScript, build and CI.
Product-owner-controlled Meta app configuration, Production deployment and the
desktop Shopify Admin flow have passed. The desktop evidence covers callback,
automatic account selection, single-account Reporting Account assignment,
Cancel/Resume without OAuth restart, revoke-first Disconnect and clean reconnect.

The complete Windows flow passes with the Meta developer-role account. A fresh
Connect transaction on the product owner's iPhone had no usable Facebook
session and correctly opened Meta's password authentication screen. A controlled
Windows comparison then started OAuth with a different, non-role Facebook
account and reproduced the exact **App not active** response previously seen on
Android. This proves that the response follows Meta's pre-review/development-mode
user restriction rather than device type or AdsTable application code.

The Android result therefore does not block acceptance. Repeating it on another
Android device is an optional post-acceptance regression check. No copied OAuth
URL or `state` may be reused, and no unobserved iOS callback or account-selection
behavior is claimed.

Durable evidence is
`docs/evidence/EO_04B_META_OAUTH_LIVE_ACCEPTANCE_2026-10-13.json`. OAuth live
acceptance and EO-04-B product-owner acceptance are PASS. Merge remains false
until its separate explicit authorization.

Product owner gave EO-04-B direct final acceptance in chat on 13 October 2026.

Product owner accepted this exact start brief in chat on 13 October 2026.

