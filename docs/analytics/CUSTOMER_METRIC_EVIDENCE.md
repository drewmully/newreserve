# Customer metric evidence

This is the input contract for offline validation of new customers, the
customer denominator for nCAC, repeat purchase and revenue LTV. It does not
authorize source reads, infer historical permission or enable reporting.

## Reuse the existing path

`assembleEvidence` in `evidenceIntake.ts` validates reviewed source bindings,
scope, capture age, payload hashes and all 17 existing evidence sections.
`prepareRefresh` prepares a disabled job; it does not accept business metrics.
`buildFullReports` consumes an already retained `Candidate`, policy, assembled
evidence and saved events. `behaviorMode: "excluded"` supports a separately
reviewed customer/commerce scope without collecting browser events. It does
not grant permission or make attribution available.

`mapMullySource` maps a current scoped customer snapshot and separately
supplied permission timeline. It deliberately leaves history incomplete and
asserts current Firebase links only from capture time. A historical source is
not made complete by another scan of current profiles.

`prepareMullyRefresh.retainReviewed` can preserve existing `identity` and
`customerHistory` packets from their original source bindings. It does not
refresh their timestamps or replace the fresh current permission/removal
authority. Reuse this path if suitable retained packets exist; do not create
another identity or history framework.

## Required private evidence

Each existing `EvidencePacket` has `section`, `sourceId`, `sourceRecordRef`,
`schemaVersion`, `scope`, `capturedAt`, `sha256` and `payload`. Scope contains
`projectRef`, `shop`, `fromDate`, `throughDate`. The matching `EvidenceBinding`
contains `sourceId`, permitted `sections`, `schemaVersion`, `approvalRef`,
`maxAgeSeconds` and `independentControlSource`.

Hashes bind supplied bytes, not truth or authority. Source references must
resolve to the separately reviewed records, not to the candidate being tested.

| Section | Required payload and source authority |
|---|---|
| `identity` | `namespace`, `identifier`, canonical surrogate `customerId`, inclusive `from`, exclusive nullable `to`, evidence `type`/`evidenceRef`, `mappingVersion`, `resolution`, `consent`, `removal`. The owner must establish historical ownership, merges and removal semantics. No email/IP guesses or backdated current Firebase links. |
| `currentlyPermitted`, `removedCustomers` | Exact canonical-ID arrays from the current account analytics permission/removal authority at the retained as-of. Historical mappings cannot override current withdrawal/removal. A marketing flag or anonymous visit grant is not this authority. |
| `customerHistory` | Per canonical ID: independently expected source-system inventory in `expectedSources`, demonstrated `completeSources`, real `approvalRef`, and `migrationsReconciled`. Include pre-report history and legacy/migrated purchases. Never set completeness from arrived rows alone. |
| `orderIdentities` | `orderId`, `namespace`, `identifier`, `evidenceRef`, matching the actual paid-time identity interval. Include independently supported first and subsequent orders. |
| `proofs` | `table`, `keyFields`, `expectedKeys`, `amountChecks`, `evidenceRef`, `independentlyExtracted`, `complete`. Customer and identity key inventories must come from an independent source; order/item and ledger proofs must reconcile the retained base. Ledger proof requires compatible amount totals. |
| `externalControls` | A real reviewed `temporal_identity_intervals` result with `passed` and `evidenceRef`; no all-true fixture copied into an operator packet. Other controls remain scoped to their dependent metrics. |
| `dateCoverage` | Per requested date: `date`, `gates`, `evidenceRef`. Customer readiness needs permitted resolved identity, complete history and linked eligible orders. Missing spend may withhold nCAC without withholding an accepted customer count. |
| `cohortCoverage` | `month`, `horizonDays`, `fullMonthCovered`, `ledgerLineageComplete`, `originalLedgerIds`, `evidenceRef`. Reconcile the complete original cohort, follow-up orders and classified financial lineage, not only surviving or observed members. |

Retained `base.orders`, `base.order_items` and `base.sales_ledger` must match
the existing fact contracts. Required financial provenance includes paid-time
eligibility, original purchase components, effective dates, source currency,
allocation and refund/correction lineage. Reuse accepted commerce evidence,
but a financial order sample is not a complete customer cohort.

Supply the other existing sections through the same reviewed intake contract.
Do not fabricate missing authority with empty arrays, fresh timestamps,
new approval references or passed controls. Unsupported independent domains
remain unavailable. All 17 sections are required by the existing intake;
this customer checklist is not a replacement packet format.

## Definition bindings

The owner must select the report dates, immutable definition/mapping versions,
as-of, first-order eligibility and tie-break/merge/erasure policy. Cohorts also
require `month`, `horizonDays`, `graceSeconds` and `acquisitionDefinition`.
Existing provisional presets are not approval for the supplied scope.

The first order is determined over complete history, then assigned to the
requested acquisition date. Repeat counts distinct customers with an
additional eligible paid order inside `[first_paid_at, first_paid_at + H)`.
The entire cohort must be mature through H plus the approved grace.
The calculation preserves all six fractional timestamp digits. Neither a
purchase or refund one microsecond before H nor coverage one microsecond
short of H plus grace is rounded to the boundary.

Revenue LTV includes each selected order's classified original merchandise
components once, even if they predate payment. **An original component at or
after H, or a missing/invalid component clock, withholds revenue and LTV.**
It is not silently dropped to produce a plausible zero. Normal post-purchase
adjustments/refunds at or after H remain excluded from that fixed-H revenue.
Valid prepayment originals remain included. Cohort counts, repeat purchase
and daily ledger effective-date reporting are unchanged by this check.

For nCAC, hand the accepted customer count with its date range, definition,
scope and readiness to the spend/attribution owners. The count alone is not
a validated nCAC ratio. Attributed first-customer credit must use only the
accepted first order; it must not count every later order again.

## Offline acceptance

1. Check the saved packet's authority and permitted processing scope before
   opening any retained customer records. Record the source owner/location.
2. Run the existing intake and, where applicable, offline preparation. Never
   pass `--collect-sources` merely to complete this review.
3. Run `buildFullReports` against the retained base and assembled evidence.
   Compare independently supplied expected customer anchors privately, then
   exact `new_customers` and cohort aggregates. Do not derive expectations
   from the same output being tested.
4. Include known first, repeat and migrated examples; denied/withdrawn,
   conflicting or incomplete history; an immature whole cohort; a valid
   original prepayment component; an in-H refund; and an H-end boundary.
5. Retain only the approved aggregate result and private evidence references.
   An offline match remains observed/unverified. It neither selects a
   certified publication nor enables the production sales/product feed.

There is no qualified real-data acceptance unless the retained authority,
independent scope/proofs and expected results are supplied. Synthetic
regressions verify implementation behavior only.
