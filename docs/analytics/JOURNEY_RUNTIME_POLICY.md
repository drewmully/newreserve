# Prospective Reserve runtime policy

This is a separate default-empty configuration path for the existing visit
opt-in flow. Deploying the code or installing the additive SQL does not enable
collection or create a grant. The existing environment-enabled lane remains
unchanged.

## Scope

The new path is fixed to production/main, Supabase `xnfjdbpjuaezxjgargto`,
`https://www.mymully.com`, shop `mullybox-store.myshopify.com`, and PostHog
353503 through `https://us.i.posthog.com/capture/`. It accepts only
`lean_reserve_started`, `lean_reserve_reveal` and `lean_reserve_checkout`
actions. It does not enable Style Game, Text Mully, campaign properties,
customer links or the cart/draft conversion bridge.

An owner must explicitly approve and enable the exact `reserve-runtime-v1`
row in the existing `lean_private.journey_policies`. Its existing approval
reference and TTL remain mandatory. The two added columns are
`runtime_capture_key_sha256` and `runtime_valid_until`. They default to null.
No row, disabled row, expired row, malformed configuration or unavailable
database means the DB path stays off.

The SHA256 value binds an existing runtime capture key to the approved
PostHog project. It is not caller-provided authority or a substitute for the
owner row. The server considers the dedicated capture key, existing server
PostHog project key and existing public build-time project key. It uses only
a candidate matching the stored fingerprint. The destination is fixed even
if a legacy host setting differs. Never put a key value in SQL, source,
approval records, fixtures or logs.

The database client uses the existing dedicated analytics connection with
the exact project/URL checks. It never falls back to the application's
generic Supabase client. No new environment secret is needed if that
connection and a matching existing capture key are available.

## Real user decision

The preferences page retains its existing visit-specific wording. Server
rendering exposes only whether allowing is currently available. It exposes
no policy, fingerprint, identifier or credential. Withdrawal stays visible
when collection is unavailable. The policy navigation change makes the
existing preferences link unconditional so disabling collection cannot hide
the withdrawal entry point. Other legal pages gain no database lookup.

The decision and DB-mode capture paths require the exact canonical origin.
GPC and DNT block allowing/capture. A real explicit allow request is still
required before an opaque secure, HttpOnly, SameSite=strict cookie is issued.
Firebase authentication, a marketing flag, the owner configuration row and a
past event are not user consent.

The runtime reads configuration without caching it between invocations.
Issue/grant/action RPCs validate the bound configuration against the current
owner row. Narrow insert triggers cover the reserved grant marker and
reserved actions even through old service-role RPCs. Existing unmarked
grants and actions retain their prior SQL behavior. Reserved grants cannot
escape into the old environment capture lane or the cart/draft helpers.
Marked operations require READ COMMITTED; unsupported transaction isolation
fails closed.

## Withdrawal, expiry and in-flight work

Disabling or expiring the DB row stops new DB-mode issuance and action
acceptance. Changing its approval reference invalidates the bound grants for
this runtime path. The existing withdrawal RPC still works after policy
disable, expiry, deletion or loss of the capture key, provided the dedicated
analytics connection remains available. Failed withdrawal does not clear the
cookie or claim success.

SQL acceptance and the provider HTTP call are not one transaction. One
already accepted request can reach PostHog after withdrawal or policy
disable. The request uses the existing 1.5-second abort signal and makes no
retry; an ambiguous HTTP outcome is not proof of non-delivery. New
invocations must recheck the policy and grant. The DB path also checks both
expiry timestamps again after the SQL action returns, before initiating HTTP.
This prevents a delayed SQL response from starting collection after a known
expiry. It does not recall an in-flight event, erase retained data or verify
downstream removal.

## Installation and activation are separate

`sql/analytics/proposed_journey_runtime_policy.sql` is an atomic,
absent-only additive installation. It pins the four delegated dependency
bodies, adds two nullable columns and one shape constraint, four public
service-only RPCs, two owner-only helper functions and four narrowly scoped
triggers. It preserves the old functions and their OIDs/bodies/ACLs. It
rejects a present or partial footprint, reserved pre-existing policy/grants,
and unsafe effective runtime role privileges.
The privilege check includes inherited column-level INSERT/UPDATE grants and
table TRIGGER access, not just whole-table write privileges.

Do not replay the installed history package. After ambiguous installation,
use the separately reviewed read-only verification/recovery receipt. A
partial or drifted footprint is not permission to drop, reset or reinstall.
Recovery means confirming absent or exact-present state; it is not a
destructive down migration.

Parent must separately approve SQL installation, verify it remains inactive,
publish the reviewed application change normally, then explicitly stage the
owner policy under applicable activation authority. Actual positive evidence
requires a genuine user opt-in, its current grant and a native event with
matching action/session lineage. No seeded grant or synthetic event closes
that gate.

Anonymous observed sessions do not require cash or customer history. Full-day
coverage and the existing seven-day conversion window plus 48-hour grace
remain separate requirements. No permission is backdated.
