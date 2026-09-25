import { storeDaily, productDaily, type Facts, type ReportScope } from "./reporting";
import { type Row } from "./primitives";

export type SelectedOrderInput = {
  runId: string; shop: string; publication: string; inputHash: string;
  sourceUpdatedAt: string; facts: Facts; savedStore: Row[];
};
/** Owner-only saved 016 inputs, not source discovery or complete-window evidence. */
export function projectSelectedOrder(input: SelectedOrderInput) {
  const { facts } = input;
  if (input.shop !== "mullybox-store.myshopify.com" || input.publication !== `pilot:${input.runId}` ||
    !/^[a-f0-9]{64}$/.test(input.inputHash) || !Number.isFinite(Date.parse(input.sourceUpdatedAt)) ||
    facts.orders.length !== 1 || facts.orders[0].eligibility_status !== "eligible" ||
    !facts.order_items.length || facts.order_items.length > 100 || !facts.sales_ledger.length ||
    facts.sales_ledger.length > 1000 ||
    ["payments","customers","sessions","marketing_spend_daily","order_attribution"].some(k =>
      facts[k as keyof Facts].length !== 0)) throw new Error("selected_input_boundary");
  const order = facts.orders[0];
  for (const [rows, key] of [[facts.order_items,"order_item_id"],[facts.sales_ledger,"ledger_entry_id"]] as const) {
    if (new Set(rows.map(r => r[key])).size !== rows.length ||
      rows.some(r => r.order_id !== order.order_id)) throw new Error("selected_fact_graph");
  }
  const dates = [...new Set([order.purchase_date, ...facts.sales_ledger.map(r => r.report_date)])].sort();
  if (dates.length > 4 || dates.some(d => typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)))
    throw new Error("selected_dates");
  const scope = (date: string): ReportScope => ({
    shop: input.shop, publication: input.publication, date, definition: "selected-order-v1",
    model: "commerce-only", stale: true, gates: { ledger: true, orders: true, purchase: true,
      productAllocation: true, cash: false, customers: false, spend: false, attribution: false, behavior: false },
  });
  const project = (row: Row): Row => {
    const { shop_id: _shop, publication_id: _pub, ...aggregate } = row;
    void _shop; void _pub;
    return { ...aggregate, report_scope: "selected_order_sample", policy_scope: "prior_single_order_test",
      certified: false, complete_window: false,
      selected_order_count: 1, source_updated_at: input.sourceUpdatedAt,
      readiness: Object.fromEntries(Object.entries(row.readiness as Record<string,string>)
        .map(([k,v]) => [k,v === "ready" ? "observed_unverified" : v])) };
  };
  const payload = {
    store_daily: dates.map(d => project(storeDaily(facts,scope(d as string)))),
    product_daily: dates.flatMap(d => productDaily(facts,scope(d as string)).map(project)),
  };
  const checks = ["report_date","gross_merchandise_sales_usd","discounts_usd","refunds_usd",
    "net_merchandise_sales_usd","shipping_net_usd","tax_net_usd","duty_net_usd","other_sales_adjustments_usd",
    "total_sales_usd","eligible_orders","purchase_merchandise_net_usd","aov_usd"];
  if (!Array.isArray(input.savedStore) || input.savedStore.length !== dates.length ||
    new Set(input.savedStore.map(r => r.report_date)).size !== dates.length ||
    payload.store_daily.some(row => {
      const saved = input.savedStore.find(r => r.report_date === row.report_date);
      return !saved || checks.some(k => saved[k] !== (row as Row)[k]);
    })) throw new Error("selected_saved_store_mismatch");
  return payload;
}
