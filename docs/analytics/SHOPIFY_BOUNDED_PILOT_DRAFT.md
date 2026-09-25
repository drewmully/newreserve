# Bounded Shopify pilot — local installation checked; activation unapproved

**Do not activate without approved scope/policy and a genuine-delivery smoke.**
The later authorized focused installation check passed 24 synthetic/local cases
on disposable PostgreSQL 18.6 and the actual two-route HTTP package. It applied
001/003/004/013–024 plus038 and039, with an enabled synthetic Google pilot preserved.
No hosted/source calls, broad regression suite or timezone reruns were performed.
The existing Google seven-day pilot, its runtime and scheduler remain separate.

## Scope and missing approval

The user confirmed only that products `8652818940096` (Mully Reserve – Golf
Curation Box) and `8592710435008` (Mully Starter Kit – Quarterly) are physical
goods. The example JSON includes those IDs; its timestamps and all approval/
actor references are intentionally blank, so it cannot register as supplied.

Still review: exact order-creation window, execution expiry, eligible paid USD
merchandise policy, `paid_at` sale and `refund_created_at` refund clocks, and the
explicit meaning of `commerceSource: other` as an **unsegmented mixed-channel
pilot bucket**, not evidence of non-storefront/non-renewal orders. Acquisition
is false. Do not promote the prior single-order test policy to broad authority.

The mapper remains restrictive: any unapproved/missing product rejects the
whole order, not just that line. Edited, cancelled, test, non-USD, tax-inclusive,
unpaid and unsupported financial cases are withheld, not reconstructed.

## Changes and bounds

- Forward `039_shopify_bounded_pilot.sql` depends on existing 017 and earlier
  schemas. It does not depend on or change Google 038, later evidence readers,
  history or full-report publication.
- Owner-only registration atomically creates a disabled pipeline scope, disabled
  immutable pilot and no source work. Requires an empty shop receipt queue and
  no existing pipeline scope; duplicate registration fails rather than replacing.
- HMAC validates exact delivered bytes first; raw SHA-256 is retained for replay/
  collision checks. Only normalized IDs, timestamps, product IDs and an unsupported
  flag are stored. Full customer/address/notes/properties JSON is not retained.
- New orders must pass the signed envelope's creation window and **all** product
  IDs before storage or hydration. The actual source is checked again before
  snapshot retention; its allowed product set is never inferred from a name/SKU.
- Refunds use only previously source-verified admitted membership. Unknown or
  not-yet-verified refunds are ignored without lookup; this is a limited observed
  feed, not guaranteed complete refund/event history.
- Previously admitted orders that leave scope or have unsupported/missing
  metadata receive a minimal dead receipt, not a source read. Prior output is
  stale. Mapping/source failures similarly remain dead/pending, never current.
  A newer/withheld admission also fences an older in-flight retain/finish.
- The existing observed view already treats any non-done shop work as stale.
  This supplement adds kill, execution expiry and total-cap staleness. It is
  deliberately conservative: one dead receipt can keep the whole shop stale;
  a later successful candidate does not silently clear the earlier problem.
- Caps: at most 1,000 stored receipts, 100 source attempts total and 20 source
  attempts per **UTC day**, with one attempt per receipt. Equal-delivery replay
  consumes no extra counter. Ignored out-of-scope HTTP deliveries are not stored
  receipts and do not count toward that database cap; this is not an HTTP
  ingress rate limiter.
- Each source attempt: fixed endpoint/API 2026-07, 20 HTTP requests maximum,
  8 MiB/response and 64 MiB aggregate; 8 MiB serialized retained-source maximum.
  Existing reader remains limited to two line pages and three refunds. Overflow
  fails, never truncates. One 60-second aborting signal includes claim/read/
  mapping, shortened to absolute expiry; SQL lease is at most 60 seconds.
- Accept/claim/retain/finish lock and check scope, expiry and kill state. Retain
  and finish recheck captured expiry/lease **after writes**, raising to rollback.
  Readiness holds a share lock on `pipeline_scope` through the transaction, after
  locking the pilot, so a concurrent scope kill cannot slip between check and write.
  Killing scope fences future retention/commit, not packets already in flight.
  Long owner-held outer transactions are not equivalent to runtime RPC commits.

## Exact minimal subscriptions

Correct app/installation and matching secret must be verified by the operator;
the unrelated Shopify connector installation must not create these subscriptions.
No product subscription filter: it would hide a transition out of the allowlist.
Verify the **returned subscription API version** is 2026-07; do not infer it from
the request URL.

For `orders/paid`, `orders/updated`, `orders/cancelled`:

```text
id
admin_graphql_api_id
created_at
updated_at
line_items.product_id
test
cancelled_at
```

For `refunds/create`:

```text
id
admin_graphql_api_id
order_id
created_at
```

Refund `updated_at` is optional in code; absence uses its actual creation time,
not an invented current timestamp. Distinct refund IDs remain distinct receipts.
The order's actual source is rehydrated, not built from these projected fields.
Missing order classification fields cannot silently approve an order.

## Environment and isolated package

New, separately deployed **two-route** package:
`POST /api/analytics/ingest/shopify`, plus authenticated
`POST /api/analytics/ingest/process` and its counts-only authenticated GET.
No Google handler, website, build-time source execution or scheduler is packaged.
Same outer guard: Preview, `review/analytics-initial-validation`, exact isolated
project/URL and `mullybox-store.myshopify.com`. Node 24; `node build.cjs`;
vendored real Next/Supabase dependencies, no install/network.

Required configuration:

```text
LEAN_ANALYTICS_SHOPIFY_PILOT_ENABLED=false
LEAN_ANALYTICS_SHOPIFY_PILOT_ID=<reviewed registered ID>
LEAN_ANALYTICS_SHOPIFY_PILOT_PROCESS_SECRET=<new dedicated random >=32 characters>
LEAN_ANALYTICS_RECEIPTS_ENABLED=false
LEAN_ANALYTICS_PIPELINE_ENABLED=false
LEAN_ANALYTICS_PIPELINE_PROJECT_REF=xeqlgxvrhgwwudyqtnun
LEAN_ANALYTICS_SUPABASE_URL=https://xeqlgxvrhgwwudyqtnun.supabase.co
LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY=<approved isolated key>
LEAN_SHOPIFY_SHOP_DOMAIN=mullybox-store.myshopify.com
LEAN_SHOPIFY_ANALYTICS_READ_TOKEN=<correct app's dedicated approved read token>
LEAN_SHOPIFY_WEBHOOK_SECRET=<matching correct app signing secret>
```

No Google variable/secret, existing process secret or existing spend secret
needs to change. With a pilot ID set but pilot flag OFF both routes stay OFF.
Processing accepts no query/body scope. Webhook authenticates only via Shopify
HMAC, not the process bearer. All unrelated switches remain OFF in this new
deployment. Do not alter the existing Google deployment or scheduler.

## Operator registration and grants

After schema review and the gated smoke, as schema owner:

```sql
select public.lean_shopify_pilot_register($1::jsonb);
```

Use the attached JSON with genuine reviewed references and UTC `Z` timestamps.
No defaults fabricate policy; expiry must be future and at most fourteen days
away. Registration does **not** enable scope. Owner reads back all immutable
fields, product IDs, disabled switches and zero counters.

Runtime can execute new `lean_shopify_pilot_accept`, `status`, and `claim`.
Registration and renamed ordinary implementations have no service-role,
anon/authenticated or PUBLIC execute grant. Legacy receipt/claim endpoints reject
pilot shops. Generic claim refuses a registered pilot; generic finish/fail cannot
mark pilot work done. Ordinary non-pilot pipeline calls delegate to unchanged017.
The registered pilot monopolizes the old generic queue worker, consistent with
017's prior queue separation; ordinary non-pilot pipeline processing remains.
No direct table writes or membership registration are granted to runtime.

Only after separately approved activation, enable in parent-before-scope lock
order (assert exactly one affected row each):

```sql
begin;
select pilot_id from lean_private.shopify_pilots where pilot_id=$1 for update;
update lean_private.pipeline_scope c set enabled=true
  from lean_private.shopify_pilots p where p.pilot_id=$1 and c.shop=p.shop;
update lean_private.shopify_pilots set enabled=true where pilot_id=$1;
commit;
```

Then enable the three receipt/pipeline/pilot deployment flags on the **new**
Shopify deployment only. Install only approved correct-app subscriptions.
A finite existing dispatcher can invoke process; this supplement creates no
scheduler. Do not reset attempts, dead work or blocked counters to evade caps.

## Installation check and remaining activation smoke

`tests/runtime/shopifyBoundedInstallation.test.cjs` exercises the packaged
handlers, synthetic fixed Shopify transport and actual service-role PostgreSQL
RPCs. Its 24 cases cover the installation, default-off/auth/target, minimal receipt
and replay/collision, supported purchase/refund, missing order update time,
catalog/cancellation/edited staleness, membership, bypass grants, caps, kill and
newer-event fences, transaction locks and post-write lease/absolute expiry rollback.
The ordinary unregistered pipeline path also passes. This is not a full suite.

A separate-connection check first reproduced a missing scope-row lock during
accept/retain; adding `FOR SHARE` in readiness made it pass. Both parent and scope
kills now block until that transaction releases its locks. Google function
definitions and enabled synthetic pilot rows were asserted unchanged.

Before activation, review the following checklist against the approved concrete
scope; steps1–6 have focused local synthetic coverage, not hosted proof. Step7
and actual scope/policy approval remain outstanding:

1. Apply039 to a disposable/local clone of017 first. Check all functions compile,
   column/view parity and runtime/anon grants, including renamed bypass denial.
2. Register a synthetic scope disabled; prove default-off and no writes. Test
   bad HMAC, query/body/auth, wrong destination and expired/disabled scope.
3. Signed allowed order: inspect only minimal retained envelope/raw hash, one
   receipt/work, no duplicate counter on replay; changed raw hash must collide.
4. Synthetic actual reader → consumer → SQL: one candidate, empty customer/
   identity domains and null cash/customer/spend reporting. Source fields remain
   fixed. Prove unknown product/mixed order/creation-window reject before hydration.
5. After a good head, signed catalog-exit/cancel/missing metadata must mark old
   head stale with no source read. Edited/rejected hydration must remain stale.
   Unknown refund must do zero lookups; admitted source-verified refund may run.
6. Separate connections: duplicate claim, kill/expiry during retain/finish,
   daily/total/receipt cap, old generic bypass, rollback and older in-flight
   source after newer withheld receipt. Prove no late retained/current output.
7. Only then perform the separately approved isolated genuine-delivery smoke;
   verify correct app/API version and unchanged Google job/scheduler state.

Stop: disable `shopify_pilots.enabled` first, then both route flags and scope;
remove only the exact new subscription IDs and stop its dispatcher. Preserve
minimal receipt/audit evidence and old source snapshots for review; do not delete
to make staleness disappear. The view stays stale when disabled/expired. No
automatic retention purge or customer deletion claim is added by this draft.
