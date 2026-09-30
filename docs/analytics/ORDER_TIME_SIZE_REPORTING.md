# Owner-only selected order-time-size inspection

This local-only increment adds a pure aggregate and a parameterized **SELECT**,
not a table, migration, RPC, grant, source reader, job, publication, or runtime sink.
Nothing is deployed or authorized for live use.

- `aggregateOrderSizes(facts, {shop, fromDate, throughDate})` accepts selected
  canonical `orders`, `order_items`, and optional `order_item_sizes` rows.
  The caller must supply **exactly one latest selected publication per order**.
  It rejects duplicate/cross-publication/orphan/unsupported facts and invalid046
  tuples. It does not authenticate latest-head selection or approve provenance.
- `OWNER_ORDER_SIZE_REPORT_SQL` binds `[shop, fromDate, throughDate]` (inclusive
  purchase dates, at most366 days apart). An independently authorized owner can
  execute it in a read-only transaction. It selects only017 `pipeline_heads`,
  checks completed matching snapshots/revisions, canonical purchase facts and
  approved snapshot product policy, and joins046 by **item + publication**.
  Companion policy/source references and values must match that retained snapshot.
  Old unselected candidates, including standalone samples, are not part of this
  selection. It never looks back to an older known size.
- Unsupported persisted selection returns `status: unavailable, rows: []`.
  Missing017/046, insufficient permission, invalid parameters, or SQL errors also
  mean **unavailable**, not a zero report. Do not expose raw database diagnostics.
  Zero selected heads is unavailable. Available-but-empty rows only mean no
  purchases inside the requested range within the selected heads—not no store sales.

Rows group by **purchase date, SKU (null→`unknown`), size semantics, status, value**.
They contain a line count and exact six-place quantity only. This is the existing
`productDaily` original eligible merchandise purchase-unit definition: refunds do
not reduce these quantities, and there are no invented refund/day-gap zero rows.

| Semantics | `unit_basis` | Meaning |
| --- | --- | --- |
| `requested_box_top_size` | `requested_box_units` | Requested BOX line units, **not number of shirts** |
| `purchased_shirt_variant` | `purchased_shirt_variant_units` | Purchased shirt-variant line units |
| Unsupported / no companion | `unclassified_merchandise_units` | Merchandise line units without a supported size interpretation |

Neither interpretation proves fulfilled size or return-adjusted units. Missing,
invalid, conflict, unsupported, and projection-absent rows remain in the denominator.
**No companion** is `not_collected` for both status and semantics; it is never
invented as `projection_absent`, known, or silently dropped.

Every result says selected-observed latest-head scope, stale, unverified,
`certified: false`, `fulfillment_proven: false`, `return_adjusted: false`, and
`complete_history: false`. Output exposes only date/SKU/enums/counts/quantities and
that metadata—no order/item/publication/customer IDs, raw references or titles.
No percentages, money, whole-store coverage, or complete-history claim is added.
Store financial formulas, report money, existing046 bytes, and all shared code/SQL
remain unchanged. Financial/refund retained-source minimization is a separate
runtime-owner concern; this SELECT does not claim complete source allowlisting.

Focused synthetic tests compare pure/SQL results through the existing reader,
017 persistence and046 companion, including latest missing replacing older known,
absent companions, invalid scope/evidence, owner-only/read-only behavior, exact
decimals, and unchanged stored financial/046 rows. Live data, owner authority,
installed017/046, and any activation remain independently gated and unverified.
