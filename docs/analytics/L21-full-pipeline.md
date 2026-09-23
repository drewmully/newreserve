# Full analytics pipeline: implementation and activation boundary

This extends the retained Shopify/Google Ads build into all ten core fact
contracts and all five reporting contracts. It is a bounded, evidence-driven
batch implementation, not an already-running customer deployment.

The source of scope is the [MyMully analytics workbook](https://docs.google.com/spreadsheets/d/1irN9OS5z6nJOU46jeAFnwv4h6oFJC5m-gkSGzrxFREA/edit?gid=103#gid=103).
The workbook's documentation and policy tabs are not separate ingestion jobs.
Configuration values in synthetic fixtures are examples, not customer approvals.

## Implemented execution path

1. `lean_full_next` validates the saved dependency inventory and selects exactly
   one unfinished Shopify history job, Google account/day job, retained-source
   report build, or full build. It validates all dependencies before starting a
   vendor read. It does not discover accounts or register new work.
2. The existing history and spend adapters retain their bounded observations.
   The commerce build creates one combined private base, not sums of per-order
   ratios. Overlapping order revisions are deduplicated.
3. The full build claims a 120-second lease before its PostHog query. At most
   three attempts can claim the saved full job. Completed runs do not query
   PostHog again. A lost completion response is not automatically replayed.
4. Native PostHog events are read through fixed, allowlisted HogQL columns,
   normalized and logically deduplicated in memory, then joined to temporal
   identity evidence, measured sessions, corroborated checkout evidence and
   configured attribution. No native event copy is persisted.
5. Original-purchase replacements, settlement evidence and offer membership
   complete the commerce facts. Customer history and mature cohort coverage
   control acquisition and LTV eligibility.
6. All ten fact domains and five report domains commit atomically into one
   private candidate. Numeric database values remain decimal strings. The
   source/configuration hash, lease and base kill switch are rechecked at commit.
7. A separate operator-only release checks coverage and expected prior
   selections, certifies the reviewed candidate and selects all five domains
   atomically. Runtime credentials cannot invoke release.
8. A separate operator-only export copies the five selected reports into
   physical reporting-only tables for a PostHog PostgreSQL source. Runtime
   credentials cannot invoke export or provision reader credentials.

## Contract coverage

| Domain | Implementation | Evidence or coverage needed for usable metrics |
|---|---|---|
| `customers` | First eligible purchase and history classification | Complete source history, migrations and current analytics permission |
| `identity_map` | Versioned temporal mappings, conflict/removal handling | Verified identity authority and analytics-permission intervals |
| `orders` | Original purchase values, eligibility and checkout linkage | Source purchase snapshot, explicit policy and corroborated checkout |
| `order_items` | Original quantities, merchandise classification and allocation | Original line evidence and approved classifications |
| `sales_ledger` | Signed component movements and reversal lineage | Independently reconciled sale/refund movements |
| `payments` | Separate cash settlement semantics | Actual settlement evidence; processed time is not settlement time |
| `order_item_offers` | Evidence-backed memberships | Authoritative offer IDs and mapping version |
| `sessions` | Deduplicated, measured sessions and conversion maturity | Native event coverage, stable action/session IDs and permission |
| `marketing_spend_daily` | Google Ads account/campaign/day bases | Complete approved inventory, closed days, compatible currency/timezone |
| `order_attribution` | Versioned configured first-party attribution | Complete lookback, identity, campaign and grace-period evidence |
| `store_daily` | Store totals, AOV, cash, new customers, MER and NCAC | Relevant reconciled domains; missing inputs remain null |
| `product_daily` | SKU/offer metrics and allocations | Original item values and reconciled ledger allocation |
| `acquisition_daily` | Spend, attributed orders/revenue and first-party ROAS | Reconciled spend plus complete attribution |
| `customer_cohorts` | Mature cohort revenue LTV | Full cohort month/history, eligible horizon and ledger lineage |
| `funnel_daily` | All measured sessions, configured stages and conversion | Complete measured coverage and mature conversion window |

`analytics_events` is currently an in-memory logical relation used by the full
build, with only counts, coverage and a digest persisted. A saved queryable
PostHog `analytics_events` view is NOT installed by this change. Existing journey
collection helpers are NOT newly wired into every customer journey here.

## Inputs that must not be invented

`FullBuildPolicy`, `FullBuildEvidence` and `BehaviorSource` are the executable
input contracts. They are saved by an operator in an immutable `full_builds`
record, not accepted from an HTTP request.

The implementation consumes the following evidence but does not automatically
extract it from an unverified customer authority:

- Historical identity/analytics-consent intervals, current permission and removals.
- Complete customer/order history across the approved source inventory.
- Corroborated checkout/session links and first-party campaign context.
- Original purchase snapshots for unsupported edited, cancelled, non-USD,
  gift-card or tax-inclusive cases.
- Bank/gateway settlement evidence and offer memberships.
- Independently extracted reconciliation keys/totals, date coverage and the
  external join controls.

These are real production integration inputs, not optional paperwork. Existing
Firebase authentication or email/SMS marketing consent must not be substituted
for analytics permission. Expected totals must not be computed from the output
being tested. If authority/evidence is missing, affected values stay withheld
or the build stops. No claim of an unattended complete live pipeline is made.

For legacy event families, explicitly map the existing action, session,
identity and boolean analytics-permission properties. Missing or non-boolean
permission is false. Existing events without usable permission cannot silently
become consented sessions. No IP, URL, email or person-profile properties are
requested by this adapter.

### Unsupported current Shopify snapshots

The normal mapper still refuses unsupported snapshots. An operator may instead
save `policy.deferredOrders` on the base report job:

```json
{
  "deferredOrders": [{
    "orderGid": "gid://shopify/Order/1",
    "sourceUpdatedAt": "2026-01-01T13:00:00Z",
    "evidenceRef": "APPROVED_ORIGINAL_PURCHASE_EVIDENCE"
  }]
}
```

This is an explicit handoff, not a skipped error. The observed source revision
must match, all partial base commerce totals are withheld, and the full build
requires exactly one matching original-purchase replacement with the same
revision and evidence reference before any PostHog read. Unsupported orders
without an approved replacement still block.

## Bounds and readiness

- One batch: at most 31 report dates, 100 selected source orders, five history
  jobs, 25 maximum history pages and 100 spend jobs. The sum of saved history
  page-size times maximum pages cannot exceed 100.
- PostHog: at most 93 days and 10,000 native events, with a `maxEvents + 1`
  overflow check and an 8 MB response limit. Overflow fails rather than sampling.
- Fixed allowlisted US/EU hosts and event/property names; no arbitrary SQL from
  callers. Redirects are refused.
- A short source query cannot certify a longer attribution lookback or maturity
  period. Coverage claims are clamped to the actual source window.
- Full inputs: 8 MB; output: 16 MB; each report domain: at most 20,000 rows.
- All new results are `observed_unverified` or `withheld`, stale and private
  until separately reconciled and released.
- Bounds are workload safeguards, NOT a dollar cap. Repeated approved
  invocations can still incur cost. Do not promise a $5 or $50 maximum without
  checking customer billing and enforceable controls.
- This is snapshot processing. Refreshes require new immutable run IDs and fresh
  evidence; a completed job is not an automatically updating daily pipeline.

## Deployment steps, not executed by this PR

1. Review and merge the stack in order: #162, #163, #164, #165. Keep all runtime
   flags off. Merging is not permission to deploy, query sources or spend.
2. In an approved isolated database, apply dependencies through migration 020,
   then 021, 022, 023 and 024 in order. Migration 023 intentionally creates a new
   `lean_posthog_reader` NOLOGIN role and refuses an existing name. Do not bypass
   a role collision or apply migrations blindly to production.
3. Populate disabled history/spend/base/full job records with exact source
   scopes, policy, evidence, approval and actor references. The fixture is a
   shape example only; never install fixture IDs or its all-passed controls.
4. Configure server-side secrets and the explicit target:

| Setting | Purpose |
|---|---|
| `LEAN_ANALYTICS_SUPABASE_URL` | Exact `https://<project-ref>.supabase.co` |
| `LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY` | Dedicated server-only runtime key |
| `LEAN_ANALYTICS_PIPELINE_PROJECT_REF` | Explicit database project |
| `LEAN_ANALYTICS_FULL_RUN_ID` | Exact saved full job |
| `LEAN_ANALYTICS_FULL_SECRET` | Dedicated secret, at least 32 characters |
| `LEAN_SHOPIFY_SHOP_DOMAIN` | Exact saved shop |
| `LEAN_SHOPIFY_ANALYTICS_READ_TOKEN` | Read-only approved Shopify source access |
| `LEAN_GOOGLE_ADS_OAUTH_CLIENT_ID` | Approved Cloud project OAuth client |
| `LEAN_GOOGLE_ADS_OAUTH_CLIENT_SECRET` | Server-side OAuth secret |
| `LEAN_GOOGLE_ADS_REFRESH_TOKEN` | Approved account read access |
| `LEAN_POSTHOG_QUERY_READ_KEY` | Scoped read/query access to the saved project |

Google's dated [developer-token sunset guide](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
takes precedence over older token-header examples: access follows the OAuth
Cloud project, and developer tokens were sunset September 9, 2026.

5. After approval for the exact isolated test and cost scope, enable only its
   saved jobs and `LEAN_ANALYTICS_FULL_ENABLED=true`. An authenticated empty-body
   `POST /api/analytics/ingest/full` performs one bounded saved step. No query
   parameters are accepted.
6. For bounded dispatch, additionally configure `LEAN_ANALYTICS_RUNNER_ORIGIN`,
   `LEAN_ANALYTICS_FULL_DISPATCH_ENABLED=true` and
   `LEAN_ANALYTICS_FULL_MAX_CALLS` (default 5, maximum 128), then run
   `node scripts/analytics/dispatch-full.mjs`. It continues only on a successful
   `partial` checkpoint, not errors, blocked work or busy leases. No scheduler
   is installed by this PR.
7. Independently reconcile the candidate and review privacy/history coverage.
   Only an authorized operator may call `lean_full_release` with all five
   expected previous selections, approval, reconciliation and actor references.
8. Only after release and separate export approval may that operator call
   `lean_full_export`. Create the reader credential and PostHog source separately.
   Never use a Supabase service-role key as the warehouse reader.

### PostHog reporting handoff

The export consists of physical tables in `lean_export`, not private fact tables
or ordinary views. `lean_posthog_reader` has SELECT only on the five exports,
no private-table access, no writes and no replication privilege.

[PostHog's PostgreSQL source documentation](https://posthog.com/docs/data-warehouse/sources/postgres)
describes full-table, incremental, append, xmin and CDC modes. For these
replacement snapshots, do not use append-only or xmin and assume deletions
propagate. Validate full-refresh replacement/deletion behavior in isolation.
CDC and replication privileges are not part of this implementation.

The database export transaction is atomic, but separate PostHog table imports
are not a single transaction. Before exposing results, read back the same
publication ID, row counts, key uniqueness and independently reconciled totals
for all five imported tables. Confirm access controls in PostHog separately.
No warehouse source, saved view, dashboard or report was created in the live UI.

## Test and rollback checklist

The final local regression on September 22, 2026 (Pacific) passed 419 tests
across 30 files with zero skipped, including seven real PostgreSQL concurrency
tests. Analytics TypeScript, ESLint, generated-SQL parity and diff checks passed.
This is not a claim that unrelated whole-application tests are green.

- Run `npm test -- --project api tests/api/analyticsContracts.test.ts tests/api/analyticsLean`.
  Set `LOCAL_POSTGRES_TEST_URL` only to the guarded loopback disposable
  `analytics_test_pipeline` database with `fixture_owner` to include concurrency.
- Run `npx tsc --project tsconfig.analytics.json` and the analytics ESLint command
  in the CI workflow.
- Regenerate staging/report-view SQL and confirm no generated drift.
- Local tests cover a $20 sale/settlement, $5 spend, one eligible customer and
  session, MER 4, NCAC 5, ROAS 4, revenue LTV 20 and conversion 1. They also cover
  missing controls, incomplete coverage, deletion/permission, exact decimals,
  wrong targets, immutable configuration, duplicate workers, lost responses,
  all-or-nothing writes, operator-only release and reader isolation.
- Local synthetic success does not establish real account access, real
  PostHog response mapping, real authority evidence, hosted permissions,
  cost, source totals or warehouse freshness.
- On failure, disable full dispatch and full endpoint, then disable the exact
  saved jobs. Stop source sync separately if activated. Do not drop operational
  customer tables. Read saved completion/lease state before retrying.
- Restore reviewed prior report selections through the existing operator
  compare-and-swap selection path, then re-export/re-sync deliberately.
  Do not assume the old PostHog copies change when a SQL selection changes.

## Remaining live integration work

Code can be reviewed and merged while disabled. Customer authority adapters
for the evidence list above, missing journey instrumentation/consent collection,
the queryable event diagnostic view, real secret provisioning, isolated
deployment, source reconciliation and PostHog sync validation are not proven
complete by these synthetic tests. Treat those as explicit remaining work,
not as a reason to fill missing evidence with guessed values.
