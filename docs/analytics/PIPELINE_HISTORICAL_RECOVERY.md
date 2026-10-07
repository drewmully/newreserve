# Private historical recovery candidate

This is an offline implementation candidate, not a release package or permission
to operate production. It adds five files to main
`5262558605e447eb08eeccc6362f49c188f37216`. The original author proof used the
separate frozen ingestion amendment with patch SHA-256
`2041ede22b2e0178295c2fdba2002b3fe83840407021789b8ba239e5d353c075`.
P1 owns that amendment and forward activation. P2 does not change its six files.

## What can be recovered

One explicitly approved retained record per operation. The original must still
be dead at attempt 5 with `mapping_rejected`, no lease, no completion and no
materialization. The retained source, policy, scope and active amendment must
still match the reviewed binding. The offline mapper must accept that source
using the three exact product additions or the exact historical refund supplement.
There is no refreshed provider read.

The October 5 22:00:12Z PRE described records, not unique orders. It does not prove
the current inventory or that all 153 dead records are recoverable. Duplicate
receipts may refer to the same order and source revision. Fresh inventory and
per-record review are mandatory before any execution proposal.

Zero-total records are outside this recovery operation. They remain unresolved
history in the existing reporting and coverage gates. The candidate neither
changes their classification nor makes the historical cohort complete.

## Smallest integration with the existing completion path

`003_receipts.sql` requires one work row per receipt and destination.
`017_shopify_pipeline.sql` ties each snapshot to a unique publication and each
head to one shop and order. `047_pipeline_extended.sql` validates store, product
and optional size rows before calling the original finish. The amendment wraps
that finish and inserts source/admission provenance in the same transaction.

Reusing a dead original directly would require changing its terminal state.
This candidate instead creates an internal recovery receipt and a new work row
inside the completion transaction. Its source is `internal_recovery` and topic
is `historical/recovery`, not a Shopify webhook. Its payload links the original
work and approved operation. It copies the exact retained snapshot into
`recovery:<operation UUID>` and invokes
`public.lean_pipeline_finish_amended`.

The synthetic work starts leased and must finish in that same transaction.
There is no committed leased recovery record, queue insertion, retry route or
background worker. Any failure rolls back the synthetic receipt, work,
publication, copied snapshot, facts, reports, head, amendment completion and
recovery completion together. Original receipt, work, attempts and snapshot
remain unchanged.

P1 confirmed that the signatures and bodies of amended finish and ingestion
context remain unchanged. Native P2 tests exercise those actual functions
through 047 and 017. No weakening of the original completion checks is needed.

## Operation identity and economic identity

An operation has a unique UUID, approval, actor, output digest and short-lived
immutable permit. Completion also has unique keys on original work, recovery
work and publication. A separate unique key on shop, order and source revision
prevents a second recovery of equivalent dead receipts under a different UUID.
Same-revision source conflicts refuse recovery rather than choosing one.

Recovery refuses an existing equal or newer head, an equal or newer order fact
even if its head is missing, and any effects in the original publication.
An older existing head may be superseded by a successfully recovered newer
revision. Reports continue using the existing latest-successful-head views.
Do not sum raw historical publications. The existing ordinary pipeline can
retain multiple publication versions; this candidate does not redefine that
behavior or authorize altering those rows.

Original dead work remains visible to stale and completeness checks, including
when an equivalent recovery completes. This is deliberate. Resolving historical
coverage requires a separate reviewed accounting of original-to-recovery links,
not deleting history or silently changing the report views.

## Authorization and locking

Installation creates empty permit, revocation and completion tables. It grants
no service-role or public execution or table access and adds no runtime hook.
All mutations are owner-only, invoker-context functions.

1. Read the separately approved bounded inventory template. Overflow, missing
   source, ambiguous records or incomplete readback stop preparation.
2. After an approved default-off installation, obtain the selected record's
   `pipeline_recovery_binding(work_id)`. Prepare the output offline using
   `prepareHistoricalRecovery`. Hash its PostgreSQL JSONB text with SHA-256.
   A JavaScript `JSON.stringify` hash is not equivalent.
3. Review the exact retained input and proposed output. A separate owner approval
   names the operation UUID, original work, full binding, output digest, actor
   and deadline. `authorize_pipeline_recovery` defaults `p_enable` to false.
   It issues a permit only with explicit true and a deadline within 15 minutes.
   It checks the deadline again after inserting permit and audit evidence,
   immediately before returning. Expiry during a lock wait rolls both back.
4. `complete_pipeline_recovery(operation_id, output)` rechecks everything under
   locks. It never accepts a caller-supplied replacement source or policy.
5. Read back the recovery and amendment completions, linked synthetic work,
   original preservation hashes, head and report totals. Establish provider
   commit status independently. A lost response is not permission to rerun.

The lock order is the shared zero-exception advisory lock, active amendment
SHARE, scope UPDATE, original work UPDATE, snapshot table SHARE, original
receipt/publication SHARE, then permit UPDATE. Scope UPDATE serializes with
normal finishes. The snapshot lock prevents source conflicts changing during
validation and materialization. This is a one-record owner operation, not a
throughput mechanism. It can briefly block retention and normal completion.
Any eventual execution wrapper must set bounded statement and lock timeouts.

Bindings include the complete original work and receipt hashes, snapshot
metadata and source hashes, full scope and admission hashes, prior head hash
and exact definitions of the existing completion chain/context. Changed
attempts, leases, source, scope, amendment revision, function definitions, head
or output refuse execution. Non-READ-COMMITTED execution refuses.

`revoke_pipeline_recovery` locks the permit and appends immutable revocation
evidence. If it commits first, completion refuses. If completion holds the
permit lock first, revocation waits; it does not cancel or undo committed
financial effects. Disabling or revising the amendment invalidates outstanding
permits. None of these controls remove audit history.

## Financial boundary

The mapper uses the existing exact refund identities and evidence hash. The
historical adjustment remains `other_sales_adjustment = -13.50 USD`, tax zero,
order-level, on the refund-created clock. It does not allocate the adjustment
to an item or product. Cash stays ineligible and null. No new refund shape,
currency, amount, settlement, financial policy or product policy is inferred.

The owner-approved output digest is an authorization boundary. The SQL sink
validates the established fact/report contract; it is not a second independent
implementation of all mapper arithmetic. Review must verify the actual mapper
build and output before issuing a permit.

## Focused proof

Run only `tests/api/analyticsLeanHistoricalRecovery.test.ts`. The pure
preparation test runs normally. `P2_NATIVE=1` enables the native database cases
against a disposable loopback-only PostgreSQL 17.6 fixture on port 55439.
It creates and drops isolated test databases. Roles are fixture-global.
The fixture uses synthetic source data, inserts synthetic active amendment
authority, and omits hosted hooks. It does not test P1 activation again.

The cases cover default-off installation, role refusal, original preservation,
duplicate dead records, concurrent recovery attempts, concurrent revocation and
source change, expired permit and synthetic lease, changed revision/scope/work/
output, head conflicts, materialized facts without a head, same-revision source
conflict, zero-total refusal, read-only inventory, provenance-failure rollback
and the exact refund's order-level effect. The refund fixture substitutes four
identity hashes explicitly, not its amount, allocation or evidence rules.

Reuse the frozen amendment's existing mapper and operations proofs for unchanged
behavior. These tests are not live recovery, provider commit verification,
production lock contention, full-history acceptance or a current cohort count.

## Authorization deadline correction

Independent review found that the first candidate checked the authorization
deadline only before acquiring locks. A real scope-row lock wait could cross
that deadline, then commit an already-expired immutable permit and authorization
audit row. Completion still refused the expired permit. The finding did not
demonstrate financial execution after expiry.

The replacement adds one final deadline check after permit and audit insertion,
immediately before successful return. An exception rolls back both inserts.
It retains the initial deadline check and all existing completion fences.
The new regression uses a separate native PostgreSQL session to hold the scope
row, confirms the authorizer's actual Lock wait through `pg_stat_activity`, then
releases the lock after the deadline. It requires a deadline refusal, zero
permits, zero authorization audit rows, preserved original evidence and zero
financial effects. It does not substitute the clock.

Only that regression is newly run for this correction, against final P1 raw
`db46f76f90ef026799e069f5776f2cbfaef5d146522f8f8cd3c2939fca71d105`.
Reuse the previous
25-case proofs, including the independent reviewer run on final P1. Do not call
the selective correction proof a fresh full-suite run. The original candidate
remains archived and is superseded by the replacement's authored hashes.

## Release and approval prerequisites

- Parent review of this additive patch and the final P1 successor. No PR, push,
  publication, deployment or production operation has been authorized.
- Independent code/security review and a guarded installer with exact catalog,
  ownership, effective ACL, trigger and dependency contracts. This raw review
  SQL is not that installer. The readback must verify empty permits and no new
  runtime grants. Hosted-hook differences still need review.
- Exact mapper/application and SQL hashes in the release record. Bind the final
  P1 artifact, not the older frozen kit as an assumed current release.
- Fresh approved inventory, deduplicated economic identities, original-record
  preservation baselines and proof that each selected retained source maps.
  The supplied inventory flags are triage, not financial eligibility.
- Explicit per-operation execution approval, short deadline and approved output
  digest. Execution and all live readbacks remain parent-owned.
- Post-commit provenance, financial/report reconciliation and unresolved-history
  accounting. Recovery success alone does not clear stale/coverage gates or
  establish full workbook completeness.
