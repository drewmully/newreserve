# Prospective source-session reporting

This is a separate default-off policy, `source-session-runtime-v3`. It leaves the v1 and Reserve cart-v2 implementations unchanged. It adds no PostHog event family and does not initialize, identify or reset the PostHog SDK.

## Concrete route

1. `/analytics-session-preferences` presents the new explicit site-session and checkout choice. It does not upgrade an earlier Reserve choice. Its decision endpoint sets a separate HTTP-only `__Host-mully_source_session` cookie only after the exact v3 Allow.
2. `SourceSessionNavigation`, mounted once in the layout, reacts to real path/search navigation. With the public flag off or SDK uninitialized it does nothing. Otherwise it checks the current server-side v3 choice before reading and sending the existing SDK's read-only native session ID. There is no client entry timestamp, URL, customer ID or campaign payload. The Allow handler never calls this collector.
3. `/api/analytics/source-session/bind` checks same origin, a 1,024-byte request cap, the existing 60-per-minute IP rate gate, current v3 policy, GPC/DNT, grant lifetime and removals. For a new native ID it queries only that UUID in project 353503 during the grant interval. It requires one native source row, exactly one entry event at the native start, and six server-evaluated predicate results. The 2.5-second request, 65,536-byte response cap, fixed columns and two-row overflow limit fail closed. The receipt stores the verified UUID/start, response digest, filter digest/results and server capture clock. Identical confirmed retries reuse that receipt without another provider read. A different grant claiming the native ID is quarantined. The browser assertion is still not proof of customer identity.
4. The existing membership Storefront checkout makes a separate auxiliary v3 cart call. The route verifies the actual returned cart using the fixed shop's Storefront API, signs the native session context and rechecks authority after I/O. Its table is separate from the v1/v2 cart table. No prior navigation binding means no receipt. A failed auxiliary call never prevents the purchase redirect.
5. Immediately after the existing `orders/paid` route's HMAC check and before its business duplicate return, the v3 helper re-verifies the original body with the owner-pinned LEAN secret, checks the fixed shop/topic headers, numeric/GID agreement, paid financial state and root cart token, then calls the v3 receipt RPC. It records only a known Storefront-verified v3 cart under unrevoked authority and its immutable later-order deadline. Identical retries are idempotent; conflicting order/cart/delivery/digest evidence is quarantined. Failure emits a fixed diagnostic and does not abort existing paid-order processing.

Shop and topic headers are checked against the configured target; they are not falsely described as signed by the body's HMAC. The activation record must bind the secret fingerprint to this exact Shopify configuration. The later independent order read remains necessary.

## First-visit timing is not rewritten

The native session will normally have started before Allow. That session is rejected before a binding receipt is created. Its entry stays unavailable for the new entry cohort. No SDK reset, artificial entry event or backdated grant fixes that.

Permission lasts at most 24 hours and can cover a later natural session. The page says this explicitly and shows the returned expiry after Allow. Actual TTL and policy cutoff remain unbound. A TTL too short to span a later native session can produce no eligible new entry. The tests cover this counterexample; a working collector is not a promise of a nonempty accepted cohort.

Only new session/cart capture uses that short grant interval. The new explicit choice separately permits matching an already-authorized checkout to a later order. Each native binding stores an immutable deadline of its independently verified source start plus 216 hours. Independent payment evidence must show payment before start plus seven days; the extra 48 hours permits receipt arrival only. A late payment does not qualify. Current withdrawal or removal stops matching even before this deadline.

The HTTP-only preference cookie remains through grant expiry plus nine days so withdrawal remains possible after new capture expires. This does not extend new session/cart permission. Allowing again after capture expiry first withdraws the old choice, then issues the new one. No earlier grant silently survives behind a replaced cookie. The UI explains this replacement and the later-order scope.

## Independent read and builder boundary

`lean_source_session_receipts_read(from, until)` is a fixed-project, service-role-only bounded read with a 10,001-row overflow sentinel. It returns the exact native ID, server binding clock, current removal/conflict state and the existing grant interval/lineage, never bearer hashes. It does not certify population completeness.

`admitSourceSessionReceipt` requires the independently read native ID, source start/end, unique entry-event UUID, exact native entry-event session ID and timestamp, plus fresh source/authority references. No match, ties, pre-Allow starts, post-expiry starts, removal or conflict yields unavailable. Eligible records provide the existing `sessionEntryInput` entry/relation/permission types. They remain anonymous; no canonical customer is inferred.

The source read uses native `events.$session_id`, not `properties.$session_id`. Native sessions and their exact start-event relation exist in the provider schema. The current six-filter digest is `61504f7e32de2ff2d4197a26e25ba57f412891b9c03e6d27b3ef7568e3829819`. Parent's actual typed-provider diagnostic established that email `is_not_set` passes all five exact negative person filters, with controls showing the predicates were applied. It did not establish entry-cohort coverage or historical permission. The new query preserves this missing-email behavior, keeps missing host unknown, and uses JSON type guards so malformed non-string properties cannot silently become pass. Only boolean, numeric zero/one or null predicate results are parsed. Fresh read-side entry flags must exactly match the retained receipt; a changed or malformed result is unavailable. The current definition is not presented as a historical configuration revision.

The bounded native query itself has not been executed against the provider by this change. Its JSON type guards, aliases and response format require the consolidated setup's guarded source verification before activation. A provider compile/shape failure yields no receipt. No new owner filter definition is needed. The full-report hook remains the separately reviewed optional f60a entry path; this delta does not register a source, fill owner evidence or schedule a reader.

`lean_source_session_paid_read(orderGids)` returns up to 100 exact known order receipts, signed cart context and current removal/conflict state. `sourceSessionPaidEvidence` verifies that context at its original cart-capture clock, requires the admitted native entry and the exact independent commerce order, and then produces the existing checkout evidence type. `orders.paid_at` must come from the independent successful-transaction source. The helper rejects an earlier or out-of-window payment, late receipt arrival, mismatched order, missing payment clock, invalid signature or removed/conflicted record. Neither the grant's original expiry nor the signed cart's original expiry is repurposed as a payment clock.

The webhook stores `order_created_at`, `order_processed_at`, `order_updated_at` and its own `received_at` separately. There is deliberately no webhook-derived `paid_at`. No raw payload, email, phone, address or customer profile is retained in the new tables. A payload SHA-256 records byte identity, not the source body.

## Default-off activation boundaries

Install only after review, in this order:

1. Existing authority/decision/runtime policy prerequisites and reviewed Reserve cart-v2 SQL.
2. `proposed_journey_source_session_policy.sql`.
3. `proposed_source_session_paid_receipts.sql`.

Neither file inserts a policy or enables a flag. The exact operator batch still needs:

- `LEAN_ANALYTICS_SOURCE_SESSIONS_ENABLED=true` and the separately built `NEXT_PUBLIC_LEAN_SOURCE_SESSIONS_ENABLED=true`.
- Existing fixed Production/main analytics DB credentials and target, not a legacy enable flag.
- The fixed v3 policy row, actual approval reference, TTL and valid-until cutoff, with its source capability explicitly enabled. Actual values are UNSET in this patch.
- The real `LEAN_SHOPIFY_WEBHOOK_SECRET` and `LEAN_POSTHOG_QUERY_READ_KEY` fingerprints in the owner-bound policy row. Values never go to the browser or receipts. Missing/wrong fingerprints disable v3, including Allow. There is no generic secret fallback. Parent observed Production LEAN webhook metadata and a generic PostHog personal-key candidate; actual project/scopes/value fingerprints remain unverified. Preview metadata is not Production authority.
- One server-only `LEAN_POSTHOG_TEST_ACCOUNT_FILTERS` JSON array from the privately retained current project settings. It must have exactly six rules in the reviewed order, each with ordered keys `key,type,value,operator`: one event `$host` `not_regex` rule, followed by five person `email` `not_icontains` rules. The canonical `JSON.stringify` digest must equal the fixed digest above. There is no alternate digest, rule set or generic fallback. Missing, malformed or mismatched configuration disables v3 Allow and source reads. Actual values belong only in private setup/proof, never public code, test fixtures, docs or logs.
- The fixed shop's actual `LEAN_SHOPIFY_STOREFRONT_TOKEN` and a signing secret of at least 32 characters for verified cart context. Missing values withhold cart linkage rather than blocking commerce.
- The actual current filter definition, provider-evaluated predicate results, native source/authority read references, mapping/session versions, independent entry completeness and exact native lineage for any accepted count.

The configured cutoff must cover the intended capture and later-order receipt period. An earlier cutoff safely stops writes, but it does not prove a complete conversion cohort. Current values remain UNSET. No secret copy or setup operation is part of this patch.

Keep v1/v2 flags and policy rows unchanged. Withdrawal reuses the existing authority removal and conservative export fence; it does not claim downstream deletion is complete. Withdrawal remains callable with v3 disabled or its policy expired.

## Acceptance and nonclaims

Focused tests use synthetic inputs and local PGlite only. They cover explicit v3 choice, no old-cookie upgrade, zero-Reserve-action navigation, retained-source retry caching, source byte/row/shape limits, wrong grants, removal/expiry, same origin, SDK unknown, signed cart verification, HMAC/shop/topic/GID/digest failures, safe auxiliary failure, source start before consent, short TTL, immutable deadlines, post-capture-expiry matching, withdrawal after expiry, and distinct payment/arrival clocks. The local late-order tests shift a synthetic graph under fixture-only disabled triggers, then restore every guard before exercising the real RPC. This is not an implementation or authorization for historical repair. Old SQL function bodies and ACLs are compared unchanged.

No live browser, provider, SQL, policy, cookie or flag action was performed. Native PostgreSQL concurrency, actual source delivery, native filter parity, a real prospective permitted session, a real paid order, source completeness and matured conversion remain unverified. No purchase is required or made by these tests. Campaign attribution stays unavailable until native entry context is separately admitted; the 90-day stored attribution blob is not used.
