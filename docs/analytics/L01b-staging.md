# L01b: isolated staging candidate

This draft supplies executable PostgreSQL DDL for all ten workbook tables,
publication-aware keys, parent constraints and independent coverage registers.
It is deliberately outside the repository's automatic migration location.
No deployment or live schema compatibility is asserted.

Generate deterministically with `node scripts/analytics/generate-staging.mjs`.
Run `npm test -- --project api tests/api/analyticsLeanStorage.test.ts`.
Tests execute SQL in a disposable PostgreSQL engine, not a mocked query builder.

## Release gates

- Inspect the customer's deployed schemas, migration ownership and extensions.
- Apply SQL in an approved non-production database with a privileged migration
  role. Existing schema names intentionally cause failure, not silent reuse.
- Provision a dedicated writer; no default public, anonymous or authenticated
  grants are introduced. Supabase service-role bypass is not a read-only boundary.
- Grant the PostHog importer only reviewed reporting views, never `lean_private`
  or `identity_map`. Schema exposure, credential provisioning, sync mechanism,
  deleted-row propagation and a non-production PostHog query remain unverified.
- Register expected source/account/history scopes from approved independent
  inventory, not the rows that happened to arrive.

Rollback before activation is code revert and abandoning this candidate schema.
After data arrives, do not drop schemas or accepted receipts: switch readers back
to the previous certified publication. Customer approval is required.
