# Meta hourly spend for New York reporting

This is an additive P6 input version, not a new reporting pipeline. Version 1
retains its original New York account-day checks. Version 2 supports USD spend
from an `America/Los_Angeles` account through independently captured campaign
and account hourly Insights responses. No formula, full-report job, current SQL
input wrapper, finish function or Google-only path changes.

## Source contract

`metaHourlyPacketFromCaptures` consumes three retained native Graph v25 HTTP
receipts. It makes no request. The receipt records GET URL, exact parameters,
HTTP status, request clocks, body size, body SHA256 and parsed response.
Its evidence digest identifies the retained receipt. It does not authenticate a
receipt supplied by an untrusted caller or reconstitute the original body bytes.

1. Account metadata must identify the exact `act_` account and numeric account ID,
   USD, `America/Los_Angeles`, active status and a fresh capture.
2. An unfiltered campaign query requests `account_id`, `account_currency`,
   `campaign_id`, `date_start`, `date_stop`, and `spend`.
3. A separate unfiltered account query requests those fields without
   `campaign_id`. This is the independent amount control, not a total computed
   from campaign rows. Optional returned clicks and impressions do not enter
   the spend contract.

Both Insights queries use `time_increment=1` and
`hourly_stats_aggregated_by_advertiser_time_zone`. Their requested provider dates
must exactly cover the local dates enclosing the NY day. The collector requests
49 account rows or 1001 campaign rows as overflow sentinels. The adapter accepts
at most 48 or 1000 rows and one exhausted page per query. Any `paging.next`
requires another bounded capture strategy; this adapter refuses it rather than
silently discarding a page.

For NY September 29, 2026, the window is
`2026-09-29T04:00:00Z` through `2026-09-30T04:00:00Z`, end exclusive.
The provider query covers September 28 and 29 Pacific. The selected buckets are
September 28 at 21:00 through September 29 at 20:00. Both complete query dates
must be closed before either Insights request starts. A response finishing after
close is not enough. Request starts and window boundaries retain microseconds.

The adapter maps each advertiser-local hour to UTC, then selects the unchanged
NY window. It reconciles account and campaign amounts for every returned hour,
including hours outside the selected NY day. It refuses duplicate or malformed
hour labels, daily aggregates, account/currency drift, filters, overflow,
incomplete responses and disagreement. Decimal strings use integer micros.
DST-transition provider dates are explicitly unsupported because the native
hour label cannot distinguish a repeated local hour. No fixed three-hour offset,
proration or daily timezone relabeling is used.

## Empty response means no activity only with native completion

A successful unfiltered native Insights response with `data: []` and exhausted
paging represents no delivery in that requested scope. Both independent queries,
the account metadata and their exact date bounds must pass. The adapter then
sets `verifiedEmpty` on the source and control and emits the existing verified
empty account-day fact with zero spend. It does not invent campaign or hourly
source rows.

The earlier flattened MCP `ad_entities: "[]"` response lacks this receipt and
cannot pass the native receipt adapter. Missing `data`, errors, continuation,
partial input or unsupported queries do not become zero.

The fact keeps `source_timezone=America/Los_Angeles`,
`source_currency=USD` and `report_date` in New York. `spend_usd` is the amount
in the reconciled interval. Clicks, impressions and click definition remain
null. Google delivery metrics keep their existing separate scope.

## Default-off registration

`prepareMetaSpendRegistration` validates either version and selects
`lean_marketing_spend_hourly_register` only for version 2. The new private SQL
adds that owner-only function. It does not edit the installed version-1
registrar, tables, grants, current input/finish chain or runtime behavior.

The successor stores the original hourly source, independent control, query
scope and window as one immutable packet in the existing P6 table. Registration
is disabled by default. Existing bindings pin its hash. Existing current input
reads the stored packet and both capture clocks under the same locks; finish
rechecks the same input hash. TypeScript rejects invalid reconciliation before
any report finish. Registration alone does not certify an amount or authorize
activation.

The raw SQL is a review artifact. It refuses absent or mismatched dependency
pins through `lean.meta_hourly_install_contract`. A production installation
still needs the parent's fresh whole-catalog preservation checks, exact
provider-owned transaction wrapper, deadline, readback and approval. It is not
a ready-to-dispatch installation packet.

## Workbook and other owners

The combined path still needs a fresh native Google base, independent Google
controls, the approved two-account inventory, and independent whole-fact
reconciliation. Meta source preparation does not manufacture those inputs.
MER additionally needs compatible eligible sales; nCAC needs compatible complete
new customers. First-party ROAS still needs permitted deterministic session
entry and purchase linkage. None is inferred from Meta platform conversions.

B1 owns commerce, cash and customer history. B6 owns Google saved-generation
succession. This change touches neither. B6 does not acquire fresh Meta controls
or renew Meta bindings; that remains an operating input requirement.

Klaviyo account `SuHCxv` has retained Shopify order and checkout copies, but the
approved 21-metric workbook has no independent email send/open metric. Those
copies are supplemental reconciliation or identity evidence for the owning
commerce/behavior lanes. This adapter does not count them as additional orders,
spend, lifetime history, permission or first-party attributed revenue. It adds
no Klaviyo formula and needs no Klaviyo request for the spend input.
