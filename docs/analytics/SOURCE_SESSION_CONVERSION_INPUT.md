# Session and conversion readout

The existing authenticated `POST /api/analytics/ingest/full` caller returns
`visitorConversion` after `lean_full_finish` succeeds for a behavior-required
build or a validated source-session sidecar. Busy, failed and changed builds do
not return that readout. Google-only behavior-excluded builds keep their existing
response shape. This adds no tracking, source request, environment write or grant.

`runSourceSessionReport` performs the bounded claim, authority/native/authority
reads and immutable registration. The registered input wrapper supplies the
packet to `runFullReportJob`; `buildFullReports` recomputes its correspondence.
The builder then generates the readout from its final session/order facts and
canonical funnel rows. The readout does not alter persisted facts, reports,
five-field manifest, certification or publication selection.

## What the numbers mean

- `entryInventory` separates native observations, included sessions, known
  exclusions and unknown permission/association. It is not a unique visitor count.
- `measuredSessions` copies the canonical all-sessions metric. A complete empty
  native population can produce zero. Unresolved eligible coverage remains null.
- `knownPaidLinks` counts only eligible, evidence-linked paid orders in the
  registered base and their distinct eligible sessions. Payment must fall after
  the session start and strictly before the configured window ends. It uses
  `paid_at`, never order creation or webhook processing as a substitute.
  Multiple orders for one session count as one linked session. Zero means no
  verified positive link in the supplied facts, not no purchases in the store.
- Mature and converted counts and the rate copy the existing canonical funnel
  gates. Positive links alone never produce a rate. A withheld rate remains null.
- Unique visitors remain unavailable without an admitted visitor identity.
  Session IDs, customer IDs and email marketing permission are not substitutes.

All values remain observed and unverified. The response contains dates and
aggregate counts only, with no visitor, session, customer or order IDs. Known
test exclusions already applied by source filters and commerce eligibility stay
excluded. This is reporting, not permission to start visitor capture.

## Exact live acceptance still needed

The retained source-session SQL and hooks are a separate default-off successor.
Install its reviewed SQL before the optional Meta wrapper so each wrapper keeps
the entire previous function chain. The independent Meta bridge is not a B1
sales-event capture cycle; do not bypass source-session paired authority to bind
it. A separate cohort target requires a genuine completed base for that date.

For sessions, bind a finite owner report claim and current source authority,
verify the new whole-day native query with the dedicated key and private fixed
six-filter configuration, then perform one bounded registration and full run.
Inspect the persisted funnel and returned accounting. One-entry setup proof does
not prove the new whole-day query. Unknown authority or a missed visitor binding
stays unknown; do not fabricate historical consent or redefine the population as
successful receipts only. Source v1 admits no actions or paid population.

For complete conversion, actual independent successful-transaction evidence,
exact checkout/session relations, complete eligible payment membership through
each entry's seven-day window and the 48-hour arrival coverage are still needed.
The existing positive-link helper and known-order reads cannot establish missing
population or delivery completeness. This change therefore does not claim a
complete conversion rate from source v1, or whole-store coverage from selected
orders. No capture or paid-source successor is silently enabled.

These reporting gaps do not themselves block turning ads or emails on. They
limit measurement and campaign attribution. Acquisition approval and its own
delivery checks remain separate from acceptance of these metrics.
