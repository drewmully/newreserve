# SMS metadata source: existing database, no producer repository prerequisite

The existing source acquisition command now supports `kind=sms-metadata-v1`.
This is a bounded reader for incoming message metadata, not a complete SMS
activation integration or authorization to run against customer data.

## Exact read scope

- One GET from the explicitly configured SMS project's `public.messages`.
- Fixed projection: `id,contact_id,direction,service,created_at`.
- Incoming messages only, half-open `created_at` window of at most 31 days.
- Explicit maximum of 1 to 1,000 rows and a 500,000-byte response ceiling.
- Exact response count required; truncation, unexpected columns, duplicate IDs,
  out-of-window timestamps and malformed records fail without a partial snapshot.
- No message content, phone, email, raw webhook, model reasoning or profile scan.
- No redirects, retries, source writes, PostHog capture or publication.

`created_at` is labelled `recordedAt`, with `timestampBasis=database_created_at`.
It is not silently substituted for the provider's original event time. Empty
or successfully read results do not establish a complete webhook history or
the first-ever incoming message. Contact UUIDs are source identifiers, not
verified website session or customer associations.

## Operator configuration

The command remains gated by `LEAN_MULLY_SOURCE_READ_APPROVED=true`, a nonempty
input `approvalRef`, and an exact approved shop. SMS reads additionally require
`LEAN_SMS_SOURCE_PROJECT_REF` and `LEAN_SMS_SOURCE_READ_KEY`; they cannot fall
back to the main application's project or key. Use a least-privileged source
credential approved for this fixed projection. No credential is provisioned
or inferred by this code.

An input contains `kind`, `projectRef`, `shop`, `approvalRef`, UTC `from` and
`until`, and `maxRows`. The existing `read-mully-source.mjs INPUT OUTPUT`
command creates a private 0600, no-overwrite snapshot. Its summary explicitly
returns `activationVerified=false`, `registered=false` and `enabled=false`.
Do not run this command on hosted sources without separate approval.

## What remains

The source snapshot explicitly carries `not_verified` for source completeness,
session linkage and analytics permission. It is intentionally not accepted as
a ready-made `lean_text_mully_activated` event or an identity/evidence packet.

To finish activation metrics, establish the source event-time semantics,
deduplication/coverage controls, and a verified temporal link from the contact
to the correct website journey and analytics permission. An enrollment form,
phone/email match, current customer association or SMS marketing consent is
not a substitute. Check whether these authorities can be provided through
existing data interfaces before treating access to another repository as a
prerequisite.

No customer records or message contents were read for this implementation.
Tests use synthetic HTTP responses, including the actual command entrypoint
and distinct SMS/application project credentials.

Local verification: 637 passing tests across 50 files, zero skipped, including
the existing ten disposable PostgreSQL integration tests. This addition covers
18 metadata-reader cases and one command-level integration case. TypeScript,
analytics ESLint, generated SQL parity and whitespace checks passed. This is
local/synthetic evidence, not a hosted source read or end-to-end certification.
