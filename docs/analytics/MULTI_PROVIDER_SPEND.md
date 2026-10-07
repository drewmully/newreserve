# Private combined Google and Meta spend input

This additive P6 component is default-off and not a source collector or a production installer. It adds Meta ad-set/day source rows to the existing full-workbook spend facts. It does not change the spend, MER, nCAC or first-party ROAS formulas.

## Input contract

The combined path requires the existing fresh Google manifest, native Google bases and independent account/campaign controls. The observed Google facts must match those exact native generations. Existing runs with no `multiProviderSpend` field use the unchanged Google-only branch.

Each Meta account/day packet includes:

- Exact project, shop, canonical account ID, report date, immutable generation ID and owner approval references.
- Source rows with `snapshot_date`, `ad_account_id`, `campaign_id`, `adset_id` and nonnegative integer `spend_cents`. The adapter aggregates ad sets into the existing campaign/day facts using integer arithmetic.
- Complete bounded source pagination, account metadata evidence, USD currency and `America/New_York` timezone.
- Separately extracted account total and campaign controls in integer micros, their capture time and approval references. Campaign membership and every amount must reconcile.
- An explicit verified-empty source and independently verified empty control for a zero-row account/day. Missing dates are not zero.

There must be one packet for every supplied Meta account on every date in the Google window, up to seven dates and 49 packets. Duplicate ad sets, conflicting generations, duplicate account/days, stale or future controls, currency/timezone mismatches and incomplete source/control packets fail closed.

The retained historical Meta key `act_2796962933960445\n` is rejected as stored. This code does not trim it, remap it or claim that it proves the canonical provider account. A fresh authoritative account read or separately approved exact mapping is still required.

## Completeness and metric admission

The owner-saved provider/account inventory is distinct from arrived rows. It must name the exact Google and Meta accounts, cover every report date, include independent extraction and approval references and satisfy the fresh manifest cutoff. Unknown or additional paid accounts withhold combined spend and ratios.

The full-build evidence must also contain an independent whole-fact key/amount proof and the existing compatible-spend external control. This adapter never derives the expected control keys from its own output.

MER still needs compatible whole-store eligible ledger coverage. nCAC separately needs eligible customer coverage. First-party ROAS still needs the existing first-party paid attribution evidence; a provider conversion total is not a replacement. No ratio is accepted merely because spend reconciles.

Meta clicks and impressions are deliberately omitted. The existing count normalizer uses Google's click definition, so pooling retained Meta counts into it would mislabel those counts. P3's optional Google account delivery report remains Google-only and unchanged.

## SQL binding and finish boundary

`multi_provider_spend_input.review.sql` adds owner-only immutable source/control registrations and immutable full-run bindings. Both tables start disabled. Runtime roles cannot register, mutate or delete those rows. Only `enabled` can change after registration.

Registration of a binding locks the existing full build `FOR UPDATE` and requires it to be disabled, unattempted and incomplete. It locks source registrations in generation order and saves their server-read hashes. A supplied Meta account must cover the full report date window.

The new current `lean_full_inputs` delegates to the exact retained input chain. With no binding, it returns the original JSON unchanged. With a binding, it requires READ COMMITTED, locks the binding and source rows `FOR SHARE`, checks scope, enabled state, freshness and the saved source hashes, appends server-read packets and inventory, then rehashes the input. Caller-supplied packets cannot replace the registered packets.

The finish chain is not rewritten:

1. P3 `lean_google_delivery_finish` delegates to current `lean_full_finish`.
2. Current 053 `lean_full_finish` delegates to `lean_full_finish_021`.
3. The 021 finish locks the full build and observed publication, then calls the current `lean_full_inputs`.
4. The P6 input wrapper calls the former current input, now `lean_full_inputs_before_marketing`. The retained 053 input still calls its prior input chain.
5. P6 binding/source locks survive through the finish transaction. A committed revocation before the finish read refuses publication. A revocation after the read waits for commit.
6. The retained 053 final expiry check still runs after report insertion. An expiry or persistence exception rolls back the whole transaction.

Registration uses full-build lock, report-build lock, then sorted source locks. Finish uses the retained full-build/publication/source lock order, then P6 binding and sorted source locks. Revocation updates should target only the relevant `enabled` rows, without acquiring these locks in reverse order.

The old input alias and new registrar functions have no non-owner execute grants, including unexpected default grants. New tables similarly lose non-owner default grants. The original current-input owner, SECURITY DEFINER setting, search path and effective ACL are preserved. This does not change the existing trusted transform and certification boundary into a database-side formula engine.

## Installation remains unbound

The review SQL refuses installation without `lean.marketing_install_contract`, an independently approved exact pin set for every current `lean_full_inputs*`, `lean_full_finish*` and `lean_google_delivery_finish` function. Each pin contains signature, OID, owner OID, SHA-256 of `pg_get_functiondef` and SHA-256 of raw `proacl` text or `null`. The current owner must execute the component. Alias/table collisions refuse installation.

The synthetic test fixture computes pins only for its disposable database. That is not a production authorization pattern. Parent must verify the actual current call chain, target, aliases, ACLs, security settings and approved hook bodies before constructing any install packet. Do not replay old migrations or an expired execution packet.

No source rows, bindings, grants, activation, collection, runtime invocation or publication are performed by the private patch.

## Minimal next source/control packet

Parent should choose one common closed NY day, or a bounded window of at most seven days. Fresh approvals and evidence are needed for:

1. An authoritative paid-provider/account inventory for this shop and date window. Known Google advertiser `4335795219` under manager `9552995078` does not establish all-marketing completeness.
2. Meta account identity, exact currency and timezone. Keep the malformed historical raw key as evidence, not a silently corrected identifier.
3. Meta ad-set/day rows with the five source fields above, bounded pagination and a terminal-page record. Refuse overflow or absent pagination evidence.
4. A separate Meta account/day total and campaign/day control extraction with exact nonnegative costs, explicit empty-day evidence and capture timestamps.
5. Existing fresh Google account/day and campaign/day controls plus the native registered Google generation for those same dates.
6. A separately saved combined key/amount proof, compatible ledger/customer evidence and paid attribution evidence where those metrics are requested.

Prepare the disabled registrations only after the packet validates. Installation, enabling, native execution and acceptance remain separate parent-owned steps.
