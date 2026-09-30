# Finite recurring subscription observations — default off

049 extends the existing048 runtime; it is **not a new importer framework, live
activation, complete-store snapshot or revenue certification**. One immutable
owner-registered plan authorizes a finite number of bounded cursor scans. Repeated
dispatches make progress across pages and, when due, start the next permitted
scan. The scheduler does not register plans or receive private reporting access.

## Execution contract

1. Install/verify the separately approved047 → revised guarded048 package first.
   The revised048 guard permits only the exact retained **disabled** sales scope
   (`ea42194207c574df8b4a3872efffe0f365de67526855f7699267ae9da70003f9`);
   the other seven sales runtime tables must be empty. Do not install046.
2. Review/approve049 separately. It creates one private plan table, one private
   immutability/kill-switch trigger function, four service write-control RPCs and
   one owner-only report function. It creates **no plan or schedule**. Raw048 is
   unchanged. The current-run FK adds referential-integrity dependencies on048;
   purge a plan's references before deleting its child runs.
3. Owner records the approved finite plan with the fields below, leaving `enabled`
   false and all progress fields at defaults. The example INSERT shape is the
   same path exercised by the existing PGlite fixture; there is no service-facing
   registration endpoint or generic registration RPC.
4. After separate activation approval, configure the existing server-only
   analytics URL/service credential/project/shop/token/dispatch-secret bindings.
   Set `LEAN_ANALYTICS_SUBSCRIPTIONS_PLAN_ID` to the exact plan ID and leave
   `LEAN_ANALYTICS_SUBSCRIPTIONS_RUN_ID` empty. Setting both fails before DB/source
   access. RUN_ID mode remains the original048 one-attempt mode.
5. Only during the approved window enable the plan,048 singleton gate and
   `LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED=true`. An approved existing scheduler
   sends an authenticated **empty-body POST**, no query parameters, to
   `/api/analytics/subscriptions/process`. One invocation admits at most one Loop
   GET/page. No new route/cron entry is introduced in this patch.

| Owner-supplied field | Contract |
|---|---|
| `plan_id`, `project_ref`, `shop` | Immutable ID; approved target project; exactly `mullybox-store.myshopify.com`. Production reference is `xnfjdbpjuaezxjgargto`, independently verified by the operator. |
| `token_sha256`, `binding_ref` | Fingerprint of the explicitly bound Loop token; owner-reviewed shop/read-scope/version binding reference. Not provider introspection. |
| `approval_ref`, `traffic_approval_ref`, `actor_ref` | Actual plan approval, cross-caller store traffic arrangement and accountable owner references. These values cannot be invented by code. |
| `retention_ref`, `retain_until` | Approved retention/deletion owner reference and explicit deadline, after the scan window and no more than30 days later. Purge remains an owner obligation; no automatic deletion is claimed. |
| `from_time`, `until_time` | Finite start/end, at most seven days apart. No requests before start or after end. |
| `cadence_seconds`, `max_cycles` | Explicit minimum delay **after a finished scan**, 300–86400 seconds; at most96 scans. No catch-up burst or infinite recurring plan. |
| `max_pages`, `max_rows`, `max_bytes`, `page_size` | Per-scan totals, not per-invocation resets: at most20 pages /1000 raw rows /4,000,000 bytes; at most100 rows per page. Smaller approved values should be chosen. |
| `status_filter`, `policy` | Documented status or null; existing explicit status/dedup/subscriber-basis/renewal policy. Definition remains proposed; `recurringValue` must be null. |

Registration shape (parameterized owner SQL, **not resolved production values**):

```sql
insert into lean_private.subscription_scan_plans
  (plan_id,project_ref,shop,token_sha256,binding_ref,approval_ref,traffic_approval_ref,
   retention_ref,actor_ref,policy,from_time,until_time,retain_until,cadence_seconds,
   max_cycles,max_pages,max_rows,max_bytes,page_size,status_filter)
values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::timestamptz,$12::timestamptz,
  $13::timestamptz,$14,$15,$16,$17,$18,$19,$20);
```

Neither the metadata existence of `LOOP_ADMIN_API_TOKEN` nor installed Loop app
identity proves its shop, scopes or supported2026-04 permissions. There is no
automatic operational-token fallback. An owner may explicitly bind a verified
existing Loop token to `LEAN_ANALYTICS_SUBSCRIPTIONS_LOOP_TOKEN`; this does not
assume a new token is necessary. `SHOPIFY_SUBSCRIPTIONS_TOKEN` is **not** a Loop
substitute. No token was read, created, changed or tested by this implementation.

## Dispatch/progress semantics

The existing five-minute `analytics-production-dispatch.yml` workflow includes
an independent subscription job. Both repository variables
`LEAN_SUBSCRIPTIONS_SCHEDULE_ENABLED` and `LEAN_SUBSCRIPTIONS_DISPATCH_ENABLED`
must be true. Its `LEAN_SUBSCRIPTIONS_SCHEDULE_START_AT` and
`LEAN_SUBSCRIPTIONS_SCHEDULE_STOP_AT` are exact UTC millisecond timestamps with
a maximum seven-day window; they must match the approved database plan window.
The runner receives only the independent `LEAN_ANALYTICS_SUBSCRIPTIONS_SECRET`,
never the Loop token or database credential. `scheduled-subscriptions.mjs`
issues at most one empty-body POST per tick, rejects redirects, limits response
bytes, logs only a whitelisted state, and never retries an ambiguous response.
An unhealthy/halted result fails the workflow visibly, but no human notification
delivery is claimed. Sales flags do not enable subscriptions or vice versa.
Merging these default-off definitions does not approve their activation.

- Each page uses the existing048 120-second singleton lease, permit and immutable
  page-run payload. 049 copies only the registered plan's scope into deterministic
  bounded child run IDs; service cannot supply new scope/policy/limits or create
  new owner plans. The maximum authorized calls is finite:
  `max_cycles × max_pages`, further bounded by rows, bytes and time.
- Cursor encryption uses AES-256-GCM with domain-separated HKDF keys derived from
  the explicitly bound Loop token. AAD binds project, shop, plan, cycle and next
  page. No additional credential is provisioned. Keyed fingerprints detect cursor
  cycles across invocations. Rotation/mismatched token or corrupt cursor stops
  the scan, not a silent restart. Opaque cursors never enter retained plaintext.
- The collector's continuation callback is an internal transient channel. Its
  normal result/evidence remains cursor-free. Raw provider PII and cursor query
  values still exist transiently in memory/on the provider request; review
  platform tracing redaction for headers **and `afterCursor`** before activation.
- A page payload and its progress/continuation commit in **one transaction**.
  Exact finish replay is idempotent. Lost successful finish responses do not
  fetch that page again: the next dispatch resumes committed progress.
- A failed source/auth/rate/projection request halts and disables the whole plan.
  There is no failed-page retry and no automatic next-cycle recovery. A lost
  claim/expired ambiguous attempt also halts instead of risking duplicate reads.
- Ordinary return states are `observation_saved`, `waiting`, `busy`, `completed`,
  `disabled`, `expired`, `halted`, `failed`, `lost_lease`; storage ambiguity returns
  the existing redacted503. Waiting/busy/completed/disabled/expired do no Loop GET.
  Scheduler must stop the current dispatch batch on failed/ambiguous responses
  and defer waiting/busy. A later approved tick rechecks committed DB state; it
  never blindly replays a provider GET. It must not register replacement plans
  or reset attempts.
- Within a scan, subsequent scheduler invocations resume the next page. After a
  scan ends, the DB enforces its minimum cadence before another scan. An approved
  scheduler can poll more slowly; this is not a provider-consistency guarantee.
- The lease/cooldown coordinates only this analytics runtime/database. Loop's
  documented store-wide shared API pool still includes operational readers and
  other apps/keys. Broader use requires a reviewed shared traffic arrangement,
  not a claim that1.6-second pacing globally solves rate limits.

## Owner reporting, not global metrics

Owner SQL: `select public.lean_subscription_scan_report('<approved-plan-id>');`

The result provides the finite scope, phase/cadence, source-binding disclaimer,
per-cycle completed page references, captured raw-row counts, page capture times,
revision-conflict flag, and **`observedUniqueContractsInCapturedPages`**. That count
deduplicates pseudonymous contract keys among committed pages only. It remains
`observed_unverified` with `coverage=captured_pages_only`, including on pagination
end. A row may change between pages; conflicting revisions are flagged, never
silently treated as a consistent snapshot. Earlier committed pages remain visible
as partial observations if a later page fails.

The original six global metrics are **still null/withheld under their original
names**: active contracts, distinct subscribers, next renewal, renewal-window
count, proposedMRR and ARR. No full-store count, recurring-price inference,
customer count certification or historical trend is introduced. End-of-pagination
is labelled `pagination_ended_unverified`; budget stops are `budget_reached`.
Per-page details remain available only through048's owner-only report.

Disable the plan to stop further permits and disable its current child run;
disable the existing environment flag/global gate as the broader kill switch.
An in-flight GET cannot be un-sent. Plans/runs/ciphertexts must be purged by the
approved owner after leases settle and according to the recorded retention
deadline. 049's report refuses expired retention, but048 data remains at rest until
owner deletion; this is not an automatic purge system.

## Validation / live gates

Focused tests reuse the existing PGlite/RPC/source fixture: encrypted resumption,
cross-project/plan/page authentication, finite cadence/caps, total row/byte budgets,
cursor-cycle rejection, atomic progress/replay/lost responses, stale claims,
source429 halt, kill switches, actual service-role execution and owner-only reads.
Known default-ACL grants are explicitly closed; unknown recipients abort049.

No live authorization, provider smoke test, migration, schedule, source data
collection or production activation occurred. Genuine remaining gates are the
approved token-to-shop/read-scope binding, traffic policy, real schema acceptance,
retention/deletion owner, exact plan values and installation/deployment/activation
approval. Complete/consistent source authority and recurring monetary evidence
remain separate requirements that this partial-observation workflow cannot supply.
