# Collected Shopify cash: bounded existing-consumer wiring

`collectRefresh` can now compose the transactions it already reads into its
existing `settlements` input. It makes **zero additional provider calls**.
Omitting `collection.cash` preserves the previous behavior. No flag, cron,
SQL migration, private041/042 projection or website behavior changes here.

## Exact live policy required

Add this option only when the owner has actually made this cash-clock decision:

```json
{
  "cash": {
    "clock": "approved_successful_transaction_processed_at",
    "approvalRef": "<real decision reference>",
    "version": "<approved version>",
    "gateways": ["<every approved gateway name, exactly as returned>"]
  }
}
```

This belongs inside `collection` in the existing `mully-collect-v1` input used
by `scripts/analytics/prepare-refresh.mjs`. The existing collection approval,
target, credential, deadline, byte, request and 100-order limits still apply.
`asOf` is generated from the actual collection finish clock, never supplied
inside this option. Nothing in this change supplies the live decision values.

The decision must explicitly define successful Shopify SALE/CAPTURE/REFUND
`processedAt` as the workbook's **customer-payment cash clock** for the named
gateways. That is not evidence of bank settlement, fee-net payout, chargebacks,
or all-gateway completeness. If the business instead requires actual bank
settlement time, do not use this option: supply the existing `settlements`
input from the corresponding authority.

The source parser checks the exact transaction count and revision, excludes
pending/failed/test transactions and authorizations, and preserves signed
refunds and non-USD unavailability. Missing `processedAt`, unknown eligible
gateway, future transaction time or conflicting retained cash fails closed.
The adapter does not automatically alias `processedAt` to `settled_at` without
the explicit policy above.

## Authority and readiness

The existing retained settlement packet must pass the existing input checks.
Its rows and original authority are preserved. Matching transaction keys are
deduplicated only when normalized amount, clock, parent, currency, kind and
status agree; a changed pending/failed/test transaction cannot hide behind an
older succeeded settlement. Conflicts are errors, never last-write-wins.
The composite retains the older capture time and hashes both original
packet/binding and new source/policy. It cannot extend old evidence validity.

Other packets—including independent controls, date coverage, customer
permissions, history, removal and attribution—are untouched. Cash facts can
therefore be populated while the report's cash metric remains null if its
existing coverage/control conditions are unmet. A matching synthetic control
in tests is not a live control or production approval.

This first composition is for a single bounded collection of at most100
orders. `mully-partition-collect-v1` rejects the option before reads rather than
copying its prior settlements into every child. Partition callers can still
supply their already-supported global settlements packet. Parent-level cash
composition is a separate, small extension, not a missing cash formula.

## Verification

33 focused collection tests and the6 existing cash mapper tests pass. The real
`runFullReportJob` consumes the collected packet, emits the expected payment
fact and observed-unverified cash amount, replays identical facts/reports, and
withholds only the cash metric when its date coverage is false. Three selected
old default-path tests pass. Analytics and whole-app TypeScript and affected
ESLint pass. No hosted/source calls were made during development.
