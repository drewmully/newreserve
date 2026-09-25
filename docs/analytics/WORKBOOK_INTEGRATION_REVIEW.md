# Workbook integration review — existing code, no activation

## Scope and provenance

This three-part review stack starts at PR 194 (`77ac9c4`) and integrates the
existing later implementation from `af08ac1..367f564`. It is not a new analytics
stack and does not supersede the production marts. The stable workbook contract
is `L34-finite-workbook-acceptance-checklist.md`: ten persisted business facts,
native `events`, a cleaned logical `analytics_events`, five report envelopes and
18 mandatory metrics. The existing formulas and null/readiness semantics are
reused. No deployment, migration, source read, activation, schedule or merge is
performed by this integration.

Review chunks:

1. **025 refresh intake:** bounded registration/dispatch, offline preparation,
   current MyMully source snapshots and the explicit-policy Shopify cash mapper.
2. **026–034 and 037 source boundaries:** anonymous permission and verified
   checkout plumbing, native offers/campaigns, draft/SMS metadata readers,
   scoped release/health/update scans and canonical timestamp serialization.
3. **035–036 collected evidence:** original-sale agreements, bounded fresh
   collection, discovered inventory fencing, immutable partition staging and
   one globally fenced publication; native offer/anonymous grant composition.

The pre-existing 191 privacy, Google authentication/dispatch and Shopify clock
fixes remain. SQL 038, 039 and 040, their operators and their source defaults
are not changed. No campaign or email code is included. The new three review
branches have `vercel.git.deploymentEnabled` set to `false` before push;
the existing `crons` array is unchanged.

## Guarded website hooks

The original later stack included useful checkout/stylegame hooks that return
without source calls unless the relevant journey flag is explicitly `"true"`.
They are retained rather than silently dropping workbook capability. Tracking
failure still cannot change a successful checkout outcome.

Two old-stack changes were unconditional and are now gated by the existing
proposed `NEXT_PUBLIC_LEAN_ANALYTICS_JOURNEYS_ENABLED` flag:

- The analytics-preferences navigation link and page are hidden by default.
- The Text Mully view action ID, strict UUID fallback and click-only listener
  behavior apply only when that flag is on. With it off, the existing view
  payload, UUID fallback, and pointerdown/click advertising listeners remain.

No environment flag is set here. This is a static/default-off guarantee, not
an assertion that a hosted environment has been inspected. Turning journey
collection on still needs explicit policy and release approval; login and SMS
marketing consent do not grant analytics permission.

## Late installation compatibility

The reported isolated installation is **001–024, then 038/039/040**. It is not
a fresh database with 025–037 already installed.

`analyticsLeanLateInstall.test.ts` reproduces that exact order, registers and
enables *synthetic* Google and Shopify pilots, and retains marked synthetic
history rows. It then applies 025–037 in numeric order, checking after **each**
migration:

- Byte-identical protected `pg_get_functiondef` values and function OIDs,
  owners, ACLs, security-definer/search-path settings, including all hidden
  ordinary delegates from 003/004/017/019/038/039/040.
- Unchanged protected table ACLs/RLS, trigger definitions and enablement.
- Identical pilot configuration, counters, source rows and enabled states.
- Real pilot status/next handlers still work; generic receipt/claim bypasses
  still fail; the service role cannot execute hidden ordinary delegates.
- The new refresh queue/limits and journey grants remain empty.

The embedded PostgreSQL (PGlite) proof passes locally. CI also runs the same
test on a disposable real PostgreSQL database in a dedicated, nonconcurrent
step because role reset operations are cluster-wide. This tests code and
synthetic state only; it is not hosted database verification or source coverage.

**No forward repair migration 042 is needed by these checks.** Do not reapply
038/039/040: their rename operations are not idempotent. After separate owner
approval, the missing 025–037 migrations can be reviewed for installation in
numeric order on the reported prefix. First verify the actual schema matches
that prefix and has no unexpected drift. Keep all new runtime, refresh,
release/export and journey controls off. Parent-owned bridge 041 is separate.

## What is implemented versus genuinely unfinished

Already implemented and integrated: all ten fact transforms, five reporting
envelopes and 18 metric formulas; independent evidence intake, metric-specific
withholding, source/permission boundaries, original purchases, bounded
collection, private persistence and controlled publication/export.

`analytics_events` is the cleaned **in-memory logical relation** produced by
`sessions.normalizeEvents` after `fullReportBuild` applies current permission,
removal and temporal-identity checks. It is not a persisted duplicate of native
PostHog events. `behaviorDiagnosticView` emits a bounded diagnostic query named
`analytics_events`, but that query is explicitly not the protected canonical
customer/session view. It must not be represented as one. A saved/materialized
PostHog query is conditional work only if an approved bounded detail route
requires it; it is not an unconditional missing sixth report.

Remaining production implementation is conditional on named real authority:

- **ID-1/ID-2:** bounded historical identity/history and customer analytics
  allow/withdraw adapters. Current profile links and anonymous grants cannot
  provide missing temporal intervals, migration history or customer permission.
- **CTRL-1/CTRL-2:** source-specific independent completeness/control adapters
  after the owner names their authoritative inventories. Arrivals cannot
  certify their own completeness or a missing day as zero.
- **SMS-1:** a source-bound inbound-message-to-session/checkout mapper after
  immutable provider ID/time, temporal association, coverage and permission
  exist. Current metadata and `sms_click` are not activation evidence.
- **FIN-1/FIN-2:** unsupported order/adjustment/chargeback mappings and automatic
  cash collection only after reviewed treatment/clock/gateway authority.
- **RET-1:** provider/downstream deletion execution and completion verification
  once the supported APIs, retention policy and evidence semantics are approved.

ATTR-1 and known supported financial cases need approved policy values and live
acceptance, not a replacement algorithm. The private 040-to-hydration/report
consumer is owned by the separate 041 worker and is deliberately not duplicated
here. 041's fixed private projection must not inherit the standard reader's
customer/cart/line-attribute additions. No fixture removes any blocker above.
