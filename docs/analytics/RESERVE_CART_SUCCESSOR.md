# Private prospective Reserve cart successor

`reserve-cart-runtime-v2` is a separate default-off capability for the existing
visit-choice, Reserve action and Storefront cart machinery. It is not a source
backfill, session-entry tracker, order reader or report activation.

## Scope and consent

The original `reserve-runtime-v1` resolver and SQL are unchanged. V1 still wins
runtime selection when available and still rejects cart receipts. The legacy
environment lane is not enabled. V2 grants cannot be used through that lane.

The new resolver runs only after v1 is unavailable, with the legacy server flag
off, on production/main and the exact existing Supabase target. It uses a
matching existing capture key, not a key supplied by the browser. Its only event
families remain `lean_reserve_started`, `lean_reserve_reveal` and
`lean_reserve_checkout`. The existing narrow membership checkout producer
conditions remain in force. Generic shop checkout, access plans, Style Game,
Text Mully and draft receipts are not new V2 capabilities.

The preferences page describes prospective cart linkage. V2 Allow submits
`policyVersion: "reserve-cart-runtime-v2"` alongside the decision. The server
rejects a stale V1 page's Allow under V2 and rejects a V2 choice after fallback
to V1. Existing V1 cookies do not become V2 grants. A genuine new choice creates
a new grant with its actual issuance clock. Withdrawal uses the unchanged
removal machinery, including after policy disable or expiry.

## Installation and future activation boundaries

`sql/analytics/proposed_journey_checkout_policy.sql` is review-only,
absent-only and transactional. It checks the delegated function body pins,
adds three default-off policy columns and adds separately named functions and
guards. It does not replace any old function, insert a policy or register a
source. It rejects duplicate/partial footprints and unsafe effective runtime
policy-write or helper-execute privileges.

An operator's future policy row must use these fixed targets:

```text
project_ref = xnfjdbpjuaezxjgargto
shop = mullybox-store.myshopify.com
posthog_project = 353503
policy_version = reserve-cart-runtime-v2
```

Actual `approval_ref`, `ttl_seconds`, `checkout_capture_key_sha256` and
`checkout_valid_until` remain UNSET in this patch. Visit TTL is 60 through
86400 seconds. Both `enabled` and `checkout_enabled` must be explicitly true
before the successor is available. The old `runtime_*` columns remain null
for this separate version. No policy values should be copied from tests.

The existing dedicated analytics connection and privately verified capture-key
binding must already target the fixed project. The future serving runtime also
needs the exact shop's `LEAN_SHOPIFY_STOREFRONT_TOKEN` and a dedicated
`LEAN_CHECKOUT_CONTEXT_SECRET` of at least 32 characters. Actual credentials
remain UNSET. Do not extract or log a key to populate this document.

The browser handoff additionally needs a separately approved build with
`NEXT_PUBLIC_LEAN_RESERVE_CART_ENABLED=true`. It defaults off. Do not turn on
`LEAN_ANALYTICS_JOURNEYS_ENABLED` or
`NEXT_PUBLIC_LEAN_ANALYTICS_JOURNEYS_ENABLED` as a substitute. A public build
flag does not authorize a grant or a receipt; the server checks the owner-bound
V2 capability and current visitor grant.

## Receipt behavior

The existing cart creation callers still pass their actual returned cart GID to
`recordJourneyCart`. The server checks origin, current grant, privacy signals
and optional authenticated principal, verifies that exact cart through the
fixed Storefront endpoint, and signs the existing context format.

The signed interval is capped by one hour, grant expiry and V2 policy expiry,
with at least 60 seconds remaining. After vendor I/O the server rechecks current
authority before requesting the receipt. SQL rechecks current policy under
locks and prevents accepting a withdrawn or changed grant. A cart already
bound to another grant does not silently move to the new session.

No cart secret key is stored. No campaign properties or personal profile fields
are added to the capture payload. A 204 from the cart endpoint intentionally
does not reveal whether a receipt was saved. PostHog HTTP acceptance is not
independent native-event delivery evidence.

An already accepted in-flight provider request cannot be recalled by later
disable or withdrawal. This patch does not claim downstream deletion or a
distributed transaction with Shopify/PostHog.

## What this does not measure

The workbook denominator, session derivation, reporting gates and maturity
rules are untouched. A grant's issuance is a browser choice, not necessarily a
visit entry. A first quiz/reveal/checkout action is not proven session entry.
The three-family population cannot be labeled all-site sessions.

Independent source-session entry coverage, sessionization and exact internal/
test/bot filters remain necessary for the workbook entry cohort. The retained
560 active custom page-event keys and 319 native session starts are distinct
diagnostics, not replacement denominators.

A signed cart receipt is not proof of payment. Existing verified webhook code
mirrors raw `orders/paid` JSON into `public.inbound_event.payload`; when genuinely
present, root `cart_token` is a source candidate. This patch neither reads that
table nor establishes payload retention, correct-shop provenance, exact order
identity, payment clock or coverage. The orders table projection does not retain
the cart token. No new order mapper or reader is installed. Do not retry the
invalid Admin GraphQL `Order.cartToken` query or resurrect the retired draft
route.

Campaign entry remains separate. The lean serializer still has no campaign
entry field. A campaign mapping registry is not a session-entry receipt or proof
of which campaign acquired an order. ROAS therefore does not become ready when
V2 records a cart.

Seven-day conversion plus 48-hour grace remains unchanged. A genuine prospective
session cannot mature sooner than nine days after its entry, and that clock
alone does not establish complete event/order coverage.

## Focused local validation

Only `tests/api/analyticsLeanReserveCartSuccessor.test.ts` is needed for this
checkpoint. It exercises the actual SQL functions, decision/cart routes,
signing/verification and runtime. Firebase verification, rate limiting and
vendor HTTP are isolated test ports. All grants, keys, carts and events are
synthetic fixtures, not live metric proof.

On a small sandbox, use V8 baseline WASM compilation to avoid PGlite compilation
memory exhausting the machine:

```sh
TZ=UTC node --liftoff-only --max-old-space-size=128 node_modules/vitest/vitest.mjs run --project api tests/api/analyticsLeanReserveCartSuccessor.test.ts --maxWorkers=1 --pool=threads
TZ=America/Los_Angeles node --liftoff-only --max-old-space-size=128 node_modules/vitest/vitest.mjs run --project api tests/api/analyticsLeanReserveCartSuccessor.test.ts --maxWorkers=1 --pool=threads
```

No broad old suite, production database, real vendor transport, browser journey,
deployment, policy registration or report release is part of this proof.
