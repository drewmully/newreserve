# Purchase ownership and current processing authorization

This private additive boundary separates purchase-time ownership from current
authorization to process purchase history. It does not create consent, change
generic browser/session identity, or admit a source on a caller boolean.

## Explicit source opt-in

The existing stored customer authority must declare schema version
`customer-purchase-processing-v1` and a `purchase-history:` scope reference.
Its source/evidence references describe the actual current processing decision.
These are a versioned source interpretation, not a new permission register for
the business. Existing authority ID, immutable source/schema/scope, revision,
fingerprint, original validity, fresh capture and SQL locks remain authoritative.
Unknown or other schema versions retain the existing resolver behavior.

Do not set these values merely to make a run pass. No production record is
supplied by this change. Reported owner authorization can be recorded as its
actual provenance, without inventing owner identity, earlier effective dates,
exclusions or a historical browser opt-in.

Purchase ownership evidence must use `original_shopify_order_ownership` and
reference actual original ownership records. Its half-open effective intervals
must cover the order's paid clock, or creation clock for a non-paid excluded
order. A current profile match cannot supply those intervals. Independent
identity/order/customer controls, exact source revisions, complete original
history and migration reconciliation remain required.

The purchase-only resolver retains historical `consent_status` unchanged.
Unknown historical consent does not become permitted. Actual current purchase
processing authorization and current member inclusion govern this separate
purpose. Explicit denial remains a refusal. Removal, conflicting or unresolved
ownership, missing provenance, invalid scope and absence from the current
permitted set also refuse.

## Completed full-report binding

The complete-customer worker opts in only from its SQL-derived authority.
The full builder additionally requires the existing completed customer
generation's immutable binding and context before using this resolver for
order ownership. The existing later admission check still verifies every
order binding, revision, paid clock, count and cohort component.

Only order resolution changes. The generic resolver closure used by browser
observations is unchanged. A purchase-owned subject with unknown historical
browser consent remains browser-ineligible. No permission is copied into
sessions, cookies, conversion or attribution identity.

No SQL definition, generic identity resolver, six-field generation binding,
100-order member limit, lease, current-authority check, CAS guard or installer
changes. Existing default behavior is retained unless the actual stored source
explicitly uses the new purchase-processing schema.

## Evidence and operating limits

Focused synthetic checks cover retained customer normalization and the actual
full builder. They preserve unknown consent values and demonstrate that the
same subject can have accepted purchase ownership while browser identity
remains unavailable. Tests also refuse denied/removed/unknown ownership,
missing source provenance, stale/expired authority, changed source revision,
incomplete history, absent immutable binding and arbitrary boolean opt-ins.

New customers and repeat purchase remain independent of LTV ledger completeness.
This change does not prove real order coverage, fix over-limit customers,
create a current authority receipt, execute a generation, select a destination
or establish recurrence. The existing installer/provider-transaction packet
is separate and remains unchanged.
