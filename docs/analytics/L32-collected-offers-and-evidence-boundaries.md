# L32 — Collected offers and remaining evidence boundaries

## Narrow completed integration

`collectRefresh.ts` now accepts an explicit `collection.offers` object:

```json
{
  "offers": {}
}
```

This opts into native Shopify line-discount membership for the approved order
scope. Optional `offers.registry` is the existing `OfferRegistry` contract from
`shopifyOffers.ts`: `shop`, `attributeKey`, `mappingVersion`, `approvalRef`, and
`values` mapping exact attribute values to `{offerId, evidenceRef}`. Registry
validation runs before reads. Native discounts do not require a business-name
taxonomy; discount codes are shop-scoped hashed identifiers and other supported
applications remain order-scoped. No offer revenue allocation is invented.

Use only through the existing `prepare-refresh.mjs --collect-sources` path with
the already-required reviewed collection approval, exact source targets,
dedicated credentials and bounded read configuration. This document does not
authorize a live execution. `{}` is explicit opt-in, not the default.

- The input must contain exactly one **authentic, validated empty** `offers`
  packet. Its original scope, binding, schema, payload hash and freshness through
  absolute expiry must validate. Missing, stale or nonempty reviewed evidence is
  not silently replaced. For existing reviewed memberships use the existing
  reviewed-packet path without this opt-in.
- Every freshly read order must explicitly declare `edited: false`. True,
  unknown or missing status fails the whole operation, including a later
  partition child. Current edited lines cannot prove original memberships.
- The existing order reader already selects allocations and custom attributes;
  the new wiring introduces **zero additional source calls** and reuses
  `mapShopifyLineDiscounts` / `mapShopifyOffers`. Missing allocation data,
  unmapped registry values and mapper-invalid evidence fail closed.
- The new packet has the approved new source binding, payload digest, actual
  collection-start capture time and a reference hashing the fresh order
  documents plus the exact registry (or null). Its binding is not an independent
  control source. Changing taxonomy provenance changes collection lineage.
- All other retained packets preserve their source reference, capture time,
  payload and binding metadata. `orderIdentities` and other separately opted-in
  existing sections are still collected under their own contracts. No identity,
  consent, history, independent expected totals or coverage is generated here.
- Global request/UTF-8-byte/deadline and expiry limits remain unchanged.
  Preparation writes local disabled-job artifacts only, not registration,
  activation, publication or source mutations.

## Ordinary and partition consumers

The existing generic `partitionRefresh.ts` composition recognizes the actual
collected `offers` section. Each child maps at most 100 orders; the parent merges
exact rows with preserved lineage and seals evidence into the existing parent
manifest. No partition publisher, migration, capacity or permission change was
needed. Nonempty prior offers still fail before they can be dropped by child
scoping. An opted-in parent with even one edited child fails instead of publishing
partial membership.

Synthetic tests exercise 101 unedited orders, two children, one shared customer
and one code across all lines. They execute `runObservedReportJob` through the
paged-input path, then `runFullReportJob` on one global base, producing 101
memberships and one customer. Equal replay yields equal facts/reports/manifests;
ordinary consumer tests verify offers do not change order/line/ledger amounts or
report revenue. RPCs are mocked in these new tests; they are not live or real
PostgreSQL verification. Existing partition database checks remain unchanged.

## Exact 17-section map

These are **17 evidence sections, not 17 independently implementable readers**.
An existing parser/transform is not proof that production source facts or owner
approval exist. Paths below are under `src/lib/analytics/`.

| Section | Existing interface / authority | Automatic preparation status and remaining boundary |
| --- | --- | --- |
| `identity` | `mymullySource.ts` current customer snapshot; `journeyPermissions.ts` signed-grant RPC and mapper; explicit reviewed temporal identity rows | Collector retains reviewed identity. Current customer metadata cannot reconstruct historical Firebase/customer associations. Anonymous `lean_subject` grant collection/composition remains feasible glue using the existing RPC and reviewed composite binding, but grants have `customerId: null` and cannot supply customer consent/history. |
| `currentlyPermitted` | Explicit `MullyPermission[]` consumed by `mapMullySource` / offline `prepareMullyRefresh` | No verified customer-level analytics-consent authority reader in the inspected collection contracts. Marketing flags, Firebase status and anonymous grants are not substitutes. |
| `removedCustomers` | Explicit customer permission/removal intervals in `MullyPermission[]` and reviewed packet | Requires authoritative customer removal history/current denial. Anonymous grant revocation does not identify a removed customer and is not verified erasure. |
| `customerHistory` | `HistoryEvidence` in `identity.ts`; bounded Shopify `shopifyHistory.ts` discovery and `historyFeed.ts` | Bounded source inventory is implemented, but cannot certify complete lifetime purchases, migrations or all expected sources. Current customer mapper intentionally produces incomplete history. Needs real history/migration scope and reconciliation authority. |
| `orderIdentities` | Fresh Shopify order customer GID; `readMullyCustomers` exact current snapshot | Already collected from approved order scope. This is an order-to-source-customer link, not a temporal website/customer identity proof. |
| `checkout` | `journeySource.ts` signed cart receipts and `draftJourneySource.ts` reviewed draft bridge | Existing optional collection and mapping are wired. These receipts do not establish actual inbound SMS event-time, contact/session ownership or customer analytics permission. |
| `campaigns` | `posthogSource.ts` permitted events; `campaignSource.ts::observedCampaigns` | Full builder already derives observed entry context and validates compatible reviewed rows. There is no missing duplicate campaign fetch to add. A bounded first observation does not certify full session-entry coverage. |
| `sessionCoverage` | Reviewed `SessionCoverage`; `fullReportJob.ts::boundBehaviorEvidence` can only narrow source windows | Needs independently supported expected entry/event coverage and approved grace/completeness boundary. Returned events cannot certify their own missing events. |
| `attributionCoverage` | Reviewed per-order `AttributionCoverage`; source window can narrow lookback/grace | Requires verified temporal identity, complete lookback and grace evidence. Neither current customers nor a returned event count establishes these facts. |
| `replacements` | `shopifyAgreements.ts`, `originalPurchasePreparation.ts` and explicit reviewed financial/line policy | Existing opt-in collector handles supported original purchases/refunds and deferred orders. Missing original line classifications, unsupported sale types/financial facts and gateway chargebacks remain explicit failures, not inferred current lines. |
| `settlements` | `shopifyCash.ts::mapApprovedShopifyCash`, fresh transactions including `processedAt`; offline `prepareMullyRefresh` | Collector wiring remains possible **only with explicit owner approval** of successful-transaction time as customer cash, version and gateway allowlist. This alternative is not bank settlement time, fee-net deposits, independent cash controls or chargebacks. No such owner decision is supplied by this patch. |
| `offers` | Fresh Shopify selected line allocations; optional approved exact attribute registry; `shopifyOffers.ts` | This chunk wires actual collection and ordinary/partition consumption for explicitly unedited orders. Nonempty prior reviewed packet and edited originals still require the reviewed-evidence path; no broad original-offer inference. |
| `proofs` | `Reconciliation` in `certification.ts`; independent source binding required by intake | Requires separately extracted expected keys/amount controls and coverage. No independent control source reader is specified by the inspected contracts. Copying current facts or order discovery into expected totals is prohibited. |
| `externalControls` | Reviewed named control results; independent source binding required | Needs actual verification evidence for temporal identity, foreign-key/event lineage, spend compatibility and other requested controls. Local synthetic success is not production control evidence. |
| `dateCoverage` | Reviewed per-date `Gates`; independent source binding required | Requires source-backed completeness per date/domain. Collection completeness of one bounded inventory cannot mark all report gates complete. |
| `comparisons` | Reviewed string keys used by `acquisitionDaily` | Report comparison configuration, not an external data feed. Retain owner-selected comparisons; do not invent a new source reader or expand requested comparisons. |
| `cohortCoverage` | Reviewed cohort month/horizon, full-month and original-ledger lineage evidence; independent binding required | Requires authoritative full acquisition month, horizon and historical ledger coverage. A bounded current Shopify scan or observed customer count cannot prove lifetime/cohort completeness. |

### Residual code versus facts/policy

1. **Code still feasible from existing contracts:** `readJourneyPermissions`
   and `mapJourneyPermissions` already exist, and offline
   `prepareMullyRefresh` already composes these rows with validated retained
   identity. Missing work is specifically **automatic `collectRefresh` wiring**,
   not a new permission system. The same accepted grants can be composed safely
   without replacing customer history or consent, under the existing narrow
   composition contract: retain all prior identity rows, first validate their
   original packet/binding/freshness through absolute expiry, reject an existing
   `lean_subject` namespace instead of overwriting it, map fresh grants only as
   `customerId: null`, use the older capture time and a digest of both inputs,
   and require an explicit compatible composite source binding. Leave
   `currentlyPermitted`, `removedCustomers` and `customerHistory` untouched.
   Read the fixed RPC for the exact approved PostHog/behavior window, reserve its
   one request in the active aggregate budget and apply the existing byte and
   deadline fence. Do not naively use partition order-row scoping for identity:
   nonempty historical identity must be retained once for the whole parent,
   not filtered as if it were an order link. This would improve anonymous
   website permission handling only; it would not finish customer/SMS identity.
2. **Code conditional on owner policy:** successful-transaction cash collection
   can reuse the existing mapper once its actual clock/gateway policy is
   approved. This is not permission to invent settlement/chargeback authority.
3. **Upstream facts/authority still required:** temporal customer associations,
   customer analytics permission/removal history, independently expected
   coverage/totals, complete historical source/migration scope, and verified
   inbound SMS event-time plus contact/session/permission bridge. The metadata
   reader in `smsSource.ts` is not that bridge.
4. **Broader engineering plus source/provider constraints, not addressed here:**
   financial cases not supported by original agreements/transaction contracts,
   gateway chargebacks, production retention policy and verified deletion in
   each downstream copy (including profileless analytics events). Existing
   bounded partitions do not turn incomplete source facts into complete history.

None of these facts are fabricated by the tests, and this change does not
complete all spreadsheet requirements or authorize a live run.
