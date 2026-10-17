# A6-EO-04-D Klaviyo reauthorization truth brief

**Status:** Repository implementation ready for visual acceptance  
**Checked:** 17 October 2026

## Analyst outcome

When an explicit Klaviyo provider operation proves that authorization is no
longer valid, reporting authority is already removed fail-closed. Settings must
show that same canonical lifecycle truth. It must not translate
`reauthorization_required` into `Not connected`.

The correction is a local lifecycle read. Opening Settings does not call
Klaviyo, refresh a token or retry a failed provider request. Historical spend
periods remain unchanged.

## State matrix

| State | Merchant copy | Action | Result |
|---|---|---|---|
| Loading | `Klaviyo setup is being updated…` | none | Duplicate action is prevented |
| Disconnected | `Not connected` | `Connect Klaviyo` | Starts a new authorized setup |
| Pending | `Account selection required` | `Resume setup` | Returns to account and spend completion |
| Connected | `Connected` | Existing spend and disconnect actions | Local verified authority is shown |
| Reauthorization required | `Reauthorization required` and `Klaviyo authorization is no longer valid. Reconnect to continue.` | `Reconnect Klaviyo` | Starts OAuth; no reporting resumes before verified completion |
| Error | Existing bounded public error code | Reload or restart according to error class | No hidden retry |
| Cancel | Existing cancelled notice | none | No account is connected |

## Shopify component mapping

| Visible element | Component | Exact property | Official source | Checked |
|---|---|---|---|---|
| Lifecycle status | `s-badge` | `tone="warning"` | https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/badge | 17 October 2026 |
| Reconnect action | `s-button` | `variant="primary"` | https://shopify.dev/docs/api/app-home/latest/web-components/actions/button | 17 October 2026 |
| Explanation | `s-paragraph` | existing default | Shopify App Home web components | 17 October 2026 |

No new visual component, CSS, color, layout or product surface is introduced.
The already accepted desktop/mobile Settings presentation is reused.

## Backend and data boundary

- Only `connected` remains reporting authority.
- `reauthorization_required` remains fail-closed and cannot produce new rows.
- Settings reads canonical local lifecycle state without provider access.
- OAuth retry, provider fallback, secret, deployment and live Klaviyo calls are
  outside this repository correction.
- Spend history is neither deleted nor rewritten.
- After OAuth reauthorization, pending account verification remains resumable
  even though the historical account record still exists. Reporting stays
  closed until fresh account evidence and spend completion succeed.

## EO-05 mandatory follow-up

Reauthorization can create a time interval with no provider collection while
the merchant is unaware. EO-05 must define and test all of the following before
scheduler or Dataset V2 acceptance:

1. the exact missing business-date interval from the last successful provider
   checkpoint through verified reconnection;
2. bounded provider-specific backfill and reconciliation windows;
3. explicit `missing`, `partial`, `stale` and recovered states, never invented
   zeroes;
4. what the merchant sees before, during and after recovery;
5. the point at which recovered dates can become provisional or final;
6. behavior when the provider cannot return the full missing interval.

## Acceptance

- Lifecycle read is installation-, generation- and provider-scoped.
- A stored `reauthorization_required` row maps to the Settings reconnect state.
- Reauthorization can resume pending account verification without deleting the
  historical account or spend ledger.
- No provider request is made by Settings inspection.
- Connected, pending and disconnected behavior does not regress.
- Repository tests, typecheck, build and Shopify UI guards pass.
- Real desktop/mobile visual acceptance remains required before merge because
  Settings behavior is affected, even though the visual components are
  unchanged.

## Official sources

- https://developers.klaviyo.com/en/docs/set_up_oauth
- https://shopify.dev/docs/api/app-home/latest/web-components/feedback-and-status-indicators/badge
- https://shopify.dev/docs/api/app-home/latest/web-components/actions/button

## Repository verification

- Complete tests: 361/361 PASS
- TypeScript verification: PASS
- Production build: PASS
- Diff whitespace validation: PASS
- Live database migration, provider call or deployment: none

