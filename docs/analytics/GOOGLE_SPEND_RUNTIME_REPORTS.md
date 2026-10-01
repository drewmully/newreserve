# Fresh Google spend in the existing full-report pipeline

This integration uses the existing source and reporting stores, not another
report job family or endpoint:

1. The v2 collector retains an immutable account/day base in `spend_jobs`.
2. A registered `report_builds.spend_runs` inventory pins those source jobs.
   SQL020 and `runObservedReportJob` persist the original normalized observations.
3. The full-input RPC supplies the original bases and approved spend policy.
   `prepareFreshGoogleSpendBuild` checks them before the existing full builder.
4. `guardFreshGoogleSpendReports` withholds incompatible global ratios before the
   same `lean_full_finish` persists the five report families.
5. The canonical production workbook reader selects that completed generation
   under its separately approved scope. SQL050's narrow webhook mode is unchanged.

The shared full-job/dispatcher hooks and SQL053 input/delivery wrappers are
coordinated changes from their existing owners. This module alone does not install
those dependencies, register a source, enable processing or activate delivery.

## Runtime input contract

Only immutable owner-saved configuration can define
`full_builds.policy.freshGoogleSpend`. Its fields are:

- `manifest`: the existing exact `FreshGoogleSpendManifest`. No new account
  discovery, date expansion or credential material is allowed here.
- `controls`: existing `SpendDayControl[]`. Independent account/day totals and
  campaign IDs/cost micros, explicit complete-zero evidence, source metadata,
  timestamps and provenance are required. Missing controls narrow readiness;
  they are never synthesized from arrived facts.
- `marketingInventory`: the fields below.

The full-input RPC adds `bases` exclusively from the base report's registered
`spend_runs`, joined to actual retained `spend_jobs`. Caller-provided bases are
not an approved source. The resulting envelope has exactly
`{ manifest, bases, controls, marketingInventory }`.

| Marketing inventory field | Meaning |
|---|---|
| `shop`, `dates` | Exact approved shop and full-report dates |
| `accounts` | Independent provider/account registry for this requested scope |
| `complete`, `independentlyExtracted` | Explicit source claims, subject to source-owner review |
| `evidenceRef`, `approvalRef`, `capturedAt` | Independent registry version, authorization and current capture |
| `salesScope` | `whole_store_eligible_ledger`, `selected_product` or `unverified` |
| `salesCoverageRef` | Independent whole-store comparison coverage reference, or explicit `null` |
| `customerScope` | `whole_store_eligible_customers`, `selected_product` or `unverified` |
| `customerCoverageRef` | Independent whole-store customer-population and history coverage reference, or explicit `null` |

This bounded adapter supports one Google account. Unknown, additional or
unimplemented providers/accounts do not become zero. The complete requested
registry must be resolved before the spend gate can pass. Actual account currency
must be USD and timezone America/New_York; daily dates are not relabeled.

The RPC must verify project, enabled pilot/jobs, run membership and expiry; lock
the relevant source records; include the complete fresh envelope in `inputHash`;
and recheck the same conditions from the existing finish transaction. SQL input
and finish fencing are dependencies of this module, not guarantees supplied by a
TypeScript check alone.

## Shared full-job hooks

Before `buildFullReports`, call:

```ts
const spend = prepareFreshGoogleSpendBuild({
  freshGoogleSpend, base, evidence, projectRef, publication, shop,
  fromDate, throughDate, asOf,
});
```

Pass the returned `base` and `evidence` to the existing builder. Then call
`guardFreshGoogleSpendReports(result.reports, spend.storeRatioAdmission)` before
the existing finish RPC. If the immutable input contains no fresh-spend policy,
the legacy path is unchanged. A malformed present policy never means legacy.

The adapter requires the original observed spend facts to match the exact retained
bases, including run identity and source vintage, not merely the grand total.
It normalizes from those bases, validates controls through the existing acceptance
logic and narrows spend gates. It never changes proof contents, campaign
comparisons, approval references or an absent/false date gate to passed.

Missing, stale, unverified or mismatched controls withhold spend and dependent
ratios. Stale source facts can remain private evidence; they are not fresh report
values. The full builder still owns all calculations and per-family dependencies.

## MER, nCAC and ROAS

The workbook's Metric Definitions B116 and B119 define MER as ledger-net
merchandise divided by spend on the same New York dates. B123 requires whole-store
scope, including approved commerce classes such as renewals. Selected products,
the narrow webhook feed and old selected-order samples do not satisfy that scope.

Global MER requires `salesScope: whole_store_eligible_ledger` and a nonempty
`salesCoverageRef`. Blended nCAC instead requires
`customerScope: whole_store_eligible_customers` and a nonempty
`customerCoverageRef`, covering the complete compatible customer population and
history for the same shop and dates. Neither customer scope field defaults to
complete. Selected-product customers cannot supply a whole-store denominator.

The returned `storeRatioAdmission` has separate `mer` and `ncac` booleans. The
post-build guard withholds each ratio independently. Complete customer and spend
evidence can support nCAC when the revenue ledger is missing and MER is null.
Conversely, complete ledger and spend evidence can support MER without a complete
customer denominator. The builder's existing proofs, history and date gates still
apply; an inventory reference cannot promote a failed gate. No purchase snapshot
is added to ledger value, and this guard never recalculates a ratio.

Attributed nCAC and first-party ROAS retain the existing approved campaign
comparisons, identity/purchase/attribution controls and single-model constraints.
The adapter does not infer attribution from spend or allocate account spend to
products, orders, customers or sessions. Zero denominators remain null; reporting
uses the existing six-place ratio rule.

## Repeated refresh and failure behavior

The existing full dispatcher must route `fresh-google:` jobs through
`advanceFreshGoogleSpend`, with the exact owner-saved manifest supplied by its
registered next-step RPC. A missing/mismatched manifest or a different ready run
must fail before claim/source reads, never fall back to the ordinary collector.
Legacy job IDs remain on their existing path.

Finite v2 day inventory, one attempt per day, request/page/byte limits and expiry
are unchanged. Repeated approved dispatcher invocations advance the next saved
day; they do not expand the window. A new provider revision needs new approved
immutable source/report/full-build IDs. Report retries consume retained bases,
not another provider read. Ambiguous finish responses are reconciled, not replayed
inside a catch block. No scheduler is added by this adapter.

Recurring operation still requires a bound runtime identity, an authorized current
control/registry producer, registered refresh generations, installed database
dependencies, configured dispatch, actual destination freshness and a verified
stop procedure. Those are not proved by local tests or a one-day operator report.

## Optional delivery diagnostics

Metric Definitions B204, B215 and B226 define CTR/CPC/CPM separately. The existing
reader/normalizer retains optional clicks, impressions and click definition, and
`deliveryMetrics` already supplies their formulas. Source presence alone is not
reconciliation or comparable semantics. This change adds no optional columns to
the five report families and does not accept those metrics without their own
independent count/definition controls.
