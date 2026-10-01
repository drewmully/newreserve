# Recurring observed sales and product delivery

This additive path serves existing SQL017/047 latest successful order heads through SQL050. It does not register full builds, certify a population or change the Goal 1 workbook selections. Existing `/observed`, `/production` and `/workbook` routes remain unchanged.

## Default-closed service authorization

`/api/analytics/reports/observed-current` uses the existing production service-role backend. It requires the current main/production enablement checks and a separate owner-approved record in `lean_private.observed_delivery_authorization`. Installation creates no row, bearer, approval, schedule or enabled source.

One finite grant covers repeated automatic imports. It binds the fixed Supabase project, shop, PostHog project 353503/source `01a0f3c6-8758-0000-378b-d15c40a96f3a`, audience, path, exact manifest, scope hash and delivery approval. The scope hash covers the approved policy and fixed creation-time window. It does not slide the window or silently admit a different catalog. Processing must preserve the approved `financial_no_geo_order_size` projection, order-size product semantics and `financial_allowlist_v1` retention.

Seven days is a hard proposed maximum, not a default duration or activation approval. The actual `not_before` and `expires_at` remain unbound until the owner approves them. The route never renews a grant or changes a source. No Computer-session credentials, per-cycle owner SQL or PostHog-management credentials are required during normal imports.

Only a SHA256 bearer digest is stored in the private, RLS-enabled, owner-only table. The new route rejects the existing observed env bearer. When the installed workbook authorization table exists, the grant trigger also rejects its digest. The new grant does not extend or reuse the old one-hour workbook authorization.

Initial authorization uses revision 1. Rotation or renewal requires an exact next revision, a distinct digest and a new approval. Revocation changes only `enabled=false` and the next revision. Those operations belong to an approved configuration operator; no automatic rotation or renewal is implemented. During a planned rotation, pause the three imports, make the owner CAS update and securely replace the source secret, verify the new route/configuration, then resume the approved schedule. Do not assume a source PATCH is free of probes or vendor-side jobs.

Both RPCs recheck the current grant and scope under READ COMMITTED. RR/serializable snapshots are rejected. The second RPC verifies the revision/snapshot supplied by the first, reads the actual SQL050 aggregate, then rechecks authority and elapsed expiry. HTTP authorization uses a constant-time digest comparison. One abortable 15-second budget covers both RPCs and their streamed bodies. Errors return an empty response, never secrets or source data.

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

Status validity ends at the earlier of grant expiry or 30 minutes after its read. Thirty minutes is a proposed maximum freshness budget for an explicitly approved 15-minute import cadence. Late/failed metric refreshes age out even when the generation has not changed.

`operational_state=idle` means the bounded database queue observation has no pending, leased, expired, dead, missing-product or scope-mismatched work. It does not prove webhook receipt liveness or completeness. Every status explicitly reports `producer_liveness=not_proven` and `freshness_scope=matched_observed_snapshot`.

Metric `is_stale=true`, `report_scope=webhook_observed_only`, `certified=false`, `complete_window=false` and `observed_unverified` readiness remain intact. Operational freshness never promotes them to verified financial data.

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
