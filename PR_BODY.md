# feat(migration): retry with backoff + maxDuration=300 for Loop flakiness

Ready to merge. Not draft.

## Why

On the morning of 2026-08-31, Loop's admin API went intermittently
degraded. `GET /admin/2023-10/subscription/{id}` alternated between
~40ms responses and 30s+ hangs. TCP handshake was clean (~30ms) — the
Loop API server itself was slow / unresponsive. This blocked the first
real prepaid-annual migration run.

Vercel's default serverless timeout is 60s. A single 30s Loop hang plus
a Shopify atomic-create round-trip is enough to blow the budget with
zero retry headroom, and any retry attempt at the caller level currently
gets no timeout at all (`fetch()` without an AbortController hangs
indefinitely on Vercel until the function is force-killed).

## What

Two new helpers wrap every external Loop and Shopify call with a
retry-with-backoff:

- `withLoopRetry(fn, { retries, baseMs, timeoutMs, label })`
  Defaults: `retries=3`, `baseMs=2000` (2s/4s/8s backoff), `timeoutMs=15000`.
  Applied to every `fetch` in `src/app/api/_lib/loopAdmin.ts`.
- `withShopifyRetry(fn, { retries, baseMs, timeoutMs, label })`
  Defaults: `retries=3`, `baseMs=1000` (1s/2s/4s), `timeoutMs=30000`.
  Applied to `subscriptionsGraphQL` (the fetch layer under every mutation
  and query in `shopifySubscriptionsApi.ts`, including `createContractAtomic`).

Both wrappers:

- Use a fresh `AbortController` per attempt (per-attempt timeout, not
  global). This is what fixes the "hang forever on a stuck TCP" case.
- Retry on: fetch timeout (AbortError), network errors (undici
  `UND_ERR_*`, `ECONN*`, `EAI_*`), HTTP 5xx, HTTP 429.
- Do NOT retry on: HTTP 4xx (except 429), GraphQL userErrors, or any
  other application-level error.
- Log every retry: `[loopAdmin] retry attempt N/3 for <label>
  (reason=..., backoff=Nms)`.

`maxDuration = 300` on the migration route is already in place (landed
in PR #128 alongside `maxDuration=300` on the martine-send and other
long-running admin cron routes; verified by grepping `maxDuration` in
`src/app/api/admin/`). No route.ts changes are required in this PR — the
route already calls `getLoopSubscriptionById`, `cancelLoopSubscription`,
and `createContractAtomic`, all of which now transparently retry.

## How the retry wrapper stays safe on non-idempotent operations

- **Loop reads** (`getLoopSubscriptionById`, `getLoopRawSubscriptions`,
  `getLoopSubscriptionStatus`): fully safe, idempotent by definition.
- **`cancelLoopSubscription`**: Loop's cancel is idempotent — canceling
  an already-CANCELLED contract returns success (documented in Loop's
  admin API + confirmed via existing segmentation.csv workflow, where
  re-cancels are no-ops). Explicit comment added in loopAdmin.ts.
- **Loop mutations** (`pauseLoopSubscription`, `resumeLoopSubscription`,
  `changeLoopSubscriptionPlan`, `reactivateLoopSubscription`,
  `swapLoopSubscriptionProduct`, `updateLoopSubscriptionLineAttributes`,
  `updateLoopSubscriptionNextBillingDate`): all set-desired-state, so a
  retry converges rather than compounding.
- **`createContractAtomic`**: retry-safe because the migration route
  passes `idempotencyKey: \`migrate_${contractId}\`` (verified in
  `route.ts:506` and unchanged by this PR). Shopify dedupes on that
  key. `createContractAtomic` now logs a WARN if called without a key,
  so future drift is visible.
- **Shopify draft lifecycle** (`updateContract`): each stage's
  userErrors are surfaced as plain `Error` and NOT retried, so a
  mid-draft retry can't double-apply variant/plan changes.

## How tested

New unit tests (7 per wrapper, 14 total). Live under `tests/lib/`, which
this PR wires into `vitest.config.ts` as a new `lib` project (previously
`tests/lib/golfStats.test.ts` was orphaned; that test now runs too).

`tests/lib/loopAdminRetry.test.ts`:

- succeeds on first attempt
- succeeds on 2nd attempt after transient network error (`TypeError: fetch failed`)
- succeeds on 3rd attempt after two AbortErrors (simulated timeout)
- fails after 3 retries exhausted (503 all the way)
- does NOT retry on 400 Bad Request
- DOES retry on 429 with backoff
- DOES retry on 503

`tests/lib/shopifyRetry.test.ts` — the same seven cases against
`withShopifyRetry`.

All new tests use `vi.useFakeTimers()` + `advanceTimersByTimeAsync` so
the 2s/4s/8s backoffs don't slow the suite. Existing PR #128 route
tests (`tests/api/migratePrepaidAnnual.route.test.ts`) still pass
because their fetch mocks return `ok: true` and never trip the retry
path. The pre-existing 11 failures documented in PR #127/#128 remain
untouched.

## Runtime safety envelope (from runbook)

- Loop worst-case: 14s backoff + 3 × 15s per-call = ~59s.
- Shopify worst-case: 7s backoff + 3 × 30s per-call = ~97s.
- End-to-end route worst-case: ~3 minutes with the current call
  sequence (Loop read → Shopify create → Loop cancel → downstream
  Firestore/subscribers updates), well within `maxDuration=300`.

## Failure recovery

If Loop is truly down and all 3 retries exhaust on the initial
`getLoopSubscriptionById`, the route returns 502 BEFORE any
`subscription_migrations` row is written. Rerun the migration when Loop
recovers — no cleanup needed. If retries exhaust AFTER Shopify create
but during Loop cancel, the existing PR #128 path applies: row goes to
`failed` with both ids and `loop_cancel_failed_after_shopify_create`,
manual reconcile via runbook.

## What was NOT changed

- Business logic in `migrate-prepaid-annual/route.ts` — untouched.
- `/account` UI — untouched.
- `SUBSCRIPTIONS_BACKEND` feature flag — not flipped.
- Existing `fetchWithRetry` semantics: replaced with the new
  `withLoopRetry` + `loopFetch`, but the observable behavior at every
  external call site is a strict superset (all the old cases still
  retry, plus timeout + 5xx + 429).
