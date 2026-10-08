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
- An audit-only eligibility engine now evaluates normalized cross-provider membership, completed paid billing cycles, service coverage and order-scoped lifecycle candidates. It has no source adapters or runtime dispatch integration, never emits Klaviyo events, and always returns `dispatchEligible: false`.
- Conflicting latest Loop statuses are held as unknown instead of choosing a status by lexical order. Order matching rejects wrong-resource GIDs, absent cancellation state and malformed selling-plan evidence.
- A dedicated pull-request CI workflow runs the lifecycle safeguards, existing Reserve analytics contract, type checking and focused lint. It does not deploy production or run against live accounts.

## Live audit that motivated this patch

The 2026-10-08 overnight bulk import completed 1,012 profiles with zero failures. However, 38 inactive Loop rows and 1 paused row were older than 48 hours; a new Klaviyo push timestamp would make stale source state appear recent.

The deployed `subscription_events` table has `raw_payload`, not the older migration's `payload`, `shop_domain` and `raw_body_bytes`. It contained no rows at inspection. This patch repairs persistence, not subscription-contract processing.

The inbound backbone had 214 paid-order events, 81 cancellations and 1 pause in the last seven days, but no fulfillment/delivered events. This is a coverage gap, not proof that no deliveries occurred.

## Review and rollout

1. Review code and tests. Review the optional schema-alignment migration only for older environments. Production already has `raw_payload`; no production DDL is needed for the observed mismatch.
2. Merge/deploy only after owner approval. Existing enabled membership/site-event flags mean those paths change on deployment; no new flag flip is needed.
3. Confirm the next normal member sync accepts null clearing and the new verification properties in Klaviyo. Inspect small sanitized samples and the completed bulk-job receipt. Do not use a manual secret-backed cron run without approval.
4. Use the website's private-key API event source for Reserve verification, not the OAuth connector's same-name metric. A separately approved correction created API metric `SHYw6P` with flow triggering disabled; draft U3emwM uses it. The earlier OAuth metric `VhyZP6` is retained unused. Correct-source credential setup and synthetic fixture QA are complete, but do not establish real identified-site production coverage.
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

## Eligibility milestone, October 8 afternoon

`src/lib/klaviyo/eligibility.ts` accepts normalized, authoritative evidence, not guessed raw provider payloads. Its output is an audit candidate and a deterministic order/program/customer dedupe key, not permission to dispatch. The dedupe key is not a substitute for a durable outbox/dispatch ledger.

- **Membership:** A fresh positive contract can establish active membership. Nonmembership requires fresh, complete, all-customer-contract coverage from both Loop and native Shopify. App-owned-only visibility, stale rows, conflicting identities and unknown/paused/failed states cannot prove nonmembership.
- **VIP:** A completed cycle must have a distinct provider/contract/cycle identity, a positive successful payment and an explicitly non-refunded, non-cancelled current state. Duplicate retries and an order reused across cycles do not count twice. Conservative audit-only interpretation: at least two cycles on one currently active contract, not two simultaneous initial purchases across two contracts. That multi-contract edge interpretation is not deployed or reflected in customer benefits.
- **Order eligibility:** Requires a current paid/non-refunded/non-cancelled exact order, stable customer-ID match, affirmative marketable email consent, explicit non-internal identity and complete fresh service coverage. Member start requires authoritative first-paid-member-order history. Member delivery separately requires first-delivered-member-order history.
- **Delivery:** All exact shipping line quantities must be delivered. Partial deliveries, mismatched order/line IDs, stale or incomplete fulfillment reads and unknown review ownership remain held.
- **Freshness defaults for the audit model:** Membership source evidence up to 48 hours; order, billing, history and fulfillment rechecks up to five minutes; service coverage up to 15 minutes. These are conservative implementation defaults, not verified source SLAs. Membership decisions are also short-lived and recheck source expiration.
- **Production boundary:** The new engine is not called by the current sync or a dispatcher. No customer holds, consent or VIP properties are populated by this module. Existing sync improvements still take effect only after a separately approved merge/deployment.

### Fresh source evidence

At 20:58:58 UTC on October 8, the read-only MyMully database audit found zero native subscription events and no fulfillment/delivery events in the seven-day inbound slice. The slice contained 55 paid-order events, 75 reconciled cancellations and one pause. These are a new time-window snapshot and should not be mixed with the earlier morning counts.

The support mirror contained 990 open, non-archived Mully threads and 126 closed archived threads. Successful Intercom receipts existed through 20:39:35 UTC, but 95 receipts had error status and two old receipts remained unprocessed. This is evidence that a support mirror exists, not proof of complete all-channel coverage or that every open thread represents a service problem. Nothing was marked service-clear.

The latest topic-registration snapshot table had no rows. Missing inbound delivery events therefore must not be reported as confirmed missing webhook registrations; ownership-aware registration and carrier-tracking checks remain necessary.

The connected Shopify store was verified as Mullybox / checkout.mymully.com. A schema-validated read of `subscriptionContracts(first: 1)` was denied for that field. No alternate credential or endpoint was used to bypass the denial. Shopify documents `read_own_subscription_contracts` or `write_own_subscription_contracts` for the [SubscriptionContract object](https://shopify.dev/docs/api/admin-graphql/latest/objects/SubscriptionContract). A usable read through the subscription-owning integration, plus explicit coverage verification, remains necessary; an empty app-owned result would not prove storewide absence.

## Rollback

Revert this PR to restore previous code, without changing draft email status or removing historical event data. Reverting also restores the known membership freshness and webhook-column defects, so prefer fixing forward when practical. The migration is not applied by this PR and is intentionally non-destructive.

## Local validation

- 136 focused tests pass across nine files, covering the new eligibility engine plus membership/identity, order matching, read-only audit authorization, subscription webhooks, analytics route acceptance, signup sync, restock hooks and the existing Reserve-producer analytics contract. Hosted results are recorded separately in the Project handoff after verification.
- The initial CI run caught an overly broad allowlist change. The correction isolates Klaviyo and keeps the original withheld-event contract unchanged. Added regressions cover disabled flag/missing key, absent identity, privacy signals, authentication, bots, rate limiting and no non-Klaviyo dispatch. That corrected commit passed hosted CI. The new eligibility milestone has its own hosted run and must pass independently.
- TypeScript `tsc --noEmit --incremental false` passes.
- ESLint passes on the changed lifecycle modules, webhook, admin routes and dedicated tests.
- `git diff --check` passes.
- Tests use mocked transports and synthetic fixtures. They do not establish real webhook coverage, a live native contract, a real recovered cart or successful production profile-property clearing.

OAuth-generated events and private-key events with the same name belong to different metrics, as documented in [Klaviyo's branded-events guide](https://developers.klaviyo.com/en/docs/understanding_branded_events). Do not substitute one for the other.
