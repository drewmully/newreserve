# L34 — finite workbook acceptance checklist

This checklist was reconciled on 2026-09-24 against the actual 29-tab
[MyMully workbook](https://docs.google.com/spreadsheets/d/1irN9OS5z6nJOU46jeAFnwv4h6oFJC5m-gkSGzrxFREA/edit?gid=103#gid=103),
the tree at `50b398ffb09621b6e0ce45f542ee4f946746eae2`, and the current L31/L33
boundaries. It is the finite scope ledger for the spreadsheet implementation.
It does not authorize a customer read, hosted migration, deployment, release,
schedule, paid run or merge.

The workbook has ten mandatory persisted business facts, native `events`, one
cleaned `analytics_events` relation, five reporting views and 18 mandatory
metrics. CTR, CPC and CPM are optional. `subscriptions` and
`subscription_billing_cycles` are optional outlines. Meta, native-ad
diagnostics, profit, fulfillment, inventory and experiments are future scope.

Status meanings:

- **Implemented**: deterministic local code and synthetic tests exist.
- **Source/policy blocked**: the transform or evidence boundary exists, but a
  named real authority, field or business decision is absent.
- **Live acceptance pending**: code is not certified by synthetic vendor rows.

## Mandatory fact and event outcomes

| Workbook outcome | Implemented code | Remaining code | Required source facts or policy | Acceptance test |
| --- | --- | --- | --- | --- |
| `customers` | `identity.ts`, `fullReportBuild.ts` derive a canonical customer, first eligible order and history/permission-gated status. | Add an adapter only after the temporal identity and complete-history authorities in ID-1/ID-2 are named. | ID-1, ID-2; first-order eligibility/tie/merge/renewal policy. | A real known migrated and non-migrated customer resolves to one canonical ID and independently verified earliest eligible order; incomplete history withholds `new_customers`, repeat and LTV. |
| `identity_map` | `identity.ts`, `mymullySource.ts`, `journeyPermissions.ts` validate versioned intervals, conflicts, consent/removal and anonymous `customerId: null`. | Read authoritative historical association and customer analytics-permission/removal intervals; do not backdate current Firebase/profile links. | ID-1 and ID-2 with validity timestamps, evidence IDs and removal semantics. | Historical positive, unknown-before-link, overlap/conflict, withdrawal and anonymous cases reproduce signed source records with no guessed joins. |
| `orders` | `commerce.ts`, `shopifySource.ts`, `shopifyMapping.ts`, `shopifyAgreements.ts` map shop-qualified orders, original purchase values, eligibility and verified cart/draft checkout. | Extend only for source-observed unsupported order classes after FIN-1; prove inventory completeness via CTRL-1. | FIN-1 eligibility/value policy; CTRL-1 expected order scope; ID-1 for customer link; SMS-1 for SMS journey checkout. | Source keyset/counts reconcile; an edited order uses original evidence; an unsupported order fails; a permitted visit reaches its independently read order without timestamp/email guessing. |
| `order_items` | `commerce.ts`, `shopifyAgreements.ts`, `shopifyOffers.ts` preserve original quantities, classifications, values and line IDs. | Add authoritative mappings for unsupported original line/product/gift-card/tip cases only when supplied. | FIN-1 original item classification, unit-price and allocation rules. | Original basket and discounts reconcile line-by-line; unknown classification withholds affected product metrics instead of becoming merchandise or zero. |
| `sales_ledger` | `financial.ts`, `shopifyPilotMapping.ts`, `shopifyAgreements.ts` create exclusive signed components, reversals and effective dates. | Add explicitly supported missing sale/adjustment types after FIN-1 and independent expected totals after CTRL-1. | FIN-1 component, eligibility, allocation and effective-clock rules; CTRL-1 source movement controls. | Independent gross/discount/refund/shipping/tax/duty/adjustment totals and movement IDs reconcile for sale, edit, refund and late-update fixtures; no fan-out. |
| `payments` | `financial.ts`, `shopifyCash.ts` map exact-decimal receipt/refund cash under an explicit successful-transaction clock and gateway allowlist. | Wire automatic collection only after FIN-2 is approved; add authoritative chargeback/reversal mapping if required. | FIN-2 cash clock, eligible transaction states, complete gateway inventory, chargeback source and reversal ordering. | Independent transaction lifecycle totals reconcile by stable ID/date; authorization, pending, test, fee-net payout and unsupported gateway rows do not become cash. |
| `sessions` | `posthogSource.ts`, `sessions.ts`, `collection.ts`, `journeyRuntime.ts` normalize permitted events, deduplicate actions, derive sessions and mature conversion windows. | Add no new family until its producer keys are verified; obtain independent entry/family/date completeness under CTRL-2. | CTRL-2 event inventory, entry definition, bot/internal policy, sessionization/grace and producer receipt-time mapping; ID-2 permission authority. | Native UUID lineage, retry/repeated-action cases and expected event/date controls reconcile; anonymous permitted sessions remain; missing coverage withholds measured sessions. |
| `marketing_spend_daily` | `googleSpendSource.ts`, `googleSpendJob.ts`, `spend.ts` implement bounded Google base account/campaign/day spend with USD/New York checks. | Populate real account inventory and expected zero/nonzero days from CTRL-1. Meta is not mandatory initial scope. | CTRL-1 approved Google account/base-report/date inventory, actual account timezone/currency, closed-day/freshness rules. | Every independently expected account/day is present or explicitly certified zero; source amount totals reconcile; non-USD or non-New-York daily data withholds. |
| `order_attribution` | `attribution.ts`, `campaignSource.ts`, `fullReportBuild.ts` implement one-row, unit-weight, single-touch attribution with explicit unattributed/not-applicable. | Integrate complete identity/lookback/entry controls; add SMS attribution only after SMS-1. | ATTR-1 conversion clock, lookback/direct fallback/renewal policy and campaign registry; ID-1; CTRL-2; SMS-1. | One row and weight 1 per eligible order/model/publication; checkout and acquisition sessions may differ; lookback/grace failure stays pending; first customer is counted once. |
| `order_item_offers` | `shopifyOffers.ts` collects native line discounts on unedited originals plus an optional reviewed attribute registry; overlapping membership is nonadditive. | Supply original offer evidence for edited/replaced orders or leave affected membership unsupported. | FIN-1 original offer identity/mapping and any business taxonomy/allocation policy. | Native and reviewed memberships trace to source lines, stacked offers do not multiply money, and missing original membership does not become empty evidence. |
| Native `events` | `posthogSource.ts` reads fixed allowlisted columns from the native PostHog table; no duplicate event table is created. | Verify the real project, fields, event families and producer completeness under CTRL-2. | CTRL-2 and ID-2. | Bounded real query returns the configured project/families/columns, reconciles native UUIDs and fails on overflow/schema drift. |
| `analytics_events` | `sessions.ts` normalization is the cleaned logical relation used in the full build; `behaviorView.ts` emits a reviewed diagnostic query. | A saved/materialized query surface is only needed if an approved bounded detail route requires it; it is not a sixth reporting view. | Query owner, supported PostHog view mechanism, allowed cuts and retention policy. | Normalized event keys/dedup/context match source fixtures; any installed view is read back against the same publication and privacy filters. |

## Mandatory reporting and metric outcomes

All formulas below are implemented in `reporting.ts` and assembled by
`fullReportBuild.ts`. `reporting-contracts.json`, generated reporting SQL and
`analyticsLeanReporting.test.ts` pin the output fields. The unchecked work is
source/policy acceptance, not another formula implementation.

| Metric outcome | Report route and implemented behavior | Exact remaining dependency | Acceptance test |
| --- | --- | --- | --- |
| Gross merchandise sales | `store_daily`, allocated `product_daily`; signed `merchandise_gross` on ledger effective date. | FIN-1 + CTRL-1 ledger coverage. | Independent gross component total matches for each requested day; product sum matches only when every merchandise component is allocated. |
| Discounts | Same routes; normal discount magnitude is negated from signed `merchandise_discount`. | FIN-1 + CTRL-1. | Discounts and corrections reconcile without including shipping discounts. |
| Refunds | Same routes; discounted merchandise reversal on refund effective date. | FIN-1 + CTRL-1 including late refunds. | Refund IDs/amounts/dates reconcile after an update scan; unallocated refunds withhold product output, not store ledger output. |
| Net merchandise sales | `store_daily`, `product_daily`; sum of exclusive merchandise components. | Gross/discount/refund readiness above. | Ratio-independent exact decimal total matches the independent ledger control. |
| Total sales | `store_daily`; net merchandise plus approved shipping/tax/duty/other components, excluding fees. | FIN-1 component policy + CTRL-1. | Component sum reconciles and is demonstrably distinct from collected cash and purchase value. |
| Spend | `store_daily`, matched `acquisition_daily`; one approved base report. | CTRL-1 spend inventory/timezone/currency/reconciliation. | Account/day totals match provider control including certified zero days. |
| Collected cash | `store_daily`; cash-eligible receipts and reversals on the approved cash clock. | FIN-2 and CTRL-1 cash controls. | Gateway transaction total and dates reconcile, including refund and any approved chargeback lifecycle. |
| Eligible orders | `store_daily`; distinct source orders on New York `paid_at` purchase date. | FIN-1 eligibility/renewal/cancel policy + CTRL-1 order inventory. | Independent order keyset/count agrees; purchase events and payment counts do not add orders. |
| New customers | `store_daily`, weighted first-order `acquisition_daily`; earliest eligible order over certified history. | ID-1, ID-2, CTRL-1. | Known first, repeat, merged and migrated customers agree with signed history; any incomplete buyer makes the metric unavailable. |
| nCAC | `store_daily` blended; `acquisition_daily` matched channel/campaign; ratio of sums with positive denominator. | Spend + new-customer dependencies; ATTR-1 for attributed route. | Same-date range numerator/denominator reconcile; zero or unknown denominator returns null. |
| MER | `store_daily`; ledger net merchandise divided by same-calendar-range spend. | Ledger + spend dependencies. | Ratio of independently reconciled sums; zero spend returns null and later refunds remain on their effective dates. |
| First-party ROAS | `acquisition_daily`; attributed frozen purchase net merchandise divided by matched spend. | ATTR-1, ID-1, CTRL-1/CTRL-2. | Approved channel/campaign/model buckets reconcile, unmatched buckets remain visible, and no native-platform/causal claim is made. |
| AOV | `store_daily`; original discounted merchandise purchase value divided by eligible orders. | FIN-1 originals and eligibility + CTRL-1. | Original basket values and order count reconcile; later refunds/tax/shipping are excluded; zero denominator is null. |
| Units | `product_daily`; gross purchased merchandise quantity by purchase-date SKU bucket. | Original item completeness/classification under FIN-1. | Line quantities reconcile including explicit unknown SKU; later returns do not rewrite gross purchased units. |
| Measured sessions | `funnel_daily`; eligible entry-date sessions and separately selected overlapping stages. | CTRL-2 behavior/family/date completeness and ID-2. | Expected session/event controls reconcile; stages are not summed; missing behavior coverage returns null. |
| Session conversion | `funnel_daily`; converted mature sessions divided by mature sessions under the seven-day proposal. | ATTR-1 session window/grace, verified checkout bridge, CTRL-1/CTRL-2; SMS-1 for SMS journeys. | A permitted session links to the correct checkout/order, each session counts once, and an open window remains null. |
| Repeat purchase | `customer_cohorts`; distinct repeat customers at one mature H-day horizon. | ID-1/ID-2 complete history, cohort maturity and eligibility policy. | Whole cohort is mature; additional eligible orders fall inside the half-open horizon; zero cohort denominator is null. |
| Revenue LTV | `customer_cohorts`; observed H-day net merchandise per original cohort customer with original-ledger lineage. | Repeat dependencies + CTRL-1 ledger/refund vintage and cohort lineage. | Original components count once, in-H refunds/adjustments are included, post-H movements excluded, and late in-H arrivals restate a later publication. |

The five reporting view envelopes, keys, fields, version dimensions, readiness
maps and stale markers are implemented by `reporting.ts`, generated in
`014_reporting_views.sql`, stored/selected/exported by migrations 021–036, and
bounded by `query-boundary.ts`. Final acceptance must read back one consistent
publication/model/definition across all selected domains and compare row counts,
keys and independently reconciled totals.

## Fixed blocker and decision ledger

These are the only remaining source/policy inputs identified by this review.
They are deliberately specific enough to answer without granting broad access.

| ID | Exact decision or data required | Code that becomes possible after receipt |
| --- | --- | --- |
| ID-1 | Name the authoritative tables/APIs and fields for historical Shopify customer, Firebase UID, Supabase/customer and PostHog/session associations; include `valid_from`, `valid_to`, merges/survivors, tombstones and migration coverage. A current row is insufficient. | A bounded temporal identity/history adapter producing `identity`, `orderIdentities` and `customerHistory` packets without backdating. |
| ID-2 | Name the customer analytics allow/deny/withdraw authority, evidence ID, effective timestamps, retention/removal meaning and whether anonymous grants can later be linked. SMS/email marketing consent and Firebase login are not substitutes. | Customer `currentlyPermitted`/`removedCustomers` acquisition and verified grant-to-customer composition. |
| CTRL-1 | Provide the independently maintained expected shop/provider/account/date/history inventory, expected keys/counts/amounts, genuine-zero representation, base-report IDs, timezone/currency and source grace/freshness thresholds. It must not be derived from candidate facts. | Source-specific `proofs`, `dateCoverage`, `cohortCoverage` and compatible-spend/control adapters. |
| CTRL-2 | Provide the independent event-family/entry/date expectation source, native project lineage, producer receipt-time rules, bot/internal policy, late-arrival grace and attribution lookback coverage. | `sessionCoverage`, `attributionCoverage` and external event/join controls backed by an actual authority. |
| ATTR-1 | Approve paid/conversion clock, 30-day last-nondirect proposal or replacement, direct fallback, renewal applicability, seven-day session window, grace, and campaign token registry ownership. | Production policy values and acceptance fixtures; no new attribution algorithm is otherwise required. |
| SMS-1 | For an inbound provider message, supply immutable provider message ID, provider event time, contact ID, complete delivery/webhook coverage, the exact temporal contact-to-journey/session link, analytics permission evidence and checkout handoff. Enrollment, phone entry, SMS marketing consent and `sms_click` do not qualify. | A source-bound SMS activation mapper and one permitted inbound-message → journey → checkout → order acceptance path. |
| FIN-1 | Approve eligible order classes, original purchase clock, sale/discount/refund/adjustment component types, allocation, tax/shipping/duty/tip/gift-card/fee treatment, cancellations/tests, non-USD handling and unsupported-case disposition. | Additional agreement/source mappings only for cases the named authority can prove. |
| FIN-2 | Approve whether successful Shopify transaction `processedAt` is the collected-cash clock, enumerate every in-scope gateway/state, and identify the authoritative chargeback/reversal source and ordering. | Automatic `settlements` collection using the existing mapper plus any evidenced chargeback adapter. |
| RET-1 | Approve retention periods by native events, profile/person data, private facts/evidence, exports and backups; identify a supported PostHog deletion request for profileless subjects, completion/status semantics, warehouse-copy deletion and readback evidence. | A deletion executor/status verifier that marks `downstream_verified_at` only after all applicable copies are proved absent. |

## Five remaining workstreams

- [ ] **Customer identity, permission and history** — blocked only by ID-1 and
  ID-2. Current order/customer snapshots and anonymous grants cannot satisfy it.
- [ ] **Independent reconciliation and coverage** — blocked by CTRL-1 and
  CTRL-2. Received rows cannot certify their own completeness.
- [ ] **SMS-to-checkout attribution** — blocked by SMS-1 plus ID-2. The current
  metadata reader intentionally reports `not_verified` for event time,
  completeness, session link and permission.
- [ ] **Financial completeness** — supported cases are implemented; production
  cash collection and unsupported cases are blocked by FIN-1/FIN-2 and CTRL-1.
- [ ] **Retention and verified deletion** — local withdrawal/export fences are
  implemented; actual provider/downstream deletion is blocked by RET-1.

No other unconditional local adapter or infrastructure change follows from the
workbook. Adding one without one of the inputs above would manufacture authority
or duplicate an implemented boundary.

## Live acceptance sequence after the blockers are resolved

- [ ] Approve the exact isolated environment, data window, source accounts and
  maximum paid scope; separately approve any hosted migration or source read.
- [ ] Apply migrations through 036 in the isolated environment with all runtime,
  queue, export and schedule controls still disabled.
- [ ] Install least-privilege readers for the explicitly approved sources and
  review the existing Supabase security advisor before changing RLS.
- [ ] Prepare one fresh ordinary or partition bundle whose 17 evidence sections
  are source-bound and fresh through the unchanged absolute expiry.
- [ ] Reconcile independent keysets/counts/amounts, event/date coverage, customer
  history, cash lifecycle and cohort lineage; do not accept self-comparison.
- [ ] Trace one permitted visit through checkout to the independently read
  purchase and attribution; separately trace one permitted inbound SMS
  conversation when SMS-1 exists.
- [ ] Exercise an older-order update/refund, overlapping window replay and a
  late-arriving in-window cohort movement without double counting.
- [ ] Withdraw one approved test subject, perform native/profileless PostHog and
  downstream/export deletion, poll provider completion and read back every
  applicable copy before marking removal verified.
- [ ] Force a failed current candidate and deadline-crossing write; confirm the
  last-good output remains explicitly stale and the transaction rolls back.
- [ ] Read back all selected/exported domains with one publication and compare
  keys, row counts and signed independent totals. Only then seek separate
  approval to release, schedule or activate.

## Session capability finding

This Codex session could read the public workbook but has no customer credentials
or installed customer-system connector. Shopify, PostHog and Supabase plugins
were unavailable under workspace policy; no relevant environment variables or
`LOCAL_POSTGRES_TEST_URL` were present. Therefore none of ID-1 through RET-1 can
be answered or live-tested from the current session. This is an access finding,
not evidence that the underlying records do or do not exist.
