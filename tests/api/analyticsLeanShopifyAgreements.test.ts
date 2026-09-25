/** Synthetic vendor transport only. No customer records or external network. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readShopifyAgreements, mapShopifyAgreements, type AgreementDocument,
  type AgreementPolicy } from "@/lib/analytics/shopifyAgreements";
import { SHOPIFY_ANALYTICS_API_VERSION, type ShopifyOrderDocument, type SourceObject } from "@/lib/analytics/shopifySource";
import { normalizeCommerce } from "@/lib/analytics/commerce";
import { normalizeLedger } from "@/lib/analytics/financial";
import { prepareMullyRefresh } from "@/lib/analytics/mymullyRefresh";
import { readMullyCustomers } from "@/lib/analytics/mymullySource";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { fullFixture } from "../fixtures/analyticsFull";
import contracts from "@/lib/analytics/lean-contracts.json";
import { productDaily, storeDaily, type Facts, type ReportScope } from "@/lib/analytics/reporting";
import { readAgreementFile } from "../../scripts/analytics/read-shopify-agreements.mjs";
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const shop = "fixture.myshopify.com", created = "2026-01-01T12:00:00Z";
const paid = "2026-01-01T12:01:00Z", changed = "2026-01-02T12:00:00Z";
const updated = "2026-01-03T12:00:00Z";
const gid = (kind: string, id: string) => `gid://shopify/${kind}/${id}`;
const bag = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
function sale(id: string, total = "20", tax = "2", discount = "2"): SourceObject {
  return { id: gid("ProductSale", id), __typename: "ProductSale", actionType: "ORDER",
    lineType: "PRODUCT", quantity: 2, lineItem: { id: gid("LineItem", "3") },
    totalAmount: bag(total), totalTaxAmount: bag(tax), totalDiscountAmountBeforeTaxes: bag(discount),
    totalDiscountAmountAfterTaxes: bag("0") };
}
function fixture() {
  const commerce: ShopifyOrderDocument = { shop, apiVersion: SHOPIFY_ANALYTICS_API_VERSION, order: {
    id: gid("Order", "1"), customer: null, createdAt: created, updatedAt: updated, currencyCode: "USD",
    edited: true, taxesIncluded: true, test: false, cancelledAt: null, originalTotalPriceSet: bag("20"),
    // Deliberately unrelated mutable current lines. Original values must come
    // from the immutable agreement instead.
    subtotalPriceSet: bag("999"), lineItems: { nodes: [], pageInfo: { hasNextPage: false } },
    transactionsCount: { count: 1, precision: "EXACT" },
    transactions: [{ id: gid("OrderTransaction", "8"), kind: "SALE", status: "SUCCESS", gateway: "fixture",
      test: false, createdAt: created, processedAt: paid, amountSet: bag("20"), parentTransaction: null }],
  } };
  const document: AgreementDocument = { shop, apiVersion: SHOPIFY_ANALYTICS_API_VERSION,
    orderGid: gid("Order", "1"), sourceUpdatedAt: updated, capturedAt: "2026-01-04T00:00:00Z", complete: true,
    agreements: [{ id: gid("OrderAgreement", "10"), __typename: "OrderAgreement",
      reason: "ORDER", happenedAt: created, sales: [sale("11")] },
    { id: gid("RefundAgreement", "12"), __typename: "RefundAgreement", reason: "REFUND",
      happenedAt: changed, sales: [{ ...sale("13", "-10", "-1", "-1"), actionType: "RETURN", quantity: -1 }] }] };
  const policy: AgreementPolicy = { decision: { eligibility: "eligible", commerceSource: "storefront",
    acquisitionEligible: true, approvalRef: "fixture:commerce" }, sourceEvidenceRef: "fixture:retained-agreements",
    lineClasses: { "3": "merchandise" }, financialApprovalRef: "fixture:finance",
    saleClock: "paid_at", changeClock: "agreement_happened_at" };
  return { commerce, document, policy };
}
let network: ReturnType<typeof vi.fn>;
beforeEach(() => { network = vi.fn(() => { throw new Error("external_network_forbidden"); }); vi.stubGlobal("fetch", network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
const map = (f = fixture()) => mapShopifyAgreements(f.commerce, f.document, f.policy);
it("preserves original purchase, tax, discount and quantity after edits/refunds", () => {
  const r = map(), facts = normalizeCommerce(r.snapshot, r.decision, "test");
  expect(facts.order_items[0]).toMatchObject({ quantity: "2.000000", unit_price_usd: "10.000000",
    purchase_gross_usd: "20.000000", purchase_discount_usd: "2.000000", purchase_net_usd: "18.000000" });
  expect(r.snapshot.paidAt).toBe(paid);
  expect(r.snapshot.lines[0].sku).toBeNull(); // No claim of historical catalog metadata.
  const ledger = r.movements.flatMap(m => normalizeLedger(m, "test"));
  expect(ledger.map(l => l.source_amount)).toEqual(["20.000000", "-2.000000", "2.000000", "-9.000000", "-1.000000"]);
  expect(ledger[0].effective_at).toBe(paid); expect(ledger[3].effective_at).toBe(changed);
  expect(r.payments[0].settledAt).toBeNull();
  expect(map()).toEqual(r);
});
it("keeps raw non-USD amounts and withholds USD instead of inventing FX", () => {
  const f = JSON.parse(JSON.stringify(fixture()).replaceAll('"USD"', '"CAD"'));
  const r = map(f);
  expect(normalizeCommerce(r.snapshot, r.decision, "test").orders[0].purchase_merchandise_net_usd).toBeNull();
  expect(normalizeLedger(r.movements[0], "test")[0].amount_usd).toBeNull();
});
it("does not shift original paid time to a later edit collection", () => {
  const f = fixture(), tx = f.commerce.order.transactions as SourceObject[];
  tx.push({ ...tx[0], id: gid("OrderTransaction", "9"), processedAt: updated, amountSet: bag("5") });
  f.commerce.order.transactionsCount = { count: 2, precision: "EXACT" };
  expect(map(f).snapshot.paidAt).toBe(paid);
});
it("keeps new post-purchase lines out of the original basket and marks allocation unresolved", () => {
  const f = fixture();
  f.document.agreements[1] = { id: gid("OrderEditAgreement", "12"), __typename: "OrderEditAgreement",
    reason: "ORDER_EDIT", happenedAt: changed, sales: [{ ...sale("14", "6", "1", "0"),
      lineItem: { id: gid("LineItem", "4") } }] };
  f.policy.lineClasses = { "3": "merchandise", "4": "merchandise" };
  const r = map(f);
  expect(r.snapshot.lines.map(l => l.id)).toEqual(["3"]);
  expect(r.movements[1].slices.every(s => s.lineId === null && s.allocation === "unresolved")).toBe(true);
  const facts: Facts = { payments: [], customers: [], marketing_spend_daily: [], sessions: [], order_attribution: [],
    ...normalizeCommerce(r.snapshot, r.decision, "test"),
    sales_ledger: r.movements.flatMap(m => normalizeLedger(m, "test")) };
  const scope: ReportScope = { shop, publication: "test", definition: "v1", model: "v1", date: "2026-01-02",
    stale: true, gates: { ledger: true, cash: false, orders: true, purchase: true, customers: false,
      spend: false, attribution: false, behavior: false, productAllocation: true } };
  expect(storeDaily(facts, scope).net_merchandise_sales_usd).toBe("5.000000");
  expect(productDaily(facts, scope)[0].net_merchandise_sales_usd).toBeNull();
});
it("keeps price/discount updates in net merchandise without rewriting the original basket", () => {
  const f = fixture();
  f.document.agreements[1] = { ...f.document.agreements[1], __typename: "OrderEditAgreement",
    reason: "ORDER_EDIT", sales: [{ ...sale("13", "-2", "0", "2"), actionType: "UPDATE", quantity: null }] };
  const r = map(f), update = r.movements[1];
  expect(update.kind).toBe("adjustment");
  expect(update.slices.map(s => [s.component, s.amount])).toEqual([
    ["merchandise_gross", "0.000000"], ["merchandise_discount", "-2.000000"], ["tax_net", "0.000000"],
  ]);
  expect(r.snapshot.lines[0].merchandiseDiscount).toBe("2.000000");
});
it("maps explicit shipping and tax without allocating them to merchandise", () => {
  const f = fixture();
  (f.document.agreements[0].sales as SourceObject[]).push({ ...sale("15", "5", "1", "0"),
    __typename: "ShippingLineSale", lineType: "SHIPPING", quantity: null });
  f.commerce.order.originalTotalPriceSet = bag("25");
  (f.commerce.order.transactions as SourceObject[])[0].amountSet = bag("25");
  expect(map(f).movements[1].slices).toMatchObject([
    { component: "shipping_net", amount: "4.000000", lineId: null }, { component: "tax_net", amount: "1.000000" },
  ]);
});
const bad: [string, (f: ReturnType<typeof fixture>) => void, string][] = [
  ["wrong shop", f => { f.document.shop = "other.myshopify.com"; }, "agreement_source_scope"],
  ["wrong revision", f => { f.document.sourceUpdatedAt = created; }, "agreement_source_scope"],
  ["future source", f => { f.document.capturedAt = created; }, "agreement_source_scope"],
  ["missing financial approval", f => { f.policy.financialApprovalRef = ""; }, "agreement_policy_required"],
  ["test order", f => { f.commerce.order.test = true; }, "agreement_requires_eligible_order"],
  ["cancelled order", f => { f.commerce.order.cancelledAt = updated; }, "agreement_requires_eligible_order"],
  ["missing original", f => { f.document.agreements.shift(); }, "agreement_original_required"],
  ["duplicate agreements", f => { f.document.agreements.push(f.document.agreements[0]); }, "agreement_invalid_set"],
  ["mismatched original total", f => { f.commerce.order.originalTotalPriceSet = bag("30"); }, "agreement_original_total_mismatch"],
  ["missing processed time", f => { (f.commerce.order.transactions as SourceObject[])[0].processedAt = null; }, "agreement_paid_time_required"],
  ["partial paid", f => { (f.commerce.order.transactions as SourceObject[])[0].amountSet = bag("10"); }, "agreement_original_payment_required"],
  ["payment before purchase", f => { f.document.agreements[0].happenedAt = "2026-01-01T12:02:00Z"; }, "agreement_payment_before_purchase"],
  ["ambiguous payment", f => { (f.commerce.order.transactions as SourceObject[])[0].amountSet = bag("21"); }, "agreement_ambiguous_original_payment"],
  ["edit before paid", f => { f.document.agreements[1].happenedAt = created; }, "agreement_change_before_original_payment"],
  ["unknown agreement", f => { f.document.agreements[1].__typename = "UnknownAgreement"; }, "agreement_type_or_time"],
  ["future agreement", f => { f.document.agreements[1].happenedAt = "2027-01-01T00:00:00Z"; }, "agreement_type_or_time"],
  ["duplicate sale", f => { (f.document.agreements[1].sales as SourceObject[])[0].id = gid("ProductSale", "11"); }, "agreement_duplicate_sale"],
  ["unknown action", f => { (f.document.agreements[1].sales as SourceObject[])[0].actionType = "UNKNOWN"; }, "agreement_unknown_action"],
  ["unknown sale", f => { (f.document.agreements[1].sales as SourceObject[])[0].__typename = "UnknownSale"; }, "agreement_unsupported_sale_type"],
  ["unapproved classification", f => { f.policy.lineClasses = {}; }, "agreement_line_class_required"],
  ["after tax discount", f => { (f.document.agreements[1].sales as SourceObject[])[0].totalDiscountAmountAfterTaxes = bag("1"); }, "agreement_after_tax_discount_review"],
  ["positive return", f => { (f.document.agreements[1].sales as SourceObject[])[0].totalAmount = bag("5"); }, "agreement_action_sign"],
  ["zero original quantity", f => { (f.document.agreements[0].sales as SourceObject[])[0].quantity = 0; }, "agreement_original_quantity"],
  ["non-divisible unit price", f => { (f.document.agreements[0].sales as SourceObject[])[0].quantity = 3; }, "agreement_unit_rounding_review"],
];
it.each(bad)("rejects %s rather than manufacturing completeness", (_, mutate, error) => {
  const f = fixture(); mutate(f); expect(() => map(f)).toThrow(error);
});
function reply(agreement: SourceObject, more = false, salesMore = false, saleCursor = "s1", cursor = "a1") {
  return { data: { order: { id: gid("Order", "1"), updatedAt: updated, agreements: {
    edges: [{ cursor, node: { ...agreement, sales: { nodes: agreement.sales,
      pageInfo: { hasNextPage: salesMore, endCursor: saleCursor } } } }],
    pageInfo: { hasNextPage: more, endCursor: cursor },
  } } } };
}
const response = (body: unknown) => Response.json(body, { headers: { "X-Shopify-API-Version": SHOPIFY_ANALYTICS_API_VERSION } });
const opts = () => ({ shop, accessToken: "fixture", orderGid: gid("Order", "1"),
  sourceUpdatedAt: updated, maxRequests: 10, now: () => new Date("2026-01-04T00:00:00Z") });
it("pages agreements and nested sales separately, verifies final revision and uses fixed queries", async () => {
  const f = fixture();
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response(reply(f.document.agreements[0], true, true)))
    .mockResolvedValueOnce(response(reply({ ...f.document.agreements[0], sales: [sale("16")] }, true, false, "s2")))
    .mockResolvedValueOnce(response(reply(f.document.agreements[1], false, false, "s3", "a2")))
    .mockResolvedValueOnce(response({ data: { order: { id: gid("Order", "1"), updatedAt: updated } } }));
  const doc = await readShopifyAgreements({ ...opts(), fetcher });
  expect(doc.agreements).toHaveLength(2);
  expect(doc.agreements[0].sales).toHaveLength(2);
  const calls = fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)).variables);
  expect(calls.map(c => [c.agreementCursor, c.saleCursor])).toEqual([[null, null], [null, "s1"], ["a1", null], [null, null]]);
  expect(fetcher.mock.calls.every(c => c[0] === `https://${shop}/admin/api/2026-07/graphql.json` && c[1]?.redirect === "error")).toBe(true);
});
it("rejects revision changes after final page", async () => {
  const f = fixture(), fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response(reply(f.document.agreements[0])))
    .mockResolvedValueOnce(response({ data: { order: { id: gid("Order", "1"), updatedAt: created } } }));
  await expect(readShopifyAgreements({ ...opts(), fetcher })).rejects.toThrow("agreement_order_revision_changed");
});
it("never retries a failed vendor request", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret"));
  await expect(readShopifyAgreements({ ...opts(), fetcher })).rejects.toThrow("agreement_transport_failed");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects repeated nested cursors and duplicates rather than looping", async () => {
  const f = fixture(), fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response(reply(f.document.agreements[0], false, true)))
    .mockResolvedValueOnce(response(reply({ ...f.document.agreements[0], sales: [sale("16")] }, false, true)));
  await expect(readShopifyAgreements({ ...opts(), fetcher })).rejects.toThrow("agreement_cursor_loop");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("fails on request exhaustion without returning a truncated document", async () => {
  const f = fixture(), fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response(reply(f.document.agreements[0], true)))
    .mockResolvedValueOnce(response(reply(f.document.agreements[1], false, false, "s2", "a2")));
  await expect(readShopifyAgreements({ ...opts(), maxRequests: 2, fetcher })).rejects.toThrow("agreement_read_budget");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(["version", "graphql", "bytes", "json", "http"])("rejects invalid %s response", async kind => {
  const f = fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    kind === "version" ? Response.json(reply(f.document.agreements[0])) :
    kind === "graphql" ? response({ ...reply(f.document.agreements[0]), errors: [{ message: "secret" }] }) :
    kind === "http" ? new Response("", { status: 403 }) :
    new Response(kind === "bytes" ? "x".repeat(1000001) : "bad", { headers: { "X-Shopify-API-Version": SHOPIFY_ANALYTICS_API_VERSION } }));
  await expect(readShopifyAgreements({ ...opts(), fetcher })).rejects.toThrow(/agreement_/);
});
it("prepares a revision-bound deferred replacement and preserves independent controls", async () => {
  const f = fixture(), refresh = refreshFixture();
  const prior = refresh.intake.packets.find(p => p.section === "replacements")!;
  prior.payload = []; prior.sha256 = evidenceDigest([]);
  f.document.capturedAt = refresh.intake.asOf;
  const snapshot = await readMullyCustomers({ projectRef: refresh.intake.scope.projectRef, shop,
    capturedAt: refresh.intake.asOf, customerIds: [], entities: ["shopify"] }, "fixture",
  async () => { throw new Error("empty_source_must_not_call"); });
  const input = { refresh, source: { snapshot, orders: [f.commerce], mappingVersion: refresh.policy.mappingVersion, permissions: [] },
    binding: { sourceId: "fixture:agreements", schemaVersion: "fixture-v1", approvalRef: "fixture", maxAgeSeconds: 3600 },
    originalPurchases: [{ orderGid: f.document.orderGid, document: f.document, policy: f.policy }] };
  const result = prepareMullyRefresh(input);
  expect(result.bundle.full.evidence.replacements).toHaveLength(1);
  expect(result.refresh.commercePolicy.deferredOrders).toEqual([{
    orderGid: f.document.orderGid, sourceUpdatedAt: updated, evidenceRef: f.policy.sourceEvidenceRef,
  }]);
  expect(result.bundle.full.evidence.proofs).toEqual(refresh.intake.packets.find(p => p.section === "proofs")!.payload);
  expect(result.bundle.full.evidence.offers).toEqual([]);
  expect(() => prepareMullyRefresh({ ...input, originalPurchases: [] })).toThrow("mully_original_purchase_budget");
  expect(() => prepareMullyRefresh({ ...input, originalPurchases: [...input.originalPurchases, ...input.originalPurchases] }))
    .toThrow("mully_duplicate_original_purchase");
});
it("carries original agreements through the actual full report builder without granting readiness", () => {
  const f = fullFixture(), replacement = map();
  const evidence = { ...f.evidence, replacements: [replacement], offers: [], settlements: [],
    orderIdentities: [], proofs: [], dateCoverage: [] };
  const base = Object.fromEntries(contracts.tables.map(t => [t.name, []]));
  const result = buildFullReports({ base, publication: "agreement-test", shop,
    fromDate: "2026-01-01", throughDate: "2026-01-03", policy: { ...f.policy, behaviorMode: "excluded" },
    evidence, events: [] });
  expect(result.facts.order_items[0].purchase_net_usd).toBe("18.000000");
  expect(result.facts.sales_ledger).toHaveLength(5);
  expect(result.facts.payments[0].cash_eligible).toBe(false);
});
it("runs the real gated extraction command with scoped credentials and private no-overwrite output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agreement-cli-fixture-")), f = fixture();
  const input = join(dir, "input.json"), output = join(dir, "snapshot.json");
  const env = { LEAN_SHOPIFY_AGREEMENTS_READ_APPROVED: "true", LEAN_SHOPIFY_SHOP_DOMAIN: shop,
    SHOPIFY_ADMIN_ACCESS_TOKEN: "must-not-use" };
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response(reply(f.document.agreements[0])))
    .mockResolvedValueOnce(response({ data: { order: { id: gid("Order", "1"), updatedAt: updated } } }));
  try {
    writeFileSync(input, JSON.stringify({ kind: "shopify-agreements-v1", shop, approvalRef: "fixture:read",
      orderGid: gid("Order", "1"), sourceUpdatedAt: updated, maxRequests: 2 }));
    await expect(readAgreementFile(input, output, env, fetcher)).rejects.toThrow("agreement_read_target");
    const allowed = { ...env, LEAN_SHOPIFY_ANALYTICS_READ_TOKEN: "scoped-fixture-key" };
    await expect(readAgreementFile(input, output, { ...allowed, LEAN_SHOPIFY_AGREEMENTS_READ_APPROVED: "false" }, fetcher))
      .rejects.toThrow("agreement_read_disabled");
    await expect(readAgreementFile(input, output, { ...allowed, LEAN_SHOPIFY_SHOP_DOMAIN: "other.myshopify.com" }, fetcher))
      .rejects.toThrow("agreement_read_target");
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readAgreementFile(input, output, allowed, fetcher)).toMatchObject({
      state: "snapshot_only", agreements: 1, enabled: false, registered: false,
    });
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ "X-Shopify-Access-Token": "scoped-fixture-key" });
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(readFileSync(output, "utf8")).not.toMatch(/scoped-fixture-key|must-not-use/);
    await expect(readAgreementFile(input, output, allowed, fetcher)).rejects.toThrow("agreement_file_budget");
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
