# L10: governed daily campaign spend

Implements campaign-grain Google response normalization, bounded complete
pagination, exact micros conversion and provider-neutral base selection.
Independent approved account/day expectations distinguish missing data from
verified zero. A later complete lower-spend report replaces the old report:
neither sum-all-snapshots nor max-spend semantics are used.

Reporting amounts require actual account timezone America/New_York and USD.
Optional click/impression metrics remain null when absent. A newer partial run
leaves the previous complete base explicitly stale, not fresh.

The existing account-level cron and native PostHog spend event mirror are not
silently repurposed. Bind the paginated adapter to a verified supported Google
Ads API version, customer metadata, approved account inventory and campaign/date
query. Compare independent account/day totals before replacing the old path.
No credentials, API version, source timezone or field approval is guessed here.
Meta remains a separate conditional adapter outside this series.
