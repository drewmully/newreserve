# Offline subscription snapshot — proposed definitions, not activation

Base inspected: `e97cd1e461749a3fdca6f225c0804fbad4481dde`. This additive module
has no routes, clients, credentials, database writes, migrations, schedules,
PostHog delivery or billing actions. No current subscription data was collected.

## Why not reuse the display counts/prices?

`src/app/api/_lib/loopAdmin.ts` reads `status`, `nextBillingDateEpoch`,
`billingPolicy.interval/intervalCount`, `isPrepaid`, and `lines[].price`.
Its customer display chooses `active[0]` / `lines[0]` and prefixes `$` without
checking currency. It cannot establish all-contract metrics or recurring value.
The separate Shopify account reader uses the root `subscriptionBillingCycles`
query, bounded to one cycle. It exposes that cycle as `nextBillingCycle` only
when its expected billing timestamp matches the contract's `nextBillingDate`.
Both timestamps must include an explicit UTC designator or numeric offset and
at most three fractional-second digits. Higher precision is withheld, never
truncated to manufacture a match. Otherwise that field and `prepaidRemaining`
stay null. This fixes a query-shape
error without traversing history or claiming that the first returned cycle is
the next renewal. Its existing `prepaidRemaining` arithmetic is not proof of
remaining deliveries or recurring revenue, and the reader is not an analytics
inventory source.
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

## Separate default-off collection mechanics increment

`subscriptionCollection.ts` adds an injected-transport, read-only adapter to the
snapshot builder. It does **not** wire a route, credential, environment variable
or automatic import. `enabled` must be exactly true, and there is no default
transport. No customer endpoint was called during implementation.

Public official documentation read on 2026-09-29 establishes the current
[2026-04 list endpoint](https://developer.loopwork.co/reference/read-all-subscriptions):
`GET /admin/2026-04/subscription`, optional ACTIVE/PAUSED/CANCELLED/EXPIRED
status filter, pageSize maximum 100, descending ID order, and rate limit
2 requests/3 seconds. The [pagination specification](https://developer.loopwork.co/reference/pagination)
uses `afterCursor` and `pageInfo.nextCursor` / `hasNextPage`, **not legacy
pageNo**. The page's embedded public OpenAPI schema confirms customer.shopifyId,
updatedAt, currencyCode, nextBillingDateEpoch, billingPolicy, isPrepaid and
string lines[].price plus integer quantity. It also documents extensive PII and
discount/prepaid fields: display price still does not prove a complete recurring
amount. The legacy version URLs could not be fetched; this increment explicitly
implements the documented 2026-04 contract, not a silent upgrade of loopRocks.

The adapter supports an unfiltered read or one explicit documented status.
A filter cannot be narrower than the count policy. It spaces reads by 1.6 seconds,
uses a 30-second whole-operation deadline, and caps pages (20), response bytes
(4 MB), rows (1,000) and requested pageSize (100, reduced to the remaining row
budget before each read). Transport receives only a
fixed-version relative GET path, `redirect="error"` and an AbortSignal; later
authenticated transport must independently bind the approved host/shop and
honor cancellation. No token, header, URL base or raw error is accepted/returned.
Per-call spacing is not a shared domain limiter: future live transport must
coordinate concurrent callers. Target binding remains explicitly unverified.

Raw provider responses—including addresses, email, payment metadata and opaque
cursors—are **transiently exposed in process memory**. Streamed bytes are bounded,
only allowlisted nested fields enter the existing strict normalizer, and errors
are redacted. No raw payload, customer ID or cursor is returned, logged or stored.
Outputs contain private pseudonymous rows plus local operation timestamps,
page counts/byte totals, projected
page digests, request-cursor digests and exact observed revision timestamps.
Those are finite reconciliation evidence, not a circular proof of completeness.

Termination reports `pagination_ended`, `page_limit` or `row_limit`, never import completion.
Even the final false marker leaves `scopeComplete=false` and all aggregate
values withheld: public docs provide no atomic snapshot/consistent-cut guarantee.
Conflicting duplicated revisions and cursor cycles fail closed. No recurring
amount evidence is inferred; collection requires `recurringValue=null`.
Source authorization, production token/version compatibility, capture-consistency
reconciliation, nested completeness and business-policy approval remain gates.
Any later release of numeric metrics must review that evidence separately.
