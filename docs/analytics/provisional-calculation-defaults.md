# Provisional calculation defaults

These are configurable calculation choices for local review, not evidence that
permission, history, source coverage or any live metric is available. Existing
`approvalRef`, reconciliation, consent/removal and completeness gates still apply.
Nothing here authorizes registration, reads, activation, deployment or release.

`PROVISIONAL_CALCULATION_DEFAULTS` in `calculationPolicy.ts` exports these choices
without fabricating an approval reference or any evidence:

| Choice | Provisional value | Configuration |
| --- | --- | --- |
| Session conversion | 7 days, `[started_at, started_at + days)` | `FullBuildPolicy.conversionWindowDays`; safe integer 1–365; omitted retains 7 |
| Acquisition attribution | Last eligible non-direct session, 30-day lookback | Existing `policy.attribution.lookbackDays` and `modelVersion` |
| Observed direct-only fallback | Off | Existing `policy.attribution.allowObservedDirectFallback` |
| Conversion clock | `orders.paid_at` | Existing implementation; another clock needs a separately reviewed implementation/model |
| Ingestion grace | 48 hours | Opt into `ingestionGraceSeconds` via existing `sessionCoverage.graceSeconds` and cohort `graceSeconds`; never treat elapsed grace as complete coverage |
| Initial cohort horizon | 30 days | Existing `policy.cohorts[].horizonDays` |
| Renewal acquisition credit | Ineligible where existing source classification says so | Preserve `acquisitionEligible: false`; do not infer new order classes from this preset |

Only the session-window omission is automatically defaulted by this change.
The other exported choices must be explicitly copied into the existing reviewed
configuration. They do not overwrite already registered settings. Missing
permission, history or independently verified coverage remains missing. Anonymous
sessions do not require a fabricated customer, but still require permission and
behavior/commerce coverage before conversion is published. An immature or
unavailable conversion stays `null`, not zero.

## Versioning and persistence

Use a **new `definition` and `funnelVersion` for changed calculation rules**, plus
a new immutable publication. Names are operator-chosen; there is no new naming
syntax or authority registry. For example, a two-day review can use
`definition: "provisional-two-day-v2"`, `funnelVersion: "two-day-funnel-v2"` and
`conversionWindowDays: 2`. Keep these identifiers consistent when comparing or
exporting reports. Do not combine rates across different definitions/windows.

The existing persistence path already retains the rule:

1. `prepareRefresh` validates the numeric window. Its full input digest includes
   `policy`, determining the immutable refresh/run identity. The full bundle
   carries `policy.conversionWindowDays` without rewriting it.
2. `lean_refresh_register` stores the complete policy in
   `lean_private.full_builds.policy` (JSONB); the existing immutable-scope trigger
   prevents changing it in place.
3. `lean_full_inputs` returns the saved policy inside the hashed input.
   `runFullReportJob` validates the window before claiming or querying events.
4. `buildFullReports` supplies the same resolved window to session maturity and
   checkout-linked conversion. Reports preserve `definition_version`,
   `funnel_version` and `publication_id`. `lean_full_finish` checks the input hash
   and report definition against the saved policy.

No database migration is needed: the seven-day wording in the original workbook
contracts describes the backward-compatible proposal, not a numeric SQL check.
The event manifest remains exactly its existing five keys; no new field is added
to the SQL-constrained manifest or to persisted fact/report rows.

The 365-day configurable calculation bound does not expand the PostHog reader's
93-day source budget. A longer window is not a promise of supported live
coverage, and cannot be certified by a shorter read.
