# 041: durable source history → private canonical facts and reports

## What this implements

One disabled, owner-registered job binds a **completed 040 source import** by its
completion hash. Database progress traverses every imported order ID exactly once;
it does not create fake 018 history pages. Each bounded step reads the actual
existing Shopify financial source reader using a fixed **no-address** projection,
durably retains the response, applies existing mappers and persists canonical
orders/items/payments/eligible ledger evidence. It then advances through selected
report dates using existing store/product/acquisition formulas. Progress and
replay survive process/build restarts. All publications remain private candidates.

The optional customer projection selects **only `customer { id }`** and retains
it as source evidence. It does not assert identity ownership, analytics permission,
removal history or first purchase. Customers, sessions, attribution, cohorts,
cash/settlement and certifications remain unproven; this does not finish the
spreadsheet's 10 core tables, five reports and 21 metrics.

No policy is inferred. With `policy:null`, canonical orders are pending and
purchase/financial report values are withheld. Unsupported/changed/unavailable
orders retain explicit outcomes and factual pending order rows. Positive source
lines can be retained as unknown class; zero-quantity original-purchase lines
remain source-only, with source/canonical counts distinguishable. A changed
revision or line/refund content under an unchanged revision never becomes an
eligible financial result.

With an explicit historical `PipelinePolicy`, only the existing supported
paid-USD-merchandise branch can produce ledger rows. One unresolved order
withholds **all** commerce report metrics for the job rather than publishing
partial selected totals. Actual saved Google spend may remain observed by date;
missing spend stays null, and MER/ROAS/NCAC remain withheld. No selected pointers
or reader permissions are changed.

**Report phase starts after all source IDs have been traversed.** Selecting real
019 Google bases for September 21–23 requires no fabricated packets, but this
job does not expose a spend-only report before its order phase finishes. An
immediate independent spend-only publication is a separate small missing
consumer path, not a capability claimed by this bridge.

## Cost and limits: not an approved whole-history activation

The reused reader takes four HTTP calls for a simple order, up to eight under its
two-line-page/three-refund bounds. **61,821 orders imply approximately
247,284–494,568 provider requests**, before unsupported retries (none automatic).
This is a durable consumer, **not** an efficient bulk enrichment implementation.
Do not start the full history by default. A future schema-validated bulk
financial adapter can feed genuine retained sources without altering mapper
semantics; that adapter is not in this change.

Each source attempt: ≤20 calls, 8 MiB total, 60 seconds; database lease 90 seconds.
One attempt is reserved before the external read. An interrupted *unretained*
attempt becomes `interrupted_source_attempt`, not an automatic repeat. A retained
response resumes without another provider read. A new owner-reviewed job is
required to retry unresolved sources/change policy.

One operator invocation: default **one step/eight source requests**, maximum
100 steps/800 requests, 64 MiB source and 256 MiB database responses, starts no
new step after eight minutes. No schedule, endpoint or self-redeploy is installed.
The database run may span at most 30 days; output calendar at most 3,660 dates.
One report-day input is bounded to 10,000 participating orders/16 MB; an
oversized day fails closed and needs further bounded reduction, not truncation.

## Installation / owner contract

Migration `041_history_report_bridge.sql` is independent of unmerged 025–037.
Dependencies: 001,013,014,019,040; compatible with installed 001–024 +038/039.
It adds only its own tables/functions. Google, Shopify receipts, history040 and
website configuration are unchanged. No source or job is enabled by migration.

Owner reads the completed import hash:

```sql
select job_id,state,orders,lines,
  encode(sha256(convert_to(completion::text,'UTF8')),'hex') as source_hash
from lean_private.history_import_jobs where job_id='mymully-whole-history-20260925';
```

Then owner calls `public.lean_history_report_register(p_scope jsonb)`, e.g.:

```json
{
  "runId": "REPLACE_OWNER_REVIEWED_RUN",
  "sourceJob": "mymully-whole-history-20260925",
  "sourceHash": "REPLACE_ACTUAL_COMPLETED_IMPORT_HASH",
  "projectRef": "xeqlgxvrhgwwudyqtnun",
  "shop": "mullybox-store.myshopify.com",
  "expiresAt": "REPLACE_EXPLICIT_FUTURE_DEADLINE",
  "fromDate": "2026-09-21",
  "throughDate": "2026-09-23",
  "includeCustomerId": false,
  "policy": null,
  "spendRuns": [],
  "approvalRef": "REPLACE_NORMALIZATION_SCOPE_REFERENCE",
  "actorRef": "REPLACE_OWNER"
}
```

Registration leaves `enabled=false`. `policy`, if nonnull, explicitly applies to
**the entire selected import**, not just the report calendar. Do not backdate
the two-product webhook policy or infer all products are merchandise.
Execution requires separate owner `enabled=true`; kill via `enabled=false`.
The completed source's execution deadline does not expire durable staging reads,
but source kill/purge/hash changes block this consumer.

Only service_role gets the four new execution RPCs:
`lean_history_report_claim`, `lean_history_report_retain`,
`lean_history_report_order`, `lean_history_report_day`.
Registration and direct table reads/writes remain owner-only. Scope/source locks
span writes, and original lease/deadline is rechecked after writes for rollback.

## Runnable operator package

Offline packaging: `node scripts/analytics/package-history-report.mjs /absolute/new/directory`.
Run from that package: `node operator.cjs`. `operator-config.json` defaults
`enabled:false`, one step, eight provider requests. Change only the reviewed run
and finite budgets. Static `/history-report.json` contains aggregate progress,
not IDs, raw rows, customer links, secrets or financial totals; a READY build is
not proof the job is complete. Require its reported state and private DB readback.

Environment reuses dedicated branch credentials, no new global switches:

- `VERCEL_ENV=preview`
- `VERCEL_GIT_COMMIT_REF=review/analytics-initial-validation`
- `LEAN_ANALYTICS_PIPELINE_PROJECT_REF=xeqlgxvrhgwwudyqtnun`
- `LEAN_ANALYTICS_SUPABASE_URL=https://xeqlgxvrhgwwudyqtnun.supabase.co`
- `LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY` (existing dedicated isolated key)
- `LEAN_SHOPIFY_SHOP_DOMAIN=mullybox-store.myshopify.com`
- `LEAN_SHOPIFY_ANALYTICS_READ_TOKEN` (dedicated correct-app read token)

No website/runtime route/scheduler or Google secret changes are required.
Use one controlled step first; inspect private outcome/source hash/core counts.
Then test replay/no extra source attempt and kill. Do not activate full61821
hydration implicitly; practical whole-store completion needs bulk enrichment.

## Known evidence boundaries

Full-store eligibility/classification, original edited-order agreements,
multi-currency/tax-inclusive rules, historical identity/permission/removal,
cash settlement definition, behavioral completeness and independent
reconciliation are still real required inputs. Missing source facts are not
replaced by synthetic test fixtures or approval placeholders.
