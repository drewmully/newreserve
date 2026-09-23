import { decimal, micros, nyDate, type Row } from "./primitives";
import { firstCustomerCredits } from "./attribution";
export type Facts = {
  orders: Row[]; order_items: Row[]; sales_ledger: Row[]; payments: Row[];
  customers: Row[]; marketing_spend_daily: Row[]; sessions: Row[]; order_attribution: Row[];
};
export type Gates = { ledger: boolean; cash: boolean; orders: boolean; purchase: boolean;
  customers: boolean; spend: boolean; attribution: boolean; behavior: boolean; productAllocation: boolean };
export type ReportScope = {
  shop: string; publication: string; definition: string; model: string;
  date: string; stale: boolean; gates: Gates;
};
const ZERO = BigInt(0), SCALE = BigInt(1000000);
const merchandise = new Set(["merchandise_gross", "merchandise_discount", "merchandise_refund"]);
function sum(rows: Row[], field: string, ready: boolean): string | null {
  if (!ready || rows.some(r => r[field] === null || r[field] === undefined)) return null;
  return decimal(rows.reduce((n, r) => n + micros(r[field] as string), ZERO));
}
/** Fixed six-place truncation towards zero is explicit; no binary float money. */
export function ratio(n: string | null, d: string | null): string | null {
  if (n === null || d === null || micros(d) <= ZERO) return null;
  return decimal(micros(n) * SCALE / micros(d));
}
export function deliveryMetrics(spend: Row[], ready: boolean) {
  const definitions = new Set(spend.map(r => r.click_definition));
  const clicksReady = ready && definitions.size === 1 && !definitions.has(null) &&
    spend.every(r => typeof r.clicks === "number" && Number.isSafeInteger(r.clicks) && r.clicks >= 0);
  const impressionsReady = ready && spend.every(r => typeof r.impressions === "number" && Number.isSafeInteger(r.impressions) && r.impressions >= 0);
  const clicks = clicksReady ? decimal(spend.reduce((n, r) => n + BigInt(r.clicks as number) * SCALE, ZERO)) : null;
  const impressions = impressionsReady ? decimal(spend.reduce((n, r) => n + BigInt(r.impressions as number) * SCALE, ZERO)) : null;
  const amount = sum(spend, "spend_usd", ready);
  return { ctr: ratio(clicks, impressions), cpc_usd: ratio(amount, clicks),
    cpm_usd: ratio(amount === null ? null : decimal(micros(amount) * BigInt(1000)), impressions) };
}
const count = (n: number) => decimal(BigInt(n) * SCALE);
function envelope(s: ReportScope): Row {
  return { shop_id: s.shop, publication_id: s.publication, definition_version: s.definition, is_stale: s.stale, report_date: s.date };
}
function output(s: ReportScope, dimensions: Row, metrics: Row): Row {
  return { ...envelope(s), ...dimensions, ...metrics,
    readiness: Object.fromEntries(Object.entries(metrics).map(([name, value]) => [name, value === null ? "withheld" : "ready"])) };
}
function preflight(f: Facts, s: ReportScope) {
  if (!s.shop || !s.publication || !s.definition || !s.model) throw new Error("missing_report_scope");
  for (const rows of Object.values(f)) if (rows.some(r => r.publication_id !== s.publication)) throw new Error("mixed_publication");
  if (f.orders.some(o => o.shop_id !== s.shop)) throw new Error("mixed_shop");
  if (f.order_attribution.some(a => a.model_version !== s.model)) throw new Error("mixed_model");
  // Publication certification verifies shape, uniqueness and FKs before projection.
}
function ledgerMetrics(ledger: Row[], ready: boolean) {
  const component = (c: string) => sum(ledger.filter(l => l.component === c), "amount_usd", ready);
  const neg = (s: string | null) => s === null ? null : decimal(-micros(s));
  const net = sum(ledger.filter(l => merchandise.has(l.component as string)), "amount_usd", ready);
  return {
    gross_merchandise_sales_usd: component("merchandise_gross"), discounts_usd: neg(component("merchandise_discount")),
    refunds_usd: neg(component("merchandise_refund")), net_merchandise_sales_usd: net,
  };
}
export function storeDaily(f: Facts, s: ReportScope): Row {
  preflight(f, s);
  const ledger = f.sales_ledger.filter(l => l.report_date === s.date && l.sales_eligible === true);
  const orders = f.orders.filter(o => o.purchase_date === s.date && o.eligibility_status === "eligible");
  const sales = ledgerMetrics(ledger, s.gates.ledger);
  const spend = sum(f.marketing_spend_daily.filter(r => r.report_date === s.date), "spend_usd", s.gates.spend);
  const purchase = sum(orders, "purchase_merchandise_net_usd", s.gates.purchase && s.gates.orders);
  const newCustomers = s.gates.customers ? f.customers.filter(c => c.acquisition_date === s.date &&
    c.history_complete === true && c.analytics_permitted === true && c.identity_status === "resolved").length : null;
  return output(s, {}, {
    ...sales,
    shipping_net_usd: sum(ledger.filter(l => l.component === "shipping_net"), "amount_usd", s.gates.ledger),
    tax_net_usd: sum(ledger.filter(l => l.component === "tax_net"), "amount_usd", s.gates.ledger),
    duty_net_usd: sum(ledger.filter(l => l.component === "duty_net"), "amount_usd", s.gates.ledger),
    other_sales_adjustments_usd: sum(ledger.filter(l => l.component === "other_sales_adjustment"), "amount_usd", s.gates.ledger),
    total_sales_usd: sum(ledger.filter(l => l.component !== "fee"), "amount_usd", s.gates.ledger),
    collected_cash_usd: sum(f.payments.filter(p => p.report_date === s.date && p.cash_eligible === true), "cash_amount_usd", s.gates.cash),
    eligible_orders: s.gates.orders ? orders.length : null, purchase_merchandise_net_usd: purchase, new_customers: newCustomers,
    spend_usd: spend, ncac_usd: ratio(spend, newCustomers === null ? null : count(newCustomers)),
    mer: ratio(sales.net_merchandise_sales_usd, spend), aov_usd: ratio(purchase, s.gates.orders ? count(orders.length) : null),
  });
}
export function productDaily(f: Facts, s: ReportScope): Row[] {
  preflight(f, s);
  const items = new Map(f.order_items.map(i => [i.order_item_id, i]));
  const orders = new Map(f.orders.map(o => [o.order_id, o]));
  const skus = new Set(f.order_items.map(i => i.sku ?? "unknown"));
  return [...skus].map(sku => {
    const purchaseItems = [...items.values()].filter(i => (i.sku ?? "unknown") === sku && i.item_class === "merchandise" &&
      orders.get(i.order_id)?.eligibility_status === "eligible" && orders.get(i.order_id)?.purchase_date === s.date);
    const ledger = f.sales_ledger.filter(l => l.sales_eligible === true && l.report_date === s.date &&
      l.product_allocation_status === "allocated" && l.order_item_id !== null &&
      (items.get(l.order_item_id)?.sku ?? "unknown") === sku);
    return output(s, { sku_bucket: sku }, {
      units: sum(purchaseItems, "quantity", s.gates.orders),
      ...ledgerMetrics(ledger, s.gates.ledger && s.gates.productAllocation),
    });
  });
}
export function acquisitionDaily(f: Facts, s: ReportScope, approvedComparisons: ReadonlySet<string>): Row[] {
  preflight(f, s);
  const orders = new Map(f.orders.map(o => [o.order_id, o]));
  const attribution = f.order_attribution.filter(a => a.conversion_date === s.date);
  if (attribution.some(a => a.credit_weight !== "1.000000000")) throw new Error("unsupported_credit_weight");
  const credits = firstCustomerCredits(f.customers, f.order_attribution, s.publication, s.model);
  const spendRows = f.marketing_spend_daily.filter(r => r.report_date === s.date);
  const bucket = (a: Row) => String(a.campaign_id ?? (["unattributed", "not_applicable"].includes(a.channel as string) ? a.channel : "no_campaign"));
  const dimensions = new Map<string, [string, string]>();
  for (const a of attribution) dimensions.set(JSON.stringify([a.channel, bucket(a)]), [a.channel as string, bucket(a)]);
  for (const r of spendRows) {
    const b = r.source_campaign_id === null ? "spend_unallocated" : r.campaign_key as string;
    dimensions.set(JSON.stringify([r.channel, b]), [r.channel as string, b]);
  }
  return [...dimensions].map(([comparison, [channel, campaign]]) => {
    const selected = attribution.filter(a => a.channel === channel && bucket(a) === campaign);
    const complete = s.gates.attribution && selected.every(a => a.attribution_complete === true);
    const values = selected.map(a => orders.get(a.order_id)).filter((o): o is Row => !!o && o.eligibility_status === "eligible");
    const revenue = sum(values, "purchase_merchandise_net_usd", complete && s.gates.purchase && values.length === selected.length);
    const allowed = approvedComparisons.has(comparison);
    const spend = sum(spendRows.filter(r => r.channel === channel &&
      (r.source_campaign_id === null ? "spend_unallocated" : r.campaign_key) === campaign), "spend_usd", allowed && s.gates.spend);
    const n = complete && s.gates.customers ? count(credits.filter(a => a.channel === channel && bucket(a) === campaign && a.conversion_date === s.date).length) : null;
    return output(s, { channel, campaign_bucket: campaign, model_version: s.model }, {
      attributed_purchase_merchandise_net_usd: revenue, credited_orders: complete ? count(selected.length) : null,
      weighted_new_customers: n, spend_usd: spend, first_party_roas: allowed ? ratio(revenue, spend) : null,
      ncac_usd: allowed ? ratio(spend, n) : null,
    });
  });
}
export function funnelDaily(f: Facts, s: ReportScope, funnelVersion: string, stages: string[]): Row[] {
  preflight(f, s);
  if (stages.includes("all_sessions") || new Set(stages).size !== stages.length) throw new Error("invalid_stages");
  const sessions = f.sessions.filter(r => r.report_date === s.date && r.funnel_version === funnelVersion && r.analytics_eligible === true);
  const behavior = s.gates.behavior && sessions.every(r => r.behavior_complete === true);
  return ["all_sessions", ...stages].map(stage => {
    const population = sessions.filter(r => stage === "all_sessions" || (r.funnel_flags as Record<string, boolean | null> | null)?.[stage] === true);
    const flagsKnown = stage === "all_sessions" || sessions.every(r => typeof (r.funnel_flags as Record<string, unknown> | null)?.[stage] === "boolean");
    const mature = population.filter(r => r.conversion_window_complete === true);
    const conversion = behavior && flagsKnown && s.gates.orders && mature.every(r => typeof r.converted_session === "boolean");
    const converted = mature.filter(r => r.converted_session === true).length;
    return output(s, { stage_id: stage, funnel_version: funnelVersion }, {
      measured_sessions: behavior && flagsKnown ? population.length : null,
      stage_reached_sessions: behavior && flagsKnown ? population.length : null,
      mature_sessions: conversion ? mature.length : null, converted_sessions: conversion ? converted : null,
      session_conversion_rate: conversion ? ratio(count(converted), count(mature.length)) : null,
    });
  });
}
export function customerCohort(f: Facts, s: ReportScope, policy: {
  cohortMonth: string; horizonDays: number; graceSeconds: number; asOf: string;
  acquisitionDefinition: string; approvalRef: string; fullMonthCovered: boolean;
  originalLedgerIds: ReadonlySet<string>; ledgerLineageComplete: boolean;
}): Row {
  preflight(f, s); nyDate(policy.asOf);
  if (!policy.approvalRef || !Number.isSafeInteger(policy.horizonDays) || policy.horizonDays < 0 ||
      !Number.isSafeInteger(policy.graceSeconds) || policy.graceSeconds < 0 || !/^\d{4}-\d{2}-01$/.test(policy.cohortMonth)) throw new Error("invalid_cohort_policy");
  const customers = f.customers.filter(c => String(c.acquisition_date ?? "").slice(0, 7) === policy.cohortMonth.slice(0, 7));
  const mature = policy.fullMonthCovered && policy.ledgerLineageComplete && s.gates.customers && s.gates.ledger && s.gates.orders &&
    customers.every(c => c.analytics_permitted === true && c.identity_status === "resolved" && c.history_complete === true &&
      typeof c.first_eligible_order_at === "string" &&
      Date.parse(c.first_eligible_order_at) + policy.horizonDays * 86400000 + policy.graceSeconds * 1000 <= Date.parse(policy.asOf));
  let total = ZERO, repeat = 0, valuesComplete = true;
  if (mature) for (const c of customers) {
    const start = Date.parse(c.first_eligible_order_at as string), end = start + policy.horizonDays * 86400000;
    const orders = f.orders.filter(o => o.customer_id === c.customer_id && o.eligibility_status === "eligible" &&
      typeof o.paid_at === "string" && Date.parse(o.paid_at) >= start && Date.parse(o.paid_at) < end);
    if (orders.some(o => o.order_id !== c.first_eligible_order_id)) repeat++;
    const ids = new Set(orders.map(o => o.order_id));
    for (const l of f.sales_ledger) {
      if (!ids.has(l.order_id) || !merchandise.has(l.component as string) || l.sales_eligible !== true) continue;
      const original = policy.originalLedgerIds.has(l.ledger_entry_id as string);
      const occurred = Date.parse(l.effective_at as string);
      const parent = orders.find(o => o.order_id === l.order_id)!;
      if (original || occurred >= Date.parse(parent.paid_at as string) && occurred < end) {
        if (l.amount_usd === null) valuesComplete = false;
        else total += micros(l.amount_usd as string);
      }
    }
  }
  const revenue = mature && valuesComplete ? decimal(total) : null;
  const row = output(s, {
    cohort_month: policy.cohortMonth, observation_age_days: policy.horizonDays,
    acquisition_definition_version: policy.acquisitionDefinition, as_of_at: policy.asOf, mature,
  }, {
    cohort_customers: mature ? customers.length : null, repeat_customers: mature ? repeat : null,
    observed_net_merchandise_sales_usd: revenue, repeat_purchase_rate: mature ? ratio(count(repeat), count(customers.length)) : null,
    revenue_ltv_usd: ratio(revenue, mature ? count(customers.length) : null),
  });
  delete row.report_date;
  return row;
}
