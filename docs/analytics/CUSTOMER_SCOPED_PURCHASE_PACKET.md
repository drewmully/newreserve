# Fresh customer-cycle packet

`compileCustomerCyclePacket` is a pure, source-only constructor for fresh
customer observations. It does not read Shopify, claim a cycle, grant authority,
register a run, publish a report or enable recurrence.

The unchanged source reader is `readCustomerScopedPurchases`. The existing
September pair envelope remains supported unchanged. Fresh cycles use a
separate `b1-cycle-customer-source-only-v1` envelope and must never copy that
pair's bundle provenance.

## Capture contract

The compiler accepts:

```ts
{
  source,
  cycle,
  identityReceipt,
  sharedUsage,
  definition: {
    definition: SCOPED_CUSTOMER_DEFINITION,
    businessEvidence: SCOPED_CUSTOMER_BUSINESS_EVIDENCE
  }
}
```

It returns `{ packetJson, binding }`. Pass those exact values to
`consumeScopedCustomerPurchases` with targets derived from the same-cycle
native commerce sources. Preserve `packetJson` bytes without reformatting or
appending a newline. The binding hashes that exact string.

The cycle fields come from the actual claimed source cycle:

- UUID `cycleId`, `grantId`, decimal-string `grantRevision`.
- `projectRef`, `shop`, `reportDate`, actual `startedAt`, absolute `deadline`.
- Existing `authorizationRef`, actual app and installation IDs.
- `sourceReaderSha256`, `sourceReaderEmissionSha256`, `captureClosureSha256`.
- Fixed customer budgets `maxRequests=65`, `maxResponseBytes=1048576`,
  `maxTotalBytes=16777216`, `maxActiveMs=120000`.

The source reader's source-file SHA is pinned to the unchanged reviewed reader.
The two emission pins must come from the final compiled capture manifest.
The capture owner compares the actual emitted files before execution; the
source-cycle grant and registration pin those same hashes. This pure compiler
cannot authenticate a caller's self-consistent metadata or invent missing pins.
It rejects the old pair bundle digest in either fresh emission field.

Grant revisions remain strings, including values above JavaScript's safe
integer range. The compiler rejects numeric revisions, nonpositive values and
values beyond PostgreSQL bigint.

The source cycle uses its own claim/deadline, even if its UUID links to an
already completed advertising cycle. The Google native lease is not a customer
read deadline.

## Identity receipt without another request

The capture wrapper records the first existing
`CUSTOMER_PURCHASE_ACCESS_QUERY` exchange inside the source reader. The
unchanged reader already counts this request. Do not add a standalone identity
query or a fictitious `+1` request.

Retain only actual exchange start/end, raw query/request-body/response-body
SHA256, HTTP status 200, API version, observed shop/app/installation and five
scope booleans. The four existing read capabilities must be true. The
`write_orders` boolean is an observation, not write authority.

The query hash is SHA256 of the raw query string. The request-body hash is
SHA256 of the reader's exact `JSON.stringify({query, variables:{}})` body.
The response hash must be computed from the actual response bytes, not from a
reconstructed object.

Fresh `bindingSha256` is the canonical digest of the exact cycle object;
fresh `identitySha256` is the canonical digest of this receipt. The distinct
envelope kind identifies these semantics. The original pair's file-hash
semantics are unchanged.

## Limits and secret handling

Customer usage records actual `requests`, `responseBytes`, `activeMs` and
`largestResponseBytes`. This includes the existing access preflight.
The source reader's plan remains at most 64 requests; actual shared customer
usage can be at most 65. No extra allowance is created by packet construction.

The reader itself has an 8 MiB per-response safety cap. The outer capture
transport must enforce the stricter cycle-bound 1 MiB cap while streaming,
record the largest actual response, and cancel on excess. Total customer
response consumption is at most 16 MiB, with at most 120 seconds active time.

The entire source-cycle claim has one absolute deadline at most 300 seconds
after its start. Every subread uses the lesser of its local cap and that same
remaining deadline. The original-order capture owns a separate 20-request
sub-budget; it is not silently folded into or added again to customer usage.
Two independent locator requests plus the original and customer sub-budgets
give the source capture's declared maximum of 87 requests. Advertising capture
uses its separately completed preceding cycle.

The capture wrapper, not this credential-free compiler, must enforce its
approved RAM-only credential transport and refuse secret reflection before
persisting any packet. Do not pass a token, raw identity response or profile
data to the compiler.

## Fresh originals and scope

The initial fresh schema requires `retainedSourceReceipts=[]` and every source
document's hydration to be `read`. This avoids relabeling old asset envelopes
as same-cycle sources. The capture owner compares fresh customer-anchor
document digests with its native original-order sources. A future retained
fresh-original optimization needs its own truthful receipt contract.

The unchanged consumer rechecks source/target ownership, revision, capture and
document hashes, complete member inventories, original purchase arithmetic and
the existing business-definition pins. It preserves returning conclusions with
unknown exact first dates.

All output remains source-only, unregistered, disabled and unaccepted. No
whole-day customer coverage, cohort, LTV, browser permission or completed
customer generation is created. Any independently complete paid-day composition
belongs to the separate event-window reporting boundary.

## Proof boundary

Focused tests exercise the actual unchanged reader with a finite synthetic
transport, derive the receipt from its first real mock exchange, compile the
new envelope and invoke the actual consumer. They verify eight reader requests
remain eight shared requests, separate emission provenance, bigint revisions,
identity/capture/budget refusals and disjoint envelope branches.

The legacy consumer tests retain the exact private pair result digest. No
actual fresh cycle, identity receipt, emission pin, operating grant or provider
read is supplied by these tests.
