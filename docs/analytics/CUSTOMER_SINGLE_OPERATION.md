# One finite customer read

`captureSalesEventCustomers` accepts either an existing `cycle` or a new
`operation`. It rejects both together. The operation branch uses the same
customer reader, exact paid-original membership, revision comparison and
customer consumer. It does not create a cycle grant, Google dependency,
controller, schedule or HTTP endpoint.

`CustomerSourceOperation` binds the actual operation UUID, approval and actor
references, processing authorization, project, shop, closed reporting day,
absolute start/deadline, expected app and installation, and verified emitted
reader/closure hashes. The operator supplies these from its real approval and
capture. The compiler cannot establish their authority from strings alone.
An unset approval, extra grant fields or a legacy bundle hash refuses before
the first customer source request.

## Existing call path

1. Retain complete sales-event and independent paid-date controls for the
   reporting day. Determine the actual union of original order IDs. This is
   not a created-date inventory or a whole-store history export.
2. Obtain complete same-revision financial originals with the customer-ID-only
   projection. Do not infer guests from missing customer data.
3. Call `captureSalesEventCustomers({source, operation, accessToken, fetcher})`.
   The token stays in the operator's RAM. The returned packet contains only
   the approved financial/customer-ID projection and provenance.
4. Bind the returned `customers` into the unchanged source with
   `bindSalesEventWindow`. Call `prepareSalesEventWindowReport`. Neither this
   compiler nor `prepareSalesEventWindowRegistration` requires advertising
   captures. Do not use the combined `prepareSalesEventCycle` for this path.
5. Registration is separate and default-off. It needs actual current report
   authority. This helper never registers, enables or publishes a report.

The operation preserves the existing limits: at most four customer members,
100 visible orders per member with exhausted and rechecked pagination,
64 reader requests inside 65 actual shared requests, 1 MiB per response,
16 MiB total, 120 seconds active and the remaining part of one absolute
deadline no longer than 300 seconds. The identity preflight is counted once.
Budget exhaustion refuses the packet. A finite operation is not renewed
automatically and cannot reuse an old source capture as a new revision.

## Reporting meaning

An earlier eligible purchase can prove returning without claiming an exact
first purchase. First-observable requires the complete current visible member
inventory and known product eligibility. Unrecognized products or missing
ownership remain unresolved. Product classes, original purchase clocks,
removal uncertainty and browser permission behavior are unchanged.

The customer packet remains source-only. The existing report compiler may
compose its selected conclusions with independently complete paid-day
membership. It does not turn the packet into whole-store history, a customer
generation, LTV, a mature cohort or visitor identity. Without a customer packet,
supported sales still compile and a nonempty day's customer count remains null.

## Focused validation

`analyticsLeanCustomerScopedPurchaseOperation.test.ts` exercises the real reader
with synthetic HTTP responses, then capture, consumer, full report and disabled
registration without Google or Meta. It also tests pre-read authority refusals,
source/identity changes, budget undercount and missing-customer behavior.
Existing cycle and historical-consumer tests cover unchanged branches. Synthetic
tests do not establish a completed live read or production admission.
