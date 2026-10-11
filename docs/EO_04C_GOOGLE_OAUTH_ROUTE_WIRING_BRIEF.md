# EO-04-C — Google OAuth route wiring and Shopify UI brief

**Control date:** 11 October 2026  
**Status:** Repository implementation PASS; callback-return/cancel live migration accepted. Deployment, live Google evidence and visual acceptance remain pending  
**Parent:** A6-EO-04-C

## Analyst result

The secure OAuth transaction, encrypted provider credential and short-lived account-selection handoff already exist. The next slice is HTTP orchestration only. It must not invent a browser authority channel, trust client account evidence, expose a credential ID, or enable live Google activity before controlled acceptance.

The Google callback has no Shopify Admin ID token. It cannot safely infer the installed shop from browser state, request parameters, cookies or the current Admin tab. After state is claimed, the server must resolve the active installed-shop return target from the claimed workspace and install generation through one narrow server-side database function. The callback then redirects to that verified installation's exact Shopify Admin app URL. The transaction ID in the return URL is correlation only.

## User result

A merchant starts Google Ads connection from Settings, completes Google consent, returns to the same installed Shopify store, chooses one to three eligible advertiser accounts, selects one of those as the reporting account, and sees a truthful connected result. Manager accounts may be retained only as Google access paths; they are never selectable reporting accounts.

## Route contract

| Route | Method | Authority | Result |
|---|---|---|---|
| Settings connection state | GET | authenticate.admin, verified ID-token destination, verified Admin shop, active install generation | Existing connection, pending selection or not-connected |
| Google begin | POST | Same Shopify authority | Creates state + PKCE and redirects to Google's exact authorization URL |
| Google callback | GET | One-time provider state claim | Handles denial or code exchange, stores encrypted refresh token, creates ten-minute handoff, resolves installed-shop return target and redirects into Shopify Admin |
| Account discovery / resume | GET | Fresh Shopify Admin and installed-shop authority; transaction ID is correlation only | Re-resolves handoff and obtains fresh Google account evidence |
| Account selection | POST | Fresh Shopify authority and fresh Google evidence | Atomically creates connection, one-to-three advertiser accounts and one reporting account, then consumes handoff |
| Cancel setup | POST | Fresh Shopify authority and matching handoff | Immediately invalidates the handoff and deletes its unreferenced encrypted credential |
| Expiry cleanup | Bounded server job | Runtime function only | Expires abandoned handoffs and deletes orphan ciphertext |

## Non-negotiable server rules

1. Begin, selection and cancellation are POST-only.
2. Callback accepts only bounded state, code and provider error parameters. Raw provider error text is never persisted or shown.
3. Browser input never carries or authorizes credential ID, tokens, provider evidence, workspace ID or install generation.
4. Callback return store comes from claimed server-side authority, never query input, cookie or referrer.
5. Shopify app handle is exact deployed configuration, never request input.
6. Settings always re-authenticates through Shopify and re-resolves the active installation generation.
7. Discovery is fresh on resume and again before selection. Managers are non-reporting access paths.
8. One to three advertisers may be connected; reporting account must be among them.
9. Access tokens stay memory-only. Only the refresh-token subset is encrypted at rest.
10. Errors expose bounded AdsTable codes and Google request ID only.
11. Cancel and expiry deterministically remove abandoned credential ciphertext.
12. No Dataset V2 write, reporting fetch, deploy or live Google request belongs to this repository-only slice.

## Accepted legacy parity correction — 11 October 2026

Controlled production evidence found five accessible Google accounts: two managers and three advertisers. Google returned `CLOSED` as the customer status for all five. The former accepted AdsTable flow still presented the three non-manager advertisers; therefore provider status is informational evidence, not a selection gate.

The binding selection rule is account kind only: a provider-verified non-manager advertiser may be selected. Manager accounts remain internal `login-customer-id` access paths; they never appear in the merchant selection list, never count toward the one-to-three limit and can never be the reporting account. A directly accessible advertiser uses its own customer ID as the login account context. The pre-OAuth confirmation modal and the post-OAuth account-selection modal are both required legacy behavior.

## State matrix and exact copy

| State | Exact merchant copy | Actions |
|---|---|---|
| Loading | **Loading Google Ads connection…** | None |
| Empty | **Google Ads is not connected.** Connect one to three advertiser accounts. Manager accounts are used only when Google requires an access path. | **Connect Google Ads** |
| In progress | **Connecting to Google Ads…** | Disabled/loading primary action |
| Resume | **Choose Google Ads accounts.** Select up to three advertiser accounts, then choose which account AdsTable uses for reporting. | **Connect selected accounts**, **Cancel setup** |
| No advertiser | **No eligible advertiser account was found.** Manager accounts cannot be reporting accounts. | **Try Google Ads again**, **Cancel setup** |
| Connected | **Google Ads connected.** {count} advertiser account(s) connected. {reportingAccountName} is used for reporting. | **Manage Google Ads connection** |
| Denied/cancelled | **Google Ads connection was cancelled.** No reporting account was connected. | **Try again** |
| Expired | **This Google Ads setup session expired.** Start again to load a fresh account list. | **Start again** |
| Validation | **Choose one to three advertiser accounts and one reporting account from your selection.** | Correct and retry |
| Safe error | **Google Ads could not be connected.** Try again. If the problem continues, share error code {code}. | **Try again** |

## Exact Polaris 2.0 RC mapping

No raw HTML action/form control, custom CSS, literal color, custom card/modal or s-clickable is authorized.

| Visible element | Exact component and property | Official source checked 11 Oct 2026 |
|---|---|---|
| Page | s-page, heading Settings | https://shopify.dev/docs/api/app-home/v2.0-rc |
| Group | s-section, heading Google Ads | https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/layout-and-structure/section |
| Layout | s-stack, direction block, documented gap tokens | https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/layout-and-structure/stack |
| Status | s-badge; success connected, info progressing, warning expired, critical failure | https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/feedback-and-status-indicators/badge |
| Explanation | s-paragraph and s-text | https://shopify.dev/docs/api/app-home/v2.0-rc/web-components |
| Advertisers | s-choice-list plus s-choice; name connectedAccountIds, multiple | https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/forms/choice-list |
| Reporting account | s-choice-list plus s-choice; name reportingAccountId, single | https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/forms/choice-list |
| Actions | s-button; primary, secondary, loading and disabled semantics | https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/actions/button |
| Feedback | s-banner with semantic tone and safe copy | https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/feedback-and-status-indicators/banner |
| Loading | s-spinner or s-button loading | https://shopify.dev/docs/api/app-home/v2.0-rc/web-components |
| Navigation | Existing App Bridge navigation only | https://shopify.dev/docs/api/app-home/latest/app-bridge-web-components |

The repository is on React 18. Account fields therefore remain uncontrolled Polaris components, using defaultSelected only when needed. Values are read from the web-component API at action time. Submission uses authenticated App Bridge resource fetching triggered by documented s-button actions; no raw HTML form is introduced.

## Desktop and mobile

Desktop uses one Settings section and vertical choices. Mobile at minimum 320 px keeps the same information order and native responsive behavior. Account names may wrap; IDs remain visible to distinguish duplicate names. Nothing is hover-only. Managers never render as eligible reporting choices.

## Additional private database boundary

Before route activation, repository implementation requires a separately approved live migration with two narrow functions:

1. Resolve callback return authority from claimed workspace ID plus install generation to the active canonical myshopify.com domain.
2. Cancel a matching pending handoff immediately and delete its unreferenced encrypted credential.

Both functions use SECURITY DEFINER with empty search path, fully qualified relations, row locking and active-generation verification. PUBLIC, anon, authenticated and service-role execution is revoked; only exact runtime execution is granted. No direct table grant is allowed.

## Legacy Settings reference boundary

The former Settings surface is a behavior reference only. The new implementation preserves one canonical Settings surface, one provider section, truthful Connect / Resume setup / Connected states, connected-account count and reporting-account summary. It does not copy legacy code, single-account limits, deprecated provider inventory, callback aliases, custom styling or known visual violations.

## Unchanged and out of scope

Installed Shopify Store remains immutable commerce authority. Google keeps one-to-three advertiser accounts, one reporting account and non-reporting manager access paths. OAuth, PKCE, encryption and handoff contracts remain authoritative.

Out of scope: live Supabase mutation, Vercel deploy, live Google activity, Dataset V2, reporting jobs, reconciliation, disconnect UX and any visual acceptance claim before real desktop/mobile evidence.

## Acceptance plan

- [x] Product owner accepted flow, copy and component mapping on 11 October 2026
- [x] Repository route/runtime and constitution tests pass — CI run 38142931704
- [x] Private migration passes repository tests
- [x] Separate live migration approval and postflight passed on 11 October 2026
- [ ] Separate deployment approval
- [ ] Controlled begin/callback/resume/selection/cancel evidence
- [ ] Real desktop and minimum-320px mobile Shopify Admin pass
- [ ] Explicit visual and package closure acceptance


## Repository implementation result — 11 October 2026

The accepted HTTP/UI slice is implemented at commit `93aa1b8901b639933ffa9feed5acc4ccfb4b70de`. Direct Google accounts are discovered with `listAccessibleCustomers`; manager descendants are resolved recursively through `customer_client`. The Settings route never accepts shop, workspace, install generation, credential ID or provider evidence as browser authority. Repository Governance run `38142931704` passed 223 tests, TypeScript and production build.

No Vercel deployment, live Google OAuth/API request, Dataset V2 write or visual acceptance was performed by this repository result.
