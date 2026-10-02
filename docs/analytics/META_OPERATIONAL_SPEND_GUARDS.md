# Operational Meta spend collection

The operational cron reads one configured Meta ad account. It is not the native
LEAN spend collector and does not certify all marketing spend, MER, nCAC or
first-party ROAS.

Before either spend table changes, the reader now requires:

- An exact account identifier without surrounding whitespace. A stored identifier
  ending in a newline is rejected, not silently trimmed into a new snapshot key.
- Provider account metadata matching that ID, USD and `America/New_York`.
- Exhausted pagination for both account/day and ad-set/day reads.
- At most 25 pages and 1,000 rows per read, 51 requests including account metadata,
  1 MiB per response, 32 MiB total and a shared 90-second source-read deadline.
- Nonnegative decimal spend representable in cents, explicit integer click and
  impression counts, same-day dates inside the requested range and unique keys.

Provider pagination URLs are checked, but never fetched directly. The next
request uses the same account, fields and date range with the returned cursor.
Tokens travel in the authorization header, not the URL. Source failure messages
do not include provider response bodies.

An explicit returned `spend="0"` is retained and can replace a previous positive
daily value. A missing row is not zero. Job metadata records omitted dates and
the observed account timezone/currency, with all-marketing completeness false.
Each retained source result also records its collection time. The legacy
`created_at` column is not a reliable last-refresh clock for an upsert.
An empty page with `next` continues within the same fixed limits; reaching a cap
with more pages fails without writing either source result.

This change does not make the two database upserts atomic. A later database
failure can still leave the first upsert recorded. The existing job log and
snapshot-error behavior remain in place.

The request window still follows the legacy UTC date selection and may contain
the current open day. It must not be treated as a closed, final source generation.
No historical missing day is backfilled, and existing stale positive rows are not
deleted when the provider omits a date.

## Existing account-key issue

The October 2 discovery found retained snapshots keyed by
`act_2796962933960445` plus a trailing newline. This proves the historical stored
key, not the current environment value or provider's returned account identity.
Do not normalize those rows or change the production configuration as part of
this patch. A future canonical-key change needs a separate duplicate/rewrite
decision because the snapshot conflict key includes the account ID.

## Acceptance still outside this change

The Meta connection was unavailable for a fresh provider read during preparation.
Focused tests use synthetic transport. Verify the current provider's account
metadata and paging format before any approved rollout.

The existing PostHog operational mirror uses a max-based refresh convention.
A lower revised amount, including an explicit zero, cannot be accepted from that
mirror without checking the actual query and replacement semantics. It is also
the same source pull, not an independent control.

The native workbook still needs approved provider/account inventory, independent
controls, one immutable compatible generation and report/destination reconciliation.
No claim of analytics completeness comes from an operational `ok` job.
