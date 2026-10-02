# Bounded extra commerce throughput

Private candidate. Installation creates an empty grant table, not permission to
collect sources. This is separate from the approved GOAL2 delivery release and
does not alter the normal timer's five-minute schedule.

## Why it exists

The ordinary supervisor advances one receipt per invocation. Its 60-second
interval setting does not produce a second cycle because its request budget is
one process POST plus one health GET. Hundreds of pending receipts therefore
take many hours at the existing rate, even without new arrivals.
Source latency, rate limits and unsupported records still limit throughput;
raising the ceiling is not proof that a burst can use it.

An explicit throughput grant permits extra sequential work after the ordinary
cycle succeeds. It reuses the same queue, Shopify reader, retained-source mapper,
store/product SQL and lease fences. It does not reset old work, change the
creation window, remove approved size handling or register new report builds.

## Authority and budgets

The grant is private and owner-written. It binds the fixed project/shop, the
complete existing scope hash, new approval and actor references, absolute
not-before/expiry times, extra-claim and native-request ceilings and per-batch
ceilings. Installation registers nothing. An absent or expired grant leaves the
ordinary baseline unchanged. Only a missing PostgREST function code is treated
as the safe pre-install off state; other admission failures hold the extra lane.

**Proposed operating values are not approved:** eight hours, 640 extra claims,
5,120 native-request permits across that grant, at most 19 extra claims and
152 extra native requests per invocation. The one ordinary baseline is separate
and retains its existing authority and source bounds. These are ceilings, not
promises to process 640 orders or finish within eight hours.

The same API supports a later, separately approved finite term of at most seven
days with explicit caps. There is no automatic renewal. Immutable terms and
consumed counters cannot be extended or reset; a replacement grant is a new
approval, and an unresolved old batch prevents its use.

The 180-second invocation clock includes the original commerce cycle. Before
each extra claim at least 65 seconds must remain. Each step has the existing
60-second processing bound. No parallel source hydration or inter-step sleep is
introduced. The extra loop stops on completion of its cap, insufficient time,
insufficient source budget or an idle queue.

Every extra native HTTP request must obtain a fresh database permit before
dispatch. Both the database and runtime enforce eight requests per claimed
order and the batch/grant ceilings. There is no retry of a permit or source
request. Ambiguous permit responses burn any committed permit and do not send
HTTP. `native_permits_used` is therefore a conservative upper bound, not an
assertion that every permitted request reached Shopify.

The client reserves room for eight requests before starting another extra
claim. A retained snapshot needs no Shopify requests but still consumes a claim.
This conservative admission can leave unused permits near the ceiling. The
reported counters distinguish extra claims, retained-source steps, native
hydrations, initiated native requests and before-window exclusions. Exclusions
without retained source can still require hydration to prove their age; they
are not assumed to be free.

## Health, failures and late results

Only a successful ordinary terminal result plus fresh, valid enabled health
can admit a burst. Pending work and old backlog age alone are allowed. Leased,
expired or dead work, malformed fields, failed requests and ambiguous responses
are not. Each extra success is followed by another completed health read.
No preflight snapshot is reused.

The extra lane holds a database batch token. Another invocation never steals an
active or expired batch. A failure, missing response or abort after dispatch
does not prove rollback. The runtime neither closes the batch nor sends a
compensating failure after an ambiguous mutation. A known mapping failure keeps
the existing bounded work retry semantics but holds the extra grant for review.

The wrapper delegates existing claim, retain, finish, exclusion and failure
functions, checking the grant, scope and deadline in the same transaction. It
checks time again after the delegate so a late mutation can roll back atomically.
An already committed mutation can still survive caller abort. Read-only
reconciliation is required before an operator resolves such a hold. Do not
clear a lease, reset attempts or invent completion timestamps to resume it.

Within a timer invocation the optional finite financial lane is skipped whenever
the throughput lane is active, held or unavailable. It remains unchanged when
the grant is off. Existing work leases still fence receipt ownership, but
ordinary separately authorized workers can overlap source reads with a burst.
This is not a global source-exclusion guarantee.

The original SQL017 baseline can also reclaim an expired work lease under its
existing five-attempt rules. The extra grant's hold does not globally quarantine
that receipt or remove this existing baseline permission. Even if the baseline
later completes the receipt, the extra grant stays held for operator review.
Approving this candidate accepts that distinction; enforcing a global receipt
quarantine would require a separate change to normal claim semantics.

## Installation and acceptance

The migration is additive. All SQL017/047/052 and financial checkpoint functions,
old scope policy, immutable snapshots and current heads remain untouched.
An exact dependency/catalog-preservation installer and a new operating approval
are still required. Activation must confirm the existing financial projection,
retention and optional size semantics, actual queue/error counts, absence of
held batches, source-cost allowance, operator and stop controls.

Local fixtures cover the actual new SQL, Supabase transport, ordinary baseline,
retained and hydrated processing, exclusions, budgets and late outcomes. They
are not live acceptance. Natural cycles must show the backlog shrinking faster
than arrivals, supported new revisions reaching both report resources and the
delivery consumer becoming current. A pending or dead queue remains visibly
unready; throughput does not weaken those delivery rules.
