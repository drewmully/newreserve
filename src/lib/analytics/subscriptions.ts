/** Offline current-state projection only. No provider/client, persistence or billing actions. */
import { decimal, key, micros, nyDate } from "./primitives";

export type SubscriptionPolicy = {
  definitionRef: string;
  countedStatuses: string[];
  excludedStatuses: string[];
  deduplication: "identical_normalized_contract";
  subscriberBasis: "shopify_customer_id";
  renewalDays: number;
  recurringValue: null | {
    definitionRef: string;
    currencyCode: string;
    amountBasis: "trusted_complete_billing_cycle";
    prepaid: "withhold" | "normalize_billing_cycle";
    annualization: "mrr_times_12";
    rounding: "per_contract_truncate_6dp";
  };
};
type Metric<T> = { value: T | null; readiness: "observed_unverified" | "withheld"; reasons: string[] };
type ObjectRow = Record<string, unknown>;
type Contract = {
  contractKey: string; subscriberKey: string | null; status: string;
  nextBillingAt: string | null; currencyCode: string | null;
  billingInterval: string | null; billingIntervalCount: number | null;
  isPrepaid: boolean | null;
  lines: { unitPrice: string | null; quantity: number | null }[] | null;
};
function object(value: unknown, allowed: string[], required: string[] = []): ObjectRow {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(k => !allowed.includes(k)) ||
      required.some(k => !Object.hasOwn(value, k))) throw new Error("subscription_shape");
  return value as ObjectRow;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error("subscription_text");
  return value;
}
function id(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value !== "string" || !/^[1-9]\d{0,127}$/.test(value)) throw new Error("subscription_identifier");
  return value; // Never round a provider identifier through Number().
}
function integer(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max)
    throw new Error("subscription_integer");
  return Number(value);
}
function timestamp(value: unknown): string {
  const s = text(value); nyDate(s);
  return new Date(s).toISOString();
}
function status(value: unknown): string {
  const s = text(value);
  if (!/^[A-Z][A-Z_]{0,39}$/.test(s)) throw new Error("subscription_status");
  return s;
}
function currency(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = text(value);
  if (!/^[A-Z]{3}$/.test(s)) throw new Error("subscription_currency");
  return s;
}
function amount(value: unknown): string {
  const n = micros(text(value));
  if (n < BigInt(0)) throw new Error("subscription_negative_amount");
  return decimal(n);
}
function metric<T>(value: T | null, reasons: string[]): Metric<T> {
  return { value: reasons.length ? null : value,
    readiness: reasons.length ? "withheld" : "observed_unverified", reasons: [...new Set(reasons)].sort() };
}
function validatePolicy(policy: SubscriptionPolicy) {
  object(policy, ["definitionRef", "countedStatuses", "excludedStatuses", "deduplication",
    "subscriberBasis", "renewalDays", "recurringValue"], ["recurringValue"]);
  text(policy.definitionRef); integer(policy.renewalDays, 90);
  if (!Array.isArray(policy.countedStatuses) || !policy.countedStatuses.length ||
      !Array.isArray(policy.excludedStatuses)) throw new Error("subscription_status_policy");
  const statuses = [...policy.countedStatuses, ...policy.excludedStatuses].map(status);
  if (statuses.length > 30 || new Set(statuses).size !== statuses.length ||
      policy.deduplication !== "identical_normalized_contract" ||
      policy.subscriberBasis !== "shopify_customer_id") throw new Error("subscription_count_policy");
  if (policy.recurringValue !== null) {
    const p = policy.recurringValue;
    object(p, ["definitionRef", "currencyCode", "amountBasis", "prepaid", "annualization", "rounding"]);
    text(p.definitionRef);
    if (!currency(p.currencyCode) || p.amountBasis !== "trusted_complete_billing_cycle" ||
        !["withhold", "normalize_billing_cycle"].includes(p.prepaid) ||
        p.annualization !== "mrr_times_12" || p.rounding !== "per_contract_truncate_6dp")
      throw new Error("subscription_recurring_policy");
  }
}
function normalize(value: unknown, shop: string): Contract {
  const r = object(value, ["id", "status", "customer", "nextBillingDateEpoch",
    "currencyCode", "billingPolicy", "isPrepaid", "lines"], ["id", "status"]);
  const customer = r.customer == null ? null : object(r.customer, ["shopifyId"]);
  const billing = r.billingPolicy == null ? null : object(r.billingPolicy, ["interval", "intervalCount"]);
  let nextBillingAt: string | null = null;
  if (r.nextBillingDateEpoch != null) {
    integer(r.nextBillingDateEpoch, 253402300799); // UTC seconds through year 9999.
    nextBillingAt = new Date(Number(r.nextBillingDateEpoch) * 1000).toISOString();
  }
  if (r.isPrepaid != null && typeof r.isPrepaid !== "boolean") throw new Error("subscription_prepaid");
  if (r.lines != null && (!Array.isArray(r.lines) || r.lines.length > 100))
    throw new Error("subscription_lines");
  return {
    contractKey: key("loop-contract", shop, id(r.id)),
    subscriberKey: customer?.shopifyId == null ? null : key("shopify-subscriber", shop, id(customer.shopifyId)),
    status: status(r.status), nextBillingAt, currencyCode: currency(r.currencyCode),
    billingInterval: billing?.interval == null ? null : status(billing.interval),
    billingIntervalCount: billing?.intervalCount == null ? null : integer(billing.intervalCount, 1200),
    isPrepaid: r.isPrepaid == null ? null : r.isPrepaid as boolean,
    lines: r.lines == null ? null : (r.lines as unknown[]).map(v => {
      const line = object(v, ["price", "quantity"]);
      return { unitPrice: line.price == null ? null : amount(line.price),
        quantity: line.quantity == null ? null : integer(line.quantity, 100000) };
    }),
  };
}

/** Input is an explicitly minimized projection, NOT a raw Loop response.
 * Scope/page attestations and independent full-cycle amount evidence must be
 * reviewed externally. This transform cannot certify a provider's completeness.
 */
export function buildSubscriptionSnapshot(input: unknown, policy: SubscriptionPolicy) {
  validatePolicy(policy);
  const root = object(input, ["shop", "asOf", "evidenceRef", "scopeComplete", "pages", "recurringAmounts"],
    ["shop", "asOf", "evidenceRef", "scopeComplete", "pages"]);
  if (Buffer.byteLength(JSON.stringify({ input, policy })) > 5000000) throw new Error("subscription_byte_budget");
  const shop = text(root.shop), asOf = timestamp(root.asOf), evidenceRef = text(root.evidenceRef);
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ||
      typeof root.scopeComplete !== "boolean") throw new Error("subscription_scope");
  if (!Array.isArray(root.pages) || !root.pages.length || root.pages.length > 20)
    throw new Error("subscription_pages");
  const contracts = new Map<string, Contract>();
  let rowCount = 0, duplicates = 0, paginationComplete = false;
  for (const [index, value] of root.pages.entries()) {
    const page = object(value, ["pageNo", "hasNextPage", "rows"], ["pageNo", "hasNextPage", "rows"]);
    if (page.pageNo !== index + 1 || typeof page.hasNextPage !== "boolean" ||
        !Array.isArray(page.rows) || page.rows.length > 500 ||
        index < root.pages.length - 1 && page.hasNextPage !== true ||
        page.hasNextPage && page.rows.length === 0) throw new Error("subscription_page_sequence");
    paginationComplete = page.hasNextPage === false;
    rowCount += page.rows.length;
    if (rowCount > 1000) throw new Error("subscription_row_budget");
    for (const raw of page.rows) {
      const row = normalize(raw, shop), prior = contracts.get(row.contractKey);
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(row)) throw new Error("subscription_duplicate_conflict");
        duplicates++;
      } else contracts.set(row.contractKey, row);
    }
  }
  const rows = [...contracts.values()].sort((a, b) => a.contractKey.localeCompare(b.contractKey));
  const global: string[] = [];
  if (!root.scopeComplete || !paginationComplete) global.push("incomplete_snapshot_scope");
  if (rows.some(r => ![...policy.countedStatuses, ...policy.excludedStatuses].includes(r.status)))
    global.push("unknown_status");
  const active = rows.filter(r => policy.countedStatuses.includes(r.status));
  const subscriberIssues = active.some(r => r.subscriberKey === null) ? ["missing_subscriber_id"] : [];
  const renewalIssues = active.some(r => r.nextBillingAt === null) ? ["missing_next_billing_date"] : [];
  if (active.some(r => r.nextBillingAt !== null && Date.parse(r.nextBillingAt) < Date.parse(asOf)))
    renewalIssues.push("past_next_billing_date");
  const until = new Date(Date.parse(asOf) + policy.renewalDays * 86400000).toISOString();
  const renewals = active.filter(r => r.nextBillingAt !== null &&
    Date.parse(r.nextBillingAt) >= Date.parse(asOf) && Date.parse(r.nextBillingAt) < Date.parse(until));

  // No revenue is inferred from lines[].price, quantity, or the first plan.
  const amounts = new Map<string, { amount: string; currencyCode: string; evidenceRef: string }>();
  if (root.recurringAmounts !== undefined && (!Array.isArray(root.recurringAmounts) || root.recurringAmounts.length > 1000))
    throw new Error("subscription_amounts");
  for (const value of (root.recurringAmounts ?? []) as unknown[]) {
    const a = object(value, ["contractId", "asOf", "amount", "currencyCode", "evidenceRef"],
      ["contractId", "asOf", "amount", "currencyCode", "evidenceRef"]);
    const k = key("loop-contract", shop, id(a.contractId)), code = currency(a.currencyCode);
    if (!contracts.has(k) || amounts.has(k) || timestamp(a.asOf) !== asOf || !code)
      throw new Error("subscription_amount_binding");
    amounts.set(k, { amount: amount(a.amount), currencyCode: code, evidenceRef: text(a.evidenceRef) });
  }
  const revenueIssues = [...global], p = policy.recurringValue;
  let mrr = BigInt(0);
  if (!p) revenueIssues.push("recurring_policy_missing");
  else for (const r of active) {
    const a = amounts.get(r.contractKey);
    const reasons: string[] = [];
    if (!a) reasons.push("complete_cycle_amount_missing");
    if (!r.currencyCode) reasons.push("contract_currency_missing");
    else if (r.currencyCode !== p.currencyCode || a && a.currencyCode !== r.currencyCode)
      reasons.push("currency_mismatch");
    if (r.isPrepaid === null) reasons.push("prepaid_unknown");
    else if (r.isPrepaid && p.prepaid === "withhold") reasons.push("prepaid_value_withheld");
    if (!["MONTH", "YEAR"].includes(r.billingInterval ?? "") || r.billingIntervalCount === null)
      reasons.push("unsupported_billing_cadence");
    revenueIssues.push(...reasons);
    if (!reasons.length && a) {
      const months = BigInt(r.billingIntervalCount!) * BigInt(r.billingInterval === "YEAR" ? 12 : 1);
      mrr += micros(a.amount) / months;
    }
  }
  return {
    scope: { shop, asOf, evidenceRef, renewalUntilExclusive: until, paginationComplete,
      scopeComplete: root.scopeComplete, definitionRef: policy.definitionRef,
      recurringDefinitionRef: p?.definitionRef ?? null, currencyCode: p?.currencyCode ?? null,
      recurringEvidenceRefs: [...new Set(active.flatMap(r => {
        const a = amounts.get(r.contractKey); return a ? [a.evidenceRef] : [];
      }))].sort(),
      definitionStatus: "proposed" as const, certified: false as const, historicalTrendsSupported: false as const },
    rows, duplicates,
    metrics: {
      activeContracts: metric(active.length, global),
      distinctSubscribers: metric(new Set(active.map(r => r.subscriberKey)).size, [...global, ...subscriberIssues]),
      nextRenewalAt: metric(active.map(r => r.nextBillingAt).filter((s): s is string => s !== null).sort()[0] ?? null,
        [...global, ...renewalIssues]),
      renewingContractsInWindow: metric(renewals.length, [...global, ...renewalIssues]),
      proposedMrr: metric(revenueIssues.length ? null : decimal(mrr), revenueIssues),
      proposedArr: metric(revenueIssues.length ? null : decimal(mrr * BigInt(12)), revenueIssues),
    },
  };
}
