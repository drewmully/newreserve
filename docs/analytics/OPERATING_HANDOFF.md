# Reporting handoff and operating limits

Import baseline updated October 8, 2026 at 21:34 UTC. Handoff updated October 9 at 00:31 UTC after actual saved-dashboard execution and the basic native-session query. All clocks below are UTC.

**Two distinct outputs are ready.** Saved Google/Meta marketing has a finite reporting feed over saved records. The October 7 sales/customer report is an accepted fixed snapshot whose temporary imports are paused. Ordinary observed-sales processing remains unchanged. The Google configuration is unchanged, but its current operational hold is recorded below.

This is not a claim that all 21 workbook metrics are complete or recurring.

## Option A operating update

The user selected a scoped dashboard and basic PostHog operations. The parent ran the three exact frozen read-only queries at **2026-10-09T00:25:44Z**. All passed natively:

- Marketing returned the expected two historical provider rows and original clocks. Google was USD 2.425689 with 10 clicks and 39 impressions. Meta was verified-empty USD 0.000000 with unknown clicks/impressions retained as NULL.
- Sales returned `accepted_fixed_snapshot`, USD 250, one eligible order and zero new customers.
- Product returned `RES-MEM`, one unit and USD 250. Native PostHog accepted the exact readiness-JSON byte check.

These are query results over already-imported rows. They are not new provider captures, proof of a fresh feed or evidence of resumed sales imports. The fixed October 7 sales snapshot remains readable after its serving window expires.

The [scoped reporting dashboard](https://us.posthog.com/project/353503/dashboard/2188727) now exists. Its saved queries ran successfully at 00:30:27–29 UTC, after exact query-byte and tile-ID binding checks. The actual dashboard was opened in Comet. These are retained historical reports, not a newly commissioned live commerce feed.

- [Marketing by provider](https://us.posthog.com/project/353503/insights/J86zCTFH).
- [October 7 sales](https://us.posthog.com/project/353503/insights/Na7jKQsb).
- [October 7 products](https://us.posthog.com/project/353503/insights/2CVtyaN4).

The basic session adapter is implemented in this change, but not yet released or verified writing to Supabase. Its one native acceptance query returned 85 included SDK-native session starts, one excluded and zero unknown for October 7 UTC at 00:29:21 UTC. It uses the existing six exclusions and returns aggregates only. The existing daily 12:30 UTC `traffic-pull` cron becomes its caller on release. No new service, tracking SDK or Computer schedule is required. This is separate from workbook measured sessions and does not establish purchase conversion. See [the traffic operator instructions](TRAFFIC_SOURCE_PULL.md).

Albert remains the interim commissioning contact. MyMully must name its operating owner and backup at handoff; neither has been assigned by this change. The repository instructions and direct source links are the operating reference, not the commissioning conversation.

The frozen consumer reads provider rows separately, preserves original capture/control/evaluation clocks and withholds provider/status mismatches. The sales and product tiles are two views of the same fixed snapshot. Do not add them together. Cross-feed totals, MER, nCAC, ROAS, cash, customer recurrence and backfill are outside this dashboard's scope. A missing or failed query is unavailable, not zero.

### Current Google hold and team repair procedure

At 00:25:16 UTC, a metadata-only check found one changed Shopify client-ID environment record while all three dedicated Google capability metadata pins still matched. This explains the present whole-inventory preflight mismatch. The exact lost response from the earlier held invocation was not reconstructed. No credential value was read and the hold remains unchanged.

1. Preserve the held receipt, complete journal, active owner and original slot/attempt counters. Do not replay the held invocation, discard its marker or create another automation.
2. The authorized operator compares the current safe metadata inventory with the approved inventory. Confirm the exact changed record and intended owner change, and recheck the three dedicated Google key IDs/versions without exporting secret values.
3. Reconcile the actual existing cycle/run and durable receipts before deciding whether any action started. Unchanged Google capability pins alone do not prove that no capture, claim or import occurred.
4. Do not edit the frozen reader or silently replace its approved inventory hash. A separate prospective reader candidate narrows metadata comparison to the three required capabilities, still requires a complete inventory and exact credential-value hashes, and refuses the original version-1 authorization. It needs explicit approval of that new policy and a matching prospective binding. No such approval, binding or live installation is claimed here.
5. Preserve the held invocation and reconcile its terminal state under the existing procedure. Do not replay it, reuse a consumed ordinal or recapture its cycle. Any approved future invocation must use a future original slot and the original exclusive October 21 23:15 UTC expiry, without resetting the spent allowance. A reader patch is not a recovery receipt.
6. Close the incident only after the actual authorized run outcome and independent required readback. Record the incident, binding revision and result in the team runbook. No schedule or grant change is part of this repair.

### Failure, expiry and recovery routing

The existing Google task's source-conversation route remains the only established task-notification route in this handoff. Its `not_automation_run` context/suppression problem remains unresolved. A successful data run is not proof that a notification was delivered.

There is **no approved marketing alert audience and no configured marketing alert**. Leave that alert uncreated. A four-call metadata/documentation check confirmed native SQL insight alerts support a selected numeric column, explicit first/last/any-row evaluation and absolute thresholds through `HogQLAlertConfig`. Thus a small native status insight can report a missing/mismatched import, age of the imported evaluation timestamp or the fixed expiry without a polling service. It is not appropriate to alert on an old provider capture clock merely because this feed intentionally reports historical evidence.

Email delivery requires at least one actual subscribed PostHog user ID. Slack delivery additionally requires an existing connected workspace and exact channel ID through `alert-destinations-create`. The owner must choose the audience and cadence once. Current schema permits hourly/daily/weekly/monthly checks; fifteen-minute and real-time cadences have plan requirements that have not been checked here. Native automatic recovery delivery and an exact queryable warehouse-job failure field were **not** established by the bounded check. Do not promise either or guess a job-table field. PostHog also documents [warehouse signals](https://posthog.com/docs/data-warehouse/surfaces/desktop), but no project-specific signal configuration or notification was inspected.

Until such delivery is actually verified, use the source pages and this runbook:

- F1 failure means a failed/missing expected resource job or incompatible rows/status. Mark the affected presentation unavailable and escalate to Albert, the interim scope owner. Do not force imports or capture providers.
- F1 expiry is October 21 at 23:15. End the expectation of new imports; retain historical rows and their clocks. Renewal needs an owner decision, not an automatic extension.
- F1 recovery needs actual completed resource jobs and consistent rows/status. A source-level `Running` label is insufficient.
- F2's paused imports and expired HTTP window are intentional, not a recurring failure. Its retained rows remain an October 7 snapshot.
- `monitor-refresh.mjs` and `/api/analytics/ingest/health` remain existing opt-in DB/Google mechanisms. They do not prove PostHog import health and must not be described as a commissioned F1 watchdog.

## Open the results

| Output | Where | What is established | Operating state |
| --- | --- | --- | --- |
| Saved marketing | [PostHog marketing source](https://us.posthog.com/project/353503/data-management/sources/01a0d9ea-e2b5-0000-8057-75c5ef5e44ef/schemas), resources `marketing_daily`, `marketing_totals`, `report_status` | October 7 Google spend USD 2.425689 and independently verified empty Meta spend USD 0.000000. Complete 2/1/1 destination rows matched. | Latest-saved reporting, six-hour import cadence, finite scope ending October 21 at 23:15. Historical/uncertified labels remain. |
| Selected October 7 sales/customer snapshot | [PostHog selected-sales source](https://us.posthog.com/project/353503/data-management/sources/01a0d9ea-e2b9-0000-381e-e68fc47de66a/schemas), `store_daily`, `product_daily`, `report_status` | USD 250 gross/net/total, one eligible order, AOV USD 250, one unit, zero new customers. Complete 1/1/5 destination rows matched. | Fixed accepted snapshot. All six source schemas were confirmed paused at 21:30:38; the original six-hour frequencies were restored. Rows remain available. |
| Dedicated Google report | Existing dedicated source `01a11885-6014-0000-3d6e-a4b9da2f0f54`, resource `google_account_daily` | Repeated real capture, report and natural-import acceptance. The retained import baseline includes acceptance at 21:14:25 on October 8. | Existing sole-owner configuration retains its original October 21 expiry and budgets. Currently held as described above. This document does not dispatch it. |
| Ordinary observed Shopify sales/product | Existing source `01a0f3c6-8758-0000-378b-d15c40a96f3a`, route `/api/analytics/reports/observed-current` | Working observed-population reporting and ordinary processing. Five isolated recovery records completed; original failure records were preserved. | Unchanged. It is not complete-store history. Its existing `new_customers` value remains null. |

F1's marketing source is not the selected-sales source. Neither replaces ordinary observed sales or dedicated Google. Meta and website source ingestion remain separate from these reporting imports. Their October 9 read-only refresh verification is already scheduled; do not create another check or invoke another daily capture.

## The 21 metrics

The sales figures below refer only to the accepted October 7 current-observable Shopify scope. A ready value in that scope does not certify earlier history, another day or the whole business. Null/withheld metrics remain unavailable, not zero.

| # | Metric | Usable result and scope | Limit |
| --- | --- | --- | --- |
| 1 | Gross merchandise sales | USD 250.000000 in the selected October 7 snapshot | Fixed accepted scope, not complete history |
| 2 | Discounts | USD 0.000000 in that snapshot | Verified zero for that scope only |
| 3 | Refunds | USD 0.000000 in that snapshot | Not complete payment/refund lifecycle coverage |
| 4 | Net merchandise sales | USD 250.000000 in that snapshot | Fixed accepted scope |
| 5 | Total sales | USD 250.000000 in that snapshot | Sales, not collected cash |
| 6 | Eligible orders | 1 in that snapshot | No wider-period count inferred |
| 7 | Average order value | USD 250.000000 in that snapshot | Uses the matching one-order denominator |
| 8 | Units | 1.000000, product bucket `RES-MEM` | Fixed accepted product population |
| 9 | Advertising spend | Dedicated Google report; also USD 2.425689 selected Google/Meta saved-account total for October 7 | Saved marketing retains `historical_snapshot`, `is_stale=true`, `certified=false`, incomplete-marketing-inventory labels |
| 10 | CTR | Supported by the separate verified Google account report | Not combined-channel CTR |
| 11 | CPC | Supported by the separate verified Google account report | Not combined-channel CPC |
| 12 | CPM | Supported by the separate verified Google account report | Not combined-channel CPM |
| 13 | New-customer acquisition cost | Unavailable/withheld | No accepted combined sales/customer/spend calculation |
| 14 | Marketing efficiency ratio | Unavailable/withheld | Do not divide the two independently scoped feeds and call it an accepted metric |
| 15 | First-party ROAS | Unavailable | Genuine eligible attribution/purchase inputs remain required |
| 16 | Measured sessions | Unavailable | Event aggregates alone do not establish eligible measured sessions |
| 17 | Session conversion | Unavailable | Requires mature eligible sessions and verified paid-order linkage |
| 18 | New customers | 0 in the selected October 7 snapshot | A prior-purchase witness supports returning status; exact first purchase and complete customer history remain unknown |
| 19 | Repeat purchase | Complete-cohort metric unavailable | One returning customer is not a cohort repeat-purchase rate |
| 20 | Revenue LTV | Unavailable | Complete relevant cohort/purchase/refund history and observation window remain required |
| 21 | Collected cash | Unavailable as complete cash | Merchant payment/refund/adjustment lifecycle, including PayPal coverage, remains incomplete |

The new-customer decision used 13 current-member orders and a July 11 prior-purchase witness. The private returning count is one; no new public returning-customer field was added. The public selected-store field `new_customers="0"` and its `ready` label were preserved in PostHog.

## What “fresh” means for each output

### Marketing: recurring access to saved records

`/api/analytics/reports/marketing` selects already-ingested Google captures and Meta packets for its approved closed-New-York-day window. A read does not capture a provider, move a capture clock, enable a P6 packet or renew Google authority.

- `source_captured_at`, `control_captured_at` and `source_sha256` identify the original evidence.
- `evaluated_at` is the reporting request's evaluation time, not source time.
- `source_age_seconds` uses that row's evaluation clock and the older original capture/control clock. Recompute using the frozen implementation when checking a row, not against the clock of a later GET.
- `report_status.google_state` and `meta_state` are `historical_snapshot` or `unavailable`. Missing provider data is not zero. The selected-account total is null with `withheld_missing_provider` unless both same-day inputs validate.
- The initial feed excludes sales. `sales_state=unavailable`, `complete_sales_window=false`, `cross_source_ratios=withheld` remain visible.

A completed six-hour import means PostHog refreshed saved reporting. It does not make old source evidence live, certify every marketing account or establish an atomic cross-resource snapshot. Keep all historical, stale and uncertified fields intact.

The first natural delivery was accepted at **20:45:32.628**, after jobs completed at 20:41:56 through 20:41:57. Whole-table keys/values, typed SQL nulls, source hashes/clocks and scope flags matched; the parent also verified the post-import database scope. No source recapture or forced import occurred. This proves that delivery, not every future scheduled refresh.

For a later read, show the actual last completed job per resource, the row's evaluation time and both original source clocks. If a resource has a failed/running/missing job or an unexpected publication/keyset, do not label the cross-resource result current. A six-hour configuration is not evidence that its next invocation succeeded.

The database read scope expires at **2026-10-21T23:15:00Z**. Future reads must fail closed at expiry. Old imported rows remain historical records, not evidence of renewed authority. No separate new marketing alert integration was installed or verified.

### Selected sales: retained snapshot, no continuing refresh

The accepted publication is:

`full:f2_sales_20261007_a0484d0e-a0aa-46bd-8862-4e9e4b5e8fef`

Its report date is October 7 and its `as_of_at` is `2026-10-08T20:15:10.771Z`. Base/full jobs completed at 20:27:51; independent database readback at 20:27:55 confirmed full result hash `0c405af51ed7ad3f35edb0886de0c6c3`, one attempt and no lease.

The user explicitly approved replacing the two archived old sample tables at 21:02. The parent used the unchanged six-resource manifest `ede0c179ef4a9f1b28625691823cb8410ae54fdce2af341de915f4a0593df6f3`, selected only store/product and temporarily enabled only store/product/status imports. Unselected acquisition/cohort/funnel domains stayed empty with `not_selected` and per-metric status `unavailable`.

Natural imports completed as follows:

| Resource | Rows | Schema ID | Natural job ID | Completed |
| --- | --- | --- | --- | --- |
| `store_daily` | 1 | `01a0d9ea-e303-0000-c381-1ac517072243` | `01a11d60-69ba-0000-fe65-4cffa71f2a7b` | 21:17:05.791370 |
| `product_daily` | 1 | `01a0d9ea-e306-0000-7a49-08ed388766e0` | `01a11d64-fd9b-0000-1c24-2aa178e0719a` | 21:22:13.691747 |
| `report_status` | 5 | `01a11d56-345d-0000-b030-da9825da6ebe` | `01a11d57-9fc8-0000-86a5-8f5694ea5f5f` | 21:07:28.603576 |

The independent retained-evidence comparison passed all **110 source fields, 60 readiness members, 10 contract SQL nulls and 12 inherited legacy SQL nulls**. The complete 1/1/5 tables had no old or extra rows. Typed schema and job identities/counts/times matched. The source body passed the unchanged `validProductionWorkbookPayload`.

The parent then confirmed authorization revision 6, the selected publication/result and finite window in the post-import database readback. At **21:30:38**, all six schemas were confirmed paused and their original six-hour frequencies restored. The three accepted rows/resources remain retained; no database renewal or deletion occurred. The finite HTTP window still ends at **2026-10-08T21:59:29Z**.

After that window, do not treat an unavailable HTTP endpoint as a failed recurring sales job. This was intentionally a one-time, bounded snapshot delivery. Equally, do not present its retained October 7 rows as today's sales. A future sales/customer refresh needs its own approved source/report scope and serving operation. Do not silently re-enable imports or extend the window.

The existing six-resource comparator requires evidence for all six resources. It was not weakened or called a full-six acceptance. This result is explicitly three-of-six scoped delivery. The source's five status rows correctly describe the unavailable domains.

### Ordinary observed sales: fresh snapshot is not complete coverage

The existing observed consumer in `src/lib/analytics/observedDeliveryConsumer.ts` checks generation, row counts, queue state and time limits. Its status expires no later than 30 minutes after the read. `snapshot_checked_at` and status `checked_at` are database observation clocks, not PostHog import-completion clocks.

Before showing a jointly current total, require the actual complete store/product/status rows, matching generation/counts, `operational_state=idle`, unexpired `valid_until` and recent metric snapshots. An empty metric table also needs its actual recent import receipt. Mixed, stale, pending, failed, disabled or invalid inputs must withhold the current-total claim.

`idle` is queue health, not webhook-liveness proof. Keep `producer_liveness=not_proven`, `report_scope=webhook_observed_only`, `certified=false`, `complete_window=false` and existing readiness. A clearly labeled partial snapshot remains useful; it is not complete history.

Raw PostHog previews do not run the TypeScript consumer automatically. Dashboard enforcement of these gates has not been independently established here. Until verified, use the explicit status fields and avoid an unqualified “current” badge.

### Dedicated Google: existing finite owner only

Automation `ed438f4b-01b9-4052-a224-6f5b1006726a` remains the sole owner of grant `google_auto_202610081734` revision 1 and policy `google_policy_202610081734` revision 1. Its original 635-slot allowance includes spent slots and ends exclusively on October 21 at 23:15. The fixed journal root remains `/home/user/workspace/google-restart-first-wake`.

Existing bounds remain 30-minute starts, 15-minute natural import, at most three ordered nine-minute wakes within one hour, one native capture per run, 60 app calls, 15 connector reads, 12 full advances and 12 Vercel GETs. Per-wake caps remain 30 app calls, five connector reads, ten advances and four Vercel GETs. Meta is off in this flow.

Retain reader `36e60402...`, immutable grant/capture/attempt records, active owner and accepted closures. Never rotate the journal, replay a held attempt, create a replacement scheduler, renew authority or add capture calls from this handoff.

The existing health route can report Google policy, selection and stored-import freshness. It does not make live PostHog queries and deliberately retains `posthogReadbackVerified=false`. For actual destination acceptance use the saved observer receipt and its current selection/import binding, not a database “healthy” response alone.

## Operator checks and stop rules

Computer owns approved routine operation, evidence collection and incident follow-through. Albert owns scope and operating-period decisions. Drew owns advertising activation and actual email sending. No ad or email action is authorized here.

| Check | Exact interpretation and response |
| --- | --- |
| Natural job | Verify actual source ID, schema **name and ID**, full-refresh type, completed status, row count and times. Job filtering uses an array of schema names. An error-free source summary or `Running` source status alone is not fresh data. |
| Destination rows | Compare complete unfiltered keysets and all values/nulls/readiness. Do not filter out stale generations or use a sampled first page to obtain a match. |
| Publication/scope | Preserve exact IDs, report dates, definition, account scope and nulls. A provider's verified-empty spend does not invent zero clicks, sales or customers. |
| SQL nulls | Preserve actual nulls, supported by typed evidence. A formatted `"(null)"` marker alone is insufficient. The two accepted comparisons include separate SQL-null checks. |
| Pending natural import | Wait only within the original bound window. No forced import or provider recapture to make an acceptance deadline pass. |
| Failed/ambiguous action | Preserve active owner, lease/attempt evidence and complete journal. No blind retry, lease reset, fourth wake or new run to finish an old cycle. |
| Expiry | Marketing/Google end October 21 at 23:15; F2 serving ends October 8 at 21:59:29 and imports are already paused. Do not renew or remove rows automatically. |
| Stop | Parent-only guarded disable/pause with exact current revision/hash and before/after readback. Stopping future reads does not retract in-flight responses or delete imported rows. |
| Privacy/removal | Withhold affected presentation and escalate. A paused source or denied reader is not proof of downstream deletion. |

Any future approved serving replacement must compare the actual predecessor and current controls. Do not reuse bootstrap/global-absence SQL. The existing historical colon-bearing publication IDs are valid; the reviewed private delivery module `04f6ded8...` preserves them.

The existing Google task sends failures, actual recovery and expiry-within-24-hours notifications to the source conversation and suppresses healthy routine output. A platform limitation has caused `pplx automation current` context to disappear after waits/human messages, with suppression returning `not_automation_run`. The parent logged it. Preserve the known run and actual receipt; never claim suppression succeeded, abandon its owner, or recreate the automation to work around it. This notification/context issue remains unresolved.

## Remaining blockers, without holding back the accepted results

| Type | Remaining item | Owner and next boundary |
| --- | --- | --- |
| Technical | Recurring F2 sales/customer refresh is not implemented or activated by the one-time snapshot | Computer can prepare the smallest existing-path successor after a separate operating decision. Do not repurpose the Google grant or reopen paused schemas automatically. |
| Technical | Historical dashboard gates are verified; a separate marketing failure/expiry alert is not configured | Native SQL alerts are supported. Choose an actual MyMully audience and cadence, then verify delivery. No new monitoring framework is needed. |
| Release | Basic native-session adapter passed one actual aggregate query but is not released | Release the reviewed change, verify one route/job and the corresponding `traffic_pulls` row, then inspect the existing next natural cron. Do not call the native query proof a Supabase write or recurrence receipt. |
| Technical | Ads collection remains tied to closed-day and one-shot job constraints | Follow [the application-owned ads plan](APPLICATION_MARKETING_INGESTION.md). A faster cron alone does not fix those constraints. The replacement workers and cutover are not implemented by this change. |
| Platform | Automation context/suppression can become ambiguous | Existing diagnostic and parent escalation. No schedule/grant changes or new continuation automation. |
| Verification | First scheduled daily Meta and website source refresh | Existing October 9 read-only check. Do not duplicate it or prematurely claim the future job passed. |
| Data | Whole-store history and wider customer/cohort coverage | F2's exact prior witness establishes this returning decision, not complete history, repeat rate or LTV. Retain missing coverage as unavailable. |
| Data/policy | Measured sessions, session conversion and attribution | Require eligible permission/session/order-linkage evidence and the approved definitions; raw event counts do not substitute. |
| Data/access | Complete collected cash | F3 continues independently on payment/refund/adjustment lifecycle and missing merchant/PayPal evidence. Sales are not cash. |
| Business | Operation beyond October 21 or a new recurring F2 scope | Albert decides the finite period, budgets and supported scope. No automatic extension is implied. |

## Evidence ledger

- F1 actual natural-import acceptance, verified `2026-10-08T20:45:32.628Z`, receipt SHA256 `46c14ca7c2903ec2bb74bbe44e9d61f50a4ccd886476e9ecc33123f76715ae07`. Saved manifest `2ab5dcb54633191825fc07deff3581f64effee6410cd7f4b025b386c980c632e`. Complete 2/1/1 tables, typed nulls and post-import scope/hash readback.
- F2 actual HTTP body SHA256 `7b74a02a7e27fc548f86ef7e123661c9d1f3432969bfcc920e26802140f52b6f`.
- F2 independent comparison `F2-comparison.json`, SHA256 `7f4cdf3aed72dc7f737e2942bb883a8d14f0bd97093096374ba09abaf3649122`. Exact-input reproducer `compare-f2-actual.cjs`, SHA256 `1a3f335adbbf36011bfdc04abe600a87730dabf0ef820745d201f90e308ba65d`. It calls no providers and records no full-six, whole-history or atomic-refresh claim.
- Parent's post-import F2 database confirmation at 21:27 and exact pause/frequency-restoration readback at 21:30:38. All six input hashes matched the independent comparison; no database renewal or deletion.
- Existing Google automation procedure, owner journal and actual accepted observer receipts remain the authority for that independent flow.

Keep original raw receipts alongside comparisons. File hashes preserve identity; they do not independently authenticate the provider. No new source read, credential operation, provider write, deployment or schedule change was made by the F4 worker.

Produced by [Teammate](https://www.perplexity.ai/teammate/d456bdc1-cf8c-4a32-9670-4a43713e0921/936182bf-b388-5b9a-8406-c6f7ea2a9eb6).
