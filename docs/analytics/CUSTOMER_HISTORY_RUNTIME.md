# Bounded customer-history invocation

`POST /api/analytics/customers/process` invokes the existing
`runHistoryCustomerStep` once. It processes at most one retained, registered
customer member. It does not read Shopify/PostHog, discover customers, register
work, renew authority, schedule processing or select reports.

The route is disabled unless `LEAN_ANALYTICS_CUSTOMER_HISTORY_ENABLED=true`.
It requires a dedicated `LEAN_ANALYTICS_CUSTOMER_HISTORY_SECRET` of 32 to 512
characters and an exact server-bound `LEAN_ANALYTICS_CUSTOMER_HISTORY_RUN_ID`.
The request must have a matching bearer and no query parameters or body.
`LEAN_ANALYTICS_PIPELINE_PROJECT_REF`, `LEAN_ANALYTICS_SUPABASE_URL` and
`LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY` must identify the same explicit
database target. There is no application credential or project fallback.

The transport permits only `lean_history_customer_claim` and
`lean_history_customer_finish`, at most once each for this invocation's run.
It uses a 60-second request deadline, below the existing 90-second SQL lease.
It bounds requests to 16 MiB, responses to 8 MiB and combined transport to
32 MiB. Redirects and retries are forbidden. The worker and SQL keep their
existing 100-order member and source-generation bounds.

Confirm the current target's installed customer-source contracts before use.
Inactive current-target wrappers may already be installed; the presence of a
legacy registration function is not a reason to reinstall them.
An owner must already have registered, sealed and enabled the exact run with
independent complete inventory, temporal ownership/history, current analytics
permission/removal authority, its current receipt and unexpired source scope.
This route supplies none of those facts or permissions. Missing/stale authority,
changed hashes, unsupported members and expiry still fail in the existing worker
and SQL. A route flag is not an authority receipt.

Responses contain only state, `providerRequests: 0` and
`certification: "unverified"`. `member_written` is not completion of the run.
`complete` is the existing SQL run state, not metric acceptance or permission
to publish. A false finish returns `changed`; a failed or ambiguous storage
response returns 503 without an automatic retry or lease reset.

This deliberately precedes the full build. The existing
`FullBuildPolicy.customerGeneration` pins a completed `generationHash` and
`resultHash` plus the authority identity/revision/fingerprint. Its SQL input
guard requires a completed matching customer run. Only after that result exists
can its reviewed immutable binding be used by the existing full pipeline.
No unfinished-result placeholder or new `lean_full_next` stage is introduced.

The companion `CUSTOMER_HISTORY_PREPARATION.md` describes an offline preparation
helper and an additional private, owner-only registration/binding SQL candidate.
Neither installs itself or changes the runtime's two-call budget. No cron,
Vercel configuration or production mode change accompanies this code. A standing
scheduler, source-authority refresh and actual full-build registration remain
separate approved work. This is a bounded invocation entry point, not a
standing recurring customer pipeline or newly accepted customer metrics.
