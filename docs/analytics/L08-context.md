# L08: consent-aware collection and bound checkout context

Adds a browser-safe allowlisted event builder for Reserve reveal, Style Game
completion and Text Mully activation/checkout. One server-recorded activation
must reuse one event ID across retries; the helper does not claim to establish
that record itself. No phone, message, profile, arbitrary URL or free-text
properties are accepted. Auxiliary capture failure cannot abort checkout/SMS.

Server-only signed context binds project, shop, checkout and a server-known
anonymous/authenticated subject with an explicit bounded TTL. Different
checkout/subject replay, altered data, expired/future tokens and revoked consent
are rejected. Repeating the same valid token for the same checkout is allowed:
downstream event/business-key deduplication prevents additive counting.
The token proves context integrity, never identity or ownership.

## Wiring and preview tests still required

No existing journey or checkout handler imports these helpers yet. Review each
actual caller, consent source, server binding, key rotation and checkout metadata
transport before integration; do not mint a token from arbitrary client-supplied
customer IDs. Add calls only after preview tests for authenticated, anonymous,
declined-consent, cross-user, ad-blocked and offline flows across all three
journeys. Confirm Text Mully activation corresponds to durable activation rather
than a button click. No production tracking has been enabled by this PR.
