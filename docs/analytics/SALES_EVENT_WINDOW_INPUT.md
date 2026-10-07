# Sales event window input

This opt-in source mode prepares a bounded, closed New York date window. It does
not declare a whole-store financial inventory or reuse an old history job.
The ordinary history and partition readers are unchanged when the mode is absent.

## Independent source requirements

`salesEventLocatorQuery` selects all sales events in the requested date window,
without order filters. `paymentEventLocatorQuery` independently selects all payment
transactions for each day. Both return their declared columns, original queries,
currency and a row count below the explicit sentinel. The limits are 31 days,
20 selected orders, 21 locator rows and 1,000 metadata members. A sentinel hit,
unsupported transaction kind, ambiguous event group or changed source stops the run.
This is a bounded adapter, not silent pagination or a large-store completeness claim.

Each selected order needs complete native `PilotSource` data, pinned API-version
evidence, an exact metadata revision and the existing eligibility/catalog policy.
Edited sole-return orders use the separately validated refund-clock preparation.
Other edited forms are not admitted. Native payment projections must equal the
unfiltered paid-date controls. This catches an original purchase whose sales-event
clock and successful-payment clock fall on different dates. The clocks are not
rewritten to make the comparison pass.

Provider error and truncation flags fail closed before structured data is read,
even when a packet is correctly rehashed. This applies to sales envelopes and
payment envelopes or faithful structured payment serialization.

The adapter compares order/event/date membership, independent monetary components,
original quantities and returned quantities. It also checks the final builder's
immutable financial projections against the source mappings. It never labels
mapper-generated canonical keys as independent controls. Original purchases outside
the target dates remain dependencies. Unselected metadata rows remain unprocessed,
not financially excluded.

Raw JSON strings and their SHA-256 hashes are retained, including connector queries
and results. Connector API versions remain null. Native API versions remain pinned.
Capture intervals are retained as acquired, including explicitly bounded intervals
where individual dispatch clocks were not saved. The canonical packet digest binds
these bytes, the source scope and the real business-definition references.

## Report and customer scope

The hook admits only ledger, order, purchase and product-allocation gates on the
proved dates. It does not change global whole-table proofs, session conversion,
cash lifecycle, attribution, cohorts or repeat/LTV readiness.

An optional scoped-customer packet is bound to targets derived from the native
commerce documents. Complete paid-date original membership plus a conclusive
current-observable Shopify result for every original can support a daily count of
distinct new customers. A returning result needs an earlier-day positive witness;
it does not need an exact lifetime first purchase. A first-observable result must
identify the same original and paid clock. Missing or unresolved evidence leaves
the nonempty day's count null. A proved empty original-purchase day has count zero.
This composition does not manufacture `customers` table or history-generation proof.
nCAC still needs independently admitted spend and a nonzero customer denominator.

`prepareSalesEventWindowReport` runs the existing full builder with explicit
unavailable unrelated evidence. Its result remains `observed_unverified`, with no
operating authority, registration or publication. It is not a certification packet.

## Disabled owner registration

`prepareSalesEventWindowRegistration` requires a separate finite operating authority.
Historical business-definition references cannot supply that authority. It compiles
the exact owner-only `lean_sales_event_window_register` call without executing it.
The optional Google binding refers to separately registered genuine spend jobs;
it does not recreate or refresh them. Meta can bind to the same disabled run through
its own owner-only path.

The review SQL requires exact current function-definition, owner, search-path, ACL
and constraint pins. It creates immutable source/authority records and disabled
base/full jobs without history jobs, queues or activation. The base input reader
revalidates the source; the full builder revalidates final facts. Base and full
finish wrappers hold the new authority row lock across delegated writes and check
the deadline again afterward. Existing input hashes, leases and result checks remain.
The script restores the prior front-door ACLs and grants no new registrar access.
All event-mode inputs and finishes acquire locks in the same order: event source,
base report, then full report, using `FOR UPDATE` from the outset. Owner enable or
disable transactions must use that same order. Neither finish locks its job first.

Installation, actual authority, enablement and destination validation are separate
operator actions. SQL static checks are not database execution proof. A restricted
recurring capture wrapper must bind genuinely fresh source bytes; copying a prior
packet or a Google-only template cannot create a new commerce window.

## Optional source-session entry hook

`FullBuildPolicy.sessionEntryPolicy` and `FullBuildEvidence.sessionEntries` must be
provided together. An excluded behavior mode rejects them. The hook uses the
existing entry mapper, preserves zero-action entries and never falls back to the
first observed action. Independent session keys and native controls gate the
`all_sessions` count separately from action-stage maturity and paid conversion.
Unknown action or checkout relations remain counted as unresolved and cannot
certify stages. Entry mode suppresses later-action campaign inference and
attribution until a separately supported entry-bound campaign source exists.
The existing five-field SQL manifest binds entry lineage in its digest.

## Checks

`tests/api/analyticsLeanSalesEventWindowInput.test.ts` contains synthetic contract
tests and an optional private-fixture replay. Set `LEAN_EVENT_WINDOW_PRIVATE_INPUT`
only to a retained preparation input with genuine source bytes. Do not commit that
file. The private proof packet also covers the actual three-source arithmetic,
source and control mutations, paid-clock boundary membership, daily customer
composition, runtime base-reader handoff and source-entry integration. It does not
claim SQL execution, operating authority or live destination acceptance.
