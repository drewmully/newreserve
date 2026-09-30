# Bounded subscription observation runtime — review only

This document describes the original048 RUN_ID mode. Optional additive049
[finite recurring scan plans](SUBSCRIPTION_SCANS.md) reuse it for bounded
multi-page progress and cadence, without changing048 or certifying global metrics.

This adds a real authenticated transport, single-run orchestration, private persistence
and owner-only SQL reporting to the existing offline collector/snapshot modules.
**It does not activate an import, certify subscribers or revenue, publish reports,
change billing, or schedule anything. No live source/credential test is part of this package.**

## Supported first run

- Exactly one owner-registered shop: `mullybox-store.myshopify.com`.
- One GET, one page, at most 100 raw rows and 4,000,000 response bytes; the owner
  can choose smaller bounds. Optional documented status filter or all statuses.
- Fixed `https://api.loopsubscriptions.com/admin/2026-04/subscription`,
  `X-Loop-Token`, no redirects, writes, automatic retries or continuation jobs.
- 10-second fetch signal, 30-second collector lifetime, 5-second RPC wait,
  60-second route duration. Each dispatch must acquire the database's 120-second
  singleton lease; the one request permit requires at least 20 seconds remaining.
- The registered scope/token fingerprint cannot be edited. An attempt is spent
  at claim, even if configuration, authorization, projection or persistence fails.
  A new attempt needs a new owner-registered run, not a reset/retry loop.

The transport verifies that the configured token matches an **owner-approved
fingerprint**, not that Loop says that token belongs to this shop or has a certain
scope. Neither a shop string, an installed Loop app nor existing environment-variable
metadata proves token-to-shop/read-scope authority. Report binding is explicitly
`owner_attested_not_provider_verified`. No token value is persisted or returned.
There is deliberately no fallback to `LOOP_ADMIN_API_TOKEN`, `LOOP_API_BASE_URL`,
`LOOP_ADMIN_API_VERSION` or the operational Loop helpers.

Official reference: [read subscriptions](https://developer.loopwork.co/reference/read-all-subscriptions)
documents the 2026-04 endpoint, read-subscription-contract scope, token header and
cursor pagination. [Rate limits](https://developer.loopwork.co/reference/rate-limits)
share the store pool across **all apps/API keys**. Our singleton lease/cooldown only
coordinates this runtime against this database. It does **not** coordinate the
existing operational Loop readers or other store traffic. The first single-page
run still needs an explicitly reviewed traffic window/budget. 401/403/429/5xx stop
without reading the error body or retrying. Broader recurring collection needs a
shared admission arrangement, not a larger page limit hidden in configuration.
[Token management](https://developer.loopwork.co/reference/generate-admin-api-tokens)
supports integration-specific read scopes; creating/rebinding a token is not
authorized by this code.

## Report meaning and privacy

The database owner can call `public.lean_subscription_report('<approved-run-id>')`.
It returns run/kill-switch/expiry status, approval and binding references, exact
selection/bounds, result hash and the private observed rows:

- Pseudonymous contract/subscriber keys (nullable subscriber), observed contract
  status and next-billing timestamp, source revision timestamp if present.
- Nullable currency, cadence/count, prepaid flag, and all projected line
  quantities/unit prices as exact decimal strings. Absence remains null, not zero.
- Operational request/byte/raw-row/duplicate counts and collection start/finish
  time/hash. These are data-quality evidence, **not total store subscriber counts**.

All six business metrics remain null/`withheld`: active contracts, distinct
subscribers, aggregate next renewal, renewals in the configured window, proposed
MRR and ARR. An individual observed next-billing date is not a certified global
renewal schedule. Pagination ending is not a complete/consistent snapshot.
`scopeComplete=false`, `certified=false`, definitions remain `proposed`, and
historical trends are unsupported. Line price × quantity is not trusted complete,
discount-adjusted recurring-cycle value; currency, prepaid treatment and cadence
must not be guessed. This path has no way to submit recurring-value authority.

Raw provider responses may transiently contain PII in server memory. The existing
allowlist projector removes names, emails, addresses, raw provider/customer IDs,
custom attributes and unrecognized fields before persistence. Stored keys are
deterministic hashes, **not anonymization**; keep the observations private. The
runtime and route return only fixed states, never rows or upstream error text.
No provider body/token logging is added. Review platform request tracing/redaction
before activation. There is no export, reporting-reader grant or deletion-history
feed. There is no automatic purge: a named owner and approved retention/deletion
deadline for these pseudonymous rows are required before activation.

## Database footprint and security

`048_subscription_snapshot.sql` is additive and transactional:

| Object | Purpose / allowed access |
|---|---|
| `lean_private.subscription_runs` | Owner registers immutable scope/binding/approval/traffic references and proposed policy; holds one validated immutable result. Default disabled; activation expires within seven days. |
| `lean_private.subscription_gate` | One default-disabled row; shared lease, fencing token, one-request permit and 1.6-second cooldown for this runtime. |
| `lean_private.subscription_scope_immutable()` + trigger | Rejects scope/result edits; owner may disable a completed run and later delete it under the retention procedure. |
| `lean_private.subscription_validate(jsonb, subscription_runs)` | Exact minimized payload schema, bounds, dates, unique keys, six-decimal line values; rejects injected PII fields/business metrics/completeness claims. |
| `public.lean_subscription_claim/permit/finish/fail` | Four `SECURITY DEFINER` write-control RPCs; only `service_role` receives EXECUTE. Claim exposes approved configuration, not existing rows. |
| `public.lean_subscription_report(text)` | Owner-only `SECURITY DEFINER` status/private report. No service/application/reporting read grant. |

Two tables, seven functions, one trigger, one inert gate row; no extension, role,
sequence, view, schedule or changes to existing tables/functions. Fixed function
search paths; RLS enabled with no table policies. Explicit revokes close PUBLIC
and existing anon/authenticated/service_role defaults, plus optional
`lean_posthog_reader`. The installation aborts atomically if an unknown explicit
default grantee remains; it does not rewrite unrelated/default ACLs. Superusers,
the object owner and roles inheriting that authority remain privileged. Verify
actual role membership, owner and schema grants in the target before approval.

Schema dependency is `001`'s `lean_private` schema and existing Supabase roles;
there is no dependency on 018/019/020, 046 or 047 runtime storage. Existing storage
is commerce/publication-specific and has no Loop observation/lease boundary, so
reusing it would mix scopes and require broader contract changes.
**Operational install order: install/verify the separately approved 047 package
before 048. The 047 preflight intentionally rejects additional objects.** This is
an ordering constraint, not permission to install either migration.

## Environment and owner registration — not execution instructions

Keep `LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED` absent/false until all separate
approvals below are recorded. No new credential is needed for local tests.

| Server-only configuration | Required binding |
|---|---|
| `LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED` | Literal `true` only for the approved dispatch window. |
| `LEAN_ANALYTICS_SUBSCRIPTIONS_RUN_ID` | Exact immutable owner-registered run ID. |
| `LEAN_ANALYTICS_SUBSCRIPTIONS_SHOP` | Exact shop above. |
| `LEAN_ANALYTICS_SUBSCRIPTIONS_LOOP_TOKEN` | Explicitly approved read token; SHA-256 must match the owner record. Reuse of an existing hosted token requires explicit target/scope/binding approval; not automatic. |
| `LEAN_ANALYTICS_SUBSCRIPTIONS_SECRET` | Independent 32–512 character dispatch secret, never exposed to clients. |
| `LEAN_ANALYTICS_PIPELINE_PROJECT_REF` | Exact approved 20-letter Supabase project ref. |
| `LEAN_ANALYTICS_SUPABASE_URL` / `LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY` | Existing explicit analytics client configuration; URL must equal `https://<project-ref>.supabase.co`. No application fallback. |

Owner registration is direct SQL, with approval references rather than PII. Example
shape only (placeholders deliberately invalid; do not paste unchanged):

```sql
insert into lean_private.subscription_runs
  (run_id,project_ref,shop,token_sha256,binding_ref,approval_ref,traffic_approval_ref,
   actor_ref,policy,page_size,max_rows,max_bytes,status_filter,expires_at)
values
  ('<approved-run-id>','<approved-project-ref>','mullybox-store.myshopify.com',
   '<securely-derived-approved-token-sha256>','<binding-reference>','<approval-reference>',
   '<traffic-window-reference>','<owner-reference>',
   '{"definitionRef":"<proposed-definition-reference>","countedStatuses":["ACTIVE"],
     "excludedStatuses":["PAUSED","CANCELLED","EXPIRED"],
     "deduplication":"identical_normalized_contract","subscriberBasis":"shopify_customer_id",
     "renewalDays":30,"recurringValue":null}'::jsonb,
   10,10,4000000,null,clock_timestamp()+interval '1 day');
```

Registration alone enables nothing. A separately approved activation must set
the exact run and singleton gate enabled, explicitly bind the environment, then
send one authenticated empty-body/no-query POST to
`/api/analytics/subscriptions/process`. No caller-selectable shop/run/filter/budget.
Wrong/missing dispatch authorization produces no database/source calls; disabled
route returns 404. No cron entry is supplied.

## Reconciliation, failures and rollback

1. Owner verifies the installed ACLs, disabled gate, exact registered project/shop/
   fingerprint/approvals, allowed filter and request/row/byte cap. Token read-scope
   authority and traffic availability are external approval evidence, not a claim
   returned by the app. Do not paste token values into SQL, tickets or logs.
2. After the approved single dispatch, inspect the owner report. Check one request,
   raw rows within requested page size, unique rows + duplicates = raw rows, time
   bounds, collection/result hashes, null preservation and expected status filter.
   Keep the report private; `pagination_ended` is still not completeness.
3. Reconcile this bounded observation against independently approved source
   evidence before assigning business meaning. A zero-row observation does not
   certify zero subscribers. No publication/select-release call exists here.
4. Failed source/auth/rate/bounds/projection results save no observation, only
   fixed failure metadata. A malformed finish rolls back all result writes.
   Lost storage responses can be ambiguous: no automatic replay. Owner reads
   status; a later dispatch of a completed run returns `complete` with zero source
   calls. An identical finish is idempotent; a conflicting finish is rejected.
   Spent attempts never fetch again. A new run requires reviewed authorization.
5. Kill switches: disable the environment flag, the run and gate. The database
   checks run/gate again at permit and finish, so a stop before finish discards
   the observation. A request already in flight cannot be un-sent; client abort
   is not a guarantee of provider-side cancellation. Do not forcibly clear an
   active lease to bypass this guard.
6. Migration failure rolls back both tables/functions. After a successful install,
   safest rollback is leave the new objects inert and undeploy/disable only this
   route. To purge an approved expired observation, owner first disables run/gate,
   waits out any active lease/request, clears the expired gate reference, then
   deletes that run in one owner transaction. No automated retention enforcement
   is claimed. Dropping 048 objects requires separate approval and checking
   dependent grants/objects; never change 046/047 or operational Loop endpoints.

## Readiness / remaining activation gates

| Area | Implemented and locally testable | Current live state | Required evidence / approval |
|---|---|---|---|
| Authentication and scope | Fixed read endpoint/version/header, explicit token fingerprint, exact shop/project, no fallback. | No token value read; token-to-shop/scopes unverified; no live request. | Secure owner-authorized token binding and read scope, target project, version compatibility; no new token creation assumed. |
| Runtime and traffic | Default-off authenticated dispatch; singleflight/fenced one-request lease; no retry; bounded bytes/time/rows. | No subscription route activation, schedule or traffic reservation performed. | Code review/merge/deploy approval, approved single-page traffic window considering all store callers. |
| Persistence and privacy | Private transactional 048 tables, minimized rows, immutable result/replay, owner-only report, ACL guard. | 048 not installed; no subscription snapshot saved by this work. | Install after047 only on approval; inspect target ACL/role membership; privacy/retention/deletion owner and deadline; tracing redaction. |
| Reporting and recurring value | Observed individual status/renewal/nullable fields and operational evidence; all global metrics withheld. | No certified active-subscriber count, revenue or history; no publication/export. | Genuine complete consistent scope and reconciliation; separately approved money/cadence/prepaid/currency definitions and full-cycle amount evidence. Current path cannot certify these. |

Focused tests use only synthetic responses and disposable PGlite, not live Supabase
or Loop. They cover actual service-role write RPCs, owner-only reads, hosted default
ACL hazards, unknown-grantee rollback, disabled/auth zero calls, one-page bounds,
projection failures, stale lease fencing, kill switches and finish-response loss.
These tests are not an authenticated provider smoke test or a target-environment
migration approval.
