# Offline workbook destination comparison

This checker compares retained packets. It does not query the application,
PostHog or any provider. It does not approve source metrics or a destination.
The existing narrow two-resource checker stays unchanged.

Run `node scripts/analytics/accept-workbook-reports.mjs <private-input.json> <new-private-output-directory>`.
Use reviewed actual evidence, not the synthetic test fixture. The input file
remains private. A new directory has mode 0700 and its receipt has mode 0600.
An existing directory or symlink is never reused or removed.

## Exact input

The root has `version: 1`, `asOf`, `binding` and `rounds`. Unknown fields fail.
`asOf` and capture/job/privacy timestamps use UTC seconds or milliseconds.
The duplicate-safe parser rejects duplicate JSON members, invalid UTF-8,
nesting beyond 32 and files above 16 MB. Each response is at most 4 MiB.
The 16 MB limit covers the entire packet, including optional second-round
evidence. Two maximum-sized rounds may not fit. Such a packet fails; there is
no automatic splitting or fallback. Compare separate packets if necessary,
without claiming that either receipt verifies their cross-round relationship.

`binding` contains private `approvalRef`, `operatorRef`, `exclusionReviewRef`,
`origin`, `projectId`, `sourceId`, `tables`, `excludedSourceIds`,
`excludedTableIds`, `maxAgeSeconds` and `scopes`.

- Origin is the canonical application origin. Tables maps all six manifest
  resource names to distinct reviewed destination table IDs. Both exclusion
  arrays must be explicit reviewed inventories. They may be empty when the
  reviewed inventory is empty; never invent placeholder exclusions. The review
  reference remains mandatory. Target collisions and listed exclusions fail.
- `maxAgeSeconds` has one independently approved freshness budget per resource,
  from 1 through 86400. No default budget is inferred.
- `scopes` has one exact reviewed metadata object per round. Its fields are the
  ten common fields in the published `report_status` contract: `report_scope`,
  `shop_id`, `publication_id`, `definition_version`, `model_version`,
  `funnel_version`, `as_of_at`, `report_from_date`, `report_through_date`,
  `atomic_resource_refresh`. The last field stays false. These are copied
  publication metadata, not a new generation or universal completeness claim.

One or two rounds may be supplied. Each has `source`, `resources` and `privacy`.

`source` is one shared snapshot with `path`, `httpStatus`, `capturedAt`,
`evidenceRef`, `complete`, `body`. Retain the complete successful canonical
HTTP response once, not six redundant copies or a reconstructed expected-value
packet. The path is `/api/analytics/reports/production`. The same immutable
response can support all six comparisons.

`resources` maps the exact five business families plus `report_status` to:

- `job`: `projectId`, `sourceId`, `tableId`, `resource`, `evidenceRef`, `jobId`,
  `status`, `startedAt`, `completedAt`, `fullRefresh`. Retain a completed actual
  full-refresh job for that exact resource.
- `readback`: the same four destination-binding fields, plus `capturedAt`,
  `evidenceRef`, `importJobId`, `independentlyExtracted`, `wholeTable`,
  `unfiltered`, `complete`, `nextCursor`, `totalRows`, `rows`. Retain every row
  from an independent unfiltered whole-table extraction. Pagination must be
  exhausted, cursor null, and the independently retained total must equal the
  row count. `importJobId` binds the readback to the supplied job. Do not infer
  that ID from matching rows.

The shared source reference and each retained job/readback/privacy reference
must be distinct. All six jobs still need distinct IDs and evidence, and all
six readbacks need distinct evidence. The shared source capture precedes
each job, which precedes its own readback. Each resource must satisfy its
own age budget even when its job/readback times differ.

`privacy` has `evidenceRef`, `checkedAt`, `publicationId`, `asOfAt`, `complete`,
`independentlyExtracted`, `pendingRemovalCount`, `newerRemovalCount`,
`selectionInvalidated`. Require independently retained complete evidence,
the bound publication/cutoff, both counts zero and selection not invalidated.
This check is captured after all six readbacks and no later than the root
`asOf`. The checker cannot authenticate those statements or find later removals.

For a second refresh, retain another complete six-resource round and reviewed
scope. Its shared capture must follow the first round's privacy checkpoint,
with new artifact/job evidence. The same immutable publication must have identical
content; corrected content requires a separately bound new publication.
This is evidence of two supplied comparisons, not a recurring-run guarantee.

## Results and limits

The checker reuses the published workbook validator and resource keys. It
requires exact decimal strings, nulls, readiness, selected/unselected status,
counts, versions, cutoff and interval. Stale source or imported rows fail.
Selected empty data and unselected unavailable data remain different because
the operational status table is itself imported and compared.

A complete match returns `offline_workbook_match`. Missing or inconsistent
source, job, completeness, binding or privacy evidence returns `not_accepted`
with a safe generic reason. Both retain `metricAcceptance: false`,
`sourceMetricAcceptance: "not_evaluated"`, `sourceAuthenticityVerified: false`,
`liveDeliveryVerified: false`, `atomicCrossResourceRefresh: false` and
`currentGenerationCertified: false`.

The receipt contains hashes, resource names, counts, metric readiness and
per-resource timestamps. It does not echo private project/source/table/shop/
publication IDs, evidence references, rows or error messages.

Matching supplied rows proves equality only. Authenticity, metric/source
acceptance and ongoing live freshness need separate reviewed evidence. A
status-only refresh, equal row counts, shared publication or successful script
exit cannot replace the six actual import/readback packets. The script creates
no templates, approval records, expected values or live acceptance claims.
