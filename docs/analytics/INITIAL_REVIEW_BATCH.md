# Initial review batch: merge code, not activation

This boundary combines PRs **162, 163, 164, 166, 167, 168 and 169** with narrow
safety backports. It deliberately stops before refresh queue registration
(migration 025). It is a default-OFF integration-validation boundary, not the
completed workbook or authorization to query customer systems.

## Ancestry and review

- Starting main: `412341829e47bc9b20548db09c003eb58b8e3bd0`.
- Prefix: `e3abc0eab52d5e2191405cd6765730307fb576a5`.
- Their merge-base is the starting main: **main is the ancestor of the prefix**.
- A normal two-parent merge preserves all seven original commits. Review and
  merge this integration snapshot as a unit rather than briefly publishing the
  uncorrected prefix on main. Do not squash or rewrite the dependent stack.
- Other original, review-stack and Codex branches are unchanged.

## Narrow backports

1. From later journey-authority work: explicit anonymous denial/unknown consent
   wins before unresolved identity; `lean_*` events need matching permitted,
   active, event-time authority. A stored event boolean is not current authority.
   This does not add a permission collector, customer identity or removal policy.
2. From Codex `367f564`: an associated Shopify payment may precede order creation;
   a timestamp after the retained revision still fails. The cash/agreement
   readers are outside this prefix, so their changes are not copied.
3. From Codex `3982fe4`: the existing history fixture uses explicit UTC literals.
   Migration 037 is not applicable: the journey SQL functions it replaces do not
   exist in this boundary. No numbered migrations were modified or renumbered.
4. Contract tests pin default-OFF routes and absence of an analytics schedule.
   The integration review branch is explicitly disabled in Vercel configuration.
   CI runs the complete available analytics suite, including the track route
   and local PostgreSQL, under UTC and America/Los_Angeles.

Later scoped-reporting, customer/journey collection, inventory and partition
changes are intentionally excluded. They are not prerequisites for a code-only
default-OFF merge. They remain prerequisites for their corresponding operations;
this batch is not approved for unattended collection or production publication.

## Activation boundary

| Entry point | Required switch (unset is disabled) |
|---|---|
| `/api/analytics/ingest/history` | `LEAN_ANALYTICS_HISTORY_ENABLED=true` |
| `/api/analytics/ingest/spend` | `LEAN_ANALYTICS_SPEND_ENABLED=true` |
| `/api/analytics/ingest/reports` | `LEAN_ANALYTICS_REPORTS_ENABLED=true` |
| `/api/analytics/ingest/full` | `LEAN_ANALYTICS_FULL_ENABLED=true` |
| `scripts/analytics/dispatch-full.mjs` | `LEAN_ANALYTICS_FULL_DISPATCH_ENABLED=true` |

The routes check their switch before constructing the database client. Enabled
routes still require dedicated secrets, exact target configuration and approved
saved jobs; job registries default disabled. The dispatcher installs no schedule.
No analytics cron is added; existing unrelated cron entries are unchanged.

Migrations 018–024 are files only until separately applied. Export is owner-only,
requires certification and all five selected report domains; its reader is
created NOLOGIN. A merge does not configure credentials, database migrations,
PostHog warehouse sources, synchronization, reporting selection or a deployment.
The review-branch deployment block does **not** disable the main deployment
pipeline: the owner must coordinate that separately before merging.

## Validation

On the prepared candidate, both full local runs passed **452 tests / 34 files,
zero skips**, including seven tests against disposable loopback PostgreSQL 18,
under `TZ=UTC` and `TZ=America/Los_Angeles`. TypeScript, analytics lint,
generated-SQL parity and whitespace checks must also pass before publication.
The new integration PR requires its own successful CI run; historical green
checks and skipped stack CI are not substitutes.

The tests use synthetic fixtures only. Independent expected coverage, historical
identity/consent, complete purchase history, the verified inbound SMS bridge and
retention/erasure facts are not supplied or proven by this code-only batch.
