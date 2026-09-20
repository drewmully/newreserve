# L04: bounded retries and analytics-only replay

Adds PostgreSQL `SKIP LOCKED` claims, lease fencing, five-attempt dead letters,
exponential backoff, per-destination work state and an atomic projection/complete
transaction. An expired worker cannot commit over a newer claim. A lost response
does not trigger an unsafe immediate retry. Projection replacement is keyed by
receipt rather than additive delivery count.

The worker accepts synchronous pure transforms, not existing business handlers.
No timer, schedule, billing, fulfillment, email or conversion sender is imported.
Replay retains the receipt, resets only warehouse work and records approval and
operator references. The replay function is NOT granted to the runtime service
role; provision a separate approved operator role before use.

Activation gates: migration/access review, signed receipt test, distinct actual
database connections contending for work, kill/restart during projection commit,
slow-transform lease expiry and authorization-denied replay. PGlite tests cover
transaction and fencing semantics but do not prove network timeout behavior or
production multi-connection performance. Domain transforms and scheduled worker
wiring are intentionally reviewed separately.
