# Source-session entry input

This read-side adapter does not collect browser events or enable the Reserve cart policy. It consumes an independently acquired entry cohort, applies its recorded predicate results and existing temporal authority, and builds the existing `sessions` rows. Private caller input alone is not source verification.

## What changes

`prepareSessionEntries` requires a pinned source namespace, sessionization version, action namespace, filter digest, source read reference and current permission snapshot reference. It rejects duplicate source keys, mismatched bindings, stale reads and malformed predicate results. It retains source entries with no Reserve action. Missing authority or unknown predicate results withhold the whole entry-day count; known exclusions remain excluded.

`mapEntryObservations` accepts only a separately evidenced, unique action-session relation to the actual source session. It verifies the same authority subject and source start/end interval. Missing relations leave an action unlinked. A grant UUID, identical-looking string, nearby timestamp or first quiz action supplies no relation. Later campaign tags are removed from this entry-mode input.

`deriveEntrySessions` uses actual source starts and ends, without creating entry events. Complete entries and incomplete action coverage can coexist. `sessionEntryDayCount` returns the eligible NY entry-day count without waiting for purchases. Stage and conversion readiness remain separate. The seven-day conversion window and 48-hour grace are unchanged; existing commerce proof and `finalizeSessionConversions` still apply.

`mapEntryCheckoutEvidence` only translates the namespace of already evidenced order links. It cannot create a cart-to-order link or recover an absent paid relation. A grant linked to multiple visits is rejected because the existing checkout evidence has no visit-disambiguation clock.

## Exact retained source

Parent metadata reads on October 7 established that project `353503` has native `sessions.session_id`, `$start_timestamp` and `$end_timestamp`. The native `events.$session_id` column joins this ID. The similarly named `properties.$session_id` is not a substitute. A candidate entry event must match the native ID and the exact native start timestamp. Zero matches or multiple matches remain unresolved.

The current settings snapshot contains six default-checked predicates: one negative event-host regex and five negative person-email substring tests. Its JSON array digest is `61504f7e32de2ff2d4197a26e25ba57f412891b9c03e6d27b3ef7568e3829819`. This identifies the current snapshot, not a historical filter revision. A retrospective calculation must say it uses the current exclusion definition. The provider project timezone is UTC; this adapter still uses the workbook's NY cohort boundaries.

Each source entry carries six server-evaluated booleans in the source predicate order. Person email and host values do not need to leave the provider. A false predicate excludes the entry; null means unknown, not pass. The producer must verify unset-property semantics against the provider's native filter implementation and retain the applied-query/filter reference. The adapter does not claim a matching digest proves that an upstream query actually applied the predicates.

## Builder integration

The full-build owner wires an optional `policy.sessionEntryPolicy` and `evidence.sessionEntries` together. Missing one of the pair must reject entry mode. Preparation uses the existing identity evidence, current permission/removal sets, publication, mapping version and as-of clock. Do not route this input through a public browser endpoint or substitute arbitrary HTTP caller evidence.

Use mapped observations for normalization, then `deriveEntrySessions`, rather than the legacy first-action sessionizer. Translate only existing checkout evidence. Include the counts/digest-only preparation lineage in the private manifest. The complete NY `all_sessions` count can use `sessionEntryDayCount` when the independent source/authority/session-key controls pass. No action-stage, conversion or campaign gate is implied by that count. Entry-mode campaign attribution must stay withheld until a separate source-entry campaign binding is admitted.

## Not implemented or claimed

- No new collection, browser identity, permission policy, consent wording or activation.
- No live PostHog reader, historical permission reconstruction or fabricated filter version.
- No independent acquisition of entry records, filter parity proof or source completeness proof.
- No native-to-custom or native-to-grant bridge inferred from counts.
- No cart-to-paid join or native entry campaign ingestion.
- No claim that all site visits are measured; this is the admitted, permitted, filtered source-session cohort.

The adapter can accept future legitimate source input under the same contract. It cannot make unavailable history exist. Reserve cart v2 remains byte-unchanged in this delta.
