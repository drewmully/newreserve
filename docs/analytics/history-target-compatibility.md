# Private current-target history compatibility

This proposal makes the existing 040 import and 041 report paths usable with a separately approved current-target scope. It does not approve a source read, install anything, create a customer generation, or publish reports.

The target is `xnfjdbpjuaezxjgargto`. The old project, app, installation, cutoff, query and Preview operator remain unchanged. The new paths cannot reinterpret an old approval.

## Authority and registration

`proposed_history_target_boundary.sql` creates two empty private tables. The owner stages an independently reviewed execution manifest through `lean_history_target_stage`. Runtime roles cannot stage, register, revoke, renew or edit authority.

The manifest contains:

- `approvalId`, `operatorRef`, `inventoryRef` and `projection: "040_no_customer_v1"`.
- `scope`, containing the exact import job, target, shop, app, installation, API `2026-07`, UTC cutoff, compiled query text and hash, independently expected order count, approval/operator references, original import expiry and purge deadline.
- `report`, containing the exact report run, separate original report expiry, date range, explicit `includeCustomerId`, financial `policy` or explicit null, spend runs, and the exact existing order/financial/refund query texts.

SQL compiles and compares both query projections. The Node compiler only supplies query bytes; it creates no approval. The TS report operator compares the report query bundle against the existing source-reader constants.

Import approval expires within 24 hours of staging. The separately approved report deadline is at most 30 days after staging. Neither deadline changes later. Completed import data may feed the approved report after import execution expires. Source disablement, purge, completion-hash change, manifest revocation and the report's own expiry still block it.

`lean_history_target_import_register` accepts only a staged approval ID and inserts a disabled 040 job. `lean_history_target_report_register` also requires the actual completed 040 completion hash and inserts a disabled 041 run. The hash is an integrity check, not approval. Both scopes contain the immutable `targetApproval` marker.

Enabling a job remains a separate owner action. No manifest, job, enablement, credential, scheduler or runtime configuration ships in this component.

The owner can append an irreversible revocation through `lean_history_target_revoke`. It stops both phases of that execution approval. It does not delete retained evidence or change B's separate customer-analytics permission authority. Owner purge retains 040's original retention behavior.

## Existing behavior and lock order

Only three old functions become private owner-only aliases:

| Original | Preserved alias |
| --- | --- |
| `lean_private.history_import_lock` | `lean_private.history_target_legacy_import_lock` |
| `public.lean_history_import_batch` | `lean_private.history_target_legacy_import_batch` |
| `lean_private.history_report_lock` | `lean_private.history_target_legacy_report_lock` |

The old bodies remain byte-identical. Replacement functions check only marked jobs. Unmarked jobs use the original behavior. The new batch uses the old line/money validator and the old order validation with the approved cutoff supplied explicitly. It never rewrites source timestamps or adds customer fields to 040.

The existing lifecycle still owns claims, tokens, leases, operation binding, checks, inventory counts, hash/replay checks and completion. No budget increases. After-write guards cover marked import/report jobs, retained report source and report progress.

Runtime transitions lock the relevant job, then take a shared approval-row lock. First-time revocation takes a conflicting approval-row update lock before inserting its row. This also protects the no-row revocation case. A revocation waits for an already-authorized transaction to finish; a transition waiting behind revocation sees the stop after acquiring its lock. The clock is sampled after the approval lock and checked again after writes.

Marked target execution supports **READ COMMITTED only**. The shared manifest guard rejects other transaction isolation levels with `unsupported target transaction isolation; requires read committed`. This covers new registration and authority reads, import claim/bind/observe/batch/finish/replay, report claim/retain/order/day/progress, and their after-write checks. A REPEATABLE READ or SERIALIZABLE transaction could otherwise retain a snapshot from before a committed append-only revocation. No isolation rule is added to unmarked legacy jobs.

The installer rejects effective inherited EXECUTE grants on all new private helpers, aliases, stage/register/revoke functions and authority-table privileges. Only the read-only authority RPC and the existing public batch replacement receive service-role EXECUTE.

## Finite operators

`history-target-operator.cjs` exports `check`. It has no command-line entry point or deploy output. With `enabled !== true`, it returns without reading credentials or calling transport. With explicit enablement it performs exactly one `start`, `check` or `import` action through the existing 040 RPCs.

`historyTargetReportOperator.ts` exports `runHistoryTargetReportOperator`. It calls the existing `runHistoryReportStep`, uses only the fixed current target, verifies source shop/app/install/scopes/API, and permits only the compiled financial projection. Customer ID enrichment requires an explicit manifest flag and `read_customers`; it does not create analytics consent or customer eligibility.

Both operators obtain authority from SQL, bind the configured operator reference, recheck before source calls, and use finite request, byte and time limits. Neither can mint or enable a job. Source tokens go only to the exact Shopify endpoint. Database keys go only to the exact target RPC endpoint. Redirects and retries are disabled. Explicit abort signals stop further transport.

The underlying report bridge retains its existing unsupported-source behavior. A failed enrichment may produce a pending, unresolved order, never a certified financial result. Storage or authority failures remain hard failures.

## Validation and review boundary

The focused tests use synthetic JSON and real local SQL. They exercise actual Node import and TS report operators through RPC transport, both customer projections, missing/disabled authority, wrong identities/scopes/API/query/hash/cutoff, replay, stop, limits, expiry during batch/finish/retain writes, source hash/kill checks, and report execution after import expiry.

`tests/runtime/historyTargetConcurrency.test.cjs` adds real two-connection PostgreSQL races, inherited-alias rejection with rollback, old body preservation, and a prewarmed caller check. It accepts only the fixed disposable loopback fixture URL. `analyticsLeanHistoryTarget.test.ts` runs with PGlite by default or native PostgreSQL using `HISTORY_TARGET_TEST_URL`.

This component's receipt records the exact engines, timezones, commands and results. Synthetic success is not production acceptance. Current-target installation still needs its independently reviewed package and explicit approval. A real scope, inventory evidence, operator assignment, source access, customer-permission authority, retention process and genuine source-to-report acceptance remain separate requirements.
