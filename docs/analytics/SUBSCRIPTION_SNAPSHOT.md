# Offline subscription snapshot — proposed definitions, not activation

Base inspected: `e97cd1e461749a3fdca6f225c0804fbad4481dde`. This additive module
has no routes, clients, credentials, database writes, migrations, schedules,
PostHog delivery or billing actions. No current subscription data was collected.

## Why not reuse the display counts/prices?

`src/app/api/_lib/loopAdmin.ts` reads `status`, `nextBillingDateEpoch`,
`billingPolicy.interval/intervalCount`, `isPrepaid`, and `lines[].price`.
Its customer display chooses `active[0]` / `lines[0]` and prefixes `$` without
checking currency. It cannot establish all-contract metrics or recurring value.
`loopRocks.ts` paginates an ACTIVE-filtered list and has a 200-page cap; an
ACTIVE scan cannot establish excluded or unknown statuses for another policy.
The prepaid fixture in `migratePrepaidAnnual.route.test.ts` additionally shows
`currencyCode`, line quantities and `customer.shopifyId`. These are code-shape
observations, not live API, permission, accounting or completeness verification.

## Input boundary

Call `buildSubscriptionSnapshot(input, policy)` on a separately authorized,
retained **minimal projection**, not raw provider responses:

- Root: `shop`, UTC `asOf`, non-PII `evidenceRef`, boolean `scopeComplete`,
  and `pages`. Optional `recurringAmounts` is described below.
- Each page: sequential `pageNo` starting at 1, explicit boolean `hasNextPage`,
  `rows`. The final false marker plus `scopeComplete=true` is required for
  aggregate values. A filtered scan must cover every policy-counted status;
  the operator must establish this externally. No-page input is not zero.
- Row: `id`, `status`; optional/null `customer: {shopifyId}`,
  `nextBillingDateEpoch` (UTC seconds), `currencyCode`, `billingPolicy:
  {interval, intervalCount}`, `isPrepaid`, `lines: [{price, quantity}]`.
- Reject all extra fields, including address, email, names, payment methods,
  cart/custom fields, delivery policy and the display-formatted `planPrice`.
  Do not silently strip PII in this module. Projection itself requires a
  separately reviewed source boundary; this change does not authorize it.
- IDs must be positive decimal strings or safe positive integer numbers.
  Decimal money must be a nonnegative string. Missing line data stays null,
  never an empty basket or zero price. Every line/quantity is retained in the
  normalized private result; no first-line selection or revenue inference.

Bounds: 5 MB input+policy, 20 pages, 500 rows/page, 1,000 input rows including
duplicates, 100 lines/contract, 90-day maximum renewal window. No automatic
retries, truncated-complete result, network request or raw PII persistence.
Output contract/subscriber keys are domain- and shop-separated hashes using the
existing helper. They are **pseudonymous private identifiers, not anonymized
data or an approved identity/consent linkage**. Do not publish row output.

## Explicit proposed policy

No default business definition is supplied. Callers must specify:

1. `definitionRef`, disjoint `countedStatuses` / `excludedStatuses`;
   `deduplication="identical_normalized_contract"`;
   `subscriberBasis="shopify_customer_id"`; `renewalDays`; `recurringValue`.
2. Count all matching contracts, not only the first per customer. Distinct
   subscribers deduplicate the shop-scoped Shopify ID across those contracts.
   An identical normalized duplicate is counted once and disclosed. Conflicting
   duplicate IDs fail the whole build; no “latest row wins” without revision proof.
3. Renewal counts are scheduled **contract** billing dates, not predicted
   successful payments or deliveries. Window is UTC `[asOf, asOf + N days)`;
   earliest next renewal considers all counted contracts. Missing or past
   dates withhold renewal metrics, not active-contract counts.
4. Set `recurringValue=null` to withhold revenue. To propose MRR/ARR, supply a
   definition reference, explicit currency, `amountBasis=
   "trusted_complete_billing_cycle"`, prepaid handling (`withhold` or explicit
   `normalize_billing_cycle`), `annualization="mrr_times_12"` and
   `rounding="per_contract_truncate_6dp"`.

Revenue additionally requires an independent `recurringAmounts` entry for
**every counted contract**: `{contractId, asOf, amount, currencyCode, evidenceRef}`.
That assertion must establish the complete contracted charge per billing cycle,
including the reviewed discount, quantity, fees/tax/shipping treatment. The
module cannot infer or verify that business authority from a reference string.
It does not sum display line prices or substitute historical paid cash.

Only MONTH / YEAR billing intervals are normalized, using intervalCount and
12 months/year. Prepaid amount basis is never inferred from delivery cadence.
Missing prepaid/currency/cadence or missing cycle evidence withholds the entire
MRR/ARR total, not just the affected row. No FX conversion or default USD.
MRR uses exact six-place decimal arithmetic and per-contract truncation;
ARR is 12 × that proposed MRR (so rounding can differ from nominal annual price).

## Readiness and remaining gates

Each metric has `value`, `readiness` and non-PII `reasons`. Supported observations
are `observed_unverified`, never certified. Incomplete scope or unknown status
withholds all aggregates. Missing subscriber identity withholds distinct
subscribers only. A complete empty inventory gives observed zero counts; no
next renewal is then null with observed readiness, unlike an unknown date.

This is a current observation, not historical churn/retention, acquisition,
MRR movement, cancellation-date, realized revenue or lifetime-value evidence.
Capture consistency, source authorization/retention, status semantics, source
scope, amount authority, business approval and independent reconciliation remain
external gates. A current snapshot must not be backdated into a trend.

Local check: `npx vitest run tests/api/analyticsLeanSubscriptions.test.ts --project api`.
Use `TZ=UTC` and `TZ=America/Los_Angeles`; analytics typecheck and focused ESLint
use the repository's existing tools.
