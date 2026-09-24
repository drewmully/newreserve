# Permissions, draft checkout linkage and operations: implementation progress

This revision extends the code paths derived from the
[MyMully analytics workbook](https://docs.google.com/spreadsheets/d/1irN9OS5z6nJOU46jeAFnwv4h6oFJC5m-gkSGzrxFREA/edit?gid=103#gid=103)
without reading or mutating customer systems. It does not complete every source
integration, deploy, enable, schedule, certify, release or live-test them.

## Implemented workbook scope

- The ten normalized fact contracts and five reporting domains are represented
  by deterministic schema, transformations and metric-specific readiness.
- Shopify orders, lines, discounts, ledger movements, transactions, refunds,
  native offer memberships, creation history and update history have bounded
  source readers and durable jobs. Unsupported financial cases fail closed.
- Native PostHog behavior is read with a fixed project/window/family contract,
  property allowlist, row/byte limits and no person-profile query.
- An approved native campaign-token registry maps the first observed session
  action to channel/campaign context. Unknown tokens remain unknown; a later
  campaign is not substituted for missing entry context. Conflicting retries,
  simultaneous contradictory entries and reviewed/source disagreements fail.
- Explicit `behaviorMode=excluded` removes the PostHog read dependency from
  commerce refresh preparation, database registration and execution. It cannot
  silently follow a failed required behavior read. Browser-dependent metrics
  remain withheld and no diagnostic behavior view is generated in this mode.
- Google base spend has an approved account/window reader and durable job.
  Meta remains the workbook's explicitly future-authorized source, not a fake
  zero-valued feed.
- Identity snapshots, permission intervals, customer history, campaign context,
  reconciliation proofs and coverage controls enter through reviewed,
  source-bound evidence packets. Missing evidence withholds dependent metrics.
- Explicit analytics allow/withdraw decisions issue opaque, expiring
  same-origin cookies through a disabled-by-default policy authority. Withdrawal
  revokes the grant, records downstream deletion work, removes current exports
  and prevents old publications from being reselected.
- Storefront carts and authenticated REST draft orders can carry verified
  checkout context without changing checkout success. Draft-to-order linkage
  uses Shopify's explicit DraftOrder.order relation, never email or timestamps.
- Report domains may be certified, released and exported independently. Null or
  withheld metrics stay unavailable rather than becoming zero.
- Standing history feeds support bounded created-at and overlapped updated-at
  windows, durable watermarks, lag, stop times, per-run pages and daily budgets.
- Health monitoring follows the configured report subset, verifies each
  selected publication against its own export audit and actual export rows,
  watches expected history feeds and pending privacy removals, and never claims
  that database health proves PostHog synchronization.
- Explicit command-line dispatchers can advance saved refresh/history work and
  send a sanitized health alert. They install no scheduler and do not retry
  ambiguous source or alert delivery.

## Application and CI integration

The analytics preferences page is linked from policy navigation. Browser intent
and successful checkout actions have separate permissioned instrumentation.
Authenticated draft-order creation/reuse records the explicit draft relation.
Text Mully clicks are not evidence of inbound SMS activation. Analytics failures
remain auxiliary and bounded.

CI includes the analytics routes, preferences/policy surfaces, source scripts,
all migrations through 034, schema parity, TypeScript, analytics lint and the
changed application integration points. The Shopify draft source uses its own
`LEAN_SHOPIFY_ANALYTICS_READ_TOKEN`; it does not silently inherit the
application's write-capable admin token.

Local verification for this revision: **618 passing tests across 49 files,
zero skipped**, including ten real PostgreSQL integration/concurrency tests.
The other SQL-backed suites use PGlite. TypeScript, analytics ESLint, generated
SQL parity and whitespace checks pass. Changed application lint has no errors;
the Text Mully page retains two existing `no-img-element` warnings.

Additional regressions exercise the actual embedded Text Mully browser script,
crypto-only unique action IDs, one click listener per action, draft-source
malformed responses and scope limits, composite cart/draft checkout lineage,
commerce-only disabled registration/replay/conflict rollback, configured native
campaigns through attribution, scoped release rollback, and preserving withheld
cash alongside independently ready sales. Vendor transports are synthetic.

## Disabled operational configuration

The following settings describe deploy-time wiring. They are not enabled or
provisioned by this revision:

| Setting | Purpose |
|---|---|
| `LEAN_ANALYTICS_HISTORY_DISPATCH_ENABLED` | Allows an external approved scheduler to invoke the history dispatcher |
| `LEAN_ANALYTICS_HISTORY_FEED_SECRET` | Dedicated history-feed endpoint secret |
| `LEAN_ANALYTICS_HISTORY_MAX_CALLS` | Per-invocation page-call ceiling |
| `LEAN_ANALYTICS_MONITOR_DISPATCH_ENABLED` | Allows an external approved scheduler to run health checks |
| `LEAN_ANALYTICS_ALERT_ENABLED` | Enables one sanitized alert attempt per unhealthy invocation |
| `LEAN_ANALYTICS_ALERT_WEBHOOK_URL` | Exact approved HTTPS alert destination |
| `LEAN_ANALYTICS_ALERT_APPROVAL_REF` | Records that the alert destination/content was reviewed |
| `LEAN_SHOPIFY_ANALYTICS_READ_TOKEN` | Read-only token for approved draft-order relation extraction |

An operator must also create disabled-by-default policy, monitor and history
feed rows with the exact shop, project, domains, windows and approval records,
then explicitly enable only the reviewed scope.

## Remaining engineering, distinct from deployment

The existence of a table, adapter or evidence-packet contract does not finish
the following integrations:

- Wire the actual inbound Text Mully activation and checkout producer. The
  available application enrollment request does not establish inbound activation.
- Verify authoritative session-entry capture and coverage. The native campaign
  reader is implemented, but first-observed context is not proof that the actual
  visit entry was captured or that the approved lookback is complete.
- Integrate temporal identity and historical purchase/migration evidence.
  Current customer associations do not prove historical identity or completeness.
- Integrate original purchase evidence for financial cases the Shopify snapshot
  adapter rejects, and complete gateway/chargeback lifecycle sources.
- Extract independent source keysets/totals and refresh all evidence sections;
  add partition/assembly support beyond the bounded pilot report windows.
- Implement retention/erasure with verified downstream deletion, not merely
  queueing a withdrawal and hiding current exports.
- Assemble an unattended full refresh with new source-bound evidence on each
  cycle. Standing history dispatch and health alerts do not refresh the other
  evidence sections by themselves.

### Source boundary checked in this revision

The application calls a separate `mully-sms-agent` from its consult/enrichment
routes. GitHub code search under the available `drewmully` owner returned those
call sites, not the producer implementation. The visible `mully-ops` repository
is empty and the connected identity has read access only. This is not proof that
the service has no repository; its location/access is unresolved.

Follow-up: [L27](L27-sms-metadata-source.md) implements metadata acquisition
through the existing database, so locating another repository is not a
prerequisite for that read path. This does not by itself establish the missing
SMS-to-journey link, analytics permission, original event time or coverage.

The workbook describes the data contracts, but does not supply the missing
historical records, independently maintained controls, retention policy or SMS
producer source. Those cannot be recovered by inventing rows or changing a
coverage flag.

PostHog's [data deletion documentation](https://posthog.com/docs/privacy/data-storage)
documents asynchronous person/event deletion and a deletion-status check.
It does not establish a direct event-deletion path for this implementation's
profileless subjects. Do not mark downstream removal complete from a local
withdrawal, an accepted HTTP request, an absent person profile or an empty
bounded report query. The supported profileless deletion and warehouse-copy
cleanup paths must be established before claiming erasure is implemented.

## Separately approved hosted work

1. Apply migrations and secrets in an isolated hosted environment after approval.
2. Populate the real source inventory and externally maintained expected
   keys/totals for the exact Shopify, PostHog, identity, campaign and ad scopes.
3. Verify that source integrations use the approved authority and coverage.
   The code must not relabel an outbound SMS click as activation.
4. Reconcile customer history and cash lifecycle against independent controls.
5. Run controlled real-source reconciliation, then approve only supported
   report domains. Install the least-privileged PostHog query surface and verify
   readback/deletion separately.
6. Add the approved external schedules and alert destination, observe at least
   one complete incremental cycle, and retain a rollback path.

Meta Ads, extra subscription-outline tabs and business-specific offer taxonomy
beyond observed Shopify discounts remain optional/future workbook items.

## Safety boundary

This revision performs no customer source read, hosted migration, account
mutation, deployment, PR merge, schedule activation, alert delivery or paid
test. Synthetic vendor responses and disposable local PostgreSQL prove code
behavior, not customer totals or live synchronization.
