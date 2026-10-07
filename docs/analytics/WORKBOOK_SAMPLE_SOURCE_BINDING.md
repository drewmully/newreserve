# Separate workbook source binding

The selected workbook uses the approved former September 25 sample-sales source `01a0d9ea-e2b9-0000-381e-e68fc47de66a`, under project `353503`. The source must first be archived and repurposed by the authorized operator. This code does not change any provider resource, create a sixth source, enable imports or claim that repurposing happened.

The ordinary observed source `01a0f3c6-8758-0000-378b-d15c40a96f3a` retains all six resources, its bearer, manifest, constraints and cadence. Subscription imports remain separate and unchanged. The workbook bearer must be distinct. Inserting workbook authorization after an observed grant is not a lawful workaround for the observed SQL guard.

## App and database binding

`workbookRuntimeSourceId` in `productionWorkbookRuntime.ts` pins the new UUID. The audience remains `posthog:353503:source:<that UUID>`. Path `/api/analytics/reports/workbook` and complete six-resource manifest SHA256 `ede0c179ef4a9f1b28625691823cb8410ae54fdce2af341de915f4a0593df6f3` are unchanged.

`sql/analytics/workbook_sample_source_binding.review.sql` is a proposed component, not an approved standalone installer. It checks the table owner, READ COMMITTED and both exact old CHECK definitions. An empty table stays empty. A populated table requires a private exact whole-row hash and revision binding for one disabled, expired authorization. Only source ID, audience and revision plus one may change. Every other field, including token hash, run/result, approvals and serving window, remains byte-equivalent in PostgreSQL JSONB. The row stays disabled and expired.

The reviewed actual row hash belongs only in the private operator contract, never this public source. The installer retains the complete before row privately, checks the current hash under the existing lock order, and verifies exact preservation afterwards. Unknown, enabled, unexpired, changed or additional rows refuse. Never delete or re-enable authorization to make the transition pass.

The parent must wrap the component in the approved provider-owned guarded installer using a fresh complete catalog. That installer must preserve all other objects and normal migration bookkeeping. The SQL file alone does not supply that authority or metadata check. Production code publication and actual configured-build verification remain separate. Environment writes do not modify an already-built deployment.

## Offline destination observer

After the real authenticated source response and natural imports are retained:

```sh
node scripts/analytics/accept-workbook-runtime-reports.mjs \
  /private/actual-workbook-evidence.json /private/new-validation-directory
```

The entry accepts only project `353503`, the fixed sample-source UUID, and actual `/api/analytics/reports/workbook` receipts. It uses the existing strict comparator for all six resources, exact values/nulls/readiness, complete unfiltered tables, completed full-refresh job bindings, time ordering and current independent privacy evidence. Old `/reports/production` and `/reports/observed-current` paths refuse. The existing generic comparator retains its old `/reports/production` contract. Never edit evidence paths to pass either comparator.

The CLI checks duplicate JSON members, UTF-8, depth and byte limits, then writes an exclusive private receipt. It performs no network call, import, source write or scheduling. `offline_workbook_match` means the supplied packets match. `liveDeliveryVerified`, `sourceAuthenticityVerified`, `metricAcceptance` and atomic cross-resource refresh remain false.

## Controller and recurrence

The private B1 controller carries the same new source pin. Its existing finite claim, source budget, CAS, disable/revocation and deadline checks remain unchanged. Recompute the explicit delivery policy digest when binding it. Do not migrate an old active journal or silently clear a held/ambiguous attempt.

The operator still needs current B1 grants, the retained Google cycle binding, actual source receipts, named completed report results, an explicitly bootstrapped enabled workbook authorization/delivery row, and approved predecessor/metric scopes. The controller never re-enables independently disabled delivery.

A successful selected workbook HTTP read is not destination acceptance. Read the actual repurposed source and all six real tables after natural import, retain job IDs and evidence, then apply the independent observer. Enable recurrence only for the verified portions under the approved interval and total budgets. Finite cycle/slot caps, overflow, expired authority and ambiguous writes remain explicit flow stops.
