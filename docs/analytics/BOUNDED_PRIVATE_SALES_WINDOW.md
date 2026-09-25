# Bounded private sales-window collection

The existing history job accepts an optional operator-owned `projection`. Set it to
`financial_no_geo` for a bounded sales/product observation that does not need
customer identity, contact, address, geographic or free-text fields. This forwards
the existing fixed financial reader; it does not add a query or change the default
history route.

## Operator contract

- Freeze `projection: "financial_no_geo"` with the isolated project, shop and
  registered run ID. Pass that same configuration to every `runHistoryJob`
  invocation, including resumes. Do not switch projections mid-run.
- Use a genuinely registered, finite history interval, page size and page budget.
  Scope, cursor and completion continue to come from the existing history registry.
  This option does not register or enable a job and is not a database-enforced
  replacement for the operator's approved source-field scope.
- Check actual product membership before mapping. Use only the reviewed product
  policy for the selected cohort; product names, subscription status or a previous
  single-order test do not automatically expand that policy.
- Keep actual shipping lines, transaction evidence, refund membership and source
  revision checks. Do not replace them with scalar totals or synthetic records.
- Build the existing observed report only from genuinely retained complete history
  pages. A complete creation-time inventory is not complete financial-day coverage:
  earlier purchases can have payments or refunds in the report's financial dates.
- Keep unsupported metrics null and label outputs as an observed creation cohort,
  not certified store totals. Verify exact decimal totals and product allocation
  before any separately authorized aggregate delivery.

## Scope of this change

No migration, route option, credential, permission, schedule, production setting,
source activation or publication selection changes. Omitting `projection`
preserves the existing caller's behavior. The history tests cover forwarding on
resumed pages, the unchanged default, and the actual private reader through the
existing report formulas using network-blocked synthetic responses. The registry
test also proves forwarding across two durable page invocations. These are code
checks, not live source acceptance or reporting-window certification.
