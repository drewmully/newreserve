# Sole-return refund-clock preparation

`mapRefundClockOriginalPurchase` and `prepareRefundClockOriginalPurchases` are private, additive preparation entries. Existing `prepareOriginalPurchases` and its callers do not change.

This path needs a complete native PilotSource, complete AgreementDocument, retained source references and capture time, and the actual eligible-merchandise decision and `paid_at` / `refund_created_at` policy. It accepts only an edited, non-test, non-cancelled, tax-exclusive USD order with one OrderAgreement, one ReturnAgreement and one direct refund. All selected connections must be complete.

The proof requires exact order and revision correspondence, original financial totals and shipping, a unique one-to-one returned-line/quantity/amount match, zero explicit tax, consistent signed discounts, and all successful refund transactions with successful original sale or capture parents. Direct refund shipping, duties and adjustments must be explicitly empty. The ReturnAgreement timestamp must exactly equal the direct refund's creation timestamp. No tolerance, shifted time, residual allocation or inferred adjustment is used.

Original quantity and merchandise value come from the original agreement, never refund-adjusted current lines. Payment processing time stays separate from refund creation time. Agreement, sale, refund and refund-line IDs remain distinct. Economic correspondence does not claim a provider foreign key.

After this proof, the helper uses the existing agreement mapper's implementation clock for the sole change. The original approval references remain unchanged. The derivation records the actual business clock and hashes both sources and policy. It is not a general approval of `agreement_happened_at`.

The named preparation entry then calls the unchanged original-purchase preparation, retaining its existing nonempty-replacement and deferred-order refusal gates. Packet lineage binds both sources and the derivation; packet capture time is the oldest source capture, not preparation time. No source acquisition, registration, publication or run approval occurs.

This narrow bridge does not cover PayPal's two RefundAgreements and balanced AdjustmentSales, other edits, cancellations, nonzero tax, shipping refunds or discrepancy adjustments. It does not certify a financial population, cash lifecycle, independent controls or operational freshness.

The private actual-source proof used the retained edited Shopify refund and its actual Sep30 historical business definition. That definition is not a new reporting-run authority. A full-build call still needs genuine scope-bound policy, input and evidence. The old Sep30 two-order full input is not a Sep28-29 input.
