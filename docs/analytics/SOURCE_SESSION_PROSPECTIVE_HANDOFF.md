# Prospective sessions and order association

This repair changes two existing collectors. It does not activate them, create a
visitor choice, change tracking, add events or change the working traffic cron.
It is based on Production `fa91e83d7aba62cd6d1fbf16033bccba53399cd4`.

## What is usable now

The parent verified website aggregate ingestion in job1990 on October 8. Its
closed October 7 UTC rows contained 189 distinct IDs on filtered `page_view`,
zero recorded `account_created` events and zero recorded `purchase` events.
These are event observations, not unique people, measured sessions or paid
conversion. They remain useful independently of this optional session lane.

The retained read-only authority snapshot had no v3 policy, visitor grants or
native receipts. It does not supply historical consent or a measured denominator.
No new live inspection was made for this repair.

## Two implementation fixes

The layout already starts `recordSourceSessionNavigation` on real navigation.
The existing Storefront checkout already calls `recordSourceSessionCart` before
redirecting. Previously the cart call could reach the server while navigation's
status or native bind was still pending. The server correctly refused an unbound
cart, but the client did not order the two operations.

The cart collector now waits for all already-started navigation work. A later
navigation finishing or refusing cannot erase an earlier pending bind. Waiting and
the cart request share the existing two-second post-status budget. If waiting
uses that budget, the optional association is skipped and checkout continues.
The client rechecks expiry and reads the SDK's current session ID before dispatch;
it does not send a stale session after waiting. It never starts navigation or a
bind from checkout. A reload without a local pending navigation can still ask the
server to associate a previously verified binding. The server remains the
authority, and HTTP202 is not a retained receipt.

The whole-day native reader now accepts only absent, null or false `hasMore` and
sends the fixed top-level `refresh: "force_blocking"`. This is the same provider
response/request contract established during the traffic repair. Cached,
incomplete, errored, truncated or malformed results remain refused. Its SQL,
native membership, six filters, one-request limit, 1,001-row sentinel, 1-MiB body
cap, five-second request limit and fifteen-second producer budget are unchanged.

Focused tests first reproduced the pending-bind race and nullable-response
failure against the released files. An overlapping-navigation regression also
reproduced the first candidate's premature clearing of pending work. After the
repair, all 21 cases pass under
UTC and America/Los_Angeles. These execute the real client functions and native
reader with synthetic network responses. They do not represent real visitors or
payments. Existing authority/SQL, native binding, Storefront verification and
HMAC receipt proofs are reused, not rerun or replaced by client mocks.

## Existing emitted path

1. `https://www.mymully.com/analytics-session-preferences` shows the existing
   optional choice. A visitor must actually press Allow. The decision route
   records `source-session-runtime-v3` authority and sets the separate HTTP-only
   `__Host-mully_source_session` cookie. An earlier Reserve preference does not
   count. The Allow handler does not reset the SDK or emit a session entry.
2. A later real native session must begin within the visitor's permission
   interval. Real navigation sends only the existing SDK UUID to `/bind` after
   an active server status. The server independently reads that exact native
   entry, its source clock and six filter results before storing a receipt.
   A visit that began before Allow remains ineligible.
3. `shopifyCheckout.ts` already passes the actual Storefront cart ID to `/cart`.
   The route verifies that cart with the fixed shop, signs its native-session
   context and rechecks current authority. No matching binding means no receipt.
4. The existing `orders/paid` webhook calls `recordSourceSessionPaid` after HMAC
   verification and before business deduplication. Only a matching authorized
   cart can produce a v3 paid-root receipt. It does not infer `paid_at` from an
   order's created, processed or updated timestamp.
5. `sourceSessionPaidEvidence` separately requires the exact order's independently
   established successful-transaction `paid_at`, matching native/cart evidence,
   current authority, payment within seven days and arrival within nine days of
   session start. A positive link is not paid-population completeness.

This patch does not alter those server checks, SQL functions, choice text,
checkout caller or webhook. No SDK capture, initialization, identification or
reset is introduced.

## One prospective operating decision

If it has not already been approved, the parent needs a decision to make the
existing optional choice available prospectively for a finite operating period.
This is distinct from silently enrolling visitors. The visitor still chooses,
GPC/DNT still decline, and withdrawal still works. It does not authorize
historical consent, new event families, advertising activation or attribution
from unrelated identities. Technical owner fields and existing keys are setup
work for the operator, not questions for the user.

### Exact destination and configuration scope

The destination is only Production/main at `https://www.mymully.com`, Supabase
project `xnfjdbpjuaezxjgargto`, Shopify shop `mullybox-store.myshopify.com` and
PostHog project `353503`. Do not change Preview, Reserve v1/v2 or the aggregate
traffic/Google/Meta flags and schedules.

The operator verifies existing values privately, without printing secrets:

- `LEAN_ANALYTICS_PIPELINE_PROJECT_REF`, `LEAN_ANALYTICS_SUPABASE_URL` and
  `LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY` for that exact database.
- `LEAN_POSTHOG_PROJECT_ID`, `LEAN_POSTHOG_QUERY_READ_KEY` and the private fixed
  `LEAN_POSTHOG_TEST_ACCOUNT_FILTERS`. The prior setup and actual aggregate query
  already proved these capabilities; this patch does not request another key.
- `LEAN_SHOPIFY_WEBHOOK_SECRET`, `LEAN_SHOPIFY_STOREFRONT_TOKEN` and
  `LEAN_CHECKOUT_CONTEXT_SECRET`, the last with at least 32 characters. Missing
  cart capabilities withhold association, not commerce.
- Only after the operating approval, set server
  `LEAN_ANALYTICS_SOURCE_SESSIONS_ENABLED=true` and build-time
  `NEXT_PUBLIC_LEAN_SOURCE_SESSIONS_ENABLED=true` for the approved release.

No current secret values or live flag settings were read here. The retained
absence of an enabled policy makes the lane unavailable even if an environment
flag is present. The public flag requires a new build; it is not a runtime toggle.

The existing owner-only `lean_private.journey_policies` row uses this fixed
project/shop/PostHog tuple and `policy_version='source-session-runtime-v3'`.
The operator binds the actual approval reference, `ttl_seconds` from 60 through
86,400, `enabled=true`, `source_session_enabled=true`, a finite UTC
`source_session_valid_until`, and exact UTF-8 SHA-256 fingerprints in
`source_session_webhook_sha256` and `source_session_read_sha256`.
`lean_source_session_config()` computes the config token. Do not fabricate it or
insert visitor grants. The policy cutoff stops later matching too, so its period
must be stated honestly rather than implying every late cohort will mature.

The immediate reversible stop is `enabled=false` on that one owner policy row.
It stops new capture and later matching without deleting authority or receipts.
The public flag can also be removed in a subsequent build. Keep the fixed
database access available for withdrawal; do not delete grants, extend old
intervals, backdate evidence or change other policies as a rollback.

### First actual acceptance

After an approved release/configuration, confirm the existing page offers Allow.
Then observe a genuine visitor choice, a later naturally started native session,
a retained `/bind` response and a real verified Storefront cart association. Do
not reset the SDK, invent an earlier start or count a mock visitor as production
evidence. Test accounts still receive the fixed exclusions. A natural paid order
can later test the exact webhook/independent-transaction join; no purchase is
required merely to make the implementation tests pass.

Use bounded receipt status/count/hash evidence, not contact or event dumps.
Any source query, credential operation or live write remains a separately
bounded parent operation. This document is an input contract, not executed SQL.

## What remains unavailable

The existing producer requires a complete independent native-day inventory and
before/after current authority. If an unmatched native entry overlaps a possibly
permitted interval, its eligibility stays unknown. A successful receipt list is
not the complete population, and zero retained permissions is not historical
proof of exclusion. This repair improves positive association; it does not
claim to solve every opted-but-unbound case or recover old consent.

There is also a concrete namespace distinction in the current emitter.
`tracking.ts` generates a `session-...` browser-storage identifier for its custom
server events, while this v3 collector reads the PostHog SDK's native UUID. Those
are not interchangeable. No timestamp-based correspondence or automatic merge
is made. This patch does not change either emitter or add an association field.

The released source-session report packet remains entry-first with actions and
paid-population completeness explicitly unavailable. Its registered full-run
path is callable through `runSourceSessionReport`; this patch does not create
recurring report authority or schedule it. Positive-order helpers cannot certify
all eligible paid orders or the 48-hour arrival allowance. Those source/coverage
inputs are separate from the already functioning website aggregate ingestion.

First-party ROAS also needs accepted native entry campaign context and compatible
paid revenue/spend. The existing 90-day cart attribution blob is not substituted
for that evidence. Thus historical measured-session totals, mature session
conversion rates and first-party ROAS remain unavailable where these inputs are
missing. Supported sales, customer and advertising reporting must not wait for
them or for F3 cash reconciliation.
