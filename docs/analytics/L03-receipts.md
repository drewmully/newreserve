# L03: durable analytics receipt boundary

Adds a disabled-by-default Shopify analytics-only webhook endpoint. Exact-body
HMAC and shop/topic checks precede persistence. An atomic PostgreSQL function
creates a restricted receipt and its warehouse work intent in one transaction.
Transport delivery ID is distinct from source business identity. Reusing a
delivery ID with different content fails closed.

The new endpoint does not call existing order, fulfillment, email, billing or
advertising handlers. Existing subscriptions are untouched. Database failure
returns 503 so the sender retries; acknowledgment follows durable commit only.

## Before activation

Apply reviewed 001 and 003 SQL in a disposable Supabase project; verify the
server-only service_role grant and anonymous denial. Provision the explicit shop
allowlist and webhook secret through deployment secrets, never PR content.
Customer approval is needed to enable `LEAN_ANALYTICS_RECEIPTS_ENABLED` and add
the separate webhook subscription. Exercise a signed test delivery, invalid
signature, duplicate, response-loss and database outage first.

Raw receipts are restricted and not exported to PostHog. Retention/erasure
policy, encrypted storage, maximum actual payload size and receipt cleanup need
owner sign-off before collection. Tests use only synthetic payloads.

PGlite tests prove SQL transaction rollback and deduplication. Its serialized
in-process engine does not establish multi-connection production contention;
repeat overlapping deliveries against test Supabase before activation.
