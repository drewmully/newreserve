import { canonicalJson, evidenceDigest, type EvidenceBinding, type EvidencePacket, type EvidenceScope } from "./evidenceIntake";
import { inventoryOrder, validateHistoryInventory, type HistoryInventory } from "./historyInventory";
import { mullyCustomerId, type MullyCustomerSnapshot } from "./mymullySource";
import type { FullBuildEvidence, FullBuildPolicy } from "./fullReportBuild";
import { nyDate } from "./primitives";
import { shopifyId, sourceObject, type ShopifyOrderDocument } from "./shopifySource";

/** Private, independently extracted inventory. Source presence, a current
 * profile's first_order_at, and this digest are NOT completeness authority.
 * Only an owner-reviewed, Shopify-complete scope is supported here. */
export type CustomerHistorySource = {
  version: 1;
  scope: EvidenceScope;
  capturedAt: string;
  sourceId: string;
  schemaVersion: string;
  sourceRecordRef: string;
  approvalRef: string;
  maxAgeSeconds: number;
  independentlyExtracted: true;
  sourceOrigin: string;
  completeThrough: string;
  expectedSources: ["shopify"];
  migrationsReconciled: true;
  migrationEvidenceRef: string;
  customers: { customerId: string; orderIds: string[] }[];
  guestOrderIds: string[];
  digest: string;
};
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 512;
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const keys = (value: object, expected: string[]) => {
  if (!same(Object.keys(value).sort(), expected.sort())) throw new Error("customer_history_schema");
};
function nyMidnight(date: string): number {
  for (const hour of [4, 5]) {
    const at = Date.parse(`${date}T00:00:00Z`) + hour * 3600000;
    if (Number.isFinite(at) && nyDate(new Date(at).toISOString()) === date &&
        nyDate(new Date(at - 1).toISOString()) !== date) return at;
  }
  throw new Error("customer_history_calendar");
}

/** Build the existing customerHistory packet and preserve its independent
 * source binding. Does not create identity, permission, financial/cohort
 * controls or reconciliation proofs. No I/O or activation. */
export function prepareCustomerHistorySource(source: CustomerHistorySource, input: {
  scope: EvidenceScope; asOf: string; expiresAt: string;
  inventory: HistoryInventory; snapshot: MullyCustomerSnapshot;
  orders: ShopifyOrderDocument[]; cohorts: FullBuildPolicy["cohorts"];
  cohortCoverage: FullBuildEvidence["cohortCoverage"];
}): { packet: EvidencePacket<"customerHistory">; binding: EvidenceBinding; inventory: HistoryInventory } {
  if (!source || typeof source !== "object" || Array.isArray(source) ||
      Buffer.byteLength(canonicalJson(source)) > 250000) throw new Error("customer_history_budget");
  keys(source, ["version", "scope", "capturedAt", "sourceId", "schemaVersion", "sourceRecordRef",
    "approvalRef", "maxAgeSeconds", "independentlyExtracted", "sourceOrigin", "completeThrough",
    "expectedSources", "migrationsReconciled", "migrationEvidenceRef", "customers", "guestOrderIds", "digest"]);
  const { digest, ...payload } = source;
  if (source.version !== 1 || digest !== evidenceDigest(payload) || !same(source.scope, input.scope) ||
      ![source.sourceId, source.schemaVersion, source.sourceRecordRef, source.approvalRef, source.migrationEvidenceRef].every(text) ||
      source.independentlyExtracted !== true || source.migrationsReconciled !== true ||
      !same(source.expectedSources, ["shopify"])) throw new Error("customer_history_authority");
  [source.capturedAt, source.sourceOrigin, source.completeThrough, input.asOf, input.expiresAt].forEach(nyDate);
  if (!Number.isSafeInteger(source.maxAgeSeconds) || source.maxAgeSeconds < 1 || source.maxAgeSeconds > 604800 ||
      Date.parse(source.capturedAt) > Date.parse(input.asOf) ||
      Date.parse(input.expiresAt) - Date.parse(source.capturedAt) > source.maxAgeSeconds * 1000 ||
      Date.parse(source.sourceOrigin) >= Date.parse(source.completeThrough) ||
      Date.parse(source.completeThrough) > Date.parse(source.capturedAt))
    throw new Error("customer_history_clock");
  const nextDay = new Date(Date.parse(`${input.scope.throughDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const reportEnd = nyMidnight(nextDay);
  if (!Number.isFinite(reportEnd) || Date.parse(source.completeThrough) < reportEnd ||
      Date.parse(source.sourceOrigin) > nyMidnight(input.scope.fromDate))
    throw new Error("customer_history_report_coverage");
  const inventory = validateHistoryInventory(input.inventory, { ...input.scope, asOf: input.asOf });
  const windows = [...inventory.windows].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  if (windows.some((w, i) => (w.scanBasis ?? "created_at") !== "created_at" ||
      Date.parse(w.from) !== Date.parse(i ? windows[i - 1].until : source.sourceOrigin)) ||
      Date.parse(windows.at(-1)!.until) !== Date.parse(source.completeThrough))
    throw new Error("customer_history_window_gap");
  if (Date.parse(inventory.capturedAt) > Date.parse(source.capturedAt) ||
      Date.parse(input.expiresAt) - Date.parse(inventory.capturedAt) > source.maxAgeSeconds * 1000)
    throw new Error("customer_history_inventory_clock");
  if (!Array.isArray(source.customers) || source.customers.length > 100 ||
      !Array.isArray(source.guestOrderIds) || source.guestOrderIds.length > 100 ||
      input.orders.length > 100 || input.snapshot.projectRef !== input.scope.projectRef ||
      input.snapshot.shop !== input.scope.shop) throw new Error("customer_history_scope");
  const { digest: snapshotDigest, ...snapshotPayload } = input.snapshot;
  if (snapshotDigest !== evidenceDigest(snapshotPayload)) throw new Error("customer_history_snapshot");
  const expected = new Map<string, string | null>();
  const history: FullBuildEvidence["customerHistory"] = {};
  const customerIds = new Set<string>();
  const add = (orderId: string, customer: string | null) => {
    shopifyId(orderId, "Order");
    if (expected.has(orderId) || expected.size >= 100) throw new Error("customer_history_duplicate_or_budget");
    expected.set(orderId, customer);
  };
  for (const customer of source.customers) {
    keys(customer, ["customerId", "orderIds"]);
    const canonical = mullyCustomerId(input.scope.projectRef, input.scope.shop, customer.customerId);
    if (customerIds.has(customer.customerId) || !Array.isArray(customer.orderIds) ||
        !customer.orderIds.length || customer.orderIds.length > 100) throw new Error("customer_history_customer_inventory");
    customerIds.add(customer.customerId);
    customer.orderIds.forEach(id => add(id, customer.customerId));
    history[canonical] = { expectedSources: ["shopify"], completeSources: ["shopify"],
      approvalRef: source.approvalRef, migrationsReconciled: true, completeThrough: source.completeThrough };
  }
  source.guestOrderIds.forEach(id => add(id, null));
  if (!same([...customerIds].sort(), input.snapshot.customers.map(c => c.id).sort()) ||
      !same([...customerIds].sort(), [...input.snapshot.requestedIds].sort()))
    throw new Error("customer_history_customer_inventory");
  const actual = new Map<string, string | null>();
  for (const document of input.orders) {
    if (document.shop !== input.scope.shop || document.order.customer === undefined)
      throw new Error("customer_history_order_scope");
    const id = String(document.order.id); shopifyId(id, "Order");
    const customer = document.order.customer === null ? null : shopifyId(sourceObject(document.order.customer).id, "Customer");
    if (actual.has(id) || !expected.has(id) || expected.get(id) !== customer)
      throw new Error("customer_history_order_inventory");
    actual.set(id, customer);
  }
  const actualOrders = input.orders.map(d => inventoryOrder(d.order)).sort((a, b) => a.id.localeCompare(b.id));
  if (actual.size !== expected.size || !same(actualOrders, inventory.orders))
    throw new Error("customer_history_order_inventory");
  // Month membership must be fully covered. Follow-up is bounded separately
  // at the actual cohort consumer using each derived first-paid clock plus H
  // and grace, never an invented next-month-plus-H waiting period.
  for (const cohort of input.cohorts) {
    const coverage = input.cohortCoverage.find(c => c.month === cohort.month && c.horizonDays === cohort.horizonDays);
    if (!coverage?.fullMonthCovered) continue;
    const month = new Date(`${cohort.month}T00:00:00Z`);
    month.setUTCMonth(month.getUTCMonth() + 1);
    const monthEnd = nyMidnight(month.toISOString().slice(0, 10));
    if (Date.parse(source.sourceOrigin) > nyMidnight(cohort.month) ||
        Date.parse(source.completeThrough) < monthEnd) throw new Error("customer_history_cohort_coverage");
  }
  const capturedAt = new Date(Math.min(Date.parse(source.capturedAt), Date.parse(inventory.capturedAt))).toISOString();
  return {
    packet: { section: "customerHistory", sourceId: source.sourceId, schemaVersion: source.schemaVersion,
      scope: input.scope, capturedAt, sourceRecordRef: `customer-history:sha256:${evidenceDigest({
        authority: digest, inventory: inventory.digest, snapshot: snapshotDigest,
        orders: evidenceDigest(input.orders),
      })}`, sha256: evidenceDigest(history), payload: history },
    binding: { sourceId: source.sourceId, schemaVersion: source.schemaVersion, approvalRef: source.approvalRef,
      maxAgeSeconds: source.maxAgeSeconds, sections: ["customerHistory"], independentControlSource: true },
    inventory,
  };
}
