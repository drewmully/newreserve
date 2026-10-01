# Customer history source wiring

`prepareMullyRefresh` accepts an optional `customerHistory` input. It connects a
reviewed complete Shopify history inventory to the existing `customerHistory`
evidence packet and binds that inventory to the base report job. No source read,
permission grant, job registration, publication or export happens during preparation.

The normal path remains unchanged when this option is omitted. Current customer
profiles still produce incomplete history and cannot establish first-time
customers, an nCAC denominator or a complete original customer cohort.

## Private input

Use the existing `mully-source-v1` input to `scripts/analytics/prepare-refresh.mjs`.
Add `customerHistory: { source, inventory }`:

| Input | Required evidence |
|---|---|
| `inventory` | Existing `HistoryInventory`, with closed, contiguous `created_at` pages from the independently established source origin through the covered cutoff. Its `orders` list contains the exact selected revisions. It must match `refresh.history` and every retained source document. |
| `source.scope` | Exact project, shop and reporting dates, matching the refresh. |
| `source.sourceOrigin`, `completeThrough` | Reviewed complete source interval, not the minimum date among arrived records. The cutoff must cover every reporting day and claimed complete cohort month in New York time. Each customer's actual H/grace endpoint is checked later by the cohort consumer. |
| `source.customers` | Independently extracted `{ customerId, orderIds }` rows using source Shopify IDs and Order GIDs. Include orders before the report window, canceled and test orders, and every source order regardless of whether the financial mapper can support it. No truncation to a convenient sample. |
| `source.guestOrderIds` | Independent exact guest inventory. An omitted customer field is not a guest. |
| `source.expectedSources` | Exactly `["shopify"]` for this adapter. Other source systems need a reviewed adapter; they are not silently dropped. |
| `source.migrationsReconciled`, `migrationEvidenceRef` | An actual independent reconciliation receipt confirming that this scope's legacy/migration coverage is complete. A nonempty reference is not proof by itself. |
| `source.sourceId`, `schemaVersion`, `sourceRecordRef`, `approvalRef` | Owner-bound source and approval references, distinct from the current-profile binding. `independentlyExtracted` must be true. |
| `source.version`, `capturedAt`, `maxAgeSeconds`, `digest` | Version 1, original extraction clock, approved lifetime, and `evidenceDigest` of the other fields. The oldest source/inventory clock survives preparation. Evidence must remain valid through job expiry. |

The type in `customerHistorySource.ts` is the exact field allowlist. Keep these
inputs private. Do not include email, phone, raw properties or credentials.
The resulting history payload contains project/shop-scoped customer surrogates,
not raw customer IDs.

The adapter compares the independent customer/order universe with the actual
retained documents and existing inventory. Missing, extra, duplicated,
guest-substituted and changed-revision orders fail. The existing
`runObservedReportJob` inventory fence checks the later base job again. A
different or partial base cannot reuse the prepared history assertion.

The packet retains `HistoryEvidence.completeThrough`. `buildFullReports` passes
these source cutoffs to the existing cohort calculation. Each actual derived
member's first eligible paid timestamp plus H and grace must fit both the source
cutoff and the report's `asOf`. One explicit cutoff opts into a complete
customer-to-cutoff map; a missing member cutoff withholds the cohort. Existing
reviewed inputs with no cutoff retain their previous behavior.

The preparer checks full calendar-month membership, but does not add H to the
end of the month. For example, a complete January cohort consisting only of
January 1 buyers can mature after their own H/grace endpoints. It need not wait
until H days after February 1. No independent first-purchase certificate or
second payment-clock calculation is invented to perform this check.

This is a bounded path, at most 100 orders. It does not make a truncated subset
of a larger lifetime inventory complete. Existing partition preparation has a
different input contract and is not silently substituted here. Unsupported
orders still require their established financial/replacement path; completeness
cannot be claimed by dropping them.

## Authority and output boundaries

Historical identity, analytics permission and removal timelines remain separate.
The adapter does not infer them from first-order timestamps, Firebase presence,
email joins, marketing consent or warehouse customer metrics. Current permission
and removals still flow through `mapMullySource`; unknown or withdrawn permission
keeps customer metrics null even with complete purchase inventory.

Independent customer/identity/order proofs, per-date coverage, original cohort
membership, financial lineage and spend comparability are retained unchanged.
The new option does not create passed controls or calculate expected totals from
its own output.

Output contracts remain the existing `store_daily.new_customers`,
`store_daily.ncac_usd` and `customer_cohorts` fields. Attribution still needs its
own resolved touch/order evidence. A complete original cohort and eligible
follow-up orders can support repeat purchase without a complete revenue ledger.
Missing ledger or original-component lineage withholds LTV, not repeat purchase.
Missing cohort/customer/order completeness still withholds both.

All prepared results remain private and unverified. Real numerical acceptance
requires independent expected results from an authorized source packet. Synthetic
tests do not establish production history, consent or metric acceptance.
