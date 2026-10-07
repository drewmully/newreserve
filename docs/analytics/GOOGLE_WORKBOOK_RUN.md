# One-day Google workbook extension

Private implementation. No source read, registration, selection, credential
binding or production approval follows from these files.

## Contract

`google_account_daily` is a separate optional business resource. Its grain is one
Google account and one New York date within one completed full publication.
It adds no column or resource to the existing five-family workbook payload.
Google-only spend is never labeled complete marketing spend.

The row contains `spend_usd`, `clicks`, `impressions`, `ctr`, `cpc_usd` and
`cpm_usd`. Money and ratios are six-place decimal strings. Counts are integer
strings. CTR is a fraction, not percentage points. The implementation calls the
existing `deliveryMetrics` ratio-of-sums formulas and truncation rules.
Missing counts or nonpositive denominators withhold the affected ratios.
An empty monetary result is not zero delivery evidence.

An immutable `full_builds.policy.googleDelivery` binding identifies the account,
single day, definition, approval and independent count controls. The existing
`freshGoogleSpend` policy supplies the native source manifest, retained bases and
independent cost controls. Count controls must match each campaign and the
account total. Matching only the grand total is insufficient.

The first intended scope is account `4335795219`, manager `9552995078`, USD,
`America/New_York`, one approved closed day. October 2 source controls are dated
evidence, not a refreshed native source base. The observed `all_conversions`
were checkout/page-view actions, not purchase revenue.

## Registered input and atomic persistence

`prepareGoogleWorkbookRegistration` compiles a one-day owner packet for
`lean_google_workbook_register`. It preserves caller-supplied policies,
independent controls and evidence. It does not create source authority.
The registrar requires actual enabled, completed retained history jobs and their
pages. It creates a new disabled spend pilot, native day job, base report and full
build in one transaction. It never creates history, inserts source facts or
reuses the completed proof-of-concept run. Duplicate IDs fail rather than replay.
The existing 25-page/100-order dependency limits remain unchanged.

Registration can contain the existing six-field completed
`FullBuildPolicy.customerGeneration` binding from P4. Its current SQL wrapper
must derive customer evidence. Caller-supplied `evidence.customerGeneration`
is rejected. An unbound customer domain does not acquire a new prerequisite.

The original full dispatcher and native Google reader are unchanged. The full
job waits for a planned Google-bound `asOf` before claiming the full transform.
At finish, a registered optional binding selects
`lean_google_delivery_finish`. That function calls the **current**
`public.lean_full_finish`, then stores the optional row and provenance in the
same transaction. It does not call historical aliases or replace their bodies.
Any optional insert failure rolls back the core full result too.

The sidecar records the exact full result hash, input hash and its own row hash.
A deferred completion constraint prevents an opted-in run from completing through
the old finish RPC without its optional row. Replays require the same core result
and identical optional content. An ambiguous finish response is not retried or
followed by a failure write. Unbound full jobs retain their old finish RPC,
payload fields, five report families and response.

Stored optional readiness is `observed_unverified`, or `withheld` for nulls.
No registration or finish grants metric acceptance or delivery.

## Independent selection and delivery

`lean_google_delivery_select` is owner-only. It uses a revision compare-and-swap
and exact full/optional result hashes to prepare a **disabled** selection. It
requires separate output approval and reconciliation references, explicit
staleness, and an authorization interval of at most one hour. Enabling it is a
separate operator action outside this patch.

The new read-only `/api/analytics/reports/google-delivery` route is off by default.
It requires production/main and these dedicated variables:

- `LEAN_GOOGLE_DELIVERY_ENABLED=true`
- `LEAN_GOOGLE_DELIVERY_SECRET`, a distinct 32–512 character printable bearer
- `LEAN_GOOGLE_DELIVERY_RUN_ID`
- `LEAN_GOOGLE_DELIVERY_RESULT_HASH`
- `LEAN_GOOGLE_DELIVERY_ACCOUNT_ID`
- `LEAN_GOOGLE_DELIVERY_DATE`

It also requires the existing explicit analytics project URL and service key for
`xnfjdbpjuaezxjgargto`. It makes one fixed read RPC, accepts no body/query scope,
allows at most 16 KiB and 15 seconds, and returns no error detail or raw facts.
It rejects bearer reuse with configured observed/workbook/full-run secrets.
It never reads general Google credentials or falls back to another report mode.

SQL rechecks enabled full result, selected result/hash/account/day, authorization
time and current privacy/removal gates under the existing selection lock.
When the full policy binds a customer generation, its current authority check
also remains required. A missing checker fails closed. The response contains
one aggregate row and selection status metadata, never customers,
orders, campaigns, approval references or source receipts.

The separate destination manifest imports only `google_account_daily`. It does
not modify either existing workbook manifest. Publication remains part of the
primary key, so callers must not sum multiple generations or present this
independent selection as the same current snapshot as other report families.
`atomic_resource_refresh` remains false. A successful read does not verify a
PostHog import, matching destination values or recurrence.

## Operator prerequisites, not supplied approvals

1. Verify the actual installed current-target input, finish, partition and
   customer/privacy chain. Do not reinstall old dependencies or call renamed
   pre-privacy helpers. The two new SQL files are review artifacts, not installers.
2. Bind dedicated `LEAN_GOOGLE_ADS_AUTH_MODE` and its OAuth fields or service
   account fields, plus `LEAN_GOOGLE_ADS_DEVELOPER_TOKEN`, to the exact advertiser
   and manager. General `GOOGLE_ADS_*` credentials are not a fallback.
3. Supply genuine retained commerce dependencies and one newly approved native
   closed-day manifest. Independently capture cost/campaign and count controls,
   with times at or after the manifest's due/freshness cutoff. Choose a bounded
   `asOf` after native capture and invoke the full transform only once it is due.
   No old capture is restamped as fresh. A mismatch withholds results.
4. Supply an honest marketing inventory. Google-only can populate the separate
   optional resource even while incomplete all-marketing inventory withholds
   store spend, nCAC and MER. Do not declare the Google account to be the complete
   marketing registry when other providers remain in scope.
5. Register disabled, verify exact stored configuration, then obtain separate
   invocation/enablement authority. Existing full-route enablement, bearer,
   run binding and database permissions remain required. No scheduler is added.
6. Reconcile the saved result, independently approve the optional selection and
   dedicated audience, then verify actual destination rows. Confirm expiry,
   revocation and disable-only stop behavior. A correction uses new immutable
   source/report/full IDs; no attempts, approvals or expiry are reset here.

Do not enable anything from example fixtures. Fresh runtime authentication,
native transport/version/pagination, installed chain compatibility, source
authority, real full completion, destination acceptance and recurrence remain
unverified by local tests.
