# Google Ads source adapter

The fixed-query reader uses REST v25 and real account metadata. It preserves
integer cost micros, account/campaign/day keys, source currency and timezone.
All pages must finish within an approved limit (at most 10 pages); partial
results are never returned as a complete base. A valid empty response requires
the expected field mask. A missing or malformed response is not zero spend.

The existing operational spend cron and its PostHog `ad_spend_daily` mirror are
unchanged. This source adapter does not regard that mirror as authoritative.
It does not create ads, change budgets, activate a schedule, or run a live query.

## Authentication and current API

Google's [developer-token sunset guide](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
states that developer tokens were sunset September 9, 2026 and API access now
follows the Cloud project behind the OAuth credentials. The new adapter uses
Bearer OAuth and optional manager `login-customer-id`, not a developer token.
The older [REST authentication page](https://developers.google.com/google-ads/api/rest/auth)
still includes token examples; the dated migration guide takes precedence.
Verify the customer's OAuth Cloud project has production access before testing.

The [REST search contract](https://developers.google.com/google-ads/api/rest/common/search)
documents v25 and `nextPageToken`/`pageToken`; the reader keeps the exact query
unchanged across pages and does not send a custom page size.

## Readiness boundaries

- The account/day inventory must be approved independently of returned rows.
- USD/New York accounts can supply daily USD metrics. Other account currencies
  and timezones remain visible as source evidence but their USD metrics are null.
- Only closed source-account days may be requested.
- Pagination completeness is not reconciliation or freshness certification.
- Migration 019 and `POST /api/analytics/ingest/spend` wire credential refresh,
  bounded reads and a fenced, immutable retained base. The full report runner
  must still consume and reconcile these bases before certified publication.
- Confirm account access, expected inventory, freshness threshold and approved
  testing spend; no live call has been made to establish these.

## Registered job setup (not executed)

An operator inserts one `lean_private.spend_jobs` row per approved account/day
and revision, including target project, optional manager ID, max pages, approval
and actor references. Rows default to disabled and scopes cannot be edited.
Use a new run for a refreshed provider revision; never overwrite a retained base.

After approval, set the explicit analytics database configuration and
`LEAN_ANALYTICS_PIPELINE_PROJECT_REF`, `LEAN_ANALYTICS_SPEND_RUN_ID`,
`LEAN_ANALYTICS_SPEND_SECRET` (at least 32 characters), and the three
`LEAN_GOOGLE_ADS_OAUTH_CLIENT_ID`, `LEAN_GOOGLE_ADS_OAUTH_CLIENT_SECRET`,
`LEAN_GOOGLE_ADS_REFRESH_TOKEN` secrets in the customer's runtime secret store.
Enable the exact job and `LEAN_ANALYTICS_SPEND_ENABLED=true`.
An authenticated empty-body POST processes that saved scope, never URL inputs.
There is no new schedule; up to three attempts can acquire a 120-second lease.
Disable the flag/job to stop, and check stored state before retrying an ambiguous
response. Finishing a base never certifies or selects a reporting publication.
