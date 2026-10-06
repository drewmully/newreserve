# Scoped ingestion amendment

Private forward-only successor against `5262558605e447eb08eeccc6362f49c188f37216`, tree `6fed5971c3b973fcef63cc4756b0a048ef364d11`. Installation, release and activation require separate approval. The additive SQL installs empty and does not update existing scope, source, policy, work state or operating controls. The prior six-path patch and V3 operating kit remain frozen evidence, not an installer for this successor.

## What the owner would approve

One versioned admission covers three verified cases under the unchanged scope `799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689`.

1. **Three exact merchandise products.** Rhone Rise quarter zip `10244806213824`, Mystery Bundle Closeout `10249371680960`, and Back 9 Legacy physical subscription `8501257306304`. This permission covers existing retained snapshots and future instances of these exact products under the same frozen policy and window. It does not classify annual access `8501257175232`, unknown products, gifts or mixed unapproved lines. Missing SKU stays null and uses the existing `unknown` report bucket. No new size semantics or subscription metric definition is introduced.
2. **One historical refund supplement.** Source digest `967d4d3a6027912a30137d71263421f6c4c64e9a692d49a2f605f1c837ce55c1` contains an ID-only adjustment. The parent matched canonical order, refund and adjustment identity hashes to separate retained source evidence. That evidence says `refund_discrepancy`, signed amount `-13.50`, tax `0.00`, USD. The supplement archive digest is `df50358fabf53683c634e5f2f56712d3dab0472f2e0cf0a7db2365f7c28e4cfe`. No legacy source field is filled or inferred.
3. **Equivalent unresolved zero-total receipts.** Extend the existing registered exception only to identical source, order, revision, shop, frozen policy and window evidence. Receipt topics remain limited to the demonstrated `orders/paid` and `orders/updated`. Pending records remain pending, and exhausted dead records remain dead, with their original attempts, retry clocks and errors. They are not paid sales, exclusions or completed work.

## Financial treatment

The refund uses the existing `other_sales_adjustment` component as a negative order-level slice. It affects store-level other adjustments and total sales, not merchandise net sales, product refunds or item allocations. Successful refund transactions must reconcile exactly to the refund total, and the existing approved refund-created clock still applies.

The mapper checks all three identity hashes, exact retained-source admission, the ID-only shape, a single adjustment and refund, zero refund-line and refund-shipping rows, USD and the exact amount. Existing completeness, transaction, duplicate and clock checks remain. Unsupported or conflicting evidence refuses. Cash remains withheld.

This is not a general refund-adapter fix. Other source digests, newer revisions, adjustment types and richer shapes remain unsupported. The GraphQL query and retention projection are unchanged. A newly hydrated copy cannot receive this historical supplement before its immutable retained digest is available on a later ordinary claim. No retry is initiated by this change.

## Admission, completion and evidence

The ordinary claim returns a separate `ingestionAmendment` context, never a replacement `policy`. Runtime classification merges only the three permitted identities into an in-memory mapping policy. The original database scope and snapshots remain byte-identical.

An amended completion uses `lean_pipeline_finish_amended`. It first takes the same shared zero-exception advisory lock as claim, before admission, scope and work locks. That ordering prevents a three-way cycle with an ordinary batch holding scope SHARE and the owner holding the exclusive advisory lock. Under those locks it rechecks enabled status, admission revision, scope, immutable snapshot, token and lease before delegating to the existing extended finish. Revocation or a newer admission revision prevents the earlier claim from finishing through this path. It does not undo a completion that already committed.

The same transaction appends an immutable `pipeline_ingestion_completions` row with admission version, revision, approval, source digest and snapshot-metadata digest. The successful processor result returns its `mappingEvidenceRef`. A failed provenance insert rolls back materialization too. Lost or ambiguous finish responses do not trigger fail, replay or lease clearing.

## Zero-total fencing

The existing v3 exact-registration predicate remains the first matching branch. A second branch is active only under the new owner admission. Health adds all equivalent unresolved work, including terminal history, to the original exception count without subtracting it from pending or dead. The original registered row is not double-counted. Terminal history does not become claimable or deferred pending work.

Activation locks every matching work row in ID order. It accepts exactly two dispositions, pending with attempts 1 through 4, or retained terminal history with state `dead` and attempts exactly 5. Both require error `mapping_rejected`, no lease, no completion, the same source and receipt checks, a candidate publication and no financial, report, head, projection, selection or certification effects. Unknown states, other errors, pending-attempts-5, leased or materialized records refuse. All matching rows remain in the inventory hash and its final CAS, including the complete terminal work-row digest.

Only pending rows receive the same logical no-op work update as v3, advancing their physical row versions while preserving every logical field. This is required for older repeatable-read writers. Terminal rows are locked and validated but never updated, and their row versions do not advance. The unchanged volatile v3 transition trigger checks the extended predicate for older read-committed claim bodies. No advisory lock is added inside the work-row trigger. The guarded operating wrapper retains its table locks and full workload preservation checks.

The binding audit now includes `zeroPendingDeferred`, `zeroTerminalRetained` and `zeroDispositionVersion=forward-only-20261005`, as well as the unchanged complete zero inventory hash and count. Guarded readbacks expose pending, terminal and unavailable counts separately. All-terminal zero history is allowed, but zero matched records still refuses. This permits supported ordinary product work to proceed without making historical recovery a prerequisite.

Unrelated work and genuinely corrected revisions use the normal claim path. No EXTRA grant, new scheduler, retry controller or capture window is introduced. The existing 20 claims, 160 native requests, 80-second invocation, 65-second admission and 60-second record limits remain unchanged.

## Smallest operating prerequisites

- Parent performs a fresh bounded metadata inventory before a guarded install. Bind the current target/owner, function headers and bodies, ACLs including columns, work hooks, existing controls and the old registered exception. The raw SQL has five dependency body checks but is not a production installation wrapper.
- Install empty and independently verify empty admission/completion tables and the changed claim, health and zero-match bodies. Existing raw SQL files are unchanged evidence. Older wrapper/body hashes cannot be reused.
- Release the matching application and verify serving identity before enabling. Old application code ignores the new claim context and cannot repair these failures.
- Bind `set_pipeline_ingestion_amendment` with enabled, expected revision, fresh whole scope-row SHA, fresh zero-equivalent inventory SHA, approval, actor and an operation deadline no more than 15 minutes away. The inventory is SHA-256 over the UTF-8 PostgreSQL JSONB text returned by `pipeline_ingestion_zero_inventory()`. The constructor is owner-only, read-committed, and checks the deadline again after writes. Initial expected revision is zero. No actual values are approved by this document.
- A fresh inventory may show leased or exhausted records. The constructor refuses leased zero equivalents. It retains only the strict terminal disposition above without reviving it. The owner must separately check the product/refund backlog before claiming recovery of those records; this constructor does not reserve them. No path revives or resets them. Previously observed counts are not promises that all historical failures remain claimable. Retained product and refund repairs only run through ordinary claims that are still eligible. Any recovery belongs to a separately reviewed and approved mechanism.
- Disable with a new approval and the exact current revision. Disable preserves sources, attempts, leases, existing completions and immutable audit. It stops amended completions and equivalent-record deferral, except the original independently registered exception. It does not cancel issued native requests or restore consumed attempts.

Pending/current and cash gates are unchanged. Local fixtures are not live acceptance. After approval and rollout, acceptance must show actual eligible retained processing, preserved unresolved records and matching completion evidence. This packet does not include hosted reads, production SQL, provider calls or activation.
