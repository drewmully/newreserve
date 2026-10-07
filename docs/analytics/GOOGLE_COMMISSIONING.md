# One-use Google commissioning capture

This additive path supplies the first genuine Google P3 input before a destination source/table exists. It does not replace standing operation or install, register, select, deliver or schedule a report. All configuration is default-off.

## Scope and credentials

The new production/main endpoint is `POST /api/analytics/ingest/google-commission` with exactly `{"action":"capture"}`. It accepts no account, date, grant, URL, query, packet or credential in the request. Required bindings are:

- `LEAN_GOOGLE_COMMISSION_ENABLED=true`
- `LEAN_GOOGLE_COMMISSION_SECRET`, a distinct32–512 printable-character capability
- `LEAN_GOOGLE_COMMISSION_GRANT_ID` and `LEAN_GOOGLE_COMMISSION_REVISION`
- Existing explicit analytics project URL/service key for `xnfjdbpjuaezxjgargto`
- Existing dedicated `LEAN_GOOGLE_ADS_AUTH_MODE=service_account`, `LEAN_GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64`, `LEAN_GOOGLE_ADS_IMPERSONATE_EMAIL` and `LEAN_GOOGLE_ADS_DEVELOPER_TOKEN`

Generic Google variables and OAuth fallback are not supported. The copied dedicated values must match the actual native setup receipt's credential SHA256. The unchanged capture module checks the fingerprint before OAuth dispatch. Setup receipt hashes use PostgreSQL `receipt::text`; the credential fingerprint uses the existing Node `googleAutomaticDigest({auth,developerToken})` algorithm. They are different hashes.

The owner binds account4335795219, manager9552995078, one closed New York date, one UUID, a finite at-most-one-hour authority window and genuine setup ID/revision/receipt hash. The setup receipt must already be saved by the native setup operation; a caller cannot supply a success receipt. The setup must remain enabled and unrevoked. Its old metadata-dispatch expiry is not renewed or repurposed. New commissioning approval, capability and expiry independently authorize this larger read.

## One consumed attempt

`lean_google_commission_claim(text,bigint,text)` locks the grant, then the actual setup. It consumes the single attempt before returning the exact unchanged `GoogleCaptureClaim` shape. Claim start/deadline are server-derived. Source failure, ambiguous transport or commit failure does not reset the attempt. There is no automatic retry, resume, second UUID, zero substitute or state-changing error cleanup.

`captureGoogleAutomatic` is unchanged. It queries independent campaign/account controls before a separate native candidate and validates actual account identity before aggregates. The fixed v25 query/page/amount/count checks, USD/New York requirement and mismatch refusals remain intact. Empty campaigns are unavailable under this contract, not a verified zero.

Limits remain1–5 pages per campaign read, at least `5+2*maxPages` and at most20 total native requests, at most16MiB total source bytes, source deadline at most60s and absolute claim deadline at most80s. OAuth and both identity reads are inside the request budget. The route has an85s enclosing deadline and256-byte request-body limit. Stored JSONB capture is at most8,000,000 bytes.

`lean_google_commission_commit(text,bigint,text,jsonb)` checks the same current authority, exact claim/date/account/credential reference, native/control/identity clocks and pinned manifest. It saves only the immutable capture packet and its PostgreSQL JSONB-text SHA256. It rechecks authority and deadline after the write. The endpoint returns only state, grant/revision/UUID/hash and explicit `registered:false, selected:false`. It returns no aggregate packet, source token, raw credential or source error.

The additive SQL requires only the installed `lean_private.google_auto_setups` table/composite type, existing `lean_private` schema and existing roles. It uses PostgreSQL's built-in `sha256(bytea)`, not a new digest extension or test-only helper. It creates one empty RLS table, one trigger and four functions. Only the two capability-checked public claim/commit functions are service-role executable. There are no grants on raw tables or private helpers, and no existing function is renamed or replaced.

The owner control template registers disabled, enables only an exact unattempted row through whole-row hash/revision CAS, and permanently stops/revokes through the same CAS. Do not use raw review SQL as a provider installer. The integrator owns a separately guarded additive package and current dependency/catalog readback.

## Existing P3 continuation, no destination dependency

After actual capture succeeds, an authorized owner reads the saved packet with its hash. The private operator uses unchanged `prepareGoogleWorkbookRegistration` and owner-only `lean_google_workbook_register`. Preserve the capture's manifest, independent controls, delivery binding and observed asOf. Bind real retained history and unchanged business policy. The registrar creates disabled spend/base/full rows.

After exact activation authority, save that already captured native base through existing `lean_spend_claim` and `lean_spend_finish`. Do not invoke the source-only advance route for another capture. Use existing base/full jobs and Google optional finish, then inspect the completed result and row hashes. Owner-only `lean_google_delivery_select` prepares a disabled fixed selection through existing CAS. Approved short-lived selection enablement lets the unchanged fixed Google delivery route serve the real provider preview. Only then create the paused destination source and use its actual IDs for ordinary standing/automatic operation.

This continuation is an existing owner workflow, not an automatic action of the commissioning endpoint. It requires actual P3 completion, separate selection authority and provider preview/readback. Recurrence is not enabled by commissioning.

P3 registration requires genuine enabled, completed retained history, with consistent saved pages and counts. A history creation window need not equal the Google day. For example, genuine Sep30 retained sources can remain Sep30 facts while a new Sep29 Google-only optional row uses newly captured Sep29 Google data. Never relabel the history window or infer Sep29 commerce zero/complete-store coverage from it. Keep financial, customer, cash and all-marketing proof gates withheld unless separately proven. Never fabricate an empty base to satisfy registration.

## Validation boundary

Focused tests execute the unchanged native capture with synthetic provider responses through the new runtime. They cover successful bounded capture, duplicate/ambiguous/failing attempts, mismatched controls, empty source, metadata drift, credentials, limits, scope injection and default-off behavior. Native claim/commit, expiry, ACL and immutable-state proof belongs to the integrator's single additive fixture. Local mocks do not prove current Google access, a provider query, a merchant metric, P3 completion or destination delivery.

No B1, B5, B6, P3 registrar/finish/selector, counter, commerce, Klaviyo or existing route bytes change.
