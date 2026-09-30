# Offline session and conversion validation

This operator closes a local execution gap: preparation could build a disabled
bundle, but the full job required hosted claims, a PostHog query and persistence.
The new command reuses the existing transforms without any of those actions.
It is not a new analytics algorithm or permission framework.

## Command and input

Run from the repository with its existing dependencies installed:

```sh
node scripts/analytics/replay-sessions.mjs /private/reviewed-replay.json /private/new-result
```

The output parent must already exist. The result directory must not exist.
No environment variables or credentials are needed. Do not run collection,
registration, dispatch, migrations or source-feed commands for this replay.

`reviewed-replay.json` is a JSON object with these exact required inputs:

| Field | Existing contract | Required origin |
| --- | --- | --- |
| `version` | `1` | Operator envelope version |
| `refresh` | `RefreshInput` in `refreshPlan.ts`, not a collection wrapper | Reviewed, frozen intake scope/as-of; all 17 packets and their bindings; unchanged policies and execution metadata |
| `base` | `Candidate` in `certification.ts`, all existing fact-table arrays | Already retained commerce/spend candidate from its owner, including source reconciliation. Customer arrays may be empty; do not create customer history |
| `deferredOrders` | `DeferredOrder[]` in `deferredCommerce.ts` | Exact saved base-input inventory. Use `[]` only when that inventory is actually empty, not when it is unknown |
| `posthogResponse` | Existing synchronous query response: `columns`, `results`, optional completion metadata | Saved bounded native response matching `refresh.behavior`; no new source read |
| `expected` | `{evidenceRef, independentlyExtracted: true, funnel: [...]}` | Independently enumerated expected aggregates; never copy from candidate output |

Each expected funnel row contains exactly `report_date`, `stage_id`,
`measured_sessions`, `mature_sessions`, `converted_sessions` and
`session_conversion_rate`. Include every date/stage, including `all_sessions`.
Counts are JSON integers or null; the rate is six-place decimal text or null.
Row order does not matter; missing, extra or duplicate rows fail comparison.

The command follows `prepareRefresh` → `readPosthogBehavior` using an in-memory
saved response → `boundBehaviorEvidence` → `buildFullReports`. It preserves the
full job's family/as-of and deferred-original checks. It deliberately refuses
`behaviorMode: "excluded"` because that is not a session-validation scope.

It writes only `session-validation.json`: projected aggregate funnel rows,
optional acquisition aggregates and attribution digests described below,
input/evidence/expected digests, version/as-of metadata and explicit
`certified: false`, `registered: false`, `enabled: false`, `hostedCalls: 0`.
It never writes canonical facts, raw event data, identifiers or tokens.
Matching a supplied expectation does not verify that its purported authority is
genuine. Input provenance remains a review prerequisite, not an inferred claim.

## Smallest real validation plan

### Measured anonymous session first

Use **one already authorized Reserve journey**, not all-site page views. A
minimal case contains one allowed `lean_reserve_started` action and one scoped
anonymous grant, with an independently enumerated expected session. Repeated
native records may exist only if the independent inventory records them and
the existing action deduplication contract applies.

Use the actual producer mapping, not the old synthetic aliases:

```json
{
  "actionProperty": "$insert_id",
  "sessionProperty": "$session_id",
  "identityProperty": "distinct_id",
  "identityNamespace": "lean_subject",
  "consentProperty": "analytics_permitted"
}
```

The producer's `collection_version` is `lean-v1`; bind the reviewed producer
and schema labels accordingly. The reader does not independently inspect that
source property. Native `distinct_id` is acceptable here only as the verified
random grant subject from this producer, not the email-capable legacy fallback.
For one family without campaign mapping, the saved query columns are exactly
`uuid,event,timestamp,distinct_id,insert_id,ph_session_id,analytics_permitted`.

Required real evidence:

- An existing `JourneyPermissions` snapshot mapped with `mapJourneyPermissions`,
  exact project/shop/PostHog/read window, source digest, capture time, effective
  interval and revocation status. Keep `customerId: null`.
- Packet/binding hashes and freshness that pass the original frozen as-of.
  Do not advance capture timestamps to make an expired input look current.
- Independent action/session key inventory and date coverage, with entry and
  bot/internal eligibility defined for this finite journey scope.
- Existing controls `native_project_uuid_lineage`, `temporal_identity_intervals`,
  `event_customer_fk` and `event_session_fk`, with evidence references. An
  anonymous null customer is legitimate; “FK control passed” does not assert
  that a historical customer exists.
- An already retained base candidate from the financial owner. Unknown
  financial/customer domains remain unavailable; this command does not rerun
  or duplicate the production sales load.

The full job conservatively requires the event-read window to include
`report_date 00:00Z` through at least the next day `06:00Z` to enable a full-date
behavior gate. A narrower saved read must remain unavailable under that
definition, not be silently promoted to full-day coverage. All queried native
rows must belong to the finite approved family/window, within 10,000 events,
8 MB response and 93 days; the envelope itself is limited to 16 MB.

Expected positive result, **only if the independent evidence enumerates this
exact case**: `all_sessions.measured_sessions = 1` and the selected Reserve
stage count equals one, with no canonical customer created. Conversion remains
null when commerce/bridge/maturity inputs are unsupported. These are conditional
acceptance expectations, not current live values or permission to collect a case.

### Add conversion only when the bridge already exists

Use the same session plus its real retained checkout receipt and independently
read eligible paid order, mapped by the existing `mapJourneyCheckout` (or
supported draft mapper). Signature verification stays in the original private
preparation path; do not put its signing secret in the replay file. Retain
the exact order/cart or verified first-party link and replacement inventory.

Require independent `orders` and `order_items` proofs, the
`event_order_diagnostics` control, date-level order availability, event
coverage through window end and the agreed observation grace. Count a session
once even if it has more than one eligible linked order. Do not join by email,
timestamp proximity or customer-history guesswork.

The provisional default is seven days, half-open `[session start, start+7d)`,
with a 48-hour grace explicitly supplied by the reviewed input. The runner
does not silently insert that grace. At a mature as-of with one independently
expected converted session, the expected row is measured/mature/converted
`1/1/1` and rate `"1.000000"`; with complete event/commerce evidence but an
immature conversion window, mature and converted counts are zero and the rate is null. Missing commerce proof is
different from a complete zero-order observation and remains unavailable.

Retain unknown attribution/customer metrics as unavailable. This journey scope
does not establish first-customer status, acquisition attribution, whole-store
session counts or whole-day commerce completeness.

## Optional attribution and first-party ROAS comparison

The same command can also compare the existing builder's order attribution and
acquisition aggregates. This is optional; omit `expected.acquisition` to keep the
original session-only invocation and output unchanged. It does not add a source
reader, model, feed, adapter, permission grant or default policy.

Previously the runner built these results internally but compared only funnel
rows. A saved ratio-only comparison cannot establish which order, session,
touch or campaign received credit. The optional check closes that offline
validation gap using exact independent expectations, not candidate-derived ones.

Add `expected.acquisition` with exactly these four fields:

| Field | Required value |
| --- | --- |
| `evidenceRef` | Nonblank reference to the independently reviewed order/touch and aggregate controls |
| `independentlyExtracted` | `true`; this is an operator claim whose authority still needs review |
| `orders` | Complete independently enumerated order-credit rows, including pending/unattributed/not-applicable rows |
| `daily` | Complete independently enumerated acquisition rows for the reporting scope |

Each `orders` row contains exactly:

```text
order_id, model_version, acquisition_session_key, touch_event_key,
channel, campaign_id, attribution_status, lookback_days,
conversion_time_basis, credit_weight, conversion_date, attribution_complete
```

These are the existing `order_attribution` fields, excluding publication ID.
Use private normalized keys, JSON integers for `lookback_days`, a boolean for
`attribution_complete`, and the existing fixed decimal text for `credit_weight`.
Missing session/touch/campaign keys stay null where the model requires it.
Rows are matched by `order_id` and `model_version`.

Each `daily` row contains exactly:

```text
report_date, channel, campaign_bucket, model_version,
attributed_purchase_merchandise_net_usd, credited_orders,
spend_usd, first_party_roas
```

Rows are matched by date/channel/campaign/model. Monetary values, credited
orders and ROAS use existing six-place decimal text or null, never floating
point numbers. Both arrays are bounded at 20,000 rows. Empty arrays are valid
only when the independently expected complete result is actually empty.
Duplicates, missing/extra rows, extra columns, wrong links and changed values
fail. A correct aggregate cannot excuse credit assigned to the wrong touch.

The existing source chain remains `prepareRefresh` → configured-field-only
PostHog normalization → job coverage bounds → `buildFullReports`. In addition
to the session inputs, a numeric ROAS case needs:

- Permission-supported temporal identity linking the order and touch session.
  The current model requires resolved matching customer IDs, unlike anonymous
  session conversion. Complete lifetime first-order history is not required
  for ROAS, but current permission and temporal identity are.
- Approved campaign mapping and complete lookback/grace controls bounded by
  the retained event read. Unknown tokens are not inferred to be direct.
- Independently reconciled original purchase values and exact order-credit
  scope, not ledger-net sales substituted for purchase value.
- The existing normalized `marketing_spend_daily` input plus independent
  source/account/day proof and approved comparison buckets. Deriving controls
  from the same normalized rows does not establish completeness or compatible
  spend. Do not divide selected-product revenue by whole-account spend.

The replay does not approve the configured model, 30-day lookback, direct
fallback, seven-day conversion window or ingestion grace. Those definitions
must be selected and approved for the actual case. Preserve original frozen
as-of and evidence timestamps. Do not widen them to make a test pass.

The private result adds `acquisition.daily`, order-count and digest evidence,
and separate `numericRoasRows` and `nullRoasRows`. It never emits the compared
order/session/touch keys or raw events. The result directory/file retain modes
0700/0600; refusal to overwrite and fixed sanitized CLI errors are unchanged.
Campaign aggregates and digests are still private review material, not a public
export or anonymization guarantee.

A matching null ROAS is unavailable-output verification, not numeric acceptance.
Synthetic numeric fixtures verify software only. New-customer and nCAC
denominators are deliberately not added to this comparison.

## Stop conditions and current blocker

Stop on any missing or changed evidence hash, unknown permission/revocation,
scope/schema/family mismatch, missing deferred replacement, absent independent
control or coverage, response budget overflow, expected-output mismatch, or
existing output directory. Do not generate expectations from the candidate,
set gates to true, strip a failed check, expand a window, retry a live source,
or activate anything to make the replay pass. Missing readiness may legitimately
match an independently expected null output; that is not a positive metric pass.

The saved September 25 isolated-path diagnostic had no scoped grants or checkout
receipts. It is not a fresh or global claim of absence. A positive real replay
requires an already authorized grant/event/coverage packet and, for conversion,
its verified checkout/paid-order packet. For acquisition, add the resolved
touch/campaign and compatible spend evidence above. First check the retained
source owner's records. If no such retained case exists, prospective creation
requires a separately scoped production-owner proposal and approval; this
document is not that approval.

## Implementation versus live completion

Session preparation, permission composition, source normalization, conversion
logic and report generation were already wired. The new work is the offline
operator and producer-faithful, zero-canonical-customer entry-point tests.
These synthetic tests are not live-source acceptance. Customer source adapters
cannot be finalized against unspecified history/permission contracts; the
existing calculations and explicit evidence intake remain available.
