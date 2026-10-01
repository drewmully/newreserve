# Retained customer history at larger volumes

This is a private, default-off extension of the existing 040/041 retained-history
path. It is not a collector, a permission authority or a second reporting feed.
The unnumbered SQL file is a review dependency, not an installation script.

## Supported source and limits

One customer run references one completed 041 generation whose registered
projection is `financial_customer_id`, and its exact completed 040 import.
The source completion hash, original 041 scope hash, order revisions and retained
source hashes are immutable inputs. An independently reviewed ownership inventory
must include every original order exactly once. Current profiles, emails,
warehouse first-order summaries and observed minimum dates are not substitutes.

The existing 70,000-order import ceiling remains. Each member contains the whole
history of one canonical customer, at most 100 orders, or one explicit guest
order. A customer with 101 orders blocks the claimed generation; it is not split,
truncated or dropped. Each shard is at most 8 MB, each fact table in its output
at most 10,000 rows and the output at most 16 MB. Retained source bytes across
the generation and total registered evidence are each capped at 256 MiB.
The generation admits at most 100,000 identity intervals. Cross-customer
overlapping intervals are checked across the entire inventory, not only inside
each shard. These limits describe a supported subset,
not acceptance of any particular production population.

The source normalizer reuses the existing Shopify paid-clock, original-purchase,
eligibility, temporal-identity and financial mapping functions. Edited or other
unsupported order histories cannot silently become complete. Known 041
revision/inventory mismatches block admission. Missing financial mapping or
ledger reconciliation does not erase otherwise supported complete order
history. It withholds the ledger-dependent contribution.

No customer or financial data appears in logs or test fixtures. Source identifiers
remain in private storage/input. Output metrics contain no customer identifiers.

## Owner-staged evidence

The owner or a future reviewed preparer stages `history_customer_runs`,
`history_customer_members` and `history_customer_inventory`. Runtime roles cannot
insert or modify these inputs. The scope binds:

- Exact project, shop, 041 source run, 040 completion hash and 041 scope hash.
- Original source origin, complete-through cutoff, as-of time, expiry and maximum
  source age. A historical import cutoff cannot claim coverage beyond its query.
- Independent complete order/customer inventory and migration reconciliation.
- Existing per-order eligibility decisions and approved mapping policy.
- Existing `FullBuildEvidence` temporal identity, current permission/removal,
  complete history, independent key/amount proofs and cohort controls.
- Report definition, dates, cohort H/grace rules and the original full-month
  coverage receipt. Per-member cohort evidence retains original ledger IDs.
- The independently supplied current-authority receipt binding described below.

The source origin is a reviewed completeness boundary, not the earliest arrived
order. A digest seals a supplied inventory; it does not prove its authority.
Guest nulls must be explicit in the retained source. An absent customer field is
not a guest, and an eligible unresolved guest cannot support a complete customer
denominator.

`lean_history_customer_seal` is owner-only and leaves the run disabled. Runtime
claim/finish functions require the exact project and an enabled, sealed,
unexpired run. `runHistoryCustomerStep` additionally requires an explicit caller
approval gate and makes no provider calls.

Each successful step writes one member to the same private
`customer-history:<run>` candidate using the existing logical fact tables.
Global completion waits for every original member/order and rechecks all source
hashes. A retry cannot duplicate a member or change its result. Source facts
cannot be changed after the candidate is complete.

The prior 041 executor's `enabled` flag is not reused as new read approval.
A completed executor may be paused while retained input is separately approved
for reading. The original 040 source kill/purge/completion controls still bind,
as do the new run's approval, enablement, expiry and authority checks.

## Current authority is a separate input

`history_customer_authority` is an owner-only receipt/current-revision pointer
from a future reviewed identity/permission producer. It is empty by default and
has no runtime write grants. It is not permission truth by itself.

Sealing compares its fingerprint with the exact whole-member identity,
currently-permitted and removed-customer evidence. Its target, source, schema
and scope cannot drift. A changed semantic revision, fingerprint or availability
invalidates the bound run. Only the actual external producer may record a
same-revision reread with unchanged fingerprint; this cannot extend the
original validity. Jobs cannot mint capture times, refresh the pointer or renew
expiry.

`history_customer_current_authority` locks the pointer and evaluates the clock
after acquiring the lock. It checks the original validity and a maximum read age
of 300 seconds. Claim, finish and equal-result replay check current authority.
Finish checks again after writes and rolls back if the original lease/authority
expires. A completed-state response is not returned as a valid result after
authority withdrawal.

An actual authority producer, its population coverage and its revocation/update
path remain required. A reference, boolean, hash or synthetic test cannot grant
analytics permission.

## Full consumer and one publication

`FullBuildPolicy.customerGeneration` contains only six immutable references:
run ID, generation hash, result hash, authority ID, authority revision and
authority fingerprint. A new outer SQL integration dependency must derive
`FullBuildEvidence.customerGeneration` from the server-bound completed source.
Caller-supplied/precomputed evidence for that field is forbidden.

`history_customer_report_input` returns bounded daily new-customer counts,
cohort primitive counts/exact dollars and bindings for the actual bounded
report-window order set. It never serializes the entire lifetime population.
The full consumer checks final order identity, paid clock, eligibility and
revision after replacements. Contradictory report-window history or complete
order-count claims fail rather than producing plausible customer numbers.

The cohort function separates primitive counts/dollars from report rendering.
Each original canonical member contributes once; ratios are computed once from
combined components. No child reports or rates are added. Every included
customer must meet its actual first-paid H/grace endpoint and covered cutoff.
Incomplete/immature cohorts remain null. Missing ledger or original-component
lineage withholds LTV, not repeat purchase. The original-component H-end rule
is unchanged.

The full build retains its explicit per-date customer and cohort coverage
withholdings. Generic customer/identity fact proof gates are not switched on.
Existing physical full facts remain report-window facts, not a newly certified
lifetime copy. The full publication requires durable, reconstructible lineage
to the exact immutable customer input generation.

The new wrapper is mandatory for numeric integration. It must hash the entire
derived envelope, check/lock source and current authority before finish even on
an already-completed replay, and preserve lineage through registration,
release, selection and delivery. Do not install or release the pure adapter
alone as a completed production integration.

## Privacy and delivery

For future full runs explicitly bound to this input, missing/changed/revoked or
expired current authority makes the customer-bearing store, acquisition and
cohort resources unavailable. A stale badge does not permit serving old customer
numbers. There is no fallback vintage. Independent product/funnel resources and
the existing 050 sales path retain their own guards.

This whole-resource withholding is a deliberate conservative first version,
not a general rule that missing customer history must block independent sales.
Ordinary missing history, cohort immaturity or missing ledger evidence keeps
the existing per-metric null behavior.

## Before any production use

The actual target's September 30, 2026 metadata check found 040/041 objects absent.
Their repository registrars also bind the earlier project/query scope. Replaying
the raw files does not establish a compatible current-target generation.
Installation requires a new exact dependency/target review, not reuse of an old
installer.

The real retained generation, independent history/migration/ownership inventory,
current authority producer and source/report/destination acceptance remain
unbound. Retention/purge and correction operations for these private candidates
need an owner-reviewed procedure. No source collection, registration, database
installation, activation, certification, export, deployment or production
numerical acceptance is authorized by this code.
