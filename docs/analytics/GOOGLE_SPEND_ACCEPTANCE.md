# Offline Google spend and MER acceptance

The fresh-spend route prepares and retains immutable account/day bases. It does
not establish independent completeness or connect those bases to accepted
business reports. This tool closes the local saved-input comparison gap using
the existing spend normalization, candidate reconciliation and `storeDaily`
formulas. It is not a new collector, feed or certification system.

The production SQL050 sales feed stays unchanged. Its spend and MER values remain
withheld. Neither this tool nor a passing replay enables a job, changes a report
gate, publishes a certified selection or delivers a row to PostHog.

## Run

```sh
node scripts/analytics/accept-google-spend.mjs /private/reviewed-input.json /private/new-output-directory
```

The script reads at most 16 MB, compiles only repository modules and writes a
private `spend-validation.json`. It never opens a source or database connection
or reads credentials. Existing output directories cannot be overwritten. Exit
code 0 means all supplied spend days matched their controls; 2 means some spend
was withheld; 1 means invalid input or a local failure. A spend match does not
mean MER matched, so inspect each day's `merIssues`.

The output contains aggregate report fields, readiness and sanitized issue codes.
It excludes source facts, account/campaign/order IDs, shop identifiers and input
evidence references. Input and manifest digests bind the comparison to its private
packet. Amounts retain six decimal places and the existing MER truncation rule.

Every result says `certified: false`, `numericAcceptance: false`,
`sourceAuthorityVerified: false`, `exportReady: false`, `published: false`,
`registered: false` and `enabled: false`. Even `offline_controls_match` means only
that the supplied inputs agree. The tool cannot prove an arbitrary file came from
an authorized source, nor approve the policy asserted inside it.

## Required saved-input contract

Use `GoogleSpendAcceptanceInput` in `googleSpendAcceptance.ts`. All timestamps
are explicit UTC instants with at most millisecond precision.

| Input | Required evidence |
|---|---|
| `version`, `shop`, `publication`, `asOf` | Version 1, approved business/report identity and comparison vintage |
| `manifest` | The existing canonical `FreshGoogleSpendManifest`, with real approval/operator/revision/binding references, account/manager, independent date inventory, actual account timezone/currency and freshness/expiry bounds |
| `bases` | Exact retained immutable `SpendBase` records for those generated run IDs, including source metadata, completed timestamp, pagination/empty evidence and `lean_private.spend_jobs/<runId>` lineage. Do not supply the old aggregate sample instead |
| `controls` | Independently extracted `SpendDayControl` records, at most one per expected account/day. Include provider/account/date, actual timezone/currency, capture time, evidence reference, independent/complete flags, explicit empty evidence, exact total integer cost micros and independent campaign ID/cost-micros rows |
| `sales` | Explicit `null` when compatible sales evidence is unavailable. Otherwise supply the complete packet below |

The source owner must supply control rows independently. Do not generate them from
the base, normalized facts, report output or its totals. Expected campaign keys
are constructed from the control's own IDs, and both account totals and individual
campaign amounts are compared. Equal account totals cannot hide shifted campaign
costs. Reusing the base's evidence reference is rejected as independent evidence.

Missing, not-due, partial, stale, mismatched and unsupported-currency/timezone days
stay null. They are not complete zero days. Empty bases need complete reader
evidence and an independently complete empty control with zero total. A genuine
zero denominator keeps MER null. Identical repeated bases count once; conflicts,
duplicate controls and out-of-scope dates/accounts fail closed.

## Additional evidence for MER

Spend can compare successfully without sales. The tool withholds MER unless
`sales` supplies all of:

- A saved commerce-only `Candidate` in the existing core contract, with its
  existing publication, complete parent/reversal lineage and an empty
  `marketing_spend_daily` array. No purchase snapshot is added to ledger value.
- Independent `Reconciliation` proofs for `orders`, `order_items` and
  `sales_ledger`. Key fields must be `order_id`, `order_item_id` and
  `ledger_entry_id` respectively; ledger proof must reconcile `amount_usd`.
  Candidate graph, source USD amounts and New York effective-date mapping must
  also agree. Missing or invalid sales evidence does not erase independent spend.
- Explicit `coverage` for `whole_store_eligible_ledger`, the same shop and exact
  dates, USD and America/New_York, a current capture, closed-day `completeThrough`,
  complete/independent flags, source reference and policy approval reference.
- An independently reviewed `marketingInventory` tying the same shop/dates to
  the one Google account in this manifest, with complete/independent flags and
  source/approval references. This asserts that the approved inventory is complete,
  not merely that Google pagination completed.

This bounded version supports one Google account. Another account, unknown
marketing inventory or any additional provider withholds MER. It does not assume
Meta is supported or absent. Selected products, selected orders, the narrow
webhook feed and the 26-order sample do not satisfy whole-store coverage by being
placed in a packet or relabeled as complete.

Matched local numbers use existing report readiness `observed_unverified`.
They are aggregate comparison excerpts, without the private shop/publication
dimensions, not drop-in SQL050 resources or a certified export payload.
Source-owner review must verify the truth and scope of every coverage/approval
claim before any real numeric acceptance.

## Current evidence gap and exact next task

The inspected shared evidence contains only the earlier September 21 through 23
aggregate spend sample, not fresh raw bases or independent account/day controls.
Do not replay those jobs, relabel that sample as current, or divide selected
commerce observations by whole-account spend.

Ask the advertising-data owner for the authorized retained source locations
containing the real v2 manifest, immutable bases and independently extracted
account/day controls above, including complete-zero evidence and freshness.
Ask the commerce/reporting owner for the existing complete ledger candidate,
independent key/amount proofs, coverage vintage and the reviewed marketing-to-shop
inventory linkage if MER is requested. A source location plus exact approved
coverage is preferable to a broad export. No credential belongs in this packet.

If those records do not exist, the required action is a separately scoped source
collection/approval, not invented controls. Until supplied and reviewed, live
spend and MER acceptance remain blocked.

After a genuine reviewed packet passes, report/export work still needs its own
approved aggregate contract and destination/audience mapping, readiness and
certified-selection decision, implementation review where necessary, exact
serving/reader binding and actual destination reconciliation with freshness,
replacement/duplicate/removal behavior. Do not widen SQL050's hardcoded narrow
sales contract or relax the old Preview sample guards to avoid those decisions.

019/038 registration, installation and activation remain with the existing
runtime owner and guarded dependency package. This tool needs neither installed
SQL nor runtime configuration to replay local files. No new SQL dependency is
introduced. Optional CTR/CPC/CPM also need independent compatible click/impression
controls; matching spend alone does not accept those metrics.
