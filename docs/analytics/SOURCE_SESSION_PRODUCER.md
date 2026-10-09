# Bounded source-session report producer

This is a default-off producer for the existing measured, permitted native-entry denominator. It does not start browser capture, issue visitor consent, install SQL, activate a report grant, enable registered work, or prove paid conversion. The cleared v1/v2/v3 capture, filter configuration and setup operations are unchanged.

## Actual path

`runSourceSessionReport` calls the new restricted report claim once, reads current authority, reads the independent whole-day native session inventory, reads authority again, seals one report cutoff, then calls the immutable report registrar once. There is no automatic retry after a failed or ambiguous claim, source read or registration. Registration is not a completed full run and does not enable the registered work.

The companion binding SQL and full-job integration own `lean_source_session_report_claim`, `lean_source_session_report_authority`, `lean_source_session_report_register` and the full-run input/finish wrappers. This module must not ship as automatic report delivery without that companion. The full builder calls `prepareSourceSessionReportBuild` itself, against the SQL-derived binding and actual report context. It does not trust a caller-provided admission result.

The caller requires `LEAN_SOURCE_SESSION_REPORT_ENABLED=true`. Native acquisition uses only `LEAN_POSTHOG_QUERY_READ_KEY`, `LEAN_POSTHOG_PROJECT_ID=353503` and the previously reviewed server-only fixed filter configuration. There is no generic credential fallback or browser export. Actual grant IDs, scope, dates, keys, policy values and activation remain unbound in this private change.

The report grant is distinct from visitor permission. Its immutable, finite slots use one-based ordinals 1 through 1000. Claim IDs and paired financial cycle IDs are UUIDs; grant IDs are nonempty text of at most 128 characters. Claims pin target versions, source policy/config, actual authority-history epoch, exact source budget, mode, dates and deadline. The application does not create a claim from an arbitrary visitor grant.

## Two target modes

- `paired_financial` requires the actual current financial cycle and a caller that seals its scope after all financial and source captures. The new registrar stages the unchanged financial operation and binds the source sidecar atomically.
- `entry_cohort` uses a genuine completed exact-day base publication, `observed:<baseRunId>`, with its real 32-hex result hash. It creates a new `full:<runId>` publication using current report authority. The companion only publishes sessions and funnel outputs. It cannot copy expired financial authority or introduce empty fabricated financial facts when a genuine base is missing.

Every capture must precede the single sealed `asOf`. A capture after an already sealed financial cutoff cannot be attached later by changing its timestamp. Cohort scheduling remains separate from the latest financial day.

## Finite source bounds

The fixed `native-entry-day-v1` plan uses one native query and two authority reads. Each request has a 5-second cap; the three source reads together have a 15-second cap. The SQL claim deadline is independent and may be shorter than 60 seconds. There is no paging or source retry.

The native query covers one complete New York entry day, including 23-hour and 25-hour DST days. It selects the native session ID, source start/end, exact entry match count, entry event UUID and the six provider-evaluated exclusion flags. It does not select contact values, person/device IDs, URLs or campaign values. It joins the native event `$session_id` column to `sessions.session_id`, at the exact source start. It never joins the custom `properties.$session_id`, first quiz action or Allow clock.

Each inventory allows 1000 rows and a 1001st-row sentinel. Native response bytes are capped at 1 MiB, each authority response at 2 MiB, and a packet at 8 MiB. An overflow, asynchronous/incomplete or known cached native response is not accepted. No partial page becomes a complete population. The native day query is new and has only synthetic envelope proof in this packet. The earlier actual one-UUID query check does not establish this query's runtime validity.

The authority RPC must enumerate all overlapping v3 grants, including revoked grants, independently of successful binding receipts. It returns current removal state, exact policy epoch/config, and only receipts whose independently stored native start lies within the requested day. It returns no grant token or grant session UUID. Its server SHA256 partition digest covers ordered grants, receipts, scope and epoch, excluding the invocation clock. Node retains that digest separately from its recursively sorted-key JSON snapshot digest. Neither digest is the base publication's MD5 result hash.

## Included, excluded and unknown

The producer preserves an accounting row over the independent native inventory. Included plus excluded plus unknown equals the native row count.

- A unique exact entry with a known false filter is excluded without inferring browser identity.
- An entry with an exact receipt, matching current grant and independent native entry can be included. An exact current withdrawal/removal can exclude it.
- A missing receipt is not an exclusion. A complete current grant population can prove an unmatched entry is outside the permitted population only when the entire day is at or after the genuine observed authority epoch and no eligible grant interval could cover its start.
- If any eligible interval overlaps an unmatched entry, its association is unknown. Unknown filters, entry ties/missing entry rows, conflicting receipts, changed authority or unmatched pre-epoch entries also withhold completeness.

The epoch limits absence inference, not a positive witnessed permission interval. A fully matched exact native/grant/receipt entry can count before the report grant's observation epoch. Known filter exclusions likewise do not need absent-permission inference. A complete independent native inventory with no entries is zero, even before the authority epoch. An empty receipt lookup with unclassified native entries is not zero.

This does not demand permission from every non-opted visitor. It also does not silently redefine the metric as successfully bound receipts. In particular, an opted later visit whose binding callback never ran may prevent a complete count. The frozen collector has no independently recorded native-to-subject association for that missing callback. No new identity association is introduced here.

The paired entry input contains only included entries. The dedicated admission retains the full accounting and verifies exact final session keys, source IDs, start/end clocks, anonymity, date, version and publication. A complete known empty population returns zero. Incomplete or unknown population returns unavailable, even if there are no retained receipts. Counts do not require seven-day purchase maturity.

## Independent unfinished domains

This first producer supplies no action completeness, paid completeness or campaign attribution. It does not synthesize entry events. Zero-action entries can count, while stage flags and conversion remain unavailable. It preserves the registered financial evidence reference and does not manufacture generic reconciliation controls or globally declare commerce complete.

The existing `lean_source_session_paid_read` checks up to 100 known order IDs. It is not a paid-order inventory or a late-arrival watermark. A concrete successor needs a finite source receipt inventory for the eligible native entry cohort, independent successful transaction evidence for each exact linked order, current removal/conflict checks, and an independently complete paid/arrival interval. The existing HMAC-paid-root receipt has order/cart lineage, but processed/updated clocks cannot supply `paid_at`.

Reusing existing commerce acquisition is possible only if it independently covers successful payments throughout the cohort's seven-day conversion window, not just orders created on one financial day. The retained B1 created-day membership and known-order transaction reads do not prove that paid-time population. The arrival side likewise needs retained verified webhook-delivery coverage, not a claim based on elapsed wall time or a receipt count. No such complete paid-window/arrival contract is claimed by this version. A day must mature through its true entry plus seven days plus 48-hour receipt grace, and any later backfill must use a separate genuine cohort generation.

## Focused verification

Run `vitest run --project api tests/api/analyticsLeanSourceSessionProducer.test.ts` in UTC and America/Los_Angeles. Tests use synthetic identifiers and mock fixed filter values. They cover zero-action entries, known non-opted exclusion, opted-but-unbound unknowns, epoch boundaries, removal, authority changes, pre-Allow starts, false/unknown filters, missing/tied entries, malformed digests/scopes, both modes, DST, row/byte bounds, no fallback credentials, exact request order and no retries. The companion must test actual register-to-full-run behavior and SQL lock/expiry races before consolidated acceptance. These tests are not actual provider or permission evidence.
