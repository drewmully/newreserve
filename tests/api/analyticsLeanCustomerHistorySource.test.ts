/** Synthetic source-bound preparation only. Never permission or production acceptance. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { prepareMullyRefresh, type MullyRefreshInput } from "@/lib/analytics/mymullyRefresh";
import { mullyCustomerId } from "@/lib/analytics/mymullySource";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { assertInventorySources } from "@/lib/analytics/historyInventory";
import { key } from "@/lib/analytics/primitives";
import { fullFixture } from "../fixtures/analyticsFull";
import { refreshFixture } from "../fixtures/analyticsRefresh";

const asOf = "2026-03-05T12:00:00Z", origin = "2025-01-01T00:00:00Z";
function seal<T extends object>(payload: T) { return { ...payload, digest: evidenceDigest(payload) }; }
function reseal(value: { digest: string }) {
  const { digest: _digest, ...payload } = value; void _digest;
  value.digest = evidenceDigest(payload);
}
function fixture(): MullyRefreshInput & { customerHistory: NonNullable<MullyRefreshInput["customerHistory"]> } {
  const refresh = refreshFixture(), scope = refresh.intake.scope, full = fullFixture();
  refresh.intake.asOf = refresh.policy.asOf = refresh.readyAt = asOf;
  refresh.expiresAt = "2026-03-05T12:30:00Z";
  for (const packet of refresh.intake.packets) packet.capturedAt = asOf;
  refresh.policy.behaviorMode = "excluded";
  const header = { id: "gid://shopify/Order/1", createdAt: new Date(full.snapshot.createdAt).toISOString(),
    updatedAt: new Date(full.snapshot.updatedAt).toISOString() };
  const window = { from: origin, until: asOf, pageSize: 5, maxPages: 1 };
  refresh.history = [window];
  const inventory = seal({ version: 1 as const, projectRef: scope.projectRef, shop: scope.shop,
    approvalRef: "fixture:collection", capturedAt: asOf,
    windows: [{ ...window, pages: [{ cursor: null, nextCursor: null, orders: [header] }] }],
    orders: [header] });
  const snapshot = seal({ projectRef: scope.projectRef, shop: scope.shop, capturedAt: asOf,
    requestedIds: ["123"], entities: ["shopify"],
    customers: [{ id: "123", firebaseUid: null, createdAt: origin, updatedAt: origin }] });
  const canonical = mullyCustomerId(scope.projectRef, scope.shop, "123");
  const proofs = refresh.intake.packets.find(p => p.section === "proofs")!;
  const payload = structuredClone(full.evidence.proofs);
  payload.find(p => p.table === "customers")!.expectedKeys = [JSON.stringify([canonical])];
  payload.find(p => p.table === "identity_map")!.expectedKeys =
    [JSON.stringify(["shopify_customer", "123", origin, refresh.policy.mappingVersion])];
  proofs.payload = payload; proofs.sha256 = evidenceDigest(payload);
  return { refresh, source: { snapshot, mappingVersion: refresh.policy.mappingVersion,
    permissions: [{ customerId: "123", from: origin, to: null, permitted: true, removed: false,
      evidenceRef: "fixture:separate-analytics-authority" }],
    orders: [{ shop: scope.shop, apiVersion: "2026-07", order: { ...header,
      customer: { id: "gid://shopify/Customer/123" },
      lineItems: { nodes: [], pageInfo: { hasNextPage: false } } } }] },
  binding: { sourceId: "fixture:profile", schemaVersion: "profile-v1", approvalRef: "fixture:profile-binding",
    maxAgeSeconds: 3600 },
  customerHistory: { inventory, source: seal({ version: 1 as const, scope, capturedAt: asOf,
    sourceId: "fixture:independent-history", schemaVersion: "history-v1", sourceRecordRef: "fixture:independent-inventory",
    approvalRef: "fixture:reviewed-origin-and-sources", maxAgeSeconds: 3600, independentlyExtracted: true as const,
    sourceOrigin: origin, completeThrough: asOf, expectedSources: ["shopify"] as ["shopify"],
    migrationsReconciled: true as const, migrationEvidenceRef: "fixture:independent-migration-review",
    customers: [{ customerId: "123", orderIds: ["gid://shopify/Order/1"] }], guestOrderIds: [] }) } };
}
function built(input: ReturnType<typeof fixture>) {
  const prepared = prepareMullyRefresh(input);
  const f = fullFixture();
  return { prepared, result: buildFullReports({ ...f, policy: prepared.bundle.full.policy,
    evidence: prepared.bundle.full.evidence, events: [] }) };
}
let network: ReturnType<typeof vi.spyOn>;
beforeEach(() => { network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("no_network"); }); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); network.mockRestore(); });

it("wires independently inventoried history through the real preparer and full builder", () => {
  const i = fixture(), original = structuredClone(i);
  const { prepared, result } = built(i);
  expect(i).toEqual(original);
  expect(result.reports.store_daily[0]).toMatchObject({ new_customers: 1, ncac_usd: "5.000000" });
  expect(result.reports.customer_cohorts[0]).toMatchObject({
    cohort_customers: 1, repeat_purchase_rate: "0.000000", revenue_ltv_usd: "20.000000",
  });
  expect(prepared.bundle.full.evidence.proofs).toEqual(i.refresh.intake.packets.find(p => p.section === "proofs")!.payload);
  expect(prepared.bundle.full.evidence.cohortCoverage).toEqual(i.refresh.intake.packets.find(p => p.section === "cohortCoverage")!.payload);
  expect(prepared.bundle.base.policy.sourceInventory).toEqual(i.customerHistory.inventory);
  expect(prepared.refresh.intake.bindings.find(b => b.sourceId === "fixture:independent-history")?.sections).toEqual(["customerHistory"]);
});

it("keeps current-history defaults withheld when the new option is absent", () => {
  const i: MullyRefreshInput = fixture(); delete i.customerHistory;
  const prepared = prepareMullyRefresh(i), f = fullFixture();
  const result = buildFullReports({ ...f, policy: prepared.bundle.full.policy, evidence: prepared.bundle.full.evidence, events: [] });
  expect(result.reports.store_daily[0]).toMatchObject({ new_customers: null, ncac_usd: null });
  expect(result.reports.customer_cohorts[0].revenue_ltv_usd).toBeNull();
});

it("includes an inventoried eligible order before the report window in first-customer classification", () => {
  const i = fixture(), f = fullFixture(), oldOrder = key(f.shop, "9"), oldItem = key(f.shop, "9", "10");
  const header = { id: "gid://shopify/Order/9", createdAt: "2025-12-01T11:00:00.000Z",
    updatedAt: "2025-12-01T13:00:00.000Z" };
  i.source.orders.push({ ...i.source.orders[0], order: { ...i.source.orders[0].order, ...header } });
  i.customerHistory.source.customers[0].orderIds.push(header.id);
  reseal(i.customerHistory.source);
  i.customerHistory.inventory.windows[0].pages[0].orders.unshift(header);
  i.customerHistory.inventory.orders.push(header);
  reseal(i.customerHistory.inventory);
  const proofPacket = i.refresh.intake.packets.find(p => p.section === "proofs")!;
  const proofs = proofPacket.payload as typeof f.evidence.proofs;
  proofs.find(p => p.table === "orders")!.expectedKeys.push(JSON.stringify([oldOrder]));
  proofs.find(p => p.table === "order_items")!.expectedKeys.push(JSON.stringify([oldItem]));
  proofPacket.sha256 = evidenceDigest(proofs);
  f.base.orders.push({ ...f.base.orders[0], order_id: oldOrder, source_order_id: "9",
    created_at: header.createdAt, source_updated_at: header.updatedAt, paid_at: "2025-12-01T12:00:00Z",
    purchase_date: "2025-12-01" });
  f.base.order_items.push({ ...f.base.order_items[0], order_id: oldOrder, order_item_id: oldItem, source_line_id: "10" });
  const prepared = prepareMullyRefresh(i);
  const result = buildFullReports({ ...f, policy: prepared.bundle.full.policy, evidence: prepared.bundle.full.evidence, events: [] });
  expect(result.facts.customers[0]).toMatchObject({ history_complete: true,
    first_eligible_order_id: oldOrder, acquisition_date: "2025-12-01" });
  expect(result.reports.store_daily[0]).toMatchObject({ new_customers: 0, ncac_usd: null });
});

it.each(["unknown", "withdrawn"] as const)("does not turn complete history into %s analytics permission", state => {
  const i = fixture();
  if (state === "unknown") i.source.permissions = [];
  else i.source.permissions[0] = { ...i.source.permissions[0], permitted: false, removed: true };
  const { result } = built(i);
  expect(result.reports.store_daily[0]).toMatchObject({ new_customers: null, ncac_usd: null });
  expect(result.reports.customer_cohorts[0]).toMatchObject({ repeat_purchase_rate: null, revenue_ltv_usd: null });
});

it("refuses unsupported legacy sources instead of silently calling Shopify history complete", () => {
  const i = fixture(); i.customerHistory.source.expectedSources.push("legacy" as "shopify");
  reseal(i.customerHistory.source);
  expect(() => prepareMullyRefresh(i)).toThrow("customer_history_authority");
});

it.each(["approvalRef", "migrationEvidenceRef"] as const)("requires independent %s", field => {
  const i = fixture(); i.customerHistory.source[field] = ""; reseal(i.customerHistory.source);
  expect(() => prepareMullyRefresh(i)).toThrow("customer_history_authority");
});

it("rejects truncated expected history, guest substitution, and changed revisions", () => {
  const absent = fixture();
  absent.customerHistory.source.customers[0].orderIds.push("gid://shopify/Order/9");
  reseal(absent.customerHistory.source);
  expect(() => prepareMullyRefresh(absent)).toThrow("customer_history_order_inventory");
  const guest = fixture(); guest.source.orders[0].order.customer = null;
  expect(() => prepareMullyRefresh(guest)).toThrow();
  const changed = fixture(); changed.source.orders[0].order.updatedAt = "2026-01-01T14:00:00Z";
  expect(() => prepareMullyRefresh(changed)).toThrow("customer_history_order_inventory");
});

it("rejects duplicates and customer-subset evidence", () => {
  const i = fixture(); i.customerHistory.source.customers[0].orderIds.push("gid://shopify/Order/1");
  reseal(i.customerHistory.source);
  expect(() => prepareMullyRefresh(i)).toThrow("customer_history_duplicate_or_budget");
  const j = fixture(); j.customerHistory.source.customers[0].customerId = "456"; reseal(j.customerHistory.source);
  expect(() => prepareMullyRefresh(j)).toThrow("customer_history_customer_inventory");
});

it("rejects open pagination, missing history intervals, and update-only scans", () => {
  const open = fixture(); open.customerHistory.inventory.windows[0].pages[0].nextCursor = "next";
  reseal(open.customerHistory.inventory);
  expect(() => prepareMullyRefresh(open)).toThrow("inventory_incomplete_or_cursor");
  const gap = fixture(); gap.customerHistory.source.sourceOrigin = "2024-01-01T00:00:00Z";
  reseal(gap.customerHistory.source);
  expect(() => prepareMullyRefresh(gap)).toThrow("customer_history_window_gap");
  const updates = fixture(); updates.customerHistory.inventory.windows[0].scanBasis = "updated_at";
  reseal(updates.customerHistory.inventory);
  expect(() => prepareMullyRefresh(updates)).toThrow("customer_history_window_gap");
});

it("preserves the original authority capture and refuses expired, future, tampered or wrong-scope evidence", () => {
  for (const kind of ["expired", "future", "tampered", "scope"]) {
    const i = fixture();
    if (kind === "expired") i.customerHistory.source.capturedAt = "2026-03-04T12:00:00Z";
    if (kind === "future") i.customerHistory.source.capturedAt = "2026-03-06T12:00:00Z";
    if (kind === "scope") i.customerHistory.source.scope = { ...i.customerHistory.source.scope, shop: "other.myshopify.com" };
    if (kind !== "tampered") reseal(i.customerHistory.source);
    else i.customerHistory.source.migrationEvidenceRef = "changed";
    expect(() => prepareMullyRefresh(i)).toThrow(/customer_history_(clock|authority)/);
  }
});

it("refuses conflicting retained history or mismatched base inventory", () => {
  const i = fixture(); i.retainReviewed = { customerHistory: "fixture:export" };
  expect(() => prepareMullyRefresh(i)).toThrow("mully_history_source_collision");
  delete i.retainReviewed;
  i.refresh.commercePolicy.sourceInventory = { ...i.customerHistory.inventory, approvalRef: "changed" };
  expect(() => prepareMullyRefresh(i)).toThrow("mully_history_inventory_collision");
});

it("fails at the existing consumer fence when the later base run omits or changes an inventoried order", () => {
  const i = fixture(), out = prepareMullyRefresh(i);
  const policy = out.bundle.base.policy;
  const sources = i.source.orders.map(commerce => ({ source: { commerce } }));
  expect(() => assertInventorySources(policy.sourceInventory, sources, i.refresh.intake.scope)).not.toThrow();
  expect(() => assertInventorySources(policy.sourceInventory, [], i.refresh.intake.scope)).toThrow("inventory_consumer_mismatch");
  i.source.orders[0].order.updatedAt = "2026-01-01T15:00:00Z";
  expect(() => assertInventorySources(policy.sourceInventory, sources, i.refresh.intake.scope)).toThrow("inventory_consumer_mismatch");
});

function cutThrough(i: ReturnType<typeof fixture>, through: string) {
  i.customerHistory.source.completeThrough = through; reseal(i.customerHistory.source);
  i.customerHistory.inventory.windows[0].until = through; reseal(i.customerHistory.inventory);
  i.refresh.history[0].until = through;
}
it("accepts an early-month mature cohort without waiting an invented month-end plus H", () => {
  const i = fixture(); cutThrough(i, "2026-02-02T00:00:00Z");
  const { result } = built(i);
  expect(result.reports.customer_cohorts[0]).toMatchObject({
    mature: true, cohort_customers: 1, repeat_purchase_rate: "0.000000", revenue_ltv_usd: "20.000000",
  });
});

it("withholds a real derived member endpoint or grace that exceeds the covered source cutoff", () => {
  const i = fixture(); cutThrough(i, "2026-02-02T00:00:00Z");
  i.refresh.policy.cohorts[0].graceSeconds = 7 * 86400;
  expect(built(i).result.reports.customer_cohorts[0]).toMatchObject({
    mature: false, repeat_purchase_rate: null, revenue_ltv_usd: null,
  });
  i.refresh.policy.cohorts[0].graceSeconds = 0;
  const prepared = prepareMullyRefresh(i), f = fullFixture();
  f.base.orders[0].paid_at = "2026-01-31T12:00:00Z";
  f.base.orders[0].purchase_date = "2026-01-31";
  const changed = buildFullReports({ ...f, policy: prepared.bundle.full.policy, evidence: prepared.bundle.full.evidence, events: [] });
  expect(changed.reports.customer_cohorts[0]).toMatchObject({
    mature: false, cohort_customers: null, repeat_purchase_rate: null, revenue_ltv_usd: null,
  });
});

it("requires the entire NY cohort month and handles the DST boundary exactly", () => {
  const i = fixture(); cutThrough(i, "2026-02-01T04:59:59Z");
  expect(() => prepareMullyRefresh(i)).toThrow("customer_history_cohort_coverage");
  cutThrough(i, "2026-02-01T05:00:00Z");
  expect(() => prepareMullyRefresh(i)).not.toThrow();
  i.refresh.policy.cohorts[0].month = "2026-03-01";
  const coverage = i.refresh.intake.packets.find(p => p.section === "cohortCoverage")!;
  (coverage.payload as ReturnType<typeof fullFixture>["evidence"]["cohortCoverage"])[0].month = "2026-03-01";
  coverage.sha256 = evidenceDigest(coverage.payload);
  const newer = "2026-04-02T12:00:00Z";
  i.refresh.intake.asOf = i.refresh.policy.asOf = i.refresh.readyAt = newer;
  i.refresh.expiresAt = "2026-04-02T12:30:00Z";
  for (const p of i.refresh.intake.packets) p.capturedAt = newer;
  i.source.snapshot.capturedAt = newer; reseal(i.source.snapshot);
  i.customerHistory.source.capturedAt = newer;
  i.customerHistory.inventory.capturedAt = newer;
  cutThrough(i, "2026-04-01T03:59:59Z");
  expect(() => prepareMullyRefresh(i)).toThrow("customer_history_cohort_coverage");
  cutThrough(i, "2026-04-01T04:00:00Z");
  expect(() => prepareMullyRefresh(i)).not.toThrow();
});

it("withholds when an explicit source-bound map lacks a cohort member, never falling back to run time", () => {
  const f = fullFixture();
  f.evidence.customerHistory["other-customer"] = { ...f.evidence.customerHistory["customer-fixture"],
    completeThrough: "2026-03-02T00:00:00Z" };
  expect(buildFullReports(f).reports.customer_cohorts[0]).toMatchObject({
    mature: false, cohort_customers: null, repeat_purchase_rate: null, revenue_ltv_usd: null,
  });
});

it.each([
  ["2026-01-31T11:59:59.999Z", 0, false],
  ["2026-01-31T12:00:00Z", 0, true],
  ["2026-01-31T12:00:00Z", 1, false],
  ["2026-01-31T12:00:01Z", 1, true],
] as const)("bounds H and grace at the actual consumer: %s + %s seconds", (cutoff, grace, mature) => {
  const f = fullFixture();
  f.evidence.customerHistory["customer-fixture"].completeThrough = cutoff;
  f.policy.cohorts[0].graceSeconds = grace;
  expect(buildFullReports(f).reports.customer_cohorts[0].mature).toBe(mature);
  f.policy.asOf = "2026-01-31T11:59:59Z";
  expect(buildFullReports(f).reports.customer_cohorts[0].mature).toBe(false);
});

it("rejects malformed optional cutoff evidence rather than removing the bound", () => {
  const i = fixture();
  const prior = i.refresh.intake.packets.find(p => p.section === "customerHistory")!;
  const canonical = mullyCustomerId(i.refresh.intake.scope.projectRef, i.refresh.intake.scope.shop, "123");
  prior.payload = { [canonical]: { expectedSources: ["shopify"], completeSources: ["shopify"],
    approvalRef: "fixture:review", migrationsReconciled: true, completeThrough: "bad-time" } };
  prior.sha256 = evidenceDigest(prior.payload);
  const without: MullyRefreshInput = { ...i, retainReviewed: { customerHistory: prior.sourceId } };
  delete without.customerHistory;
  expect(() => prepareMullyRefresh(without)).toThrow("invalid_timestamp");
});

it.each(["ledger", "lineage"] as const)("retains repeat purchase when only %s revenue evidence is missing", missing => {
  const i = fullFixture();
  if (missing === "ledger") i.evidence.dateCoverage[0].gates.ledger = false;
  else i.evidence.cohortCoverage[0].ledgerLineageComplete = false;
  expect(buildFullReports(i).reports.customer_cohorts[0]).toMatchObject({
    mature: true, cohort_customers: 1, repeat_customers: 0, repeat_purchase_rate: "0.000000",
    observed_net_merchandise_sales_usd: null, revenue_ltv_usd: null,
    readiness: { repeat_purchase_rate: "observed_unverified", revenue_ltv_usd: "withheld" },
  });
});

it("retains a positive repeat numerator without inventing a revenue zero", () => {
  const i = fullFixture(), nextOrder = key(i.shop, "9"), nextItem = key(i.shop, "9", "10");
  i.base.orders.push({ ...i.base.orders[0], order_id: nextOrder, source_order_id: "9",
    paid_at: "2026-01-05T12:00:00Z", purchase_date: "2026-01-05" });
  i.base.order_items.push({ ...i.base.order_items[0], order_id: nextOrder, order_item_id: nextItem, source_line_id: "10" });
  i.evidence.orderIdentities.push({ ...i.evidence.orderIdentities[0], orderId: nextOrder });
  i.evidence.proofs.find(p => p.table === "orders")!.expectedKeys.push(JSON.stringify([nextOrder]));
  i.evidence.proofs.find(p => p.table === "order_items")!.expectedKeys.push(JSON.stringify([nextItem]));
  i.evidence.dateCoverage[0].gates.ledger = false;
  expect(buildFullReports(i).reports.customer_cohorts[0]).toMatchObject({
    cohort_customers: 1, repeat_customers: 1, repeat_purchase_rate: "1.000000",
    observed_net_merchandise_sales_usd: null, revenue_ltv_usd: null,
  });
});

it("withholds repeat and LTV when cohort membership or customer/order completeness is missing", () => {
  for (const missing of ["month", "customers", "orders"] as const) {
    const i = fullFixture();
    if (missing === "month") i.evidence.cohortCoverage[0].fullMonthCovered = false;
    else i.evidence.dateCoverage[0].gates[missing] = false;
    expect(buildFullReports(i).reports.customer_cohorts[0]).toMatchObject({
      cohort_customers: null, repeat_purchase_rate: null, revenue_ltv_usd: null,
    });
  }
});

it("does not permit unknown fields or an oversized private history packet", () => {
  const i = fixture();
  Object.assign(i.customerHistory.source, { email: "not-an-allowed-source-field" });
  reseal(i.customerHistory.source);
  expect(() => prepareMullyRefresh(i)).toThrow("customer_history_schema");
  delete (i.customerHistory.source as unknown as Record<string, unknown>).email;
  i.customerHistory.source.sourceRecordRef = "x".repeat(250001);
  reseal(i.customerHistory.source);
  expect(() => prepareMullyRefresh(i)).toThrow("customer_history_budget");
});

it("uses source-scoped surrogate keys without exporting raw customer IDs in history payload", () => {
  const i = fixture(), out = prepareMullyRefresh(i);
  const ids = Object.keys(out.bundle.full.evidence.customerHistory);
  expect(ids).toEqual([mullyCustomerId(i.refresh.intake.scope.projectRef, i.refresh.intake.scope.shop, "123")]);
  expect(ids[0]).not.toBe(key("123"));
  expect(out.refresh.intake.packets.find(p => p.section === "customerHistory")?.sourceRecordRef).toMatch(/^customer-history:sha256:[a-f0-9]{64}$/);
});
