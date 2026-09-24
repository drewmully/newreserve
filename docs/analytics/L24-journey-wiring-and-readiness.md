# Journey runtime wiring and full-pipeline readiness

This is executable, default-off integration code in the existing analytics
stack, not a live deployment. It connects application events and Storefront
carts to retained permission/checkout evidence and the offline refresh builder.
It does not claim that every customer source or workbook metric is live.

## Runtime paths implemented

| Application path | New analytics behavior | Preserved behavior |
|---|---|---|
| `/api/analytics/track` | Reserve start/reveal/checkout and Text Mully page-start events, using the original stable action ID | Existing advertising and KPI dispatch |
| Style Game HTML | Sends the actual `sg_begin` action to the separate first-party event endpoint | Existing PostHog/advertising flow |
| `/api/stylegame/played` | Uses the persisted lead ID to produce a stable completion action | Existing lead creation and legacy event idempotency |
| `/api/stylegame/checkout` | Records the actual returned cart and a stable checkout action | Existing Shopify cart contents, selling plan and redirect |
| `/api/simulatorclubs/checkout` | Records the returned Storefront cart | Existing checkout and email prefill |
| `shopify.ts`, `shopifyCheckout.ts`, `swingBoxCheckout.ts` | Same-origin cart receipt handoff before returning/redirecting | Existing commerce attributes and destinations |

The browser helper reuses a current user from an already initialized default
Firebase app when available; it does not initialize Firebase or sign in.
The server verifies a supplied token, including revocation, before accepting
a Firebase-bound grant. Login is never itself analytics permission.
Anonymous journeys use an anonymous permission grant, not a guessed customer.

New tracking is auxiliary: missing configuration, denied permission, vendor
failure and timeout return without changing the checkout result. It is not
zero-latency: each permission/action/receipt RPC is bounded to one second, a
capture/cart verification request to 1.5 seconds, and the browser handoff to
two seconds after up to one second of Firebase token lookup. No automatic
retry follows an ambiguous network response. Explicit action retries retain
the same event ID and first recorded timestamp.

## Permission authority boundary

Migration 026 adds private grant, action and checkout-receipt tables. Every
event or cart operation rechecks a scoped, unexpired and unrevoked grant.
GPC/DNT suppress collection. The opaque cookie is
`__Host-mully_analytics`; only its SHA-256 hash is stored. Sessions and subjects
are authority-issued, and subject IDs cannot be reused within a project/shop.

**Grant issuance, cookie delivery and revocation updates are not implemented
against an actual customer permission authority.** The application runtime
cannot mint, extend, backdate or revoke grants. Connecting an authority remains
implementation work, not merely setting a boolean environment variable.

The approved authority must establish an actual permission decision and its
evidence reference, generate an unpredictable 32-byte token and separate
subject/session IDs, save its hash through an operator-owned integration,
and deliver a Secure, HttpOnly, SameSite cookie with Path `/` and no Domain.
Grant validity is at most 24 hours. Withdrawal must update the grant and
initiate the separately governed removal/refresh/export process.
These requirements are an integration contract, not an instruction to insert
synthetic fixture grants into production.

The new permission reader extracts only subject, interval, withdrawal and
evidence fields. It never exports bearer hashes or Firebase IDs.
`lean_*` events need a matching `lean_subject` authority interval in the full
build; the event's permission boolean alone is insufficient. Withdrawn grants
are excluded from rebuilt historical sessions and checkout links.
Previously released reports and native PostHog records are not automatically
erased by this adapter; deletion propagation remains separately governed.

## Checkout evidence

The application verifies the full secret-bearing Storefront cart ID against
the configured shop using a read-only `cart(id)` query. It stores a signed
context and the non-secret cart token in a private immutable receipt.
The secret cart key is neither persisted nor sent to PostHog. No existing
cart attributes are mutated.

Refresh mapping requires three agreeing pieces: the saved receipt, its HMAC
signature, and the independently read Shopify order's `cartToken`.
Verification uses purchase time, not the later reporting time. An absent
receipt stays absent, a revoked grant is excluded, and a reused cart cannot
silently move to another session.
Shopify documents `cartToken` on its
[Order API object](https://shopify.dev/docs/api/admin-graphql/latest/objects/order)
and in the [2026-07 release notes](https://shopify.dev/release-notes/2026-07).

This does not handle the separate REST draft-order paid-member checkout.
An order with `cartToken: null` has no Storefront link; an older retained
document missing the selected field must be refreshed, not treated as null.

## Source preparation

The existing source command now supports three bounded, explicitly approved
read modes. It does not register work, apply SQL, activate a queue or publish.

| Input `kind` | Required scoped fields beyond project/shop/approval | Output |
|---|---|---|
| Omitted | `entities`, retained `orders` with `customer.id` | Current customer snapshot |
| `journey-receipts-v1` | Retained `orders` with `cartToken` | Receipts for at most 100 selected cart tokens |
| `journey-permissions-v1` | `posthogProject`, `from`, `until` | At most 10,000 grants overlapping an exact window of at most 93 days |

Use `node scripts/analytics/read-mully-source.mjs INPUT OUTPUT` only after
the specific source read has been approved. All modes require the existing
`LEAN_MULLY_SOURCE_READ_APPROVED`, project, shop and source-key settings.
Permission mode also requires the matching `LEAN_POSTHOG_PROJECT_ID`.
The receipt/permission RPCs require the migration-026 service-role grant;
the customer GET requires the appropriate selected-row access.
Each invocation makes one bounded source request and creates an exclusive
owner-readable snapshot. Missing receipts are not proof of full coverage.

The `mully-source-v1` preparation envelope now optionally accepts:

- `journey`: the retained receipt snapshot. The offline preparer reads
  `LEAN_CHECKOUT_CONTEXT_SECRET` from its environment, never from JSON.
- `journeyPermissions`: the exact behavior-window permission snapshot.
  It appends anonymous authority intervals without inventing customer ownership.
- `offers`: an approved `OfferRegistry` with exact line-attribute key, value-to-
  offer mappings, mapping version and evidence references. Unknown configured
  values, conflicting attributes and incomplete line pages fail closed.
  This is optional extra taxonomy; native Shopify line-discount membership is
  now mapped automatically, as documented in L25.
- `retainReviewed`: source IDs for separately approved `identity` and/or
  `customerHistory` packets. Original hashes, capture times, scopes and expiry
  are checked and retained; this does not refresh stale evidence.

Current permission/removal lists always come from the fresh customer source.
Existing independently extracted controls are not rewritten by these adapters.
Offer joins use the complete shop/order/item key.

## Configuration before an approved isolated test

Apply migration 026 only after dependencies through 025 in an explicitly
approved isolated database. No migration is applied at application startup.

| Setting | Purpose |
|---|---|
| `LEAN_ANALYTICS_JOURNEYS_ENABLED` | Server collection gate; absent/false means off |
| `NEXT_PUBLIC_LEAN_ANALYTICS_JOURNEYS_ENABLED` | Browser cart gate; build-time setting |
| `LEAN_ANALYTICS_SITE_ORIGIN` | Exact HTTPS same-origin endpoint boundary |
| `LEAN_ANALYTICS_PIPELINE_PROJECT_REF` | Explicit Supabase target |
| `LEAN_ANALYTICS_SUPABASE_URL`, `LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY` | Server-only scoped runtime connection |
| `LEAN_SHOPIFY_SHOP_DOMAIN`, `LEAN_SHOPIFY_STOREFRONT_TOKEN` | Exact cart-verification shop and its Storefront token |
| `LEAN_POSTHOG_PROJECT_ID` | Exact permission/context/reader project |
| `LEAN_POSTHOG_CAPTURE_ORIGIN`, `LEAN_POSTHOG_CAPTURE_KEY` | Matching US/EU capture origin and project key |
| `LEAN_CHECKOUT_CONTEXT_SECRET` | Dedicated at-least-32-character signing secret, shared with offline verification |

Configure new behavior families with identity namespace `lean_subject`,
identity property `distinct_id`, action property `$insert_id`, session
property `$session_id`, consent property `analytics_permitted`, and schema
version `lean-v1`. The actual emitted families are:
`lean_reserve_started`, `lean_reserve_reveal`, `lean_reserve_checkout`,
`lean_style_game_started`, `lean_style_game_completed`,
`lean_style_game_checkout`, and `lean_text_mully_started`.
Only register families actually installed and verified for the test.
The runtime does not emit Text Mully activation or checkout from an SMS click.
Funnel definitions and coverage must match this actual instrumentation.

## Exact remaining work before full live scope

| Remaining item | What must happen | Why this PR does not guess |
|---|---|---|
| Permission lifecycle | Select and integrate the real analytics-decision authority, cookie issuance, withdrawal and retention/erasure process | Marketing consent and Firebase login are not equivalent |
| Text Mully outcomes | Connect actual inbound activation and purchase/checkout source, with stable IDs and permission evidence | An outbound SMS click is only intent |
| Draft-order checkout | Integrate the existing REST draft-order flow with its own corroborated order/session evidence | It need not have a Storefront cart token |
| Customer/identity history | Obtain and integrate verified historical ownership, complete purchase/migration coverage and source inventory | Current customer rows cannot prove historical ownership or first-ever purchase |
| Campaign and custom offer meaning | Connect authoritative first-party campaign receipts; supply a custom offer registry only if business taxonomy beyond native discounts is required | Native line discounts now establish membership without that registry; UTMs/product names do not establish campaign or identity authority |
| Cash and original purchases | Map the workbook's customer-cash clock and complete gateway lifecycle, including unsupported chargebacks; obtain originals for unsupported edited/cancelled/non-USD/gift-card/tax-inclusive orders | Customer cash is not bank deposits or fee-net payouts; current values need not be original purchase values |
| Independent controls | Wire independently extracted totals/keys for the approved source windows | Computing expected totals from the output would make the test circular |
| Ongoing full-volume operation | Implement source-driven fresh-evidence collection, production-volume partition/backfill, scheduling/watermarks, retention cleanup and alert delivery | L25 adds bounded update-time scans and read-only health checks; these do not make reviewed snapshots an unattended unlimited pipeline |
| Hosted installation and validation | Approved migrations/secrets, isolated real-source test, report release, least-privileged PostHog source/view setup and synchronization/deletion checks | These are not authorized by a local-code request |

The ten core fact transformations and five report builders exist. That is
not the same as having all upstream feeds and operational lifecycle completed.
Two optional subscription-outline tabs remain outside the core implementation.
Connected accounts remove an access hurdle; they do not resolve these source
definitions or prove deployment.

## Verification

The journey-wiring revision passed **520 tests across 41 files, zero skipped**;
the subsequent L25 revision passed **547 tests across 42 files, zero skipped**,
including ten real PostgreSQL integration/concurrency tests against a disposable
loopback database. Analytics TypeScript, analytics and changed-application-file
ESLint, generated SQL parity, and whitespace checks passed.

New coverage includes actual application checkout redirects, failed cart
creation, saved-lead retry behavior, Style Game script syntax, Firebase-bound
and anonymous handoffs, real SQL permission/receipt readers, withdrawal,
stable capture timestamps, default hosted grants, bounded source CLI modes,
offer-key compatibility with the full graph, reviewed-history preservation,
and incomplete/stale/tampered inputs. Vendor transports use synthetic responses.

No real customer source request, live event capture, hosted migration,
deployment, paid branch, source creation, schedule activation or paid live test
was performed for this change. This is not a whole-application test claim.
Local bounds do not constitute a guaranteed dollar cap for future live tests.
