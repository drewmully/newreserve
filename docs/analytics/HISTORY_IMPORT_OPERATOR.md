# Private Shopify historical-source import

**Source staging only—not financial facts, a report, all-product eligibility, or a historical point-in-time reconstruction.** The existing Shopify two-product pilot, Google jobs, schedules, website and other migrations are unchanged.

## Install / register / operate

1. Owner applies **040_shopify_history_import.sql** to isolated project `xeqlgxvrhgwwudyqtnun`, over installed 001–024 +038/039. No scopes/jobs/enablement are installed by this migration. It creates only private history-import tables and narrowly scoped RPCs.
2. Review `operator-registration.json`. Query text/hash and target are immutable and independently checked by SQL and operator. Fill `approvalRef` and `actorRef` truthfully. Parent's dedicated-token sizing is 61,821 visible orders before **2026-09-25T08:04:00Z**. Proposed execution expiry **2026-09-26T08:00:00Z** must still be in the future and within 24 hours when registered.
3. Through the authorized owner connection only:
   - `select public.lean_history_import_register(<reviewed JSON>::jsonb);`
   - Inspect disabled row in `lean_private.history_import_jobs`.
   - `update lean_private.history_import_jobs set enabled=true where job_id='mymully-whole-history-20260925';`
   - Registration/purge are **not** granted to service_role, anon, authenticated, or PUBLIC. Do not broaden grants.
4. Package is a **Node 24 Vercel BUILD operator**, no runtime functions/cron. Change only `mode` in `history-import-config.json` for each explicitly chosen action; keep fixed jobId. Deploy files-only to the isolated Preview branch with the exact existing branch-bound credentials. Build command: `node history-import-operator.cjs`; no install/dependencies.
   - **start**: one bounded preflight plus one `bulkOperationRunQuery`. Durable `submitting` reservation precedes either source call. Refuses any active QUERY or incomplete active-operation inventory; never cancels. Successful result: `source_operation_submitted`.
   - **check**: one exact operation-ID query with identity/access/count control; stores safe metadata privately, never the signed download URL. Result `source_operation_running`, `source_download_ready`, or failure. Up to 30 explicit checks; there is no polling loop.
   - **import**: requires saved COMPLETED operation metadata; verifies it again, streams its exact allowlisted download, stages approved rows, checks provider operation + independent order count again, then completes only after EOF/count/hash/parent checks. Result `source_history_imported`.
5. Inspect static **`/history-import.json`**. Deployment READY means the operator finished, **not** success. A safe failure report remains available. Raw source rows, source money totals, credentials and signed URLs are never published. Owner SQL is authoritative for retained counts and completion evidence.

### Existing environment only

- `VERCEL_ENV=preview`
- `VERCEL_GIT_COMMIT_REF=review/analytics-initial-validation`
- `LEAN_ANALYTICS_PIPELINE_PROJECT_REF=xeqlgxvrhgwwudyqtnun`
- `LEAN_ANALYTICS_SUPABASE_URL=https://xeqlgxvrhgwwudyqtnun.supabase.co`
- `LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY` — existing isolated key
- `LEAN_SHOPIFY_SHOP_DOMAIN=mullybox-store.myshopify.com`
- `LEAN_SHOPIFY_ANALYTICS_READ_TOKEN` — existing dedicated token

No new secrets/flags; no dependency on existing Shopify/Google enabled switches. Runtime access instead requires an explicitly enabled import registration. App **280048107521**, installation **616186609856**, shop, scopes `read_orders`, `read_all_orders`, `read_products`, and Admin response version **2026-07** are verified on every action.

## Exact scope and safety limits

- All **currently visible** orders created before the fixed cutoff, their complete bulk line-item connection, and nested refund summaries. Approved projection has IDs, timestamps, boolean flags, quantities, currency/money **decimal strings**, nullable product/variant references. No names, SKUs, customer/contact/address fields, free text, arbitrary attributes or marketing permissions.
- Unknown/cancelled/edited/test orders and deleted-catalog nulls are retained as source, never classified as eligible. Refund summaries do not establish original agreements, payment/cash reconciliation, chargebacks or transaction completeness.
- 70,000 root orders; 1,000,000 line rows; 1 MiB/raw JSONL line; 256 MiB maximum completed output **and cumulative reserved downloads across attempts**. Reservation charges the actual provider fileSize each attempt, not 256 MiB. A large file may leave only one attempt. Metadata has separate 2 MiB/response and 16 MiB/build limits.
- At most one submission, 30 checks, three import attempts and 64 durably reserved provider requests/job. Start reserves two calls, check one, import three (including download). One active ten-minute lease/deadline per action, capped by immutable execution expiry; no deadline extension. Maximum 6,000 RPC calls/build, batches at most 250 records/2 MB SQL payload.
- Download permits only HTTPS `storage.googleapis.com`, no credentials/ports/fragment, no redirects and no source/DB auth headers. COMPLETED only, no partialDataUrl/errorCode. Exact operation ID/type/query hash and rootObjectCount, objectCount, fileSize are verified. If the provider counts or serializes refund arrays differently, fail explicitly; never skip unexpected records or reinterpret success.
- Each row is schema/projection validated in Node **and SQL**; only exact equal JSON replay is accepted. SQL job lock fences concurrent actions/owner kill; expiry/lease are checked after staging and final writes too.
- `source_import_already_complete` is an idempotent replay, not a new source read. Every intermediate row remains private, and incomplete attempts are never exposed as complete history or fed into 018/reporting.

## Recovery, retention, and owner checks

**Ambiguous start:** never rerun start or reset the state automatically. `submitting` remains durable. Reconcile the exact operation against query/hash/app/window with the owner, using any returned safe operation ID. No generic operation adoption/cancellation tool is included. Runtime cannot register another job. Any manual reconciliation is an explicit owner action.

**Import interrupted:** partial rows remain private. After the ten-minute lease ends, another explicit import may start from byte zero and replay identical rows, within remaining imports/byte reservations. A changed duplicate conflicts; a malformed/duplicate source line, orphan, count drift, callback/SQL failure or active timeout fails closed. This is restartable streaming, not byte-range resume. Never bypass its remaining budgets.

**Disable:** owner sets this job's `enabled=false`. Subsequent claim/write/finish fails; current SQL transaction holds the job lock so disable serializes with its writes. Do not disable the unrelated Google or Shopify pilot.

**Retention:** execution expiry stops runtime collection/writes; it does **not** expire owner access or delete staging. `purgeAfter` is only the earliest eligible time for an **explicit owner-authorized** `lean_history_import_purge(jobId)` (not an automatic deletion schedule or storage TTL). Proposed value is expiry+24h. Rows stay durably private until subsequent normalization or explicit owner purge. The purge RPC retains the manifest and aggregate audit, marks `purged`, and removes source rows. No automatic privacy-cleanup claim is made.

Owner readback:

```sql
select job_id, enabled, state, operation_id, checks, imports, provider_requests,
       reserved_download_bytes, orders, lines, completion, expires_at
from lean_private.history_import_jobs where job_id='mymully-whole-history-20260925';
select count(*) from lean_private.history_import_orders where job_id='mymully-whole-history-20260925';
select count(*) from lean_private.history_import_lines where job_id='mymully-whole-history-20260925';
```

Completion requires identical independent EXACT counts before/after import, provider root count, distinct root IDs, total root+line object count, all child parents present, exact raw-file size and SHA256, EOF and a successfully completed nonpartial operation. A stable count is **not** a point-in-time snapshot guarantee; other order fields may change during the provider export. A subsequent refresh is separate scope.

## Local validation

Dedicated disposable loopback PostgreSQL 18.6: exact prerequisites +040 install, real service-role RPC through the actual build operator with synthetic Shopify transport; disabled/default-off controls, scope immutability, projection privacy, nullable/zero/decimal preservation, completion/replay/conflict/orphan/count gates, budgets, separate-connection locking, and expiry during batch/final writes. Parser negatives cover malformed, oversized, duplicate, missing, write-failed and unexpected-field source. No live source calls or broad regression suite are part of this focused validation.

Run only this focused test when needed:

`HISTORY_IMPORT_TEST_URL=postgresql://fixture_shopify_install@127.0.0.1:55439/postgres node --test tests/runtime/shopifyHistoryImport.test.cjs`

Package offline: `node scripts/analytics/package-history-import.cjs /absolute/new/output-directory`.
