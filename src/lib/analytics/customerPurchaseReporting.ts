import { evidenceDigest } from "./evidenceIntake";
import { SCOPED_CUSTOMER_DEFINITION } from "./customerScopedPurchaseConsumer";
import type { prepareSalesEventWindow } from "./salesEventWindowInput";

type PreparedWindow = ReturnType<typeof prepareSalesEventWindow>;

/**
 * Aggregate projection of an already validated event-window preparation.
 * Callers must use prepareSalesEventWindow first. This helper grants no source
 * authority and is not an intake for caller-supplied customer conclusions.
 */
export function summarizeCustomerPurchases(prepared: PreparedWindow) {
  const customers = prepared.scopedCustomers;
  const rows = prepared.dates.map(date => {
    const orders = prepared.fullFacts.orders.filter(o =>
      o.eligibility_status === "eligible" && o.purchase_date === date);
    const conclusions = orders.map(o => customers?.orders.find(c =>
      c.orderGid === `gid://shopify/Order/${o.source_order_id}` && c.paidAt === o.paid_at));
    const first = conclusions.filter(c => c?.status === "first_observable");
    const returning = conclusions.filter(c => c?.status === "returning");
    const missing = conclusions.filter(c => !c).length;
    const unresolved = conclusions.filter(c =>
      c && c.status !== "first_observable" && c.status !== "returning").length;
    // Reuse the paid-window composition. A same-day prior witness alone cannot
    // decide whether this customer was acquired today.
    const newCustomers = prepared.customerCounts.get(date) ?? null;
    const observedCustomers = missing ? null : new Set(conclusions.map(c => c!.customerGid)).size;
    if (newCustomers !== null && (missing || unresolved || observedCustomers === null ||
        newCustomers < 0 || newCustomers > observedCustomers))
      throw new Error("customer_purchase_report_composition");
    return {
      reportDate: date,
      eligiblePurchaseOrders: orders.length,
      classifiedPurchaseOrders: first.length + returning.length,
      missingHistoryPurchaseOrders: missing,
      unresolvedPurchaseOrders: unresolved,
      firstObservablePurchaseOrders: first.length,
      returningPurchaseOrders: returning.length,
      observedCustomers,
      newCustomers,
      returningCustomers: newCustomers === null ? null : observedCustomers! - newCustomers,
      readiness: newCustomers === null ? "withheld" as const : "observed_unverified" as const,
      nextRequiredInput: missing ? "same_revision_customer_projection_and_complete_inventory" as const
        : unresolved ? "resolve_selected_purchase_history" as const
        : newCustomers === null ? "resolve_first_purchase_within_paid_day" as const : null,
    };
  });
  const available = rows.every(row => row.newCustomers !== null);
  const body = {
    version: 1,
    definition: SCOPED_CUSTOMER_DEFINITION,
    scope: "complete_paid_window_with_selected_current_observable_customer_history",
    fromDate: prepared.scope.fromDate,
    throughDate: prepared.scope.throughDate,
    status: available ? "available" : rows.some(row => row.classifiedPurchaseOrders > 0) ? "partial" : "unavailable",
    rows,
    evidence: {
      eventWindowDigest: prepared.ref.replace(/^sales-event-window:sha256:/, ""),
      customerResultDigest: customers?.digest ?? null,
      sourceStartedAt: customers?.sourceStartedAt ?? null,
      sourceCapturedAt: customers?.sourceCapturedAt ?? null,
    },
    sourceOnly: true,
    productionAdmission: false,
    wholeStoreCoverage: false,
    lifetimeHistory: false,
    cohortCoverage: false,
    repeatPurchaseRate: null,
    revenueLtvUsd: null,
    browserIdentityAsserted: false,
  };
  return { ...body, digest: evidenceDigest(body) };
}
