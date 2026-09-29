import { mapPilotSource, type PilotPolicy } from "./shopifyPilotMapping";
import type { PilotSource } from "./shopifyPilotSource";
import type { OrderSizeSidecarOption } from "./shopifyOrderSize";
import { productDaily, type Facts } from "./reporting";
import type { Row } from "./primitives";

/** Pure composition for ONE already-claimed, durably retained order.
 * The caller owns shop/order/window/revision/lease fences and explicit policy.
 * This does not fetch, claim, retain, persist, certify, or select a publication.
 *
 * A future approved finish transaction must persist facts + reports +
 * productReports + optional order_item_sizes together BEFORE completing work
 * or advancing its head. Existing hosted writers do not implement that sink.
 * Never sum these per-order AOVs or call them whole-store reporting.
 */
export function composeRetainedOrderReports(
  source: PilotSource, policy: PilotPolicy, publication: string, evidenceRef: string,
  definition: string, options?: OrderSizeSidecarOption,
) {
  if (typeof definition !== "string" || !definition.trim() || definition !== definition.trim())
    throw new Error("retained_order_definition_required");
  // Reuse all existing money, refund, policy, and explicit size-sink gates.
  const mapped = mapPilotSource(source, policy, publication, evidenceRef, options);
  const observed = (row: Row): Row => ({
    ...row, definition_version: definition, is_stale: true,
    readiness: Object.fromEntries(Object.entries(row.readiness as Record<string, string>)
      .map(([name, status]) => [name, status === "ready" ? "observed_unverified" : status])),
  });
  const productReports = mapped.reports.flatMap(row => productDaily(mapped.facts as Facts, {
    shop: source.commerce.shop, publication, definition, model: "pilot-no-attribution",
    date: row.report_date as string, stale: true,
    gates: { ledger: true, orders: true, purchase: true, productAllocation: true,
      cash: false, customers: false, spend: false, attribution: false, behavior: false },
  }).map(observed));
  return { ...mapped, reports: mapped.reports.map(observed), productReports };
}
