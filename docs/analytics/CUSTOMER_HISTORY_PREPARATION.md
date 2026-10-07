# Customer history preparation and completed binding

This private addition connects operator preparation to the released customer
generation and full-report contracts. It has no provider client, environment
mutation, source collector or scheduler. Unknown identity/history authority
stays unbound.

## Existing contracts remain authoritative

`prepareCustomerHistoryRegistration` accepts an exact disabled registration
packet, an independently retained source-generation receipt and a current
processing/removal authority receipt. Its output is preparation, not admission.
It does not create authority rows or calculate the PostgreSQL generation hash.
`generationHash` and `resultHash` remain null in that preparation output.

The packet maps directly to the existing `history_customer_runs`,
`history_customer_members` and `history_customer_inventory` tables. It contains:

- Exact run ID, completed source run, target project/shop, original source
  scope/completion hashes and covered interval.
- Original as-of/expiry, approved source age and reporting definition, dates,
  cohorts and coverage.
- The existing authority ID, scope, revision and fingerprint, with original
  validity and separately supplied current capture.
- Independently reviewed original ownership inventory, source revisions,
  source hashes, per-order decisions, member evidence and source/migration/
  permission references.

The helper requires the independent source order count to match the whole
packet. Every order has one member; every canonical customer has one member.
Each member retains all its orders, at most 100, or one explicit guest order.
The 70,000-order generation ceiling remains. A member over 100 blocks
preparation. Nothing is truncated or split.

The helper rejects unavailable, stale, future or mismatched authority. A current
marketing preference, Firebase account, Klaviyo profile or new-signup sync is
not an authority receipt. The preparation digest binds bytes only. It cannot
replace the database's source, identity or permission fingerprint.

## Owner registration remains disabled

`customer_history_registration.review.sql` is a proposed additional dependency,
not an installer. It defines two owner-only functions and revokes their use
from public, anonymous, authenticated and service runtime roles.

`lean_history_customer_register` inserts one run and its exact members and
inventory, then calls the existing `lean_history_customer_seal` in the same
transaction. Existing sealing checks the actual stored authority, complete
retained 040/041 source, original hashes and budgets. The new function checks
current authority again after sealing. A duplicate ID or failed check rolls
back the call. There is no upsert or automatic retry.

Successful registration returns the database-derived generation hash, null
result hash and `enabled:false`. It does not enable the run, extend authority,
create a source read, select reports or call the worker.

Confirm current target functions and wrappers before considering installation.
The September 30 inactive dependency receipt already established current-target
registration code. An older function with a legacy project literal does not,
by itself, justify reinstalling history dependencies.

## One member per separately approved invocation

Use the companion default-off runtime only after an owner enables the exact
registered run and binds its server configuration. Each invocation still uses
one claim and at most one finish, a 60-second transport deadline, the existing
90-second database lease and unchanged row/byte limits.

`member_written` is not run completion. An ambiguous finish returns unavailable
and stops without retry or lease reset. Reconcile its durable state before any
new invocation. This addition does not start a loop, advance another run or
turn retries into a schedule.

## Bind only completed results

The owner-only `lean_history_customer_completed_binding` reads one actual
registered, enabled, completed run. It checks current authority and the retained
source generation before returning bounded scope and binding metadata. It
returns no members, identity rows, order bindings or ledger key lists.

`selectCompletedCustomerBinding` chooses one exact receipt from at most 31
explicitly registered run IDs for the target project/shop, dates, definition,
mapping version, as-of and cohort policy. Another date does not substitute for
the requested date. Missing, duplicated, ambiguous, unfinished, expired or
revoked matching input fails. A conflicting existing policy binding also fails.

The return value is only the existing six fields:

- `runId`
- `generationHash`
- `resultHash`
- `authorityId`
- `authorityRevision`
- `authorityFingerprint`

P3's full-registration preparation can place that value in
`FullBuildPolicy.customerGeneration`. Do not place a completed receipt or
precomputed customer numbers in owner-supplied `evidence.customerGeneration`.
The installed SQL wrapper derives that evidence from the registered generation
and rechecks it at input, finish, release and serving. Do not mint a prospective
result hash or put an unfinished customer stage in `lean_full_next`.

The helper can prepare and select future explicitly registered windows, but
does not automatically register them or choose a runtime run ID. A standing
source-authority producer, invocation schedule, monitoring and stop policy are
still required for recurrence. Changing a configured run ID to a future
registered run is an operator action, not an action taken by this code.

## Metric independence

This addition does not change metric formulas or widen coverage. Complete new
customers and mature repeat-purchase counts do not require a revenue ledger.
Revenue LTV still requires complete original merchandise and in-H adjustment/
refund lineage. Whole-month membership and each member's H plus grace endpoint
remain explicit. Unknown or immature metrics remain null.

The synthetic full-builder checks use two customers, one repeat customer,
$5 spend and $30 fixed-age revenue. Expected outputs are two new customers,
nCAC $2.50, repeat purchase 0.50 and revenue LTV $15. Missing ledger evidence
withholds LTV without changing those customer counts or repeat rate. An
immature cohort withholds cohort ratios without suppressing new customers.
Those fixtures are not current customer acceptance.

## Remaining real inputs and operating prerequisites

The retained October 2 investigation found 180 customer-linked Klaviyo order
copies across 177 profiles for one closed day. It also found no admitted target
customer runs, members, inventory or current authorities. The earliest observed
event in 2021 is not complete lifetime history, and those order copies cannot
replace transaction-validated retained source documents wholesale.

Before any production execution, the owner must supply:

1. A governing current processing/removal source, historical identity ownership
   and explicit correction/withdrawal semantics. No permission backdating.
2. A completed matching current-target source generation with independently
   complete original purchase/migration coverage, actual source hashes and
   source revisions. Resolve the observed over-100-order customers without
   silent omission or increasing a limit here.
3. Reviewed registration scope, exact member evidence, independent key controls,
   calendar coverage and separate financial lineage when requesting LTV.
4. Exact current database capability/body checks and approval for any additional
   dependency, registration, enablement and runtime binding. Existing inactive
   installation is not activation.
5. The actual completed binding, full-build registration, independent numerical
   controls, selected output and destination comparison.
6. A recurring producer/registration/invocation owner, freshness and failure
   alerts, disable-only stop procedure and genuine changed-input refresh proof.

No real input is staged by this package. Other metric domains remain independent
and need not wait for customer-history completion.
