# L33 — Collected anonymous journey permissions

This completes the **anonymous grant collection/composition glue** identified
in L32. It does not establish customer identity or consent, an SMS bridge,
independent completeness, production source validation, or erasure.

## Explicit API and authority binding

Both existing ordinary and partition collection inputs accept:

```json
{
  "journeyPermissions": {
    "retainedIdentityDigest": "<evidenceDigest({packet, binding})>",
    "binding": {
      "sourceId": "<new reviewed composite source>",
      "schemaVersion": "<approved composite schema>",
      "approvalRef": "<composition approval>",
      "maxAgeSeconds": 3600
    }
  }
}
```

Here `packet` is the exact input `identity` packet and `binding` is its original
source binding, before other collected sections are removed from that binding.
The digest covers the original payload hash, source reference, capture time,
scope, schema, approval and age budget. It is not just an identity-row hash.
The new composite binding must be distinct from **every prior source** and the
ordinary collected-commerce binding. Unknown options fail.

This remains an explicit `prepare-refresh.mjs --collect-sources` operation with
the existing source approvals, exact approved targets and dedicated
`LEAN_MULLY_SOURCE_READ_KEY`. `LEAN_POSTHOG_PROJECT_ID` must match both the
report policy and behavior source. Nothing registers, enables, schedules or
publishes a job. No additional customer policy or permission system is created.

## Actual integrated flow

1. Validate all retained evidence and the exact reviewed identity packet/binding
   before any source read. Reject existing `lean_subject` rows instead of
   replacing or guessing their history.
2. Reserve one extra request. Use the existing `readJourneyPermissions` fixed
   `lean_journey_permissions_read` RPC with the exact project, shop, PostHog
   project, `refresh.behavior.from` and `until` window. No arbitrary URL, query,
   fallback, or customer-list filtering.
3. In ordinary collection, read grants after the other approved sources. In
   partition collection, strip the option from every child and read **once at
   the parent**, after all children. The original aggregate abort signal,
   request count and UTF-8-byte budget cover this final read; they never reset
   for it. Existing grant-reader and combined-intake row/size caps still apply.
4. Reuse `mapJourneyPermissions`; append its anonymous rows to every original
   identity row, preserving the original rows exactly. Unrelated historical
   customers remain present even when absent from the selected order inventory.
   Never interpret anonymous grant revocation as a removed customer.
5. Record fresh RPC capture separately in `collected-sources.json`. Composite
   packet capture is the **older** of the retained packet and fresh snapshot.
   Its source reference hashes `{retained: {packet, binding}, snapshot}`.
   Its binding is not independent control evidence. Both the original
   authority's age budget and the composite age budget must cover the unchanged
   absolute expiry. A new approval cannot extend old evidence validity.
6. Keep `currentlyPermitted`, `removedCustomers`, `customerHistory`, independent
   controls and all unrelated packets unchanged. Compose parent identity
   outside order-row scoping and seal the final composite evidence digest into
   the existing partition manifest. Existing preparation/consumer paths handle
   it; no publisher or database migration was added.

Fresh output cannot be supplied as a new retained input indiscriminately:
the prior `lean_subject` namespace collision deliberately fails. A later
collection uses the separately reviewed historical-identity input while it
remains valid; offline replay of prepared output needs no fresh source read.

## Synthetic acceptance and limits

`analyticsLeanJourneyPermissionCollection.test.ts` covers ordinary and
101-order partition collection, exact source/body scope, both captures,
packet/binding hashes, non-duplicated historical identity, independent evidence
preservation, pure replay, and actual CLI creation plus offline replay in both
modes. Real observed/full consumer code processes one synthetic anonymous
session when permitted and none when revoked; neither result infers a customer.
Consumer RPCs and source responses are synthetic, not production verification.

Negatives cover changed original authority/capture/schema/hash, expired or
insufficient validity, missing composite approval, reused source IDs, existing
anonymous namespace, changed source window/project, unknown options, duplicate/
invalid/overflow grants, missing independent controls, request reservation,
UTF-8 overflow, the original active ordinary/parent deadline, late captures,
manifest tampering, and CLI binding mismatches. No runtime activation occurs.

## Final finite evidence map

This table updates L32's map; **17 sections are not 17 missing readers**.

| Section | State after this chunk / concrete unresolved authority |
| --- | --- |
| `identity` | Automatic anonymous grant composition now implemented for ordinary and partition preparation. Historical customer/Firebase/session associations still require verified temporal source records. Anonymous grants have `customerId: null`. |
| `currentlyPermitted` | Retained reviewed customer permission remains required. No customer-level authority is supplied by anonymous grants or marketing flags. |
| `removedCustomers` | Retained reviewed customer removal authority remains required; grant revocation neither identifies a removed customer nor proves deletion. |
| `customerHistory` | Current source metadata and bounded inventory cannot establish lifetime purchase/migration completeness. Requires historical source scope and independent reconciliation. |
| `orderIdentities` | Existing fresh Shopify order-to-source-customer collection is wired; not a temporal website/customer identity bridge. |
| `checkout` | Existing approved cart/draft receipt collection is wired. Actual inbound SMS timestamp/session/contact/permission association remains unsupported by those receipts. |
| `campaigns` | Observed permitted event-context extraction already runs in the full builder. It does not prove complete entry coverage. |
| `sessionCoverage` | Needs independently supported expected event/entry coverage and approved completeness/grace boundaries. |
| `attributionCoverage` | Needs verified identity and full lookback/grace coverage, not self-certified returned events. |
| `replacements` | Existing original-agreement collection supports its explicit financial/line policies. Missing original authority or unsupported financial cases still fail. |
| `settlements` | Conditional code remains: wire the existing successful-transaction mapper only after actual owner approval of its clock and gateways. It is not bank settlement or independent cash/chargeback authority. No policy was invented here. |
| `offers` | L32 wired bounded native/reviewed-taxonomy membership for unedited originals in ordinary and partition collection. Edited-original membership remains separate reviewed evidence. |
| `proofs` | Requires independently extracted expected keys/amounts and coverage. Candidate facts cannot generate their own controls. |
| `externalControls` | Requires actual temporal identity/event lineage/join/spend validation evidence for the requested domains. Synthetic tests do not supply production control evidence. |
| `dateCoverage` | Requires independently supported date/domain completeness; not all-true gates from bounded scans. |
| `comparisons` | Existing reviewed report-selection configuration, not a missing data reader. |
| `cohortCoverage` | Requires authoritative acquisition month, historical ledger lineage and observation horizon coverage. |

No further unconditional source-backed preparation glue was identified in this
bounded review. Additional customer history/permission, independent controls,
SMS association and gateway-chargeback work depends on the specified source
facts/authority. Retention/verified erasure and unsupported financial cases are
separate remaining engineering/provider-policy constraints. The conditional
cash-clock integration above is not implemented or implicitly approved.

**All spreadsheet requirements are not complete.** Live source validation,
activation, customer reads, paid tests and deployment remain outside this work.
