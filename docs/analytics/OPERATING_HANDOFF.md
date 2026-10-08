# Reporting operations and metric availability

Operational handoff for the October 8, 2026 release. This document distinguishes source ingestion, calculated reports, destination delivery and metric coverage. A successful step does not establish the next one.

The immediate handoff is supported reporting with explicit unavailable metrics. Cash completeness, complete customer history and measured sessions must not be inferred from working Google or observed sales reports. F1 reporting delivery and F2 sales/customer coverage take priority over further operational refinements.

## What is established

| Flow | Established outcome | Boundary |
| --- | --- | --- |
| Google | Genuine source capture, saved report and natural PostHog import accepted. Parent confirmed scheduled 18:45 and 19:15 UTC runs accepted. The actual 19:50:02 database projection records cycle `7501ec9b-bd31-4569-bd8c-cde8869cf4b7` accepted at 19:41:31 UTC for October 7. | One Google account, not all advertising or all 21 metrics. Its retained commerce baseline is not fresh commerce evidence. A past acceptance is not proof of current freshness. |
| Observed Shopify sales/product | Scoped live reporting has reached PostHog. Existing webhook processing and ordinary processing continue. | Observed population only. Queue health and a current snapshot do not establish whole-store history or complete-period reconciliation. |
| Meta | Genuine October 7 source packet saved, including independently verified no activity. Daily source ingestion is deployed. | Source registration is not combined-report or PostHog acceptance. The saved disabled generation must enter an approved report explicitly. Ads remain off. |
| Website events | Genuine page-view, account-created and purchase-event aggregates saved after the ingestion repair. | Event counts do not establish measured sessions, analytics eligibility, session-to-paid-order linkage or attribution. |
| Selected full workbook | The fixed delivery route and six-resource comparator exist. At 19:50:02 UTC, delivery was off and authorization revision 5 was disabled and expired on October 1. The 19:53:32 destination read still showed only the paused September 25 sample's two schemas, not the six-resource workbook. | There is no current combined-workbook serving or destination acceptance in these readbacks. F1 must bind its new real report and actual destination evidence. Do not reuse Google-only acceptance. |

The October 9 read-only Meta and website refresh check already exists. Do not add another check, invoke either daily source route or consume another daily attempt to demonstrate recurrence.

The same actual readback recorded zero sales-event grants and zero Meta workbook bridges. The October 7 Meta generation `meta_ingest_b921826b-b76b-41fd-9076-dc4c2cc442f1` remained disabled with packet hash `0b647fa4350cf03fa8a2778a6a40c361b59437754d923b647329aa76d8b50e40`. This is genuine saved source evidence, not an active combined-report pipeline.

F1 now owns a separate saved-marketing output that can use already ingested records without changing the Google loop. Its implementation and destination receipt remain pending in this snapshot. The disabled historical workbook authorization is not a prerequisite for that independent output. Do not turn workbook bootstrap into a serial gate for supported marketing delivery.

At 20:00 UTC the parent confirmed five Shopify recovery records completed and independently verified, with the original failed records unchanged. The October 7 sales and payment locators returned one order and one successful sale, with USD 250 gross and net. These are coverage progress, not yet native population/compiler/customer acceptance. F2 owns the remaining proof and any resulting metric promotion.

Cash classification has progressed separately. An unresolved cash item and missing PayPal lifecycle coverage remain. Neither blocks the supported marketing or sales handoff.

## The 21 metrics

This is the honest baseline before the new F1/F2 receipt is attached. A metric can be usable for a named scope without being complete for the store. A missing or withheld metric is unavailable, never zero.

| # | Metric | Currently supported scope | Still required for the wider claim |
| --- | --- | --- | --- |
| 1 | Gross merchandise sales | Observed Shopify population | Complete-period order population and reconciliation |
| 2 | Discounts | Observed Shopify population | Complete order and discount coverage |
| 3 | Refunds | Observed supported refund population | Complete refund coverage and unresolved cases |
| 4 | Net merchandise sales | Observed Shopify population | Complete reconciled gross, discounts and refunds |
| 5 | Total sales | Observed Shopify population | Complete supported components and coverage |
| 6 | Eligible orders | Observed supported orders | Complete eligible population, including exception disposition |
| 7 | Average order value | Scoped sales divided by scoped eligible orders | Matching complete numerator and denominator |
| 8 | Units | Observed supported product lines | Complete line population and reconciled order-size treatment |
| 9 | Advertising spend | Verified dedicated Google account | F1's independent saved Meta inclusion, compatible day/account scope and combined destination comparison |
| 10 | CTR | Verified dedicated Google account | Do not present as combined-channel CTR without compatible native definitions and coverage |
| 11 | CPC | Verified dedicated Google account | Do not present as combined-channel CPC without compatible native definitions and coverage |
| 12 | CPM | Verified dedicated Google account | Do not present as combined-channel CPM without compatible native definitions and coverage |
| 13 | New-customer acquisition cost | Unavailable as a complete-store metric | Compatible accepted spend, complete new-customer population and approved definition |
| 14 | Marketing efficiency ratio | Unavailable as a complete-store metric | Compatible accepted sales and all required spend scope |
| 15 | First-party ROAS | Unavailable | Genuine eligible identity, attribution, purchase and spend inputs |
| 16 | Measured sessions | Unavailable | Genuine session eligibility, permission and complete behavior coverage |
| 17 | Session conversion | Unavailable | Eligible mature sessions and verified session-to-paid-order linkage |
| 18 | New customers | Complete-store result unavailable | F2's explicit historical/customer coverage and first eligible purchase evidence |
| 19 | Repeat purchase | Complete-cohort result unavailable | F2's complete relevant cohort history, maturity and repeat-purchase evidence |
| 20 | Revenue LTV | Complete-cohort result unavailable | F2's complete relevant purchase/refund history and observation window |
| 21 | Collected cash | Unavailable as complete cash | Complete payment, refund and adjustment lifecycle, including missing merchant records |

For any newly delivered F1/F2 scope, replace the relevant baseline entry only after retaining its exact population, dates, definition, source evidence, report publication and destination comparison. A scoped customer result does not silently upgrade the complete-store rows above. Preserve the per-metric `readiness` returned by the report.

## Existing visibility, not a new monitor

Three current contracts already separate availability from freshness:

- `src/lib/analytics/observedDeliveryConsumer.ts` validates observed sales/product/status generations, counts, time limits and queue state.
- `src/lib/analytics/productionWorkbookDelivery.ts` validates the selected full-build resource and per-metric readiness contract.
- `/api/analytics/ingest/health` reports configured database checks and the separately enabled Google standing check. It does not query PostHog and explicitly does not establish full-workbook destination delivery.

Do not enable another monitor, alert webhook or scheduler from this document. The existing `scripts/analytics/monitor-refresh.mjs` is an opt-in transport, not proof that an alert destination or recurring monitor is active.

### Observed sales/product

Source `01a0f3c6-8758-0000-378b-d15c40a96f3a` belongs to `/api/analytics/reports/observed-current`, not the full workbook. The existing contract has store, product and status resources plus empty unavailable domains.

`report_status` exposes `operational_state`, `checked_at`, `valid_until`, `last_processed_at`, `source_observed_revision_at`, head counts and pending/leased/expired/dead work. The status expires no later than 30 minutes after its read. Actual import completion comes from PostHog job evidence, not `checked_at`.

`idle` means the bounded queue observation has no known pending/failing work. It does not prove webhook liveness. `producer_liveness=not_proven`, `report_scope=webhook_observed_only`, `certified=false`, `complete_window=false` and observed readiness remain intact.

The existing consumer returns visible `mixed`, `stale`, `pending`, `failed`, `disabled` or `invalid` states and withholds current totals. A deliberately labeled partial observed snapshot may remain useful while incomplete. Do not turn it into a complete or certified total.

Raw PostHog table previews do not automatically run this consumer. A consuming query or dashboard must apply these gates before claiming a jointly current result. A dashboard that does not apply them is an operational rough edge, not evidence that the data is fresh.

### Selected full workbook

The code reserves source `01a0d9ea-e2b9-0000-381e-e68fc47de66a` for a separately approved replacement of the old sample source, with runtime path `/api/analytics/reports/workbook`. Actual configuration had not made that transition as of October 8 at 19:53:32 UTC.

The actual source still had prefix `mymully_sample_sales_20260925` and saved manifest SHA `79cfe02c138521cba9733e0fe174e9d4b760969984884f2f090a30fefffc43e0`, not workbook manifest `ede0c179ef4a9f1b28625691823cb8410ae54fdce2af341de915f4a0593df6f3`. Only `store_daily` and `product_daily` schemas existed. Both had `should_sync=false`, full-refresh type, six-hour frequency and last sync on September 25. Source-level `status=Running` did not mean these tables were refreshing. Their absence of errors did not establish freshness.

The code's six-resource contract is `store_daily`, `product_daily`, `acquisition_daily`, `customer_cohorts`, `funnel_daily` and `report_status`. Do not invent schema/table IDs for the four absent resources. The contract's status contains the publication, dates, definition/model/funnel versions, resource selection, counts, staleness and per-metric readiness. `atomic_resource_refresh=false` is intentional. Independently refreshed tables can temporarily contain different publications.

The route's owner authorization is finite, revision-bound and at most one hour. A selected row or HTTP 200 is not a recurring source producer or a natural-import acceptance. An expired route must fail closed; never select an old publication as fallback.

At the retained 19:50:02 UTC check, the exact predecessor was `full:sales-checkpoint:20260930:20261001:full-two-orders-02`, selected for store and product only. Its authorization had expired at `2026-10-01T22:05:00Z`. New serving authority must preserve and compare the real predecessor and revision; do not reuse that expired serving window or strip the colons from the existing ID. This document does not supply the owner replacement transaction.

The private controller already has a reviewed colon-preserving successor. `sales-event-cycle-delivery.mjs` SHA `04f6ded88ae791962576b93d888ddbbd2ea764e6a3d88808d862c90790b01552` accepts the exact predecessor spelling. The historical `5d527b1...` file does not. Use the already-reviewed successor if an old package is loaded; no new parser change is needed. Its historical runtime bundle pins do not establish compatibility with a later production bundle or supply fresh serving authority.

## Precise live acceptance check

The parent/F1 operator owns destination verification. Reuse already captured evidence rather than performing duplicate reads. For the separate saved-marketing output, use F1's frozen route, exact resource contract and approved comparator. Do not substitute the six-resource workbook validator, borrow the Google destination, or require an unrelated workbook authorization. Verify actual source identity, complete natural-import jobs/rows, metric scope/readiness and current freshness under that exact contract.

The sequence below applies only after an explicitly approved six-resource workbook setup exists. It cannot run against the currently paused two-schema sample source. It is not a requirement that F1 choose that route. Leave ordinary observed sales and the dedicated Google source untouched.

1. Retain the actual selected publication and source response from `/api/analytics/reports/workbook`, including all six arrays and unchanged nulls/readiness. Bind the actual source, manifest, schema IDs, table IDs, primary keys and full-refresh configuration. Do not guess an absent table ID.
2. Let the existing natural import run. Do not invoke a forced import or recapture Google/Meta while waiting.
3. Read jobs for the actual source ID using `schemas` as an array of schema **names**, not UUIDs. Verify each returned job's schema ID and name against the actual metadata. A successful job alone is insufficient.
4. Retain a complete, unfiltered read of every bound destination table, its exact row count, completion evidence and native job binding. The whole table must match the expected keys and values. Old generations and extra rows fail; a sample or first page cannot pass.
5. Require coherent publication, scope and readiness across all six resources. Retain the actual privacy/removal and selection validity readback after the table reads. Never create missing domain rows to make the resources look complete.
6. Run the existing offline comparator against that actual packet:

   ```sh
   node scripts/analytics/accept-workbook-runtime-reports.mjs \
     /private/actual-workbook-evidence.json /private/new-validation-directory
   ```

7. Record the comparator receipt alongside the original authenticated source/job/table/privacy evidence. `offline_workbook_match` means supplied-packet equality. The comparator intentionally retains `liveDeliveryVerified=false`, `metricAcceptance=false` and `atomicCrossResourceRefresh=false`. The parent's live claim must be supported by the actual evidence, not by changing those flags.
8. Publish only metrics whose real source scope and readiness support the claim. Keep unsupported cash, sessions, attribution and complete-store/cohort metrics visibly unavailable.

For observed sales, use the separate observed consumer and its actual three-resource evidence. Do not relabel an observed-current response as workbook evidence or change a recorded response path to satisfy either comparator.

## Google operating boundary

Existing automation `ed438f4b-01b9-4052-a224-6f5b1006726a` remains the sole owner. Its grant is `google_auto_202610081734` revision 1 and standing policy `google_policy_202610081734` revision 1. The original 635-slot allowance includes already spent slots. It ends exclusively on October 21 at 23:15 UTC.

The fixed root is `/home/user/workspace/google-restart-first-wake`. Retain all grant, capture, cycle, credential, attempt and closure records. The completed October 8 owner recovery and original held attempts remain historical evidence. No root rotation, replay, grant renewal, new scheduler or extra capture is authorized here.

Existing limits remain 30-minute starts, 15-minute natural import, at most three ordered nine-minute wakes within one hour, one native capture per run, 60 app calls, 15 connector reads, 12 full advances and 12 Vercel GETs. Each wake retains 30 app calls, five connector reads, ten advances and four Vercel GETs. Meta remains off in this flow.

Reader `36e60402...` keeps Vercel transport for its four verified reads, then removes only `HTTPS_PROXY` and `VERCEL_TOKEN` from the Node child. The unchanged connector uses normal ambient authorization. Do not revert to the historical proxy-inheriting reader or put capabilities in artifacts.

The durable task procedure, actual automation receipt and current owner pointer remain authoritative. This document does not replace them.

## Failure, stop and escalation

| Condition | Operator response |
| --- | --- |
| Wrong, missing or mixed publication; stale status; extra/missing rows | Withhold the current claim. Keep raw receipts and exact hashes. Identify the failing resource; do not hide the mismatch with a filtered query. |
| Source `not_selected`, metric `withheld`, incomplete population | Show unavailable or the explicitly qualified scope. Do not coerce null to zero or extend coverage labels. |
| Failed/ambiguous capture, observation, dispatch or credential reservation | Preserve the active owner and journal. No blind retry, lease reset, fourth wake or new run to finish the old cycle. |
| A PostHog job has not naturally completed | Wait within the original bound run/authorization. Expiry stops the claim; it does not authorize a forced import. |
| Current automation identity becomes ambiguous after wait/messages | Keep the known owner and run receipt. Do not claim `suppress-run-notification` succeeded after `not_automation_run`. Escalate the platform limitation; do not invent another continuation task. |
| Google expiry is within 24 hours | Notify Albert in the source conversation under the existing task rule. Do not renew the original end automatically. |
| Meta or website daily attempt fails or is ambiguous | Keep the consumed job record. Use the already scheduled read-only follow-up; no second daily source attempt. |
| Privacy/removal or unauthorized exposure | Stop presenting affected data and escalate immediately. Source pause or reader revocation does not prove downstream deletion. |

Computer owns approved implementation, evidence collection, routine fixes and the handoff. Albert owns scope/operating decisions. Drew owns actual advertising activation and email sending. Failure, recovery and expiry notifications go to the existing source conversation, not to newly invented recipients.

Actual stop writes remain parent-owned and separately scoped. Existing Google stop controls, observed delivery disable/pause controls and workbook authorization disablement must use their current revision/hash guards. Do not reuse bootstrap/global-absence SQL against an existing control. Stopping future reads does not retract in-flight responses or imported rows.

## Evidence required in the final handoff

Retain one compact record for each accepted scope:

- Actual source dates, population/account scope and source-capture reference.
- Completed report ID, publication, definition and per-metric availability.
- Actual source/schema/table IDs, natural import job IDs and completion clocks.
- Complete comparison receipt and source/table evidence hashes.
- Current selection/freshness expiry, next authorized refresh and owner.
- Unavailable metrics and their precise remaining data or authority requirement.

This handoff does not certify all 21 metrics, whole-store history, combined advertising, cash completeness, a new alert integration or an unverified dashboard. F1/F2 may establish narrower useful scopes independently without waiting for F3/F4 completion or reviving the historical workbook authorization.

Produced by [Teammate](https://www.perplexity.ai/teammate/d456bdc1-cf8c-4a32-9670-4a43713e0921/936182bf-b388-5b9a-8406-c6f7ea2a9eb6).
