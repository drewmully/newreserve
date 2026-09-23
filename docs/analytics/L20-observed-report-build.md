# L20: retained-source report build

This joins L17/L18 Shopify history with L19 Google Ads observations and persists
one private candidate transaction. It does not certify full-store completeness,
publish customer reports, or enable a schedule. No deployment or hosted test is
part of this PR.

## Implemented path

- An operator registers an immutable `lean_private.report_builds` row identifying
  the exact project, shop, completed history runs, spend runs, report dates,
  approved merchandise catalog/financial policy, approval reference and actor.
  There is no runtime registration grant.
- The default-off POST `/api/analytics/ingest/reports` reads that saved scope.
  It accepts no body or query parameters and needs a separate 32-character secret.
- Source reads are restricted to those retained runs. Disabled/incomplete sources
  block the build, rather than becoming zero spend or missing orders.
- The mapper deduplicates overlapping order revisions, applies the approved
  product classifications, and refuses unsupported orders. It does not silently
  drop edited/tax-inclusive/cancelled/non-USD/gift-card orders.
- Stored facts and three report tables are written atomically. Store/product
  observations and campaign spend are labeled `observed_unverified`; cash,
  customer counts, attributed revenue, ROAS, NCAC and MER remain withheld.
  The acquisition table contains spend dimensions only, not attribution.
- The source snapshot hash is checked again under source-job locks at commit.
  Duplicate completions are idempotent. A lost response is resolved by reading
  state on the next invocation, never by automatically replaying a write.

## Boundaries and rollout

Apply migration 020 only after 001/013/014/018/019 in an explicitly approved test
database. This is an instruction, not an action performed by this PR.

Limits: five history runs, 25 retained pages, 100 source orders, 100 selected
spend runs, 10,000 campaign rows, 31 report dates, 20,000 product/date rows,
5 MB source payload and 16 MB output payload. Larger approved scopes need bounded
partitioning and reconciliation; do not simply remove these safeguards.

Keep `LEAN_ANALYTICS_REPORTS_ENABLED` unset until approved. Activation also needs
`LEAN_ANALYTICS_REPORTS_SECRET`, `LEAN_ANALYTICS_REPORTS_RUN_ID`, the explicit
`LEAN_ANALYTICS_PIPELINE_PROJECT_REF`, `LEAN_ANALYTICS_SUPABASE_URL` and
`LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY`. Source tokens are not needed by this
build; it makes database calls only. No cron or PostHog source is installed.

All results stay in `lean_private` with publication state `candidate`. Existing
selected views do not show these rows. Do not certify this observed-only build
as a complete release: independent account/history coverage, source totals,
financial policies, identity/consent, session/attribution and cohort evidence
remain separate requirements. There is no new PostHog reader grant.

## Tests

Synthetic retained Shopify + Google inputs exercise mapping, exact monetary sums,
private SQL materialization, duplicate execution, incomplete/disabled sources,
wrong targets, immutable scope, unsupported orders, incompatible currency,
transaction rollback, stale snapshot rejection, lost-response recovery, hosted
default privilege removal and default-off request guards. No customer data or
paid hosted resources are used.
