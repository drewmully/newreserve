# Annual-access terminal exclusion

Private implementation, not release, installation or operating authority.
The existing merchandise policy remains unchanged. Reserve Access product
`8501257175232` is not merchandise and is never added to `productClasses`.
The retained September29 ongoing-activation review excluded annual access,
other products and mixed orders from merchandise reporting. The released
landing-page source also identifies this product as Reserve Access.

That business scope does not itself authorize this new queue operation.
`pipeline_annual_access_exclusion.review.sql` creates an empty owner-only rule
table. An operator must separately approve and insert a finite rule before the
new finalizer can terminally exclude anything. No rule, grant, schedule or
source call is created by installation. Rules are specific to the existing
shop/project, scope SHA799209 and this one excluded product. Each term is at
most seven days. It cannot be extended, re-enabled or deleted; explicit
disable is allowed. A later term requires a new owner-approved row, not renewal
by a worker.

## What qualifies

The ordinary worker keeps its existing claim, bounded source/retention,
identity, revision and window checks. Before financial composition, it
recognizes a candidate only when the source is unedited, the complete nonempty
line collection has unique IDs, and every line is the exact annual-access
product with a positive safe-integer quantity and no gift-card flag.

The SQL finalizer independently validates those predicates and:

- Requires read-committed isolation, current finite rule authority and a
  currently enabled scope matching both the rule hash and frozen policy/window.
- Locks scope before work, validates the active token and lease, and checks the
  retained order/financial identity, revision and receipt lineage. Refund events
  require the matching retained refund and a clock at least as new as the event.
- Refuses any existing head for this order, even from another publication.
  A correction must not leave older merchandise totals falsely current.
- Refuses an existing materialization, projection, selection or non-candidate
  publication. Unknown, mixed, edited, partial and malformed orders remain
  failures; a failed catalog lookup is never interpreted as an exclusion.

A before-window order still uses the unchanged052 finalizer and reason.
The new operation handles only in-window annual-only orders. It does not
certify financial completeness of excluded orders or calculate their money.

## Effects and audit

A valid normal claim can finish as `excluded_annual_access`. The transaction
marks only its queue work `done`, records that reason/completion time and
clears its live lease. It preserves attempts, the original retained source,
frozen policy/window, publications, facts, reports, heads and selected pointers.

The existing operator audit records the rule/approval, original work and
snapshot metadata, and SHA256 of the unchanged retained JSONB source. The
source itself remains in the snapshot, not duplicated into a new payload store.
If the rule or lease expires during the audit write, both completion and audit
roll back. Duplicate completion does not create a second audit event.

Previously retained pending receipts use their next ordinary claims, with the
normal attempt increment and no new native HTTP for those retained inputs.
There is no attempt reset, forced retry, direct pending-to-done operator path or
materialized-head rewrite. Future annual-only receipts still use the existing
bounded read/retain path. Empty, disabled or expired rule authority returns
false without terminal mutation. The worker reports `lost_lease` in that case;
existing lease/attempt rules remain in force.

## Extra lane and counters

The new SQL explicitly replaces the body of `lean_pipeline_throughput_step`,
adding only the annual finalizer delegate and its successful terminal-clear
case. The existing controller already accepts `state=excluded`; it needs no
new app path, source budget or scheduler change. Retained exclusion consumes
one extra claim and zero native permits. The same ambiguity rule applies:
a lost response may follow a commit, so there is no automatic fail, close or
replay. A batch left open keeps the extra lane held. Ordinary baseline lease
recovery remains separately authorized, not globally blocked by that hold.

Health keeps `done` as all terminal queue receipts. `excluded` becomes the sum
of the two explicit exclusion reasons, with separate `excludedBeforeWindow`
and `excludedAnnualAccess` counters. These are receipt counts, not distinct
orders, successful financial mappings or report counts. The existing health
parser accepts the additive fields and the dispatcher already recognizes
`excluded`. Observed-delivery status uses queue state and head consistency, so
no delivery SQL or consumer change is required.

## Installation and proof limits

Old files052, throughput6b127 and observed-delivery9c5e stay byte-unchanged as
historical evidence. This new SQL version changes the installed health and
throughput-step body hashes while preserving their function identities/ACLs.
Any earlier installer, readback or owner operation that pins those old bodies
must receive a new reviewed version. Old approval hashes cannot authorize the
amendment. Parent remains the sole production writer.

Focused local tests use synthetic inputs with the actual SQL, ordinary worker,
Supabase abortable transport and extra controller. They cover nine pending
receipts over three orders, unchanged scope and25 existing merchandise heads,
two selected pointers, normal future hydration, direct-RPC denials, finite
authority, audit/lease-expiry rollback, receipt/refund lineage and lost-response
ambiguity. They do not use the nine actual private sources or claim a native
concurrency proof. Actual queue completion and recurring delivery acceptance
remain separate production checks after explicit approvals.
