# L07: temporal identity and certified first-order anchors

Implements publication/version-scoped, half-open temporal joins. Conflicting
evidence never chooses a customer arbitrarily; current removals and permissions
override historical eligibility. No email/phone matching or operational ID
rewriting is introduced. `identity_map` stays in restricted staging.

First-order anchors require independent expected historical sources, completed
coverage, reconciled migrations and approval evidence. A recent renewal cannot
be counted as a new customer when an older eligible paid order exists.

Firebase is not required to test this code. It may be required to establish
approved UID/customer/consent evidence if the existing Supabase or hub sync lacks
it. Do not interpret a disabled Firebase login as customer erasure. Live source
mapping, canonical merge/removal policy, retention/deletion propagation and
independent full-history reconciliation remain explicit activation gates.
