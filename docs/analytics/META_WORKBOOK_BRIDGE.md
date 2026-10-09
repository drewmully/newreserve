# Independent Meta input for a new workbook

This disabled owner-only bridge joins a fresh Meta hourly packet to actual saved Google evidence and a fresh B1 sales-event window. It uses the existing full-report job and workbook delivery contract. It does not create an HTTP endpoint, change formulas, operate campaigns, or modify Google's serving grant, cycle, full run or original `asOf`.

## Why this bridge exists

The installed Google-only grant has no Meta policy. Its full run is already enabled before an independent Meta capture could finish. Adding Meta to that run would change its source scope and timestamps.

The existing standing B1 claim instead expects Meta saved on its Google cycle. That claim remains unchanged. This component uses the separate owner registration path and new IDs:

* Full run `meta_workbook_<future Google cycle UUID>`.
* Base run `meta_workbook_base_<future Google cycle UUID>`.
* Independently registered P6 generation `meta_workbook_<future Google cycle UUID>`.

The bridge never inserts a `sales_event_cycles` row or backfills Meta into a Google cycle. A finite, separately approved contract binds one future Google cycle and one Meta generation. Registration and all new inputs start disabled.

## Exact sources and clocks

Google evidence comes from the actual owner-only `lean_google_auto_cycle_binding` read, with the returned capture hash. The SQL stage rereads that getter and compares the stored manifest, base, control and native account metadata. It does not re-register Google spend or ask Google for another report.

Meta uses the existing three-request Graph v25 helper and clock-fixed hourly adapter for account `2796962933960445`, USD and `America/Los_Angeles`. Both complete Pacific query dates must be closed before either Insights request starts. UTC selection preserves the approved New York reporting day and retains the actual source timezone.

Only successful, complete native account and campaign responses can establish no activity. Missing data, a continuation page, a sentinel overflow or disagreement refuses the packet. No missing source becomes zero.

The compiler re-decodes all three actual Meta receipts and compares the result with the registered packet. `metaPacketSha256` is the actual P6 database `packet_hash` readback, not a locally invented equivalent hash. Raw receipts and the immutable source packet remain separate from the standing two-account declaration.

The contract's expiry cannot exceed the actual Google getter's validity, either Google or Meta capture/control clock plus `maxAgeSeconds`, or one hour after its own `notBefore`. The compiler preserves microseconds. B1 source captures must begin no earlier than the separate contract. The database checks the actual clock again after staging and after delegated finish.

## Existing B1 acquisition is not impersonated

`prepareMetaWorkbook` consumes a genuinely fresh `SalesEventWindowInput`. It does not acquire one, fabricate a standing B1 claim, or run the old 87-request operator under a substituted object.

Parent must supply a separately approved finite acquisition or an already acquired packet whose exact scope and clocks fit this contract. Reuse the existing sales/original/customer readers and the current compiled closure, including the customer successor. Keep their existing limits, source hashes and actual native customer anchors. Do not relabel an old packet as current or change a standing claim's authority.

Customer history is optional for this bridge. If supplied, its source-level binding and freshness must pass the existing B1 customer consumer. Missing customer history stays unavailable. This component does not make whole-store, lifetime-history, consent, attribution or cash claims.

## Parent-operated sequence

1. Obtain separate finite owner authority. Pin the future actual Google cycle, new target IDs, report date, two-account declaration, source contract and bounds. This is not a new Google grant.
2. Acquire Meta once through the existing bounded helper under that authority. Retain the three real native receipts. A failed or ambiguous attempt stays consumed under the parent's durable operator journal.
3. Decode with `metaHourlyPacketFromCaptures`, using the new generation ID and actual capture cutoff. Prepare and execute the existing owner-only `lean_marketing_spend_hourly_register`. Read back the disabled row and its exact `packet_hash`.
4. Acquire or supply the separate genuine fresh B1 sales-event input and optional customer packet. No existing standing claim is renamed or bypassed.
5. Call `prepareMetaWorkbook` with the owner contract, actual Google getter result, registered Meta packet/readback hash, original three receipts, standing account declaration, B1 source and the new full policy `asOf`. It returns a local report candidate and exact `lean_meta_workbook_stage` arguments. It makes zero source or database calls.
6. Under separate parent execution approval, call the owner-only stage once. It rereads Google and Meta, calls the existing B1 event-window registrar and P6 binding, and stores one disabled bridge. Any failure rolls back the transaction. Existing target IDs or a conflicting standing B1 cycle refuse.
7. Read back the actual disabled bridge, new base/full, B1 source and P6 binding. The owner-only enable function requires their exact contract, scope and spend digests. No service-role execute grant is added to stage or enable.
8. After explicit activation, run the existing observed-report and full-report jobs against these new targets. Use the existing selected-workbook path and its actual destination selection/import comparison. Do not repoint ordinary sources or treat local compilation as natural-import acceptance.

Stage, enable, selection, destination configuration and actual import are separate operations. No real contract, source capture, database installation, grant, activation, destination change or scheduled task is supplied by this patch.

## What becomes reportable

The combined adapter admits the exact Google and Meta spend facts after native source correspondence and independent controls agree. The existing `store_daily.spend_usd` includes that bounded two-account scope. Provider/campaign lineage and Meta's source timezone remain in `marketing_spend_daily`.

Other metrics keep their existing evidence gates. MER needs compatible sales. nCAC needs the corresponding customer population. First-party ROAS requires first-party attribution, not Meta platform conversions. Existing acquisition comparison restrictions remain unchanged, so this patch does not invent campaign-level ROAS or make attribution-dependent columns available.

No Meta clicks, impressions or Google click definition is fabricated. An admitted spend amount does not establish those metrics, visitor conversion, full-store cash, repeat rate or LTV. The customer's team can launch ads independently; this reporting component does not switch campaigns on or off.

## SQL composition and revocation

Install the reviewed B5 overlay first, then this component. The Meta installer requires the two B5 aliases and exact reviewed B5 front-door body hashes. It must also bind the complete then-current `lean_full_inputs*` and `lean_full_finish*` function inventory, plus its owner registrar/getter dependencies. Never substitute the old e432 function bodies or fixture OIDs.

The new wrappers rename and delegate the current functions. An absent Meta bridge returns the prior input unchanged. A bound bridge appends only `nativeSpendWindow` and `nativeSpendWindowBinding`, preserves other optional fields, and recomputes the input hash. The existing full job already consumes those fields; no shared TypeScript hook is changed.

Both input and finish wrappers retain current authority/source locks, delegate the preceding chain, then check current authority again. Expiry, revocation or changed input refuses the result and rolls back any write. Enable takes write locks from the outset in Google, bridge, Meta, event-input, base and full order rather than upgrading shared bridge locks after locking the full run. The focused source-order check does not establish native multi-session deadlock freedom.

Private aliases, stage, enable and helpers have no non-owner execute privilege. The prior public input and finish ACLs are restored exactly. Unexpected default grants on the new table/functions are removed.

The bridge's contract, source digest, spend packet and target IDs are immutable. Only enable and irreversible revocation can change. The current getter also preserves Google's independent grant revocation and freshness checks.

B5 `entry_cohort` remains a separate nonfinancial mode and still rejects Meta/financial markers. The wrapper composition test does not create a genuine paired B5 claim for these new one-off targets. A joint successful B5/Meta report needs a separately valid paired source authority. Until that exists, keep truthful per-domain outputs separate.

## Focused validation

```sh
NODE_OPTIONS=--max-old-space-size=384 npx vitest run \
  tests/api/analyticsLeanMetaWorkbook.test.ts --maxWorkers=1 --no-file-parallelism
NODE_OPTIONS=--max-old-space-size=256 node tests/analytics/meta-workbook-bridge-sql.cjs \
  /private/reviewed/source_session_report_input.review.sql
```

The SQL test pins B5 raw SHA `45194ac97898e5a5673cff1fea97bb6d0017e33f6a63cedf032774ed47935c02` and executes its exact two public wrappers before the new Meta SQL. Other prior-domain authority helpers are explicit fixture doubles. It tests new staging, ACLs, input composition, delegated finish and rollback fences in PGlite, not native PostgreSQL or production authority. Existing individual source, normalizer and B5 proofs are reused.

The TypeScript tests use synthetic native responses, the actual Meta and combined adapters, full builder and full-job finish path. There are no provider calls. Actual catalog preservation, native installation, new acquisition/emission authority, publication and destination acceptance remain parent-owned gates.
