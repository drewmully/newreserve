# MyMully: isolated Shopify pipeline wiring and test results

Status: September 22, 2026. The bounded, single-order live-test path is implemented and tested locally; it has not been deployed or run against customer data. This is not a claim that the full production analytics pipeline is finished.

Update: [L16 automatic processing](L16-automatic-processing-and-merge-checklist.md)
now wires the separate webhook queue to hydration, retained snapshots, candidate
facts and latest observed-order reports. Its opt-in scheduler and queue-health
checks are implemented, not hosted or activated. The single-order pilot below
remains available for the first isolated live test; the historical test counts
in this document describe that earlier pilot revision.

## Why merging was not necessary

Initial compatibility tests used an isolated local branch combining the existing PR stack with the then-latest fetched `main`. For publication, the changes were transferred onto the existing PR heads without importing unrelated `main` changes. Neither GitHub `main` nor MyMully's running application has been changed.

Before these updates, all 14 existing PRs (#146 through #159) reported `MERGEABLE` and `CLEAN`, with passing analytics checks and no recorded review approval. Updated heads require fresh CI; consult GitHub for current status. They are stacked, not 14 independent PRs targeting `main`; see the [first PR](https://github.com/drewmully/newreserve/pull/146) and [last PR](https://github.com/drewmully/newreserve/pull/159).

Do not merge the stack indiscriminately or infer that a green PR deploys the entire data pipeline. Merge approval, a paid isolated test, database migrations, and production activation are separate decisions.

## Implemented path

```text
Operator registers one approved shop/order and mapping policy
    -> authenticated, disabled-by-default HTTP runner claims a fenced lease
    -> fixed read-only Shopify GraphQL queries
    -> immutable source response retained in isolated Supabase
    -> original purchases + transactions + itemized sales/refunds mapped
    -> actual contract tables + physical single-order report committed atomically
    -> restricted reader can read only the unverified test report
    -> PostHog connection/readback after separate hosted-test approval
```

- **Source reader:** Explicit shop/token, fixed API version, bounded pagination and refund reads, revision checks, timeouts, no order discovery, and no Shopify mutations.
- **Financial mapping:** Original merchandise gross, all discount allocations, shipping, tax, original duty and itemized refunds. Every movement's component sum must match the independent source total. Refund transactions must also match the order's successful refund transactions.
- **Durable runner:** One frozen source snapshot and policy per registered run. Maximum five claims, 120-second fenced lease, 60-second source-read deadline, and replay without duplicate facts. Lost storage responses do not overwrite a potentially completed run with a failure.
- **Actual database writes:** Candidate `orders`, `order_items`, `sales_ledger`, and `payments`, plus the physical `lean_analytics.pilot_store_daily` report table. Facts, reports, and completion commit together.
- **Approval isolation:** The service role cannot register new run scope through the registration RPC. The database environment and shop/order/policy are registered by an operator; the runtime cannot choose arbitrary orders from an HTTP body.
- **Target protection:** The runner and database registration reject MyMully's known production Supabase project. The configured isolated project reference must match both the explicit database URL and the database's operator-registered environment.
- **Read-only report access:** A non-login `lean_pilot_reader` group can select only the sample output. Anonymous/authenticated clients cannot invoke pilot RPCs, including under broad Supabase default function grants.
- **No false certification:** Publications remain candidates. No certifications or production selection pointers change; every export row says `single_order` and `unverified`.

The source queries use the documented original-order fields and refund components; a refund object alone does not prove a successful refund, so the mapping checks its transactions as well ([Shopify Order](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order), [Refund query](https://shopify.dev/docs/api/admin-graphql/2026-07/queries/refund), [RefundLineItem](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/RefundLineItem), [RefundShippingLine](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/RefundShippingLine)).

## Deliberate pilot limits

Each registered run covers exactly one approved order, not all sales for its dates. Register additional approved orders as separate runs; never add their sample reports to a production dashboard as full-store totals.

- **Supported sample:** Fully paid, eligible, unedited, tax-exclusive USD orders with explicitly classified merchandise. Up to 500 original lines, 100 shipping lines, three refunds, and 100 components per refund connection; overflow or partial pages fail.
- **Blocked for review:** Edited orders, tax-inclusive prices, unknown/gift-card/other item classifications, non-USD orders, tips/additional fees, refund adjustments or duties, missing components, unresolved refund transactions, and values that do not reconcile.
- **Clock policy:** Sale at `paid_at`; refund at `refund_created_at`, only with a real financial-policy approval reference. Those policy choices are not silently inferred.
- **Cash withheld:** Successful Shopify transactions are stored, but no bank-settlement evidence is fabricated. Collected cash stays null.
- **Other domains withheld:** Customers, acquisition, spend, attribution and behavior are not supplied by this pilot. Their dependent metrics remain null.
- **Snapshot freshness:** A retry reuses the retained snapshot. A later source revision requires a new explicitly registered run; this pilot is not an always-current order feed.

## Tests actually run

All test Shopify records were synthetic, source-shaped responses. No customer order was downloaded, no hosted database was created, no hosted migration was applied, and no PostHog import was triggered.

| Check | Result | What it proves |
|---|---|---|
| New pilot integration suite | 18 passed | Actual source reader, mapper, runner, SQL migration and report code connected locally |
| Complete analytics suite | 297 passed in 19 files | New pilot plus prior 279 analytics tests |
| Analytics TypeScript check | Passed | Scoped compile/type compatibility |
| Analytics ESLint | Passed | Scoped lint |
| Generated SQL regeneration | Passed, no generated-file difference | Existing SQL generators remain reproducible |
| Git whitespace check | Passed | No diff-format issues |
| Full application suite | 632 passed, 11 tests failed, one suite-load failure | Whole application is not green |

The full-application results above are from the isolated compatibility branch, not a claim of green full-app CI on each PR. The failure names match the recorded baseline and earlier source-mapping run: blog routes (three), home document coverage, membership cart persistence (two), mulligan page, analytics dispatcher, inbound email, reply approval, mulligan API, and upgrade-modal suite loading. These failures were not repaired in this scoped analytics change.

The new tests cover:

- Original sale and next-day partial refund, with independently specified expected values: first day gross 20, discount 2, total sales 27; second day merchandise refund 5 and total sales -6.
- Duplicate invocation and a lost successful-finish response.
- Lost retain response, lease expiry, reuse of durable source, and rejection of a stale owner.
- Unsupported data retained for investigation without emitting facts or reports.
- Full transaction rollback when one report violates the cash-withholding rule.
- Read-only report access, denial of raw-data access and deletion, and removal of anonymous/client RPC permissions.
- Immutable run scope and rejection of the production target.
- Changed source revision, five truncated-connection cases, pending/failed refunds, missing refund allocation, unexplained totals and excessive refunded quantity.
- HTTP runner disabled by default, dedicated-secret authentication, and production-target rejection before database/network access.

These tests do not prove real Shopify credentials/scopes, a customer's actual catalog policy, hosted Supabase/PostgREST behavior, hosted latency, PostHog connectivity, or production correctness. The runner was exercised against real local PostgreSQL-compatible SQL through an in-process RPC transport, not a live PostgREST service.

## Hosted-test preparation

The following actions remain unexecuted and require explicit approval. Do not pay for a hosted branch until the intended sample, access, and configuration are ready.

### Runtime configuration

Only an isolated deployment or local server pointed at the approved isolated database may enable this route. Do not copy production environment fallbacks.

```text
LEAN_ANALYTICS_PILOT_ENABLED=true
LEAN_ANALYTICS_ENVIRONMENT=isolated-test
LEAN_ANALYTICS_PILOT_PROJECT_REF=<approved isolated project reference>
LEAN_ANALYTICS_SUPABASE_URL=https://<same reference>.supabase.co
LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY=<isolated database service key>
LEAN_ANALYTICS_PILOT_RUNNER_SECRET=<dedicated random secret, at least 32 characters>
LEAN_SHOPIFY_SHOP_DOMAIN=<approved shop>.myshopify.com
LEAN_SHOPIFY_ANALYTICS_READ_TOKEN=<dedicated authorized Shopify read token>
```

Supply secrets through the deployment secret store or secure credential flow, never in Git, this document, a PR, or chat. The pilot intentionally does not fall back to the operational `SHOPIFY_ADMIN_TOKEN`.

### Database and approved run

On the approved isolated database only:

1. Apply migrations `001_staging`, `003_receipts`, `004_worker`, `013_release`, `014_reporting_views`, `015_backfill`, and `016_shopify_pilot`, in that order.
2. As operator, insert the isolated project reference and actual test-approval reference into `lean_private.pilot_environment`.
3. As operator, call `public.lean_pilot_register` with a new UUID, exact shop, exact Order GID, approved policy JSON, actual test approval, and actor reference.
4. The policy must include the real catalog/eligibility decision, per-line classifications, financial approval reference, and the explicit supported sale/refund clocks.
5. Invoke `POST /api/analytics/ingest/pilot?run_id=<registered UUID>` with the dedicated bearer secret. A scheduler is not installed; the first test is manual.
6. Read back the stored source, actual fact tables, and sample report for that run. Independently compare the order and refund amounts to the selected Shopify source before considering the plumbing test successful.
7. Repeat the same invocation once. Confirm no second source read or extra rows.

A `503` during storage may be ambiguous. Retry the same registered run after its lease expires, not a newly generated run; committed completion returns `done` without duplicating work. Investigate a failed/exhausted run rather than silently changing its retained evidence or policy.

### PostHog readback

The database-side physical table and restrictive grants are implemented. The actual PostHog source is not created: it needs a reachable isolated database and a dedicated read-only login, which should only exist after hosted-test approval.

Use schema `lean_analytics`, table `pilot_store_daily`, a clearly named test source, and a login inheriting only `lean_pilot_reader`. Do not use the Supabase service-role key or database-owner credentials as the PostHog reader.

PostHog supports specifying a schema, selecting tables, TLS connections, scheduled full-table sync and live-query modes; it requires schema `USAGE` and table `SELECT` for the selected data ([PostHog Postgres source documentation](https://posthog.com/docs/cdp/sources/postgres)).

For the first readback, prefer the documented **Query live only** mode if the project's source UI exposes it; that avoids configuring recurring ingestion, but is not a promise of zero usage cost. If actual warehouse ingestion is required to test dashboards or joins, approve that separate sync scope and confirm how to pause it before linking, because the default mode is scheduled sync ([PostHog Postgres source documentation](https://posthog.com/docs/cdp/sources/postgres)).

PostHog uses IPv4 egress, so verify the chosen isolated Supabase host is reachable or use the appropriate pooler; do not purchase an IPv4 add-on without approval ([PostHog Postgres source documentation](https://posthog.com/docs/cdp/sources/postgres)).

Success requires matching run ID, row count, dates, six-decimal amounts and withheld/null fields between Supabase and PostHog. Verify that raw source tables and unrelated operational tables are inaccessible using the reader credentials.

## What still separates this from production

The narrow hosted-test path is wired, but the full production pipeline is not certified or activated. Outstanding work must not be presented as merely accepting an invitation.

- **Live validation:** Real read credentials, selected sample, actual catalog/financial approvals, isolated migrations and Supabase-to-PostHog readback.
- **Continuous ingestion:** The L16 receipt-to-report worker is now implemented. Approve source coverage/backfill bounds and validate real event delivery; a healthy observed queue does not prove complete historical coverage.
- **Scheduling/monitoring:** The opt-in dispatcher, counts-only health endpoint, staleness and audited dead-work retry are implemented. Hosting, cadence approval, log-alert delivery and operator ownership remain activation tasks.
- **Broader source coverage:** Settlement/payout evidence, identity/checkout/offer mapping, behavioral events and advertising sources.
- **Release:** Independent reconciliation and authorized certification/selection of complete publications, plus approved production reporting sources.

## Placement in existing PRs

The implementation is folded into the existing stack rather than creating four additional PRs. Publishing these branch updates does not merge any PR, provision a hosted database, or activate the pipeline.

- **[PR #152](https://github.com/drewmully/newreserve/pull/152), finance:** Original purchase/payment source mapping and source-shaped tests. Includes branch-specific Vercel review-deployment guards.
- **[PR #159](https://github.com/drewmully/newreserve/pull/159), release/testing:** Bounded financial source reader and sales/refund mapping; isolated run registration, retained source, leases, atomic fact/report writes and read-only export grants; authenticated runner, integration tests and this runbook.
- **Intermediate PRs #153–158:** Receive the updated finance ancestor without rewriting history. Their own functional scope is unchanged.

GitHub PR CI can run on publication. `vercel.json` disables Git-triggered deployments only for the eight updated review branches (`feat/analytics-l06-finance` through `feat/analytics-l13-release`); unspecified branches, including `main`, retain their prior behavior. This is a review-push guard, not approval to deploy or run a paid hosted test ([Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration)).
