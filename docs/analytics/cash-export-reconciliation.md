# Cash export reconciliation

Run this offline operator against the supplied payment-transaction and payout
exports before attempting cash admission:

```sh
node scripts/analytics/reconcile-cash-exports.mjs payments.csv payouts.csv NEW-report.json
```

The output is a new mode-0600 JSON file. Existing output files are not overwritten.
The operator makes no network calls and does not read credentials, write Supabase,
register a refresh, or deliver to PostHog. Inputs are limited to 8 MiB and 10,000
data rows each. CSV schemas and explicit transaction timestamp offsets are
checked. Financial values use integer cents, separated by currency.

It groups transaction amounts, fees and net by the exported transaction clock in
America/New_York. Charge, refund, chargeback, adjustment, refund failure and reserve
categories remain separate. It compares transaction net against payout totals
only on matching payout dates and currencies. A match is date-level arithmetic,
not proof that the cash arrived at a bank or that the export is complete.
Unpaired dates have a null difference, not zero.

The supplied payout headers do not necessarily explain the payout total.
`headerComponentResidual` shows the difference from the mechanical sum of the
listed signed components less fees. It remains unclassified. The operator never
turns that residual into a principal adjustment.

Bank references, order references, payout IDs, checkout IDs, card details and
business entity fields are discarded. They never appear in the result or error
messages. Exact input SHA-256 hashes preserve the link to the private originals.

## What this does not establish

These CSV shapes have no payment transaction ID or explicit gateway field.
`Payment Method Name=card` does not establish PayPal coverage. Observed first and
last timestamps do not prove a complete merchant export. All results therefore
retain `cash: null`, `cashGate: false`, and `lifecycleComplete: false`.

To enter the existing `cashSourceEvidence` path, an operator still needs the real
merchant and gateway binding, stable ledger-to-payment identifiers, complete
coverage for both Shopify Payments and PayPal, and the meaning of adjustments
and refund failures. Retain fees and reserves separately from customer principal.
The approved successful-transaction processing clock is not the payout date.

This operator does not weaken the existing source freshness, full final-payment
population, independent controls, registration, or report release checks.
Sales and other supported reports do not depend on completing cash.
