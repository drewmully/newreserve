# Finite sales event cycles

This default-off successor joins a new bounded commerce acquisition to one saved
Google cycle and its saved Meta generation. It does not copy a historical sales
packet, renew a grant, launch advertising or send email. The historical event-window
candidate remains a separate artifact. Installation is not activation.

## Claim, acquire, stage, enable

The owner creates an immutable disabled `sales_event_cycle_grants` row. It pins the
Google grant and revision, project, shop, finite dates and expiry, report policy,
existing merchandise and paid/refund-clock definition, standing account declaration,
actual compiled reader and capture hashes, and exact budgets. Real grant rows and
schedules are deployment inputs, not values supplied by this change.

1. The restricted `lean_sales_event_cycle_claim` reads the real committed Google
   accessor, including its separately captured Meta packet and three HTTP receipts.
   It consumes one cycle once and returns its exact date, immutable source hashes,
   new `event_auto_…` full/base IDs and an absolute acquisition deadline.
2. `sales-event-cycle-operator.mjs queries CLAIM_JSON RUNTIME_DIR` returns the two
   fixed connector queries. Run each once through the approved Shopify connector,
   retain the complete success envelope, original query, SHA-256 and actual start/end
   clocks. The sales receipt has `result.structured_content`; payment evidence has
   the documented columns and one `results` entry. A faithful serialization must
   preserve errors, truncation, row counts and source clocks. It is not a wire copy.
3. Run `capture CLAIM_JSON RUNTIME_DIR LOCATOR_JSON PAYMENTS_JSON OUTPUT_DIR` on the
   same operator. Supply `{shop,accessToken}` through RAM-only stdin. No token file,
   command-line token or token log. The operator checks the complete emitted-file
   manifest and its own bytes before reading credentials. The two connector calls
   are an external producer step, not hidden extra calls in the native operator.
4. The operator reads complete selected originals, edited agreements when needed,
   and current customer histories. It compares customer anchors to the new original
   documents, including revisions. It writes one private, source-bound preparation
   with exact stage arguments. Failed or ambiguous acquisition is not replayed.
5. `lean_sales_event_cycle_stage` compares these arguments with the server-saved
   Google/Meta cycle, immutable B1 grant and fresh source/customer binding. It calls
   the existing owner registrars internally, creating disabled base/full builds and
   binding the exact disabled Meta generation. It does not enable them.
6. `lean_sales_event_cycle_enable` requires the exact registered scope hash and spend
   digest and rechecks current authority. Existing report jobs then use the real
   base/full input and finish hooks. These hooks retain authority locks through both
   delegated writes and check expiry again after each write. Ordinary unbound jobs
   keep their previous behavior.

Only these bounded claim/stage/enable/status functions receive service-role execute.
The underlying generic registrars and the Google packet accessor stay owner-only.
Grant tables are inaccessible to that role. This is code for a restricted producer,
not permission to install, seed or enable it.

The PostgreSQL getter's `startedAt` can carry the connection's explicit offset.
Preparation converts that server clock to canonical UTC, retaining all six
fractional digits and the unmodified raw getter receipt. B1 serializes inherited
deadlines/expiry with six digits too. Zone-less and invalid-calendar values refuse.
Source JSON capture clocks and the standing declaration are not rewritten.

## Exact bounds and overflow

All stages share one absolute deadline of at most 300 seconds after the B1 claim.
Google's earlier 80-second capture lease is not extended or reused. Source/control
freshness and the grant expiry bound execution after acquisition.

| Stage | Requests | Per response | Stage total | Local active limit |
| --- | ---: | ---: | ---: | ---: |
| Sales and paid-date locators | 2 | 2,000,000 bytes | 4,000,000 bytes | Common deadline |
| Original/refund/agreement reads | 20 | 8 MiB | 64 MiB | 240 seconds |
| Customer reader including both existing access checks | 65 | 1 MiB | 16 MiB | 120 seconds |
| All stages | 87 | Stage-specific | 87,886,080 bytes | Common 300-second deadline |

The original limit is **20 requests, not 20 orders**. Before native acquisition the
operator allows at most four selected order IDs. One scope check and at least four
requests per order consume that same budget; extra refund/agreement work can exhaust
it sooner. The customer reader plan is capped at 64, within the 65-request outer cap.
Its first existing access response supplies identity evidence without an extra call.
The outer wrapper enforces 1 MiB while streaming, before JSON parsing. Both readers
check secret reflection before retention. The final operator also checks serialized
output, the summed request/byte limits and the absolute deadline before writing.
Retention has a separate 128 MiB serialized-output ceiling. A failed response may
lack a complete byte audit; held diagnostics never claim a complete source capture.

Each locator must contain fewer than 21 rows. Sentinel hits, more than four selected
orders, incomplete histories, changed revisions, unsupported source semantics,
missing customer conclusions and any budget/deadline failure hold the whole day.
No partial population is called complete. No hidden pagination or cap expansion.
The operator exits nonzero and emits a safe stage label on a held attempt. Status
reports expired or unavailable cycles as held, never accepted. Alert routing and
schedule registration remain explicit deployment inputs, not claimed by local tests.

The B1 date comes from the actual server-selected Google slot, not cycle ordinal.
The Google slot producer selects the latest eligible closed date only after the
full LA provider query window closes. B1 pins its immutable ordinal and not-before
clock, requires both to advance, and refuses a backward report date. A later slot
may refresh the same closed day with newly acquired source bytes. It cannot reuse
the previous slot, cycle claim or capture. A failed, ambiguous or unfinished B1 cycle holds its
grant; an operator must resolve it under separately bound authority. A later
date cannot silently reset or reuse a consumed attempt. Days missed or too large
for these bounds stay unprocessed. This is bounded recurrence, not all-store or
all-day acceptance at arbitrary volume.

The immutable owner-selected cycle cap is between 1 and 1,000 and cannot exceed
the actual matching Google grant revision's slot count for these dates before B1
expiry. Claim and current-authority checks enforce that bound and the consumed
attempt counter. No grant is automatically expanded. The maximum B1 source calls
are `maxCycles × 87`, with a corresponding total-byte upper bound of
`maxCycles × 87,886,080`. Actual cycle count, duration and global acquisition limits
remain explicit setup inputs. A fourteen-day grant need not use the maximum cap.

## Scoped spend, not fabricated reconciliation

The standing two-account declaration retains its original time, version, evidence
digest and contemporaneous ID-binding hashes. Each cycle separately proves fresh
native Google and Meta identity. There is no per-cycle owner business question,
provider-wide account enumeration or rewritten declaration capture time.

`nativeSpendWindowInput` compares the final financial spend projection against
separate expected groups. Google expected campaign amounts come from independent
campaign/account controls. Meta expected membership and groups come directly from
the exhausted native campaign-hour response, with separately captured account-hour
totals validating the same hours. The comparison includes provider, account, native
campaign ID and key, date, generation, currency, timezone, amount and source clock.
Missing, extra, duplicate, shifted or substituted campaign rows fail, including an
A-to-B replacement that preserves account totals. LA source timezone is retained.

The explicit optional hook admits only this date's spend in the combined adapter
and full builder. Generic `proofReady` and `Reconciliation` are unchanged. Source
keys are never labeled independently extracted controls. Legacy inventory fields
remain explicitly unverified; their timestamp is the original standing declaration.
Only complete sales/customer composition plus admitted spend can feed existing
MER/nCAC formulas. No formula, global proof, cash, cohort, behavioral or attribution
gate is relaxed. A genuinely empty Meta day uses its explicit empty sentinel.
The existing Google capture contract still holds an empty Google day rather than
inventing zero. That separate producer limitation is not overridden here.

## Validation boundary

Local transport tests use synthetic authority and capture clocks. Some original
documents are retained genuine fixtures, not fresh reads. Synthetic customer history
tests are not the actual historical pair. Runtime tests exercise actual readers,
packet compiler, combined adapter, full builder and job with in-memory RPC doubles.
They do not prove a live source query, native SQL transaction, schedule, alert,
registration or publication. The composed installer/native fixture must independently
validate lock order, revocation, deadlines, hash/token fences and ACLs before release.

Financial lifecycle coverage remains separate. Shopify-recorded PayPal principal
facts do not establish PayPal-side adjustments or chargebacks. Missing cross-gateway
cash evidence leaves cash null and does not hold sales, customer or spend processing.
