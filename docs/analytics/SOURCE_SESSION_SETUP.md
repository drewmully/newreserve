# Bounded native-source setup check

This separate operator diagnostic does not issue a visitor grant, collect an event, write credentials, activate capture, run a reporting pipeline or prove historical consent. The visitor runtime remains dedicated-LEAN-key-only.

## Why a separate operation

The existing full/refresh endpoints run publishing pipelines. They are not dry-run key probes. The new visitor bind endpoint requires genuine current visitor authority. Neither path should be repurposed to test an existing historical source row. Connector SQL proof establishes query compilation and a projection, but not the raw HTTP envelope or a particular Production key's access.

`POST /api/analytics/source-session/setup-check` therefore has its own default-off enable flag and one-use database claim. It accepts only `{"phase":"source"}` or `{"phase":"copy"}`. It rejects caller IDs, SQL, query arguments and bodies over 64 bytes. A 64-hex-character bearer token authenticates the owner claim by SHA-256. The existing rate gate allows three requests per minute per IP; the database claim is the durable one-use bound.

## Owner pins, all unset until separately approved

- `LEAN_SOURCE_SESSION_SETUP_ENABLED=true` and `LEAN_SOURCE_SESSION_SETUP_CLAIM_ID` naming the exact claim.
- Fixed Production/main analytics DB target and existing service-role credentials.
- One owner-inserted `source_session_setup_claims` row. The table fixes project reference, PostHog project 353503, the Oct1 NY source interval, and reviewed filter digest. The owner supplies one genuinely retained native session UUID and a fresh bearer-token digest. The claim has an immutable expiry no more than one hour after creation and can be revoked but not extended or reopened.
- The exact private `LEAN_POSTHOG_TEST_ACCOUNT_FILTERS` configuration already required by the hygiene successor.

This SQL file creates no claim or flag. Do not put the actual UUID, token, key or filter values in source code, public tests, docs or logs. Installing the SQL and creating/activating a claim are separate operations.

## Source phase

The app commits `lean_source_session_setup_begin` before any provider request, consuming this claim's one source attempt. Any failed, timed-out or ambiguous attempt remains consumed. It then uses the explicitly selected existing `POSTHOG_PERSONAL_API_KEY`, with `POSTHOG_PROJECT_ID` exactly `353503`, through the app's normal outbound environment. There is no credential transfer through an unrelated sandbox origin.

The shared source-only projection uses the unchanged fixed one-UUID SQL, 2.5-second timeout, 64 KiB response cap, exact 11-column/raw-row parser, unique start event and six predicate flags. This diagnostic expects the six true flags already observed for the pinned retained entry. It does not fabricate a qualifying visitor. The original visitor wrapper supplies only `LEAN_POSTHOG_QUERY_READ_KEY`; it still receives the real grant interval from the unchanged binding authority checks.

After I/O the app rechecks current candidate key, project, private filter configuration, claim selection, enable flag and deadline. The finish RPC rechecks the locked owner claim and current revocation/expiry. It saves only key fingerprint, bounded response digest, six booleans and capture clock in an immutable setup proof.

The successful response contains exactly:

```json
{
  "state": "verified",
  "phase": "source",
  "project": "353503",
  "keySha256": "SHA256_OF_EXACT_KEY_UTF8_BYTES",
  "projectionSha256": "SHA256_OF_RAW_BOUNDED_PROVIDER_RESPONSE_BYTES",
  "filterResults": [true, true, true, true, true, true],
  "capturedAt": "SERVER_UTC_CAPTURE_CLOCK"
}
```

This sample is a field contract, not a receipt. No key is trimmed or normalized for its fingerprint. `projectionSha256` is not the query-string digest. No native ID, entry ID, contact/property value, token, raw response, parser error or configuration value is returned. A failed operation returns only unavailable and its phase.

## Dedicated-copy phase

After an actual successful source receipt, a separately approved parent operation may create the absent Production `LEAN_POSTHOG_QUERY_READ_KEY` from those exact existing candidate bytes and bind `LEAN_POSTHOG_PROJECT_ID=353503`. The app does not copy or write environment values. Metadata presence alone is not success.

The parent then invokes the same claim with `{"phase":"copy"}` before expiry. The app hashes the current dedicated key and compares its fingerprint, dedicated project ID and fixed filter configuration to the saved server-side source proof. This phase makes no provider request. It has its own one-use copy record. A mismatch is consumed rather than silently retried. The app postchecks current environment and the returned private claim deadline before reporting verified. A key or config changed after the DB comparison does not produce a verified HTTP result.

The copy response has the same safe fields with phase `copy`. It is a point-in-time comparison, not a claim that future environment values cannot change. Later visitor capture still needs its own policy, key fingerprints, voluntary choice and permissions. If the source result was ambiguous, the parent must not invent a receipt from metadata or a stored row count.

## Parent-only saved-proof readback

The parent may bind the actual source response to this exact owner claim with the following minimized read. `$1` is the previously approved setup claim UUID, not a native session ID. No new source read is needed. The source receipt's `capturedAt` must equal `sourceCapturedAt`, and its project, key/response digests and flags must match. Require `active=true` and `copyUnspent=true` immediately before the parent-side create-only copy. The app performs the authoritative current claim/deadline check again in the copy phase. A no-row result is unavailable, not a receipt.

```sql
select c.posthog_project as "project", c.filter_sha256 as "filterSha256",
  p.key_sha256 as "keySha256", p.source_sha256 as "projectionSha256",
  p.filter_results as "filterResults",
  to_char(a.started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "sourceStartedAt",
  to_char(p.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "sourceCapturedAt",
  to_char(c.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
  c.revoked_at is null and c.created_at<=statement_timestamp()
    and c.expires_at>statement_timestamp() as "active",
  x.claim_id is null as "copyUnspent"
from lean_private.source_session_setup_claims c
join lean_private.source_session_setup_attempts a on a.claim_id=c.claim_id
join lean_private.source_session_setup_proofs p on p.claim_id=c.claim_id and p.attempt_id=a.attempt_id
left join lean_private.source_session_setup_copies x on x.claim_id=c.claim_id
where c.claim_id=$1::uuid and c.project_ref='xnfjdbpjuaezxjgargto'
  and c.posthog_project='353503';
```

Readback contains no native identifier, bearer digest or secret. This is a proposed owner read, not an executed query. The copier must not manufacture these fields from configuration metadata. The exact filter digest algorithm is SHA-256 of `JSON.stringify` of the six parsed rule objects in their retained order, with ordered keys `key,type,value,operator`. No alternate expected digest is accepted. Configure those private rules before the source phase; copy the dedicated query key only after actual source verification.

## Boundaries and checks

Apply `proposed_source_session_setup.sql` after the reviewed analytics prerequisites. Its four new tables and three public RPCs do not change existing functions, visitor tables or source policies. Source and copy operations serialize on the exact claim. Table guards preserve immutable pins and evidence. Service-role callers receive only the three explicit functions, not direct table access.

Focused synthetic tests exercise raw projection parsing, missing/wrong keys, wrong project, private-config failure, one-use consumption, post-I/O revocation/config/key/deadline changes, metadata-only copy and output minimization. They do not test a real Production key. The exact real-config query remains byte-equivalent to the parent's retained 2,270-byte source query in an offline comparison.

No provider, hosted setup, claim creation, environment copy, credential read or deployment is part of the private implementation. Actual runtime key/raw-envelope proof is established only by the separately authorized source phase. Setup proof never admits the historical diagnostic row into session or conversion metrics.
