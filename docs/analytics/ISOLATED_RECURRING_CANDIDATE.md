# Isolated reporting candidate: source auth, bounded dispatch, broader scenarios

This supplement is based on PR191 `daecde98fb699f30dda0766c354ac0ff2a80a7b2`.
It does not merge, deploy, register a subscription, change credentials, activate
a switch or install a schedule. No migration is added or rewritten.

## Implemented scope

1. The existing saved Google spend job accepts explicit service-account
   authentication in addition to its backward-compatible OAuth refresh path.
   JWT signing is shared with the existing application helper; analytics uses
   its own fixed scope, bounded/redacted transport and dedicated configuration.
2. The spend route and full-pipeline saved spend stage pass that explicit auth
   and the dedicated developer-token header to the existing campaign reader.
   Account, manager, date, page budget and approval still come from the immutable
   saved job—not the credential or a request body.
3. A default-off, read-only Google command compares campaign sums with a
   **separate `FROM customer` date/control query**, not a campaign-derived total.
   It covers at most three closed dates, five campaign pages per date, twenty
   total HTTP requests, eight MiB of response bytes, and ninety seconds.
   Worst-case requests are reserved before OAuth. Missing control dates remain
   missing, not zero. No DB job, report publication or mirrored event is written.
4. Existing `dispatch-pipeline.mjs` now has a finite global request/deadline
   budget, cancellation and no retries after errors/unhealthy health checks.
   Existing `dispatchOnce` and `--once` remain available. The previous endless
   CLI loop is deliberately replaced with a one-cycle default; repeated calls
   require an explicitly larger finite budget or an independently approved
   external supervisor.
5. SQL-backed tests cover multiple partial refunds, exact replay, provider
   refund processing before record creation, and retention of cancelled/edited
   partial-refund records with the last-good observed output visibly stale.
   **Cancelled or edited orders are not newly declared eligible or supported.**

## Google configuration and read-only check

Service-account mode uses only:

```text
LEAN_GOOGLE_ADS_AUTH_MODE=service_account
LEAN_GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64=<approved service-account JSON>
LEAN_GOOGLE_ADS_IMPERSONATE_EMAIL=<explicitly approved user, if delegation is used>
LEAN_GOOGLE_ADS_DEVELOPER_TOKEN=<approved developer token>
```

No fallback to `GOOGLE_ADS_*` or a shared Google credential is added. The subject
is optional: it is sent only when explicitly configured. Possessing a key does
not establish domain-wide delegation or target-account permissions.

Unset auth mode keeps the previous OAuth variables:
`LEAN_GOOGLE_ADS_OAUTH_CLIENT_ID`, `LEAN_GOOGLE_ADS_OAUTH_CLIENT_SECRET`,
`LEAN_GOOGLE_ADS_REFRESH_TOKEN`. Existing programmatic OAuth callers remain
compatible. The developer-token input is additive for those legacy callers;
new service-account checks require it. An OAuth caller omitting a provider-
required developer token is not thereby claimed to be live-ready.

The independent check takes a reviewed scope JSON:

```json
{
  "accountId": "<exact ten-digit account>",
  "loginCustomerId": "<exact ten-digit manager, or null>",
  "fromDate": "2026-09-21",
  "throughDate": "2026-09-23",
  "maxPages": 5,
  "maxRequests": 20,
  "deadlineSeconds": 90,
  "approvalRef": "<actual approval>",
  "actorRef": "<actual operator>"
}
```

`LEAN_GOOGLE_ADS_LOGIN_CUSTOMER_ID` metadata may help the operator verify this
scope, but the check does not silently read or override manager/account IDs from
environment. Saved runtime jobs likewise use their registered IDs.

Commands below are **preparation/execution instructions, not actions performed**:

```sh
# Repository command; needs installed existing development dependencies.
LEAN_ANALYTICS_GOOGLE_CHECK_ENABLED=true \
  node scripts/analytics/read-google-spend.mjs reviewed-scope.json

# Build locally; generated bundle requires Node built-ins only at runtime.
node scripts/analytics/bundle-google-check.mjs /private/new-google-check.cjs

# Run the bundle only after approval, with credentials injected securely.
LEAN_ANALYTICS_GOOGLE_CHECK_ENABLED=true \
  node /private/new-google-check.cjs /private/reviewed-scope.json /path/to/static-output
```

The bundle prints one aggregate JSON line to the **private build log**, including
source commit/digest, actual account currency/timezone, per-day campaign counts,
campaign/control cost micros, match status and request/byte counts. It prints no
campaign IDs, credential values, JWT or raw source records. It writes no totals
or records into the static artifact—only generic completion text. Do not copy
the bundle, credentials or input file into a public output directory. Exit 0
means all sample amounts matched; exit 2 is an unverified comparison; exit 1 is
a failed/disabled check. All results remain uncertified.

The compiler-derived source digest identifies the embedded reader modules;
the generated bundle's SHA-256 identifies the exact runnable file. The parent
handoff manifest supplies both. A static completion artifact is not evidence of
certification or broader integration.

## Genuine automatic Shopify feed: existing path, not an idle-queue claim

The candidate already contains the endpoint
`POST /api/analytics/ingest/shopify`, the `017_shopify_pipeline` queue/revision
consumer, and the restricted `lean_analytics.observed_order_daily` view.
No missing application endpoint needs to be invented for a genuine webhook.

To feed it, the operator must verify the exact Shopify app installation and
subscription authority, then configure a **real subscription to the reachable
isolated endpoint**, with the signing secret belonging to that subscription/app.
Names such as `SHOPIFY_CLIENT_SECRET` or `SHOPIFY_WEBHOOK_SECRET` alone do not
prove which secret is correct. Do not guess one, synthesize deliveries, or
create purchases to test it.

Supported topics:

- `orders/paid`
- `orders/updated`
- `orders/cancelled`
- `refunds/create`

The raw body is HMAC-SHA256 verified before parsing/storage. Shopify must supply
`x-shopify-hmac-sha256`, `x-shopify-shop-domain`, `x-shopify-topic`, and
`x-shopify-webhook-id`. The exact shop must match; unsupported topics, oversized
bodies, invalid delivery IDs and invalid signatures are rejected.

Required receipt/consumer runtime configuration:

```text
LEAN_SHOPIFY_SHOP_DOMAIN=<approved shop>.myshopify.com
LEAN_SHOPIFY_WEBHOOK_SECRET=<verified signing secret of the actual subscription>
LEAN_SHOPIFY_ANALYTICS_READ_TOKEN=<approved source credential>
LEAN_ANALYTICS_SUPABASE_URL=https://<approved isolated ref>.supabase.co
LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY=<key for that isolated database>
LEAN_ANALYTICS_PIPELINE_PROJECT_REF=<same isolated ref>
LEAN_ANALYTICS_PIPELINE_SECRET=<dedicated bearer secret, 32+ characters>
LEAN_ANALYTICS_RECEIPTS_ENABLED=false
LEAN_ANALYTICS_PIPELINE_ENABLED=false
```

Subscription creation/update permission and topic-related source access must be
verified for the actual app. The local repository cannot prove those provider
permissions or reachability through deployment protection. Keep both switches
off until the separately approved source/runtime check.

An operator registers `lean_private.pipeline_scope` with:
`shop`, `project_ref`, `enabled=false`, inclusive `from_time`, exclusive
`until_time`, `policy`, actual `approval_ref`, and actual `actor_ref`.
The registered window bounds **order creation time**, not webhook arrival or
refund date. Older-order refunds therefore require appropriate approved scope;
do not claim that a recent-created window covers every refund.

Policy is the existing `PipelinePolicy`: approved `decision`, explicit numeric
`productClasses`, `financialApprovalRef`, `saleClock='paid_at'` and
`refundClock='refund_created_at'`. These are business/financial approvals, not
inferred defaults. Runtime service role cannot modify scope or register broad
eligibility. A revised policy/window needs a new approval reference.

After separate activation approval, a supervisor may invoke the existing
authenticated `POST /api/analytics/ingest/process` (one receipt) followed by
`GET` (counts-only health), with no caller-controlled scope parameters. To use
the dispatcher:

```text
LEAN_ANALYTICS_DISPATCH_ENABLED=false
LEAN_ANALYTICS_RUNNER_ORIGIN=https://<approved isolated deployment>
LEAN_ANALYTICS_DISPATCH_MAX_CALLS=2
LEAN_ANALYTICS_DISPATCH_DEADLINE_SECONDS=300
LEAN_ANALYTICS_DISPATCH_INTERVAL_SECONDS=60
```

Max calls are even, 2–120 inclusive, because every cycle reserves POST + GET.
Deadline is 1–3600 seconds for the entire invocation, not per-cycle. No cron or
subscription is installed by the code.

Without a real signed feed, this processor only drains existing receipts.
Existing history collection uses `CREATED_AT`; it is **not** ongoing update
discovery. No new polling registry or forged webhook source was added.

## Dependency and reporting boundaries

Stay on PR191 plus this supplement. Later refresh-queue/preparation PRs require
all 17 independently bound evidence sections; they are not a minimal substitute
for genuine receipt delivery. This change neither manufactures those controls
nor claims automatic full five-domain reporting.

Google completed account/day jobs are immutable; replay does not create the
next day's registered job or reauthorize restatements. Ongoing account/day job
registration is still a reviewed orchestration requirement.

Edited original-purchase integration lives later in the stack. The initial
pilot intentionally rejects edits rather than reconstructing original value
from current lines. Cancellation with partial refunds needs a reviewed policy
and complete reporting semantics, not removal of a guard.

PostHog warehouse access is outside this patch. A five-table grant does not
prove least privilege when PUBLIC privileges remain inherited. Keep the reader
NOLOGIN until platform-specific access hardening is verified; this patch does
not change grants or create a warehouse connection.
