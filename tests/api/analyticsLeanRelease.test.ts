import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import core from "@/lib/analytics/lean-contracts.json";
import reports from "@/lib/analytics/reporting-contracts.json";
import { certifyCandidate, externalJoinControls, reconcileCandidate, validateCandidateGraph, type Candidate } from "@/lib/analytics/certification";
import { runBackfillBatch } from "@/lib/analytics/backfill";
import { storeDaily, type Facts, type ReportScope } from "@/lib/analytics/reporting";
import { normalizeCommerce } from "@/lib/analytics/commerce";
import { normalizeLedger, normalizePayment } from "@/lib/analytics/financial";
import { key } from "@/lib/analytics/primitives";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role service_role; create role release_test_reader;");
  for (const file of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views", "015_backfill"])
    await db.exec(readFileSync(`sql/analytics/${file}.sql`, "utf8"));
}, 30000);
afterAll(async () => { await db.close(); });
const empty = (): Candidate => Object.fromEntries(core.tables.map(t => [t.name, []]));
const customer = () => ({
  customer_id: "c", publication_id: "p", identity_status: "resolved", analytics_permitted: true,
  history_complete: true, first_eligible_order_id: null, first_eligible_order_at: null, acquisition_date: null,
});
describe("candidate evidence and release boundaries", () => {
  it("requires independent key and amount reconciliation, not row counts", () => {
    const c = { payments: [{ payment_id: "p1", source_amount: "12" }] };
    const proof = { table: "payments", keyFields: ["payment_id"], expectedKeys: ['["p1"]'],
      evidenceRef: "independent-export", independentlyExtracted: true, complete: true,
      amountChecks: [{ field: "source_amount", expectedTotal: "12" }] };
    expect(reconcileCandidate(c, [proof], ["payments"])).toEqual([]);
    expect(reconcileCandidate(c, [{ ...proof, expectedKeys: ['["different"]'] }], ["payments"])).toContain("payments:key_mismatch");
    expect(reconcileCandidate(c, [{ ...proof, amountChecks: [{ field: "source_amount", expectedTotal: "11" }] }], ["payments"])).toContain("payments:amount_mismatch");
    expect(reconcileCandidate(c, [{ ...proof, independentlyExtracted: false }], ["payments"])).toContain("payments:unverified_source");
  });
  it("rejects duplicate/mixed publication rows and an orphan first-order anchor", () => {
    const c = empty(); c.customers = [customer(), customer()];
    expect(validateCandidateGraph(c, "p", "m")).toContain("customers:shape_or_key");
    c.customers = [{ ...customer(), publication_id: "other" }];
    expect(validateCandidateGraph(c, "p", "m")).toContain("customers:shape_or_key");
    c.customers = [{ ...customer(), first_eligible_order_id: "missing" }];
    expect(validateCandidateGraph(c, "p", "m")).toContain("join_6:missing_parent");
  });
  it("requires explicit policy and all external join-control evidence", () => {
    const c = empty();
    const input = { publication: "p", model: "m", requiredTables: ["customers"], policyApprovalRef: "approved",
      proofs: [{ table: "customers", keyFields: ["customer_id"], expectedKeys: [], evidenceRef: "independent-empty",
        independentlyExtracted: true, complete: true, amountChecks: [] }],
      externalControls: Object.fromEntries(externalJoinControls.map(k => [k, { passed: true, evidenceRef: "reviewed-not-applicable" }])) };
    expect(certifyCandidate(c, input).certified).toBe(true);
    expect(certifyCandidate(c, { ...input, externalControls: {} }).certified).toBe(false);
    expect(certifyCandidate(c, { ...input, policyApprovalRef: "" }).certified).toBe(false);
  });
  it("integrates paid purchase, refund, separate settlement and core-graph checks without requiring attribution", () => {
    const c = empty();
    Object.assign(c, normalizeCommerce({
      shop: "shop", id: "order", createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-01T13:00:00Z",
      paidAt: "2026-01-01T12:01:00Z", paidEvidenceRef: "paid-evidence", currency: "USD",
      checkoutId: null, shippingCountry: "US", shippingRegion: "NY", linesComplete: true,
      lines: [{ id: "line", sku: "sku", productId: "product", quantity: 2, itemClass: "merchandise",
        unitPrice: "10", merchandiseDiscount: "2", purchaseEvidenceRef: "original-purchase", offers: [] }],
    }, { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: true, approvalRef: "approved" }, "p"));
    c.sales_ledger = [
      ...normalizeLedger({ shop: "shop", id: "sale", orderId: "order", currency: "USD", effectiveAt: "2026-01-01T12:01:00Z",
        sourceTotal: "18", evidenceRef: "sale-source", kind: "sale", salesEligible: true, slices: [
          { id: "gross", component: "merchandise_gross", amount: "20", lineId: "line", allocation: "allocated", reversesEntryId: null },
          { id: "discount", component: "merchandise_discount", amount: "-2", lineId: "line", allocation: "allocated", reversesEntryId: null },
        ] }, "p"),
      ...normalizeLedger({ shop: "shop", id: "refund", orderId: "order", currency: "USD", effectiveAt: "2026-01-01T15:00:00Z",
        sourceTotal: "-5", evidenceRef: "refund-source", kind: "refund", salesEligible: true, slices: [
          { id: "refund", component: "merchandise_refund", amount: "-5", lineId: "line", allocation: "allocated", reversesEntryId: null },
        ] }, "p"),
    ];
    c.payments = [normalizePayment({ shop: "shop", gateway: "gateway", id: "cash", orderId: "order",
      parentId: null, kind: "sale", status: "succeeded", signedAmount: "18", currency: "USD",
      settledAt: "2026-01-02T12:00:00Z", settlementEvidenceRef: "bank-settlement", adjustmentApproved: false }, "p")];
    expect(validateCandidateGraph(c, "p", "m1", false)).toEqual([]);
    expect(validateCandidateGraph(c, "p", "m1", true)).toContain("join_18:invalid_credit");
    expect(reconcileCandidate(c, [{
      table: "orders", expectedKeys: [JSON.stringify([key("shop", "order")])], keyFields: ["order_id"],
      evidenceRef: "independent-order-export", independentlyExtracted: true, complete: true,
      amountChecks: [{ field: "purchase_merchandise_net_usd", expectedTotal: "18" }],
    }], ["orders"])).toEqual([]);
    const scope: ReportScope = { shop: "shop", publication: "p", definition: "v1", model: "m1", date: "2026-01-01", stale: false,
      gates: { ledger: true, cash: true, orders: true, purchase: true, customers: false, spend: false, attribution: false, behavior: false, productAllocation: true } };
    expect(storeDaily(c as unknown as Facts, scope)).toMatchObject({
      net_merchandise_sales_usd: "13.000000", purchase_merchandise_net_usd: "18.000000",
      aov_usd: "18.000000", collected_cash_usd: "0.000000", new_customers: null, mer: null,
    });
    expect(storeDaily(c as unknown as Facts, { ...scope, date: "2026-01-02" }).collected_cash_usd).toBe("18.000000");
    c.sales_ledger[0].order_item_id = "wrong-line";
    expect(validateCandidateGraph(c, "p", "m1", false)).toContain("join_14:missing_parent");
  });
  it("builds all five exact-schema reporting views but exposes no unselected rows", async () => {
    for (const view of reports.views) {
      const result = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema='lean_analytics' and table_name=$1 order by ordinal_position", [view.name]);
      expect(result.rows.map(r => r.column_name)).toEqual(view.fields.map(f => f.name));
      expect((await db.query(`select * from lean_analytics.${view.name}`)).rows).toEqual([]);
    }
  });
  it("integrates report computation, SQL materialization, approved selection, staleness and rollback", async () => {
    const c = empty();
    const scope: ReportScope = { shop: "shop", publication: "one", definition: "v1", model: "m1", date: "2026-01-01", stale: false,
      gates: { ledger: true, cash: true, orders: true, purchase: true, customers: true, spend: false, attribution: false, behavior: false, productAllocation: true } };
    const row = storeDaily(c as unknown as Facts, scope);
    expect(row.total_sales_usd).toBe("0.000000");
    expect(row.spend_usd).toBeNull();
    const columns = Object.keys(row);
    for (const p of ["one", "two"]) {
      await db.query("insert into lean_private.publications(publication_id,contract_version) values($1,'v1')", [p]);
      const values = columns.map(k => k === "publication_id" ? p : typeof row[k] === "object" && row[k] !== null ? JSON.stringify(row[k]) : row[k]);
      await db.query(`insert into lean_private.report_store_daily (${columns.join(",")}) values(${columns.map((_,i)=>`$${i+1}`).join(",")})`, values);
      await expect(db.query("select public.lean_select_publication('store_daily',$1,null,'approval')", [p])).rejects.toThrow("uncertified");
      await db.query("insert into lean_private.certifications values($1,'store_daily','tests','independent-reconciliation','reviewer')", [p]);
      await db.query("update lean_private.publications set state='certified',evidence_ref='release-evidence' where publication_id=$1", [p]);
    }
    await db.exec("select public.lean_select_publication('store_daily','one',null,'approve-one')");
    expect((await db.query<{ publication_id: string }>("select * from lean_analytics.store_daily")).rows[0].publication_id).toBe("one");
    await db.exec("select public.lean_mark_publication_stale('store_daily')");
    expect((await db.query<{ is_stale: boolean }>("select * from lean_analytics.store_daily")).rows[0].is_stale).toBe(true);
    await expect(db.exec("select public.lean_select_publication('store_daily','two',null,'stale-cas')")).rejects.toThrow("selection changed");
    await db.exec("select public.lean_select_publication('store_daily','two','one','approve-two')");
    await db.exec("select public.lean_select_publication('store_daily','one','two','rollback')");
    expect((await db.query("select * from lean_private.publication_audit")).rows).toHaveLength(3);
    expect((await db.query<{ publication_id: string }>("select * from lean_analytics.store_daily")).rows[0].publication_id).toBe("one");
  });
  it("freezes certified facts, report rows, evidence and publication records", async () => {
    await expect(db.exec("insert into lean_private.customers values('c','one','resolved',true,true,null,null,null)")).rejects.toThrow("immutable");
    await expect(db.exec("update lean_private.report_store_daily set eligible_orders=999 where publication_id='one'")).rejects.toThrow("immutable");
    await expect(db.exec("delete from lean_private.certifications where publication_id='one'")).rejects.toThrow("immutable");
    await expect(db.exec("update lean_private.publications set evidence_ref='changed' where publication_id='one'")).rejects.toThrow("immutable");
  });
  it("lets an explicitly granted reader query the view but not identities, receipts or release functions", async () => {
    await db.exec("grant usage on schema lean_analytics to release_test_reader; grant select on lean_analytics.store_daily to release_test_reader; set role release_test_reader");
    try {
      expect((await db.query("select * from lean_analytics.store_daily")).rows).toHaveLength(1);
      await expect(db.query("select * from lean_private.identity_map")).rejects.toThrow();
      await expect(db.query("select * from lean_private.receipts")).rejects.toThrow();
      await expect(db.query("select public.lean_select_publication('store_daily','two','one','bad')")).rejects.toThrow();
    } finally { await db.exec("reset role"); }
  });
  it("rejects null lease bounds and cannot bypass fencing with a null token", async () => {
    await expect(db.exec("select * from public.lean_claim_work(null,1,120)")).rejects.toThrow("invalid lease bounds");
    await expect(db.exec("select * from public.lean_claim_work(repeat('a',32),null,120)")).rejects.toThrow("invalid lease bounds");
    const receipt = await db.query<{ id: number }>("select public.lean_accept_receipt('shopify','release-test','o','orders/paid',repeat('a',64),'{}') as id");
    expect(receipt.rows[0].id).toBeDefined();
    const work = await db.query<{ work_id: number }>("select * from public.lean_claim_work(repeat('a',32),1,120)");
    const result = await db.query<{ ok: boolean }>("select public.lean_finish_work($1,null,'v1','{}') as ok", [work.rows[0].work_id]);
    expect(result.rows[0].ok).toBe(false);
  });
  it("commits a page and cursor atomically, rejects stale workers, and resumes bounded backfill", async () => {
    await db.exec("insert into lean_private.backfill_runs(run_id,source,approval_ref) values('run','shopify','approved-limited-scope')");
    const store = { commitPage: async (cursor: string | null, page: { rows: number[]; nextCursor: string | null; complete: boolean }) =>
      (await db.query<{ ok: boolean }>("select public.lean_commit_backfill_page('run',$1,$2,$3,$4::jsonb) as ok",
        [cursor,page.nextCursor,page.complete,JSON.stringify(page.rows)])).rows[0].ok };
    const first = await runBackfillBatch({ cursor: null, maxPages: 1, maxRowsPerPage: 2, approvalRef: "approved",
      fetchPage: async () => ({ rows: [1,2], nextCursor: "next", complete: false }), store });
    expect(first).toEqual({ cursor: "next", written: 2, complete: false });
    expect(await store.commitPage(null, { rows: [99], nextCursor: null, complete: true })).toBe(false);
    await expect(runBackfillBatch({ cursor: "next", maxPages: 1, maxRowsPerPage: 2, approvalRef: "approved",
      fetchPage: async () => { throw new Error("source_unavailable"); }, store })).rejects.toThrow("source_unavailable");
    expect((await db.query<{ cursor: string }>("select cursor from lean_private.backfill_runs where run_id='run'")).rows[0].cursor).toBe("next");
    const second = await runBackfillBatch({ cursor: "next", maxPages: 1, maxRowsPerPage: 2, approvalRef: "approved",
      fetchPage: async () => ({ rows: [3], nextCursor: null, complete: true }), store });
    expect(second.complete).toBe(true);
    expect(await store.commitPage("next", { rows: [3], nextCursor: null, complete: true })).toBe(false);
    expect((await db.query<{ row_count: number; page_count: number }>("select row_count,page_count from lean_private.backfill_runs")).rows[0]).toMatchObject({ row_count: 3, page_count: 2 });
  });
  it("does not checkpoint invalid, unapproved or repeatedly paginated source responses", async () => {
    let writes = 0;
    const input = { cursor: "same", maxPages: 1, maxRowsPerPage: 2, approvalRef: "approved",
      fetchPage: async () => ({ rows: [1], nextCursor: "same", complete: false }),
      store: { commitPage: async () => { writes++; return true; } } };
    await expect(runBackfillBatch(input)).rejects.toThrow("invalid_backfill_page");
    await expect(runBackfillBatch({ ...input, approvalRef: "" })).rejects.toThrow("unapproved_backfill_bounds");
    expect(writes).toBe(0);
  });
});
