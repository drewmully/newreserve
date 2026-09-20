# L05: commerce normalization and complete pagination

Implements exact-decimal, shop-qualified orders/items/offers projections against
the workbook shapes. Complete nested pagination is required; limits, repeated
cursors, duplicate lines and conflicting equal revisions fail closed. Source
updates choose revisions, not arrival order. Offers are deduplicated membership,
not additional revenue rows. Missing identity stays null.

Purchase-time evidence is mandatory for merchandise values. Current order
subtotal, refunds and present-day SKU price must not be passed as original
purchase evidence. Unknown/non-USD values stay null. No operational tables or
existing backfill endpoint are modified.

## Adapter integration still required before activation

The normalizer accepts an explicit typed source-evidence envelope; it is not a
claim that arbitrary webhook JSON already contains that evidence. Bind the
existing Shopify client to `collectCommerceSnapshot`, verify the live API
version/fields and full order-history access, and map original line amounts and
paid transactions from recorded customer-approved fixtures. The source decision
requires an approval reference; test/cancelled/renewal classification is not
guessed from tags. Prove independent source key/count/amount reconciliation and
old-vs-new revision overlap before enabling backfills.

The existing bulk helper may cancel another bulk operation and is not reused
automatically. Run bounded historical batches only after the customer approves
the time window and provider resource limits. This PR is a tested transform and
pagination foundation, not a live Shopify sync.
