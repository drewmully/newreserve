# Recurring observed sales and product processing

The existing production timer advances one verified Shopify receipt per commerce
cycle. SQL017 retains its source and SQL047 writes store and product reports in
the same transaction. No new base/full registration, report engine, schedule or
source enumeration is needed for the observed reporting path.

This path is `shopify-observed-v1`, `webhook_observed_only`, uncertified and not a
complete window. It must not replace the saved two-order demonstration or its
destination binding without separate approval. Candidate `is_stale` and
`observed_unverified` values are not operational freshness clocks.

## Processing guarantees

- A verified receipt enters the existing durable queue. Only the approved shop,
  creation window and merchandise catalog are eligible. The processor does not
  extend the window or approve a product.
- A newer successfully mapped source revision replaces the order's head. Older
  and identical revisions do not add another order to the aggregate. Conflicting
  source content at the same revision is rejected.
- Supported refunds use the existing financial mapper and refund-created date.
  Incomplete source connections, edited orders without supported original
  evidence, unknown products and other unsupported input remain failures. They
  do not overwrite the last successful head. Pending and failed work must remain
  visible to delivery status rather than presenting retained totals as current.
- The process POST has one 60-second budget across claim, source read, retention
  and finish. GET health has a five-second budget. The native Supabase builder
  receives the abort signal, and caller settlement is bounded even if an
  in-flight request does not settle. The timer's existing 180-second budget and
  financial lane are unchanged.
- Abort does not establish rollback. A claim, retention or finish may already
  have committed. The processor returns unavailable and does not issue a
  compensating fail, clear a lease or retry inline after cancellation. Existing
  database leases, attempt caps and immutable retained snapshots govern the
  next normal cycle. A late finish before lease expiry may succeed; an expired
  or replaced lease cannot publish.

## Delivery and acceptance

Both report resources must be read from one database snapshot and assigned one
generation derived from current heads and the approved scope. Delivery status
must distinguish last successful head completion, observed source revision,
current queue health and time of status observation. None proves completeness
of events never received. Status import alone cannot establish that both report
tables contain the current generation.

Release requires the separate delivery contract and operating approval. The
parent operator must bind the actual standing date window, catalog, receipt
subscriptions, cadence, credentials and stop controls. Preserve the previous
demonstration while approving any destination transition. No consumed finite
checkpoint, full report registration or temporary credential is renewed here.

Local fixtures verify processing, not live recurrence. Acceptance still needs
two normal automatic cycles including genuine new eligible input, exact changed
head/report values, matching destination generation and visible freshness.
Unchanged re-imports and queue counters alone are not that proof.
