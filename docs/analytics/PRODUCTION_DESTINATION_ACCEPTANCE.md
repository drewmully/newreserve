# Offline production destination comparison

This checker compares saved evidence for the shipped two-resource production
feed. It does not contact the application, PostHog or a database. It cannot
authenticate a saved file, approve a destination, enable reporting or prove
real delivery.

The canonical contract remains
[`production-posthog-manifest.json`](./production-posthog-manifest.json),
`GET /api/analytics/reports/production` and `lean_production_reports_read()`.
The checker reuses the route's `validProductionReportPayload` validator.
Nothing changes the route, SQL050, scheduler or existing sample and trial.

## Prepare private evidence

Only an authorized operator may obtain these inputs. Source creation can probe
the production endpoint; creating a source is not an offline preparation step.
This command grants no permission for collection, configuration or source creation.

Keep the input packet, source responses, warehouse extracts, approval and job
records outside Git and public artifacts. Use synthetic identifiers in tests.
The operator must independently review the intended destination and inventory
every excluded sample/trial source and table in that project. The checker only
enforces the supplied inventory. It cannot discover omissions or authenticate
approval references.

Save one JSON input with the following exact envelope. The TypeScript
`ProductionDestinationInput` in
[`productionDestinationAcceptance.ts`](../../src/lib/analytics/productionDestinationAcceptance.ts)
defines its shape. All fields below are required; unknown fields fail.

| Field | Required evidence |
| --- | --- |
| `version` | `1`, the offline packet format, not a feed revision. |
| `asOf` | Frozen review time in UTC, `YYYY-MM-DDTHH:mm:ssZ` or with three fractional digits. |
| `binding.approvalRef`, `operatorRef`, `exclusionReviewRef` | Private references to the reviewed destination/audience, operator and excluded inventory. Never put a token in this packet. |
| `binding.origin` | `https://www.mymully.com`, matching the manifest. |
| `binding.projectId`, `sourceId` | Exact private target identifiers from the operator's approved binding. |
| `binding.tables` | Exact distinct table IDs under keys `store_daily` and `product_daily`. |
| `binding.excludedSourceIds`, `excludedTableIds` | Nonempty, duplicate-free arrays containing all protected old sample/trial destinations. IDs are scoped to the bound project. Neither target may match an excluded ID. |
| `binding.maxAgeSeconds` | Separate reviewed source-to-review age budgets under both resource names, integer seconds from 1 through 86,400. This is offline policy, not a new feed TTL or expiry. |
| `resources` | Exactly `store_daily` and `product_daily`, each with `source`, `readback` and `job` as below. |

For each resource, save its pre-job source response and an independent complete
post-job destination extract. The two resources may use different captures and
jobs. All six artifacts need distinct nonempty private `evidenceRef` values.
These references distinguish retained evidence, not its trustworthiness.

### Source

- `path` is exactly `/api/analytics/reports/production`.
- `httpStatus` is `200`; `complete` is `true`.
- `capturedAt` is the actual saved response time.
- `evidenceRef` locates that response privately.
- `body` is the complete parsed canonical response, with **both** arrays.
  Do not project away rows, alter strings or substitute a computed expectation.

A null/failed/partial response is not an empty success. The normal response
validator enforces exact fields, readiness, decimal/integer strings, nulls,
valid dates, unique record keys and product-to-store date/definition coverage.
It keeps the existing 366-store-row, 10,000-product-row and 4 MiB response bounds.

### Destination readback

- `projectId`, `sourceId`, `tableId` and `resource` exactly match the private binding.
- `capturedAt` and `evidenceRef` identify the independent warehouse extraction.
- `independentlyExtracted`, `wholeTable`, `unfiltered` and `complete` are `true`
  only after the operator checks them against retained query/export evidence.
- `nextCursor` is `null` after all pages are exhausted.
- `totalRows` is the independently obtained whole-table count at the extraction's
  consistent snapshot, not a count derived from the endpoint's expected keys.
- `rows` contains every row of the canonical field projection, with no row
  filter, limit, date slice or deduplication.

Preserve native nulls, booleans, nested readiness and exact strings. Provider
metadata may be excluded by an explicitly reviewed column projection; keep the
original extraction and query privately. Do not convert numbers back into
strings to hide a destination coercion, round decimals or fill missing fields.
The checker rejects provider fields included in canonical rows.

If the destination cannot supply a complete, consistent table extract and
independent count, this acceptance remains blocked. A preview, first page or
key-filtered match is insufficient. A `complete: true` assertion alone is not
independent proof of extraction completeness.

### Job

- `projectId`, `sourceId`, `tableId` and `resource` match the same binding.
- `evidenceRef` identifies the saved per-resource provider job evidence.
- `status` is `completed`; `fullRefresh` is `true` only when verified.
- `startedAt` and `completedAt` are the actual UTC job times.

Each resource must satisfy
`source.capturedAt <= job.startedAt <= job.completedAt <= readback.capturedAt <= asOf`.
Its source capture must fall within its own `maxAgeSeconds` budget at `asOf`.
Freshness is checked separately. Different job times and differing source
payloads across resources are permitted. This is a bounded sample comparison,
not proof that the job consumed a specific source capture.

## Run offline

Use existing repository dependencies. The command compiles only the comparator
and its existing route validator into a temporary local directory.

```sh
node scripts/analytics/accept-production-reports.mjs \
  /private/review/production-evidence.json \
  /private/review/new-destination-receipt
```

The input must be a regular UTF-8 JSON file of at most 16 MB. Duplicate JSON
members, malformed/truncated JSON and oversized/deep inputs fail. The output
directory must not exist, even if empty or a symlink. The checker creates it
with mode `0700` and `destination-validation.json` with mode `0600`, using
exclusive creation. It never overwrites, cleans up or updates prior evidence.
If a write fails after directory creation, preserve that incomplete attempt
and use a new output path after review.

Successful exit `0` means `offline_tables_match`. It compares unique composite
keys and every field, ignoring row order and object-member order only. It
detects missing/extra rows, stale retained deletions, duplicates, corrections
that did not arrive and null/precision/readiness changes.

The private receipt records each resource's counts, stale-row count, separate
capture/job/readback times, age budget and hashes. It includes no raw
identifiers, row values, SKU buckets or evidence references. Hashes are audit
links, not anonymization or permission to publish commercially sensitive
evidence. Console output contains only a fixed status and claim limits.

Failure exits `1` with a generic error, without printing inputs, IDs or paths.
Validation failures write no receipt. Existing successful receipts remain
unchanged and must not be interpreted as current after a later failure.

## What a match does not accept

Every result explicitly keeps `sourceAuthenticityVerified`,
`liveDeliveryVerified`, `metricAcceptance`, `atomicCrossResourceRefresh` and
`currentGenerationCertified` false. The canonical payload has no shared
generation, revision or expiry. Do not add those fields to make an old
single-stream verifier pass.

The route labels remain `webhook_observed_only`, `certified: false` and
`complete_window: false`. Cash, customers, spend, nCAC and MER remain null and
withheld. Matching empty tables accept no business activity. Matching
`is_stale: true` rows verify preservation of that flag, not current data.

Repeat with new evidence and new receipt directories after separately approved
real operations. Reviewed successive captures can show a correction/removal or
retry without duplicate destination rows; one capture cannot prove replacement
or retry behavior over time. Failed jobs and incomplete reads must fail this
checker. Production failure/recovery, stop controls, recurrence and actual
source-to-destination provenance still need operator evidence. Do not alter old
sample/trial resources to manufacture these cases.

## Focused synthetic checks

```sh
npx --no-install vitest run tests/api/analyticsLeanProductionDestinationAcceptance.test.ts --project api
```

The tests use synthetic saved responses/readbacks only and prohibit `fetch`.
They cover independent per-resource timing, whole-table equality, schema/type
changes, nulls, duplicates, missing/extra rows, correction/removal comparisons,
protected targets, incomplete/paginated evidence, failed jobs, empty/stale
outputs, malformed JSON, private receipt permissions and no-overwrite behavior.
Passing them is not live metric or provider acceptance.
