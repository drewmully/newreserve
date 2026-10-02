# Recurring observed sales and product delivery

This additive path serves existing SQL017/047 latest successful order heads through SQL050. It does not register full builds, certify a population or change the Goal 1 workbook selections. Existing `/observed`, `/production` and `/workbook` routes remain unchanged.

## Default-closed service authorization

`/api/analytics/reports/observed-current` uses the existing production service-role backend. It requires the current main/production enablement checks and a separate owner-approved record in `lean_private.observed_delivery_authorization`. Installation creates no row, bearer, approval, schedule or enabled source.

One authorization covers repeated automatic imports. It binds the fixed Supabase project, shop, PostHog project 353503/source `01a0f3c6-8758-0000-378b-d15c40a96f3a`, audience, path, exact manifest, scope hash and delivery approval. The scope hash covers the approved policy and fixed creation-time window. It does not slide the window or silently admit a different catalog. Processing must preserve the approved `financial_no_geo_order_size` projection, order-size product semantics and `financial_allowlist_v1` retention.

The original runtime accepts only finite authority, with a maximum seven-day term. The separate `pipeline_standing_authority.review.sql` amendment adds an explicit `authorization_mode` to the existing observed authorization and annual-access rule tables. Existing rows and omitted modes remain `finite`, with the original expiry and ceiling. Only an owner-approved `standing` row permits `expires_at=null`; infinity, a far-future sentinel, or a missing expiry on a finite row is not standing authority.

Standing authority lasts until the owner disables or replaces it. It is a deliberate long-lived credential decision, not a renewable proof window or an unlimited permission. Fixed target, policy, lease, revision, size and request-time bounds still apply. The route never renews authority, rotates credentials or changes a source. No Computer-session credentials, per-cycle owner SQL or PostHog-management credentials are required during normal imports.

Only a SHA256 bearer digest is stored in the private, RLS-enabled, owner-only table. The new route rejects the existing observed env bearer. When the installed workbook authorization table exists, the grant trigger also rejects its digest. The new grant does not extend or reuse the old one-hour workbook authorization.

Initial authorization uses revision 1. Rotation, finite-to-standing replacement or renewal requires an exact next revision, a distinct digest and a new approval. Revocation changes only `enabled=false` and the next revision. Standing changes append before/after authority metadata, including only the token digest, to the existing private operator audit. Its actor is the actual database role; the approval reference identifies the human-authorized operation. Existing finite cleanup has no added audit mutation.

Those operations belong to an approved configuration operator; no automatic rotation or renewal is implemented. During a planned replacement, pause the three imports, make the owner CAS update and securely replace the source secret, verify the new route/configuration, then resume the existing schedule. Do not reuse the old finite initial-insert script against an existing row. Do not assume a source PATCH is free of probes or vendor-side jobs.

Both RPCs recheck current authority and scope under READ COMMITTED. RR/serializable snapshots are rejected. The second RPC verifies the revision/snapshot supplied by the first, reads the actual SQL050 aggregate, then rechecks authority and finite expiry when present. Finite auth RPC responses retain their original exact shape. Standing responses add only `authorization_mode:"standing"` and use JSON null for `expires_at`. The HTTP parser rejects all other modes, extra fields and missing fields; this internal authority metadata never enters the report response.

HTTP authorization uses a constant-time digest comparison. One abortable 15-second budget covers both RPCs and their streamed bodies; the report body remains capped at 4 MiB. Errors return an empty response, never secrets or source data.

An authorized response already in flight can finish after its SQL transaction releases its locks. Disabling a grant cannot retract such bytes or rows already imported into PostHog.

## Generation and freshness

Every response includes the existing store/product metrics, two `report_status` rows and empty arrays for the other three resources. The manifest keeps all six existing resource names and primary keys. Only store, product and status are candidates for enabled imports. No additional metric domain becomes active.

`publication_id` is `observed:` plus a SHA256 of the ordered current head identities/revisions and the approved scope. IDs, work records, source payloads and policy contents are not exposed. One STABLE SQL statement reads metrics, heads, scope and queue health. No new report store or report engine is introduced.

The clocks have different meanings:

- `snapshot_checked_at` on each metric row is that resource request's source-read time, not its import completion time.
- `report_status.checked_at` is the status request's database observation time.
- `last_processed_at` is the latest successful current-head work completion. Polling does not advance it.
- `source_observed_revision_at` is the maximum observed source revision, not a universal source watermark.
- Actual PostHog import completion time comes from destination evidence. The consumer accepts it as `importedAt`, or explicitly reports null when unknown. `capturedAt` is evidence capture time and is never relabeled as import time.

Status validity ends 30 minutes after its read, or at finite grant expiry if earlier. For standing authority, the existing SQL `least` expression uses the non-null 30-minute bound. A null authority expiry is never a null status deadline. The 15-minute import cadence remains separate from this freshness limit. Late/failed metric refreshes age out even when the generation has not changed.

`operational_state=idle` means the bounded database queue observation has no pending, leased, expired, dead, missing-product or scope-mismatched work. It does not prove webhook receipt liveness or completeness. Every status explicitly reports `producer_liveness=not_proven` and `freshness_scope=matched_observed_snapshot`.

Metric `is_stale=true`, `report_scope=webhook_observed_only`, `certified=false`, `complete_window=false` and `observed_unverified` readiness remain intact. Operational freshness never promotes them to verified financial data.

## Ordinary processing and annual-access authority

The existing production scheduler supports explicit `continuous` mode without trial start/stop dates. Its invocation deadline, per-work leases and capped retries remain; standing delivery does not increase processing capacity. The existing future-open source scope and per-order accepted revisions manage which received work is processed. An accepted head is not a complete upstream watermark. No new source poller, full-report registration loop or scheduler is installed here.

The amendment also allows an explicitly standing annual-access rule. Existing rules remain finite and immutable except for disabling. Replace a finite rule by disabling that exact row and inserting a distinct, separately approved standing rule; do not edit its history. The unique enabled-rule fence, fixed product/scope, complete unedited source predicate, lease checks, existing-head refusal and per-exclusion audit remain unchanged. No EXTRA throughput grant or controller is renewed, reset or replaced.

Unresolved nonterminal exceptions must remain visible and pending. This amendment changes neither claim nor health nor the report status/consumer gates. Processing other work does not permit a current or complete claim while pending/failed conditions remain.

Pending work does not suppress the HTTP metric arrays or stop PostHog from importing updated observed-partial values. The separate consumer gate hides totals from a current-report presentation while pending. A partial snapshot may still be shown with its explicit pending/incomplete qualification, not as current or complete. Exception-specific counts belong to the processing health/owner response; the unchanged `report_status` includes aggregate pending work, not an exception-detail field or UI.

## Deployment and operating transition

The amendment changes two tables and three existing function bodies: observed snapshot, observed revision guard and annual exclusion. It pins the prior bodies, preserves existing function identities/ACLs, and adds no RPC or privilege. Guarded installation still requires the actual catalog and provider-hook checks before any DDL, plus preservation checks before commit.

Deploy the parser while existing finite authority remains valid, then install the guarded amendment. Old parser deployments reject standing responses, so verify the serving version before activation; repository main alone is insufficient. Installation creates no authorization and does not promote existing rows.

Bind one approved transition to fresh owner/catalog/current-control evidence. Pause imports, replace delivery authority using the exact old-row CAS and a new separately stored bearer, replace annual authority if approved, verify, and resume only the same three full-refresh imports. The existing fixed-time cleanup remains in force until this replacement is explicitly approved and verified. Canceling that obsolete cleanup is a separate authorized action, not an installation side effect.

The continuing stop controls are observed authorization `enabled=false` with next revision, annual rule `enabled=false`, existing pipeline scope/050 controls and the three PostHog `should_sync=false` settings. Pausing and denial do not retract in-flight responses or delete imported rows. Early revocation can leave an imported status apparently valid until its prior deadline, at most 30 minutes; consumer cache behavior must also respect that deadline. Privacy removal requires destination reconciliation.

## Coherent consumer and destination transition

`observedDeliveryView` consumes complete, unfiltered rows and independently captured counts for the two metric tables and status. It must run at every consumer read with the current clock. It exposes totals only when:

1. Status is valid, unexpired and healthy.
2. Both metric tables and status carry one matching generation, exact keys/counts and valid observed-only fields.
3. Each metric snapshot is still within the freshness budget. An empty metric table additionally needs a recent actual import-completion receipt because it has no row clock.

Mixed, stale, pending, failed, disabled or invalid inputs return empty metric arrays plus the visible state. “Current” means only a fresh matched observed snapshot. It does not mean all-source-now, a verified webhook subscription, a completed financial window or joint atomic import.

The route supplies source/status data; raw PostHog table access does not automatically call the TypeScript consumer. The consuming report or query must apply these gates before claiming a joint current total. A table preview that ignores them can still display an old or mixed pair.

The in-place source transition needs separate approval. Keep the same source and schema IDs, `auto_sync_new_schemas=false`, full-refresh semantics and the three unused schemas disabled. Preserve the actual store/product key definitions. Enable status only after its existing schema mapping is verified. The old Goal 1 imports remain untouched until that transition is approved.

Full refresh is required, but its name alone does not prove replacement. Live acceptance must verify that a corrected/removed key disappears from the entire destination table. The consumer rejects extra old generations and count/key mismatches; it does not delete rows. Reader revocation or import pause is not downstream removal. If replacement/removal cannot be verified, pause and hide the consumer, then separately reconcile/delete the affected destination data under approval.

## Installation and operating boundary

The raw review SQL is one transaction and contains no existing-object replacement. Its new footprint is:

- Table `lean_private.observed_delivery_authorization`, primary-key index and constraints.
- Trigger `observed_delivery_revision_guard`.
- Private functions `observed_delivery_revision_guard`, `observed_delivery_scope_hash`, `observed_delivery_snapshot`, `observed_delivery_payload`, `observed_delivery_acl_check`.
- Public functions `lean_observed_delivery_auth(text)` and `lean_observed_delivery_read(text,text,text)`.
- EXECUTE only for `service_role` on the two public functions. No private table or column access is granted.

The installer must freshly verify target identity, absent footprint, exact dependency owners/bodies/ACLs and the current provider-hook pins. The parent-owned wrapper checks hook/extension identity before its first DDL and checks all resulting function OIDs against the captured GraphQL extension OID before commit. It must also verify unchanged hooks, extension and unrelated catalog objects. This raw SQL is not permission to install it.

For operations spanning multiple objects, use authorization-table → pipeline-scope → SQL050-delivery lock order. Binding the initial grant requires the current `observed_delivery_scope_hash()`, exact current SQL050 delivery approval, a fresh random independent bearer held only in secure configuration transport, and the new explicit operating approval. Do not log the bearer or put it in SQL/artifacts. Existing secure transport limits and provider telemetry limits remain applicable.

Stop requires separate checks of processing scope, grant revocation, paused imports and any already running job. Imported data remains until its retention/removal action is verified. Scope changes, grant expiry and failures never select the old Goal 1 publication as fallback.

## Acceptance still required

Local tests exercise actual receipt/claim/retain/finish SQL, generation changes under one grant, independently expected fixture totals, HTTP checks, mixed/stale/failure gating, revocation, elapsed expiry and access controls. They do not prove live recurrence.

The parent must verify two natural automatic cycles with genuine changed input, exact canonical-to-warehouse row/count comparisons, correction replacement including obsolete keys, source/processing evidence, all three import outcomes, freshness aging and stop behavior. An unchanged scheduled re-import or two idle ticks alone do not complete Goal 2.
