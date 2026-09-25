# Production schema preparation, not analytics activation

## Scope

The smallest useful schema-only set is `001_staging.sql`,
`013_release.sql`, and `014_reporting_views.sql`. It creates ten private
business-fact tables, six control tables, five private report-storage tables,
and five empty reporting views in `lean_private` / `lean_analytics`.
It does not replace or modify `public.orders`, `public.order_line_items`,
`public.customers`, `public.marketing_spend_daily`, `analytics_staging`,
or `analytics_analytics`.

This is preparation only. No source data is copied, publication certified or
selected, runtime job installed, credential provisioned, schedule activated,
PostHog source connected, or report made publicly accessible. The cleaned
events relation is a logical transform, not another table created here.
Do not describe this installation as complete spreadsheet/live acceptance.

## Why the release ACL patch is required

The old 013 revoked the two public release functions only from PUBLIC.
Explicit creation-time EXECUTE grants to `anon`, `authenticated`, and
`service_role` survive that revoke. The corrected 013 removes those grants,
then restores only service-role execution of `lean_mark_publication_stale`.
Publication selection remains owner-operated.

017 already closes these earlier grants in full installations. This patch
is required for a minimal installation that deliberately omits 017; it is
not evidence that a full installation still exposes the release function.
045 provides an idempotent, two-function ACL repair for existing installations.
It does not alter global defaults, managed extensions, custom operator roles,
facts, pointers, or any 043/044 sample-report registry.

## Owner-run installation gate

Obtain explicit approval for the exact target project and reviewed commit.
Repository merge/deployment approval is not production migration approval.
The Supabase read-only connector can inspect metadata but cannot perform this
owner operation. Use the customer's legitimately signed-in owner SQL editor or
an explicitly authorized migration connection; never impersonate an owner.

Before installing:

- Confirm the intended production project independently of the isolated pilot.
- Confirm `current_user`, `transaction_read_only`, schema/function ownership,
  and the owner's `pg_default_acl` for schemas, tables, sequences and functions.
- Confirm `lean_private`, `lean_analytics` and the two public functions do not
  already exist. Stop on a partial/existing installation; do not rerun 001.
- Confirm `service_role` exists, and no unrelated global defaults grant access
  to newly created private schemas/tables. Stop for review if they do.
- Pin exact file hashes and inspect the complete SQL payload before approval.

For a fresh installation, apply corrected 001, 013, 014 and optionally 045
inside **one outer transaction**, stripping only their top-level `begin;` /
`commit;` wrappers. Include fail-closed preflight assertions and privilege /
empty-state assertions before the final commit. Use bounded statement and lock
timeouts. Do not concatenate nested transaction wrappers unchanged: an inner
COMMIT would end the outer transaction early.

For an existing installation, apply only 045 after checking the actual function
signatures and owners. Do not reinstall 001, 013 or 014, or replay later
non-idempotent rename migrations.

## Required acceptance checks

- Ten business-fact tables, five private report-storage tables, and five views
  match the checked-in contracts. All are empty in this schema-only step.
- `selected_publications`, `certifications`, and `publication_audit` are empty.
- `anon` and `authenticated` cannot execute either release function.
- `service_role` cannot execute `lean_select_publication`; it can execute
  `lean_mark_publication_stale`.
- PUBLIC has no EXECUTE grant on either function; the owner retains execution.
- Application roles have no USAGE on either new schema and no table privileges.
- Existing application tables/views, schedules and environment flags are unchanged.

Local regression tests reproduce the old grant leakage, assert fresh-install
and idempotent-repair ACLs, exercise denied application calls, and retain owner
selection, compare-and-swap, audit and service stale-marking behavior. The CI
PostgreSQL test runs separately from suites that reset the disposable database.

## Stop and rollback

If a pre-commit assertion fails, roll back the entire new-schema transaction.
After commit, leave the empty private schemas inert if a later step is blocked.
Do not automatically drop schemas or restore insecure function grants.
Any post-commit removal needs separate approval and a fresh dependency/data check.

## Subsequent work, separately approved

Choose the first production report and bounded source window; use existing
production sources where sufficient rather than duplicating the entire history.
Resolve true update timestamps, original-sales/refunds/cash evidence, business
policy, and independent completeness controls. Add only necessary runtime
migrations, validate a candidate against independent totals, approve its release,
and provision a least-privilege production delivery route. Customer/cohort and
session/funnel metrics also need historical identity, analytics-permission and
event-coverage evidence. The 043/044 isolated expiring samples are not this
production delivery route or a recurring service.
