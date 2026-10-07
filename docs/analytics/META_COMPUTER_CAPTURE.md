# Computer-operated Meta capture

This additive script parameterizes the parent's already working curl capture.
It does not change the frozen hourly adapter, SQL, current input/finish chain,
Google worker, or workbook formulas. It imports only Python standard libraries.
Importing or testing it sends no request.

## Required operating boundary

Worker 936 supplies one immutable cycle binding as exact UTF8 JSON bytes and
its independently retained SHA256. The Computer operator must read both from
the approved cycle record, not accept a caller's arbitrary JSON and matching
digest as authority. A hash pins bytes. It does not authenticate a grant, claim
a cycle, enforce one-time consumption or authorize source registration.

The cycle owner must reserve three requests before invocation and invoke this
helper only once for that claim. A failed/ambiguous attempt consumes that
reservation; it must not retry this command or change its output directory to
replay the same cycle. The helper makes no retry internally. Grant revision,
claim/replay fencing, restricted SQL registration, and any later activation
remain the cycle controller's responsibility.

Use the existing `meta_ads` credential preset on the parent Computer Bash
invocation. Never put credentials in arguments, the binding, files or source.
Curl inherits the configured HTTPS transport. The script does not inspect
credentials, alter TLS/proxy settings or grant permissions.

```sh
python scripts/analytics/capture-meta-hourly.py \
  --binding /private/operator/claimed-cycle.json \
  --binding-sha256 EXACT_HASH_FROM_IMMUTABLE_CYCLE \
  --output /private/operator/new-cycle-capture
```

This example is not execution authority. There are no account, timezone, URL,
filter, paging, retry, date or budget override CLI arguments.

## Exact binding shape

Only these fields are accepted:

```text
version: 1
cycleId: canonical UUID
grantId: exact immutable grant ID
grantRevision: nonnegative decimal string
projectRef: xnfjdbpjuaezxjgargto
shop: mullybox-store.myshopify.com
provider: meta
accountId: 2796962933960445
currency: USD
timezone: America/Los_Angeles
apiVersion: v25.0
date: approved New York YYYY-MM-DD
notBefore: actual cycle claim UTC instant
deadline: finite cycle deadline UTC instant
freshnessCutoffAt: same instant as notBefore
maxRequests: 3
maxBytes: owner's positive bound, at most 8388608
accountLimit: 49
campaignLimit: 1001
approvalRef: approved source operation reference
actorRef: operator reference
controlApprovalRef: approved independent control reference
```

The script refuses duplicate JSON keys, altered bytes, additional fields,
placeholder `UNSET` references, wrong target/account, wrong fixed limits,
premature/expired claims and an open provider query window. It does not sleep
until a window opens.

## Capture contract

`ny_window` derives NY midnight boundaries with IANA timezone rules, converts
through UTC, and requests both enclosing complete Pacific dates. Both dates
must already be closed before the first request, and the check repeats before
each Insights request. Clock comparisons preserve microseconds. Like the
frozen hourly adapter, it refuses NY or enclosing Pacific DST-transition days.

Exactly three GETs are allowed, in this order:

1. Graph v25 account metadata for the fixed account.
2. Unfiltered hourly account Insights, limit 49 with accepted ceiling 48.
3. Separately requested unfiltered hourly campaign Insights, limit 1001 with
   accepted ceiling 1000.

Queries are identical to the frozen native receipt adapter. They include
`time_increment=1` and
`hourly_stats_aggregated_by_advertiser_time_zone`. Any continuation, provider
error, non-200 response, scope drift or row sentinel stops the attempt. Native
complete `data: []` is retained as an empty response, not fabricated hourly rows.
The final adapter makes the verified no-activity interpretation.

Each curl call has at most 15 seconds, at most 5 seconds to connect, no retry,
no redirects and HTTPS-only URLs. A bounded pipe reader enforces the remaining
body byte allowance even without Content-Length. Each receipt is also capped at
1,000,000 bytes, matching the frozen consumer. The whole capture has at most
55 seconds and the earlier cycle deadline wins. The response parser checks the
remaining clock after parsing, too. There is no fourth request.

## Output and consumer

All responses stay in RAM until all three calls and checks succeed. Only then
does the script create a new directory with mode `0700` and these `0600` files:

- `account.json`
- `account-hours.json`
- `campaign-hours.json`
- `cycle.json`

The receipts contain exact request parameters, start/finish clocks, original
body byte count and SHA256. Successful response JSON is projected to typed
reporting fields. Business display names, paging URLs/cursors and unknown
free-form response content are not persisted or printed. The flag
`responseProjectedToRequestedSafeFields` makes that projection explicit.
Original body bytes are not written to disk. Provider errors and curl stderr
are never printed. A stopped invocation emits only a fixed stage code.

The successful JSON summary identifies the cycle, binding hash, approved date,
derived query dates, request/body counts and NY bounds. It explicitly says
`metricAcceptance=false`, `registered=false`, `enabled=false`.

The cycle owner passes those three receipts to the frozen
`metaHourlyPacketFromCaptures`, using the same immutable cycle's scope,
freshness/approval references and its final policy `asOf`. It must use the
clock-fixed adapter revision, not the predecessor. The resulting packet goes
through `prepareMetaSpendRegistration`, which selects the new owner-only
`lean_marketing_spend_hourly_register`. That SQL function still needs its
guarded installation.

The numeric binding account ID is not the adapter's account key. Use the exact
verified native metadata `response.id`, which is `act_2796962933960445`.
Do not trim or recycle the historical newline-bearing stored key.

```ts
const packet = metaHourlyPacketFromCaptures({
  projectRef: binding.projectRef, shop: binding.shop,
  generationId: `meta-hourly:${binding.cycleId}`,
  accountId: metadata.response.id, date: binding.date,
  approvalRef: binding.approvalRef, actorRef: binding.actorRef,
  controlApprovalRef: binding.controlApprovalRef,
  metadata, accountHours, campaignHours,
  freshnessCutoffAt: binding.freshnessCutoffAt,
  asOf: actualFullRunPolicyAsOf,
});
const prepared = prepareMetaSpendRegistration(packet, {
  freshnessCutoffAt: binding.freshnessCutoffAt,
  asOf: actualFullRunPolicyAsOf,
});
```

The actual full-run `asOf` must be at or after every receipt's finish, not the
earlier cycle claim. The claim remains the freshness cutoff. The cycle owner
must create/bind the correct immutable target after acquiring those inputs;
neither helper rewrites an already registered full-run policy.

The existing `prepareMultiProviderSpendBinding` prepares
`lean_marketing_spend_bind` arguments only after the actual default-off row
readback and exact target full-run creation. The SQL binder reads each stored
packet hash itself. It does not accept a caller-created hash. This helper
neither computes whole-provider proof from its own returned rows nor enables
any source, binding or full build.

## Offline proof

```sh
python -m unittest discover -s tests/analytics -p test_capture_meta_hourly.py -v
```

The test runner uses fake clocks and in-memory provider responses. Three local
Python subprocess cases test the actual bounded pipe reader, with no curl or
network operation. These tests do not prove a live credential, current grant,
native registrar installation or recurring publication.
