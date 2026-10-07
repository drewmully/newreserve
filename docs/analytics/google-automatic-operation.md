# Restricted Google producer and destination observer

Private, default-off addition to frozen B6 V2. This code has not contacted Google, PostHog or a hosted database. It does not create a schedule, credentials, a source or an alert.

## One real cycle

1. `POST /api/analytics/ingest/google-automatic` accepts a private producer capability and `{"action":"capture","cycleId":"<new UUID>"}`. SQL first selects the latest eligible explicitly approved wall-clock slot and reserves one attempt. Account, manager, date, request/page/byte budgets and deadlines come from the immutable grant, not the request.
2. The application makes native Google v25 reads with dedicated credentials. One campaign query and an independent customer total query establish cost and count controls. A separate native campaign read supplies the candidate. Missing, partial or mismatched evidence refuses registration.
3. The restricted commit checks the lease, exact grant, retained history hashes and genuine capture intervals. It creates a new P3 report, saves the native base and enqueues one new standing run. It cannot reset a completed run or replace immutable evidence. An ambiguous capture remains held.
4. The existing full endpoint advances one saved step. Frozen B6 V2 still owns selection. Its source and both independent-control clocks bound validity. Selection cannot exceed one hour.
5. The separately authenticated observer reserves a read lease. A Computer turn reads exact source/schema metadata and newest matching natural job, performs one atomic unfiltered whole-table query, then rereads source/schema and job metadata. The application derives proof from the raw responses. SQL rechecks the unchanged current selection before admitting it.
6. Only accepted content permits the next native cycle. That cycle uses the latest eligible slot, not an ordinal catch-up date. Observation failures never trigger an import. A bounded expired read-only observation lease can be replaced; native capture or full-work ambiguity cannot.

The observer does not need every historical job. Its content proof is exact whole-table equality to one immutable generation. Job metadata is bounded freshness evidence, not a native job-to-table foreign key. `created_at` is a conservative lower bound, not an observed worker-start timestamp. Empty/extra/wrong-generation rows, truncated output, query mismatch, changing selection/schema sync metadata or stale jobs refuse acceptance.

The optional `google_account_daily` resource remains separate from the five-family workbook. The standalone producer preserves the approved retained commerce dependency and forces non-Google coverage gates false. It does not refresh commerce, customer, consent or behavior evidence by changing `asOf`.

## One-use metadata setup before dedicated copies

`{"action":"setup"}` is a separate one-use metadata grant in `google_auto_setups`. It needs no recurring policy, destination, table UUID or LEAN credential copy. This avoids a first-import bootstrap dependency. Its exact ID/revision use `LEAN_GOOGLE_AUTOMATIC_SETUP_ID` and `LEAN_GOOGLE_AUTOMATIC_SETUP_REVISION`; recurring grant settings may still be absent.

The parent calls this exact setup action once directly through the authenticated route. The recurring Computer operator does not call setup or attempt to repair a consumed setup claim. An ambiguous setup needs independent receipt inspection, not another token exchange.

It reads only these exact existing Production settings:

- `GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64`
- `GOOGLE_ADS_IMPERSONATE_EMAIL`
- `GOOGLE_ADS_DEVELOPER_TOKEN`

Account and manager come only from the claim. There is no environment fallback. Setup exchanges the service-account assertion and makes one fixed customer metadata query, at most two requests and 32 KiB within 40 seconds. It checks exact account, USD and America/New_York before recording success. It does not read campaign aggregates or use the old admin Google-spend route.

The private receipt stores the credential tuple SHA-256 and an identity SHA-256, never credential values, private keys, email addresses or access tokens. Only after this test may the parent create the corresponding dedicated LEAN copies. Recurring capture requires `LEAN_GOOGLE_ADS_AUTH_MODE=service_account`, the dedicated JSON/impersonation/developer-token entries, and an exact fingerprint match to the tested tuple. Changed or missing copies refuse before native reads.

## Installation and actual missing bindings

`google_automatic_operation.review.sql` is raw review SQL, not an installer. Use the additive installer:

```sh
node scripts/analytics/google-automatic-install.mjs read pre-ddl-read.sql
node scripts/analytics/google-automatic-install.mjs render approved-install.json guarded-install.sql
```

The parent executes the readonly file, binds its real owner/session, capture time and catalog SHA-256, plus fresh approval/actor, a deadline no more than 15 minutes ahead and the manifest's exact raw SQL SHA-256. The renderer refuses absent values. Metadata is hex encoded, so refs cannot escape a dollar delimiter. Installation compares the current catalog before DDL, checks roles, creates empty default-off tables, verifies the new ACLs and rolls back after a missed final deadline. It inserts no grant and enables nothing.

`scripts/analytics/google-dedicated-source.mjs` builds the exact paused create request in parent RAM from the unchanged P3 manifest bytes. `schemas` lives inside `payload`, as does the separate actual `auth_token`. It adds no cadence field or inline manifest secret. Parent must first run the actual provider-required schema validation and preview, then choose the approved prefix and create the source. Later sync cadence and enable are separate verified settings. No preview, create or source-enable action was performed here.

The catalog inventory covers all `lean_private` relations, columns, constraints, indexes, triggers, policies and view definitions; all functions there and public `lean_*` functions with owner/body/config/ACL; both schemas; role membership and default privileges. It exports no business/source rows or tokens. It includes the actual P3 registration, spend claim/finish, report/full tables, frozen standing enqueue/read/import functions and their indirect guards.

`sql/analytics/google_native_setup.template.sql` is separately default-unbound. An explicit `metadataSetupApproved=true` owner contract can register exactly one enabled metadata-only setup grant for at most one hour. It contains account/manager, finite window, capability digest and approval refs, with no report or destination scope.

`sql/analytics/google_automatic_control.template.sql` handles the later recurring grant. Its register/enable/stop actions require a finite fresh owner contract and whole-policy/whole-grant compare-and-swap bindings. Registration inserts disabled, empty counters and no setup receipt. Enable also requires the standing policy enabled, the real tested setup ID and its current whole-row hash. It copies only that server-saved receipt after checking account/manager and credential binding. The owner cannot submit a fabricated success receipt through this template. Missing settings fail before mutation.

Actual binding still required, not invented here:

| Setting | Required real binding |
|---|---|
| Existing standing policy | Current owner-approved ID/revision, account/manager, dates, finite window, source/control freshness, step and generation budgets, current selector revision |
| New producer grant | Distinct ID/revision; same standing policy; immutable `capture_slots` array of exact `{date,notBeforeUTC}` entries with strictly increasing UTC slot times and nondecreasing dates; finite window at most 14 days; minimum cadence; capture timeout 1–80 seconds; source timeout 1–60; pages 1–5; requests at least `5+2*pages` and at most 20; bytes at most 16 MiB; bounded observation attempts and 1–80-second leases |
| Native binding | Approval/actor/credential-binding refs, distinct producer and observer capability digests; the real setup receipt creates the tested fingerprint |
| Retained dependency | Exact immutable history row and ordered page hashes; owner-pinned report policy and behavior-excluded template. No customer generation or all-provider completeness |
| New destination | Actual dedicated Custom source, `google_account_daily` schema/table IDs and table name, exact approved manifest bytes hash, observer contract hash, freshness bound at most one hour. Parent inventory proved this resource does not yet exist. Do not substitute the observed three-resource source |
| App route | `LEAN_GOOGLE_AUTOMATIC_ENABLED=true` only after approval, fixed grant ID/revision and separate producer/observer secrets; existing exact project/database service binding; Production/main |
| Existing advancement/delivery | Frozen B6 V2 full/standing/delivery flags and separate secrets, no per-run env rewrite or legacy fixed-run bindings |
| Computer turn | Approved origin, exact grant/revision and standing policy/revision, destination contract hash, finite turn window, enabled action flags, 3 application calls and 5 readonly connector calls, a new exclusive attempt path |
| Scheduling and alerts | Actual authorized cadence/window/total-call budget, credential availability on each Computer turn, approved alert destination and successful delivery test. None are configured by this package |

`scripts/analytics/google-automatic-operator.mjs` runs one bounded turn. It uses ambient `pplx connector` authorization only for PostHog reads. Google remains native application service-account traffic. It does not treat connector identity as a Google service account or persist a short-lived CLI credential in Vercel. Provider responses remain in memory; source connection fields are removed before the private callback. Only attempt/result hashes and status are retained. A lost response is not retried.

`posthogRead` accepts the retained connector `result` envelope and the actual newest-first bare job array. SQL display parsing requires the exact query echo, exact two-column header, one JSON tuple and no truncation. The atomic HogQL expression has not been executed live; a provider refusal is a hold, not permission to downgrade to filtered rows.

## Wall-clock slots and late updates

The server selects the latest slot whose explicit `notBeforeUTC` has arrived. Unclaimed earlier slots enter append-only `slot_log` as `skipped_unprocessed`, never as accepted captures. Each claimed slot can create at most one cycle. A restart or delayed prior import therefore skips missed work and chooses the current eligible date instead of replaying an ordinal backlog.

Each slot must begin at or after the exact enclosing full-LA provider query closes. This uses the same NY-to-UTC-to-full-LA calculation and DST refusal as the final Meta hourly adapter. It is normally 03:00 NY on the following day, not midnight NY. A fixed UTC offset is not used. Source identity, account-hour and campaign-hour reads still must pass their existing live checks.

Repeated slots for the same day permit genuine fresh recaptures for late changes. Once later-day slots become eligible, missed earlier-day slots are skipped rather than backfilled. A deliberate older correction needs a separate approved scope. The finite slot inventory does not extend or renew itself.

One active cycle remains enforced. A lost or ambiguous consumed source/full-work attempt stays held and cannot be skipped as though it never ran. The operator withholds and requires reconciliation; it does not silently advance. While active work is held, missed unclaimed slots can be logged, but no second active cycle starts.

A proposed 30-minute capture cadence with at most 672 explicit slots over a 14-day, 24-hour-per-day window fits the existing 1,000-slot cap. This is a proposal, not installed scheduling. The parent may run bounded advancement and observation inside each approved capture turn; this package creates no one-minute platform tasks. Fifteen-minute natural imports remain separate from native capture recurrence. Selection/source-control validity stays at most one hour, and any late or failed replacement can still create a truthful gap rather than stale serving. Keep the initial September 29 positive proof in a separate short grant.

## Combined B1 and Meta recurrence

`lean_google_auto_cycle_binding(uuid)` is owner-only. A separately restricted B1 definer can read the real saved cycle under locks. It returns the immutable packet and its PostgreSQL JSONB SHA-256, exact account/day/grant pins, actual capture/commit clocks and the earliest source/control/grant validity deadline. Runtime receives no execute grant for this accessor.

The accessor does not authorize B1 or Meta acquisition. Their separate restricted cycle must register a genuine new disabled B1 full run, register the newly captured Meta hourly packet with the final clock-fixed registrar, read back its PostgreSQL hash, then call the existing `lean_marketing_spend_bind` while the B1 full run is still disabled. Never call that binding against the already enabled standalone Google report. Never recycle the prior Meta snapshot or infer complete-store sales/customer coverage from an arrived packet.

Optional `meta_policy` defaults to NULL. An explicit immutable value contains only `maxBytes`, `captureSeconds` and `controlApprovalRef`. It fixes account `2796962933960445`, USD, America/Los_Angeles and Graph v25. `meta_claim` reserves exactly three requests once before invoking the separately reviewed `capture-meta-hourly.py`. A failed or ambiguous attempt stays consumed across output paths. Its actual claim is the freshness cutoff; its deadline is at most 55 seconds and no later than current Google evidence validity. `meta_commit` accepts only raw typed native receipts, parses them with the final clock-fixed Meta helper, and calls the owner registrar internally. The new Meta generation stays disabled. Runtime gets no generic registrar permission.

The Computer turn must receive the existing `meta_ads` credential preset for this optional native step. The preset is not embedded or printed. Output files exist only in a private temporary directory and are removed after the private callback. The parent owns approval and scheduling. B1 then uses a distinct new target with `asOf` after all Google and Meta captures, never an update to the standalone Google target.

The three-request Meta packet reconciles account-hour amounts independently. Complete unfiltered campaign EOF provides source membership. The separate B1 scope-specific proof must independently check the exact raw campaign-to-fact transformation, so a changed campaign ID cannot pass merely because total money matches. It must not fabricate a generic independently extracted whole-fact keyset from candidate rows. This packet does not add that B1 proof or relax the global reconciler.

Albert Tres Vilanova is interim freshness/failure and stop/escalation owner pending customer confirmation. No channel or alert threshold is invented. Existing monitor: `scripts/analytics/monitor-refresh.mjs` → `GET /api/analytics/ingest/health`. It already reports standing selection expiry and dedicated import failure. Its opt-in webhook has not been configured or tested here.

## Stop

The owner locks the exact grant, compares its current full-row SHA-256 and revision, then sets `enabled=false`. The trigger permanently revokes it and disables its linked standing policy/current selection. Read back all three. Do not re-enable or delete audit rows, replay an ambiguous capture, or revive an old selection. Stop/pause of the actual external source is a separate explicitly authorized operation.
