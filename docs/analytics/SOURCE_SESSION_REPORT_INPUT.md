# Registered source-entry reports

This is a private, default-off addition to the existing reporting chain. It does
not install or enable a grant, make a provider request, select an export, or alter
the frozen sales-event, Google, Meta or browser source-session components.

## Two exact targets

`paired_financial` adds a source-entry packet to a new current sales-event cycle.
`lean_source_session_report_register` calls the unchanged
`lean_sales_event_cycle_stage` and stores the immutable packet in the same
transaction. Both financial rows must still be disabled, unattempted and unused.
The stored B1 policy and evidence remain unchanged. All B1 and B5 captures precede
the same newly sealed `fullPolicy.asOf`. The B1 claim and source cutoff do not move.

`entry_cohort` creates a new full-run ID for one explicit NY cohort date. Claim
selects a genuine completed exact-day base and freezes its run ID, publication,
result hash and date. That result is input provenance, not current financial
operating authority. Missing authentic base data holds this cohort only. The new
mode cannot renew an expired B1 grant, attach to an old full run or publish finance,
spend or customer-cohort rows.

The generic full finish requires a store row for every date. The new explicit
cohort-only finish therefore has a separate narrow write path. It writes only
sessions and funnel rows, with exact date, stage, version, publication and column
allowlists. Every other fact and report array must be empty. It does not insert
null financial scaffolding and delete it afterward. Paired and unbound runs still
delegate to the previous financial finish chain.

## Finite acquisition and registration

The owner creates an immutable disabled `source_session_report_grants` row with
the exact current v3 config, entry policy, full policy versions, explicit slots,
source plan, approval and actor references. Grant insertion records a real server
observation as `authorityHistoryFrom`; it cannot backdate this clock. The source
policy must already be active and match its config token. This report authority
does not grant browser permission.

Slots are one-based and contain `{mode,date,notBeforeUTC}`. Their not-before clocks
strictly increase, and each date must be closed in New York. The owner chooses at
most 1,000 slots and a matching attempts cap, with an operating window of at most
14 days. Dates are explicit, not derived from loop ordinal or the latest Google
date. A cohort revisit is a new generation, not a claim that a latest-day loop has
matured a different cohort.

`runSourceSessionReport` is the executable producer and registration caller:

1. Call `lean_source_session_report_claim(p_grant,p_slot,p_cycle)` once. Paired mode
   requires the actual B1 capture cycle. Cohort mode requires a null cycle.
2. Read `lean_source_session_report_authority`, one fixed whole-day native query,
   then the same authority RPC again. The server saves both authority responses
   and their original clocks. Only two external authority reads are allowed.
3. Seal one as-of after acquisition. Paired mode's sealing callback prepares the
   financial scope from its actual retained fresh sources using this same as-of.
4. Call `lean_source_session_report_register(p_claim,p_packet,p_scope,p_spend)`
   once. Cohort scope/spend arguments must be null. The registrar compares both
   saved authority snapshots, their digests and the current locked population.
5. A separate explicit `lean_source_session_report_enable(p_claim,p_digest)`
   checks the immutable target and current authority. Registration never enables.
6. Existing base/full jobs consume the named sidecar through `lean_full_inputs`.
   The full job does not make a second, unbound behavior read. The full builder
   revalidates the raw packet even for a direct non-job caller.

The fixed source plan permits one native query and two authority reads in 15
seconds, with a five-second per-request limit. Native, grant and receipt populations
are each capped at 1,000 with sentinel refusal. Native response bytes are capped at
1 MiB, each authority response at 2 MiB and the packet at 8 MiB. This is separate
from B1's 87-request budget. Claim and register are additional once-only control
operations, not hidden provider reads.

The B5 claim deadline is the earliest of start plus 60 seconds, the report grant,
the actual source-policy expiry, source freshness, and the paired B1 deadline.
There is no browser-grant expiry extension. A failed or ambiguous attempt stays
consumed. An unfinished prior claim holds later slots; there is no automatic
retry, replay, backfill or reset. No schedule, alert destination or live operating
grant is created by this component.

## Entry, action and paid domains

The whole native universe is separate from successful receipts. The authority RPC
enumerates all overlapping v3 grants plus exact-day receipts, including current
removal and conflict state. It does not return bearer hashes or claim that a grant
ID is a native session ID.

The producer accounts for included, excluded and unknown native entries. A false
native filter can exclude an entry. For an unmatched entry, a complete authority
domain with no possible eligible grant interval can prove it is outside the
authorized population. Missing receipts alone cannot. The epoch restricts that
absence-based inference, not conclusive matched positive receipts or known native
filter exclusions. A fully classified older native population can therefore count
without backdating the report grant. An independently exhausted empty native
universe also establishes zero without inferring anyone's permission.

A possible unbound overlap, unknown filter, tied entry or unmatched pre-epoch
entry keeps the count unavailable. This does not require every non-opted visitor
to possess a grant.

Only the explicitly scoped `all_sessions` count gets the new correspondence
admission. Generic reconciliation, `proofReady`, `commerceComplete`, financial and
spend gates remain unchanged. The manifest binds the packet digest and population
accounting without publishing raw session or subject identifiers.

The first version has no admitted native action namespace and no independent
complete paid population. Both domains remain unavailable. It does not infer
campaigns from first actions, manufacture paid negatives after nine days, insert
out-of-day orders into B1 facts, or claim mature conversion acceptance. Individual
paid-link helpers remain separate from complete paid membership and receipt-arrival
coverage. Entry-cohort scheduling does not fill those missing domains by itself.

## Current authority and wrapper order

Every paired registration, input and finish operation obtains the existing
Google/B1 grant and cycle locks before the new B5 locks. It then locks the B5
grant/claim and the exact v3 policy for update as its first policy lock. Existing
v3 creators take that policy for share before mutation, preventing new grant or
receipt population changes during report writes. Existing grant and native rows
are share-locked before target base/full/publication rows. Withdrawal holds its
grant update lock before publication changes, so the report does not invert it.

Paired target locks retain the existing event-input, base, full order. The cohort
branch has no financial cycle and starts with its own B5 authority. It reads the
completed base without calling B1 input/current wrappers or requiring an expired
operating grant. Only the explicit immutable cohort mode can use this branch.

Inputs and both finish paths recheck current config, removal/conflict population,
scope and expiry after delegated writes. The input hash includes the packet and
binding. The existing full lease/token and immutable result hash remain mandatory.
The cohort finish also checks lease expiry after its writes. Any exception rolls
back the transaction. The private aliases do not retain runtime execute access.

## Validation boundary

Synthetic producer and consumer tests are not native source proof. The new
whole-day query needs guarded provider validation during its own setup. Real
population closure remains unavailable when opted-but-unbound native visits cannot
be classified from existing authority history. Deployment also needs actual
source configuration, finite grants, dated slots and operator scheduling.

Native SQL validation belongs to the assembled installer fixture. It must show
cohort-only persisted readback, financial injection refusal, wrong date/hash/token,
expired or revoked authority, concurrent privacy mutation, exact paired lock order,
and unchanged unbound financial behavior. No production acceptance follows from
installing or locally testing these files.
