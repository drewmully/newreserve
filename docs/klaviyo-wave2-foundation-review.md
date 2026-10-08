# Klaviyo Wave 2 foundation review

Status: review branch only. No production merge, database migration, manual cron run, new environment variables, profile backfill, customer send or flow activation is part of this change.

## Scope

- Membership sync deduplicates contract IDs, uses source `synced_at`, rejects unknown status values, detects contract/email conflicts and explicitly clears stale transition fields with null.
- A fresh active Loop contract can establish positive active membership. Negative Loop-only evidence cannot certify absence of native Shopify membership.
- Completed orders remain a descriptive count. They are not certified completed billing cycles; the user's two-cycle VIP rule is not activated from that count.
- Existing `mully_wave1_*` launch holds are untouched. New metadata describes verification; it does not release drafts.
- Subscription webhook writes `raw_payload`, matching the live Supabase table, and rejects invalid JSON objects. HMAC verification and duplicate handling remain in place.
- The existing outfit-builder Reserve CTA has a separate Klaviyo-only lane, enabled only by the existing site-event flag and private key. It is not added to the legacy/ad-platform allowlist. Known identity, authentication, bot filtering, rate limiting and explicit GPC/DNT exclusions apply; legacy dispatch, journey capture and AI sales are skipped.
- A pure order classifier recognizes known membership variants/SKUs, selling plans, mixed baskets and renewal-source orders. It rejects missing/test/unpaid/refunded/ambiguous snapshots.
- A pure delivery matcher uses order ID, fulfillment ID, latest fulfillment state, line IDs and exact shipping quantities. It never joins by email or treats fulfillment creation as delivery.
- A new authorized read-only `/api/admin/cron/klaviyo-order-audit` endpoint reports aggregate seven-day coverage and candidate classifications. It has no schedule or dispatch path and never returns customer identity.

## Live audit that motivated this patch

The 2026-10-08 overnight bulk import completed 1,012 profiles with zero failures. However, 38 inactive Loop rows and 1 paused row were older than 48 hours; a new Klaviyo push timestamp would make stale source state appear recent.

The deployed `subscription_events` table has `raw_payload`, not the older migration's `payload`, `shop_domain` and `raw_body_bytes`. It contained no rows at inspection. This patch repairs persistence, not subscription-contract processing.

The inbound backbone had 214 paid-order events, 81 cancellations and 1 pause in the last seven days, but no fulfillment/delivered events. This is a coverage gap, not proof that no deliveries occurred.

## Review and rollout

1. Review code and tests. Review the optional schema-alignment migration only for older environments. Production already has `raw_payload`; no production DDL is needed for the observed mismatch.
2. Merge/deploy only after owner approval. Existing enabled membership/site-event flags mean those paths change on deployment; no new flag flip is needed.
3. Confirm the next normal member sync accepts null clearing and the new verification properties in Klaviyo. Inspect small sanitized samples and the completed bulk-job receipt. Do not use a manual secret-backed cron run without approval.
4. Use the website's private-key API event source for Reserve verification, not the OAuth connector's same-name metric. The approved backfill fixture was recorded on October 8 with flow triggering disabled, but the connector created metric `VhyZP6` under its own integration. That metric must not trigger the website flow. Correct-source credential setup and a separately confirmed correction remain blocked; a synthetic fixture still does not establish production coverage.
5. Run the read-only order audit using normal authorized operations. This endpoint cannot make a flow eligible.
6. Before lifecycle activation, implement/verify the remaining gates below and rewire order-dependent flows to order-scoped eligibility events. Do not mass-set profile holds true.

## Remaining launch work

- Native Shopify contract state coverage and reconciliation, including active/paused/cancelled transitions.
- Unique successful paid billing-cycle evidence for the two-cycle VIP definition.
- Delivered shipment source coverage and first-member-order history, including split deliveries.
- Fresh source-of-truth cancellation/refund checks at dispatch. A paid webhook snapshot can later become invalid.
- Open service-issue exclusions and single ownership of feedback/review requests.
- Durable retry/idempotency and dispatch ledger for new eligibility events; the current order matcher is read-only audit code, not that dispatcher.
- Real inbox and recovered-cart tests; the current cart sample has no CheckoutURL.
- Owner approval for each live flow and campaign.

## Rollback

Revert this PR to restore previous code, without changing draft email status or removing historical event data. Reverting also restores the known membership freshness and webhook-column defects, so prefer fixing forward when practical. The migration is not applied by this PR and is intentionally non-destructive.

## Local validation

- 106 targeted tests pass across membership/identity, order matching, read-only audit authorization, subscription webhooks, analytics route acceptance, signup sync, restock hooks and the existing Reserve-producer analytics contract.
- The initial CI run caught an overly broad allowlist change. The correction isolates Klaviyo and keeps the original withheld-event contract unchanged. Added regressions cover disabled flag/missing key, absent identity, privacy signals, authentication, bots, rate limiting and no non-Klaviyo dispatch. Full hosted CI must still pass on the corrected commit.
- TypeScript `tsc --noEmit --incremental false` passes.
- ESLint passes on the changed lifecycle modules, webhook, admin routes and dedicated tests.
- `git diff --check` passes.
- Tests use mocked transports and synthetic fixtures. They do not establish real webhook coverage, a live native contract, a real recovered cart or successful production profile-property clearing.

OAuth-generated events and private-key events with the same name belong to different metrics, as documented in [Klaviyo's branded-events guide](https://developers.klaviyo.com/en/docs/understanding_branded_events). Do not substitute one for the other.
