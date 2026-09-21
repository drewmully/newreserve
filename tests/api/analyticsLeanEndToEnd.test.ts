/**
 * LOCAL ONLY. No Supabase client, environment credentials or network adapters.
 * The fixture envelope is NOT a Shopify API mapping. Its evidence stands in for
 * the source adapter still needed in production. Approvals below are test data.
 */
import { PGlite } from "@electric-sql/pglite";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import contracts from "@/lib/analytics/lean-contracts.json";
import { acceptShopifyReceipt } from "@/lib/analytics/receipts";
import { createReceiptStore, createWorkerStore, type AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { runAnalyticsWorker, type Work, type WorkerStore } from "@/lib/analytics/worker";
import { normalizeCommerce, type ShopifySnapshot } from "@/lib/analytics/commerce";
import { normalizeLedger, normalizePayment, uniqueLedger, type Movement, type PaymentEvidence } from "@/lib/analytics/financial";
import { certifyCandidate, externalJoinControls, type Candidate, type Reconciliation } from "@/lib/analytics/certification";
import { storeDaily, type Facts, type ReportScope } from "@/lib/analytics/reporting";
import { key, type Row } from "@/lib/analytics/primitives";

const publication = "local-fixture-publication";
const shop = "local-fixture.myshopify.com";
const secret = "synthetic-test-secret-not-a-credential";
const snapshot: ShopifySnapshot = {
  shop, id: "order-1", createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-01T13:00:00Z",
  paidAt: "2026-01-01T12:01:00Z", paidEvidenceRef: "fixture:paid", currency: "USD",
  checkoutId: null, shippingCountry: "US", shippingRegion: "NY", linesComplete: true,
  lines: [{ id: "line-1", sku: "fixture-sku", productId: "product-1", quantity: 2,
    itemClass: "merchandise", unitPrice: "10", merchandiseDiscount: "2",
    purchaseEvidenceRef: "fixture:original-purchase", offers: [] }],
};
const sale: Movement = {
  shop, id: "sale-1", orderId: "order-1", effectiveAt: "2026-01-01T12:01:00Z",
  currency: "USD", sourceTotal: "18", evidenceRef: "fixture:sale", kind: "sale", salesEligible: true,
  slices: [
    { id: "gross", component: "merchandise_gross", amount: "20", lineId: "line-1", allocation: "allocated", reversesEntryId: null },
    { id: "discount", component: "merchandise_discount", amount: "-2", lineId: "line-1", allocation: "allocated", reversesEntryId: null },
  ],
};
const refund: Movement = {
  shop, id: "refund-1", orderId: "order-1", effectiveAt: "2026-01-01T15:00:00Z",
  currency: "USD", sourceTotal: "-5", evidenceRef: "fixture:refund", kind: "refund", salesEligible: true,
  slices: [{ id: "refund", component: "merchandise_refund", amount: "-5", lineId: "line-1",
    allocation: "allocated", reversesEntryId: null }],
};
const payment: PaymentEvidence = {
  shop, gateway: "fixture-gateway", id: "payment-1", orderId: "order-1", parentId: null,
  kind: "sale", status: "succeeded", signedAmount: "18", currency: "USD",
  settledAt: "2026-01-02T12:00:00Z", settlementEvidenceRef: "fixture:bank", adjustmentApproved: false,
};
type FixtureEnvelope = {
  id: string; fixtureVersion: "local-v1"; snapshot?: ShopifySnapshot;
  movement: Movement; payment?: PaymentEvidence;
};
const paidEnvelope = (): FixtureEnvelope => ({
  id: "order-1", fixtureVersion: "local-v1", snapshot: structuredClone(snapshot),
  movement: structuredClone(sale), payment: structuredClone(payment),
});
const refundEnvelope = (): FixtureEnvelope => ({
  id: "refund-1", fixtureVersion: "local-v1", movement: structuredClone(refund),
});
let db: PGlite;
let network: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  network = vi.fn(() => { throw new Error("network_forbidden_in_local_pipeline"); });
  vi.stubGlobal("fetch", network);
  db = new PGlite();
  await db.exec("create role service_role; create role local_report_reader;");
  for (const file of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views", "015_backfill"])
    await db.exec(readFileSync(`sql/analytics/${file}.sql`, "utf8"));
}, 30000);
afterEach(async () => {
  try {
    expect(network).not.toHaveBeenCalled();
    await db?.close();
  } finally { vi.unstubAllGlobals(); }
});

async function receive(envelope: FixtureEnvelope, delivery: string, topic: string, badSignature = false) {
  const body = Buffer.from(JSON.stringify(envelope));
  return acceptShopifyReceipt({
    body, signature: badSignature ? "invalid" : createHmac("sha256", secret).update(body).digest("base64"),
    secret, deliveryId: delivery, topic, shop, allowedShop: shop,
  }, createReceiptStore(localRpc));
}

/** Local transport only; the receipt/worker adapters are the source modules.
 * Named SQL arguments exercise the same parameter names sent to PostgREST.
 * No network transport or service-role authorization is simulated here.
 */
const localRpc: AnalyticsRpcClient = {
  async rpc(name, args) {
    const allowed = ["lean_accept_receipt", "lean_claim_work", "lean_finish_work", "lean_fail_work"];
    if (!allowed.includes(name)) throw new Error("unexpected_local_rpc");
    const entries = Object.entries(args);
    if (entries.some(([k]) => !/^p_[a-z_]+$/.test(k))) throw new Error("invalid_local_argument");
    const parameters = entries.map(([k], i) =>
      `${k} => $${i + 1}${k === "p_payload" || k === "p_facts" ? "::jsonb" : ""}`);
    const values = entries.map(([k, v]) => k === "p_payload" || k === "p_facts" ? JSON.stringify(v) : v);
    const call = `public.${name}(${parameters.join(",")})`;
    if (name === "lean_claim_work") return { data: (await db.query(`select * from ${call}`, values)).rows, error: null };
    const result = await db.query<{ value: unknown }>(`select ${call} as value`, values);
    return { data: result.rows[0].value, error: null };
  },
};

function workerStore(): WorkerStore {
  return createWorkerStore(localRpc);
}
function transformFixture(work: Work): Candidate {
  // Explicit test-only adapter. Do not accept this envelope on a live endpoint.
  const input = work.payload as FixtureEnvelope;
  if (input.fixtureVersion !== "local-v1" ||
      !["orders/paid", "refunds/create"].includes(work.topic)) throw new Error("not_a_local_fixture");
  const facts: Candidate = Object.fromEntries(contracts.tables.map(t => [t.name, []]));
  if (input.snapshot) Object.assign(facts, normalizeCommerce(input.snapshot, {
    eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: true, approvalRef: "fixture:policy",
  }, publication));
  facts.sales_ledger = normalizeLedger(input.movement, publication);
  if (input.payment) facts.payments = [normalizePayment(input.payment, publication)];
  return facts;
}
const run = (store = workerStore()) => runAnalyticsWorker(store, transformFixture, "local-fixture-v1");

/** Freeze a complete local batch, merge durable projections and store actual facts. */
async function materialize() {
  await db.transaction(async tx => {
    const pending = await tx.query("select 1 from lean_private.work where state <> 'done'");
    if (pending.rows.length) throw new Error("local_batch_incomplete");
    await tx.query("insert into lean_private.publications(publication_id,contract_version) values($1,'local-v1')", [publication]);
    const projections = await tx.query<{ facts: Candidate }>("select facts from lean_private.projections order by receipt_id");
    for (const table of contracts.tables) {
      let rows = projections.rows.flatMap(p => p.facts[table.name]);
      if (table.name === "sales_ledger") rows = uniqueLedger(rows);
      else {
        const unique = new Map<string, Row>();
        for (const row of rows) {
          const id = JSON.stringify(table.primaryKey.map(k => row[k]));
          const prior = unique.get(id);
          if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw new Error("conflicting_local_projection");
          unique.set(id, row);
        }
        rows = [...unique.values()];
      }
      // Identifier is from the checked-in contract, not an event payload.
      await tx.query(`insert into lean_private."${table.name}"
        select * from jsonb_populate_recordset(null::lean_private."${table.name}",$1::jsonb)`, [JSON.stringify(rows)]);
    }
  });
}

async function readFacts(connection: Pick<PGlite, "query"> = db): Promise<Candidate> {
  const candidate: Candidate = {};
  for (const table of contracts.tables) {
    const columns = table.fields.map(f => {
      const name = `"${f.name}"`;
      if (f.logicalType.startsWith("DECIMAL") || f.logicalType === "DATE") return `${name}::text as ${name}`;
      if (f.logicalType === "TIMESTAMP_UTC")
        return `to_char(${name} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ${name}`;
      return name;
    });
    candidate[table.name] = (await connection.query<Row>(
      `select ${columns.join(",")} from lean_private."${table.name}" where publication_id=$1`, [publication],
    )).rows;
  }
  return candidate;
}

// Fixed oracle declared independently of transformed/stored output. This fixture
// covers USD commerce only; it does not certify live coverage or customer history.
function proofs(): Reconciliation[] {
  const proof = (table: string, keyFields: string[], expectedKeys: string[][],
    amountChecks: Reconciliation["amountChecks"]): Reconciliation => ({
    table, keyFields, expectedKeys: expectedKeys.map(v => JSON.stringify(v)), amountChecks,
    evidenceRef: "fixture:independent-oracle", independentlyExtracted: true, complete: true,
  });
  return [
    proof("orders", ["order_id"], [[key(shop, "order-1")]], [{ field: "purchase_merchandise_net_usd", expectedTotal: "18" }]),
    proof("order_items", ["order_item_id"], [[key(shop, "order-1", "line-1")]], [{ field: "purchase_net_usd", expectedTotal: "18" }]),
    proof("sales_ledger", ["ledger_entry_id"], [
      [key(shop, "sale-1", "merchandise_gross", "gross")],
      [key(shop, "sale-1", "merchandise_discount", "discount")],
      [key(shop, "refund-1", "merchandise_refund", "refund")],
    ], [{ field: "source_amount", expectedTotal: "13" }]),
    proof("payments", ["payment_id"], [[key(shop, "fixture-gateway", "payment-1")]], [{ field: "source_amount", expectedTotal: "18" }]),
  ];
}

async function publishLocalFixture() {
  // PGlite's single-connection transaction proves atomic local publication, not
  // production multi-connection isolation. No real approvals are implied.
  await db.transaction(async tx => {
    await tx.query("select 1 from lean_private.publications where publication_id=$1 for update", [publication]);
    // Use this transaction handle for readback too; do not query db while tx owns it.
    const candidate = await readFacts(tx);
    const check = certifyCandidate(candidate, {
      publication, model: "local-v1", requiredTables: proofs().map(p => p.table), proofs: proofs(),
      policyApprovalRef: "fixture:commerce-only",
      externalControls: Object.fromEntries(externalJoinControls.map(control =>
        [control, { passed: true, evidenceRef: "fixture:not-applicable-no-identity-events-or-spend" }])),
    });
    if (!check.certified) throw new Error(`local_certification_failed:${check.issues.join(",")}`);
    // Also check exclusive component totals, so equal/opposite corruptions cannot
    // pass merely because the combined ledger net still matches.
    const expectedComponents: Record<string, string> = {
      merchandise_gross: "20.000000", merchandise_discount: "-2.000000", merchandise_refund: "-5.000000",
    };
    if (candidate.sales_ledger.length !== 3 || candidate.sales_ledger.some(r =>
      r.source_currency !== "USD" || r.source_amount !== expectedComponents[String(r.component)] ||
      r.amount_usd !== expectedComponents[String(r.component)]))
      throw new Error("local_component_reconciliation_failed");
    for (const date of ["2026-01-01", "2026-01-02"]) {
      const scope: ReportScope = {
        shop, publication, date, definition: "local-v1", model: "local-v1", stale: false,
        gates: { orders: true, purchase: true, ledger: true, cash: true, productAllocation: true,
          customers: false, spend: false, attribution: false, behavior: false },
      };
      const report = storeDaily(candidate as Facts, scope);
      await tx.query(`insert into lean_private.report_store_daily
        select * from jsonb_populate_record(null::lean_private.report_store_daily,$1::jsonb)`, [JSON.stringify(report)]);
    }
    await tx.query("insert into lean_private.certifications values($1,'store_daily','fixture:evidence','fixture:oracle','local-test')", [publication]);
    await tx.query("update lean_private.publications set state='certified',evidence_ref='fixture:certified' where publication_id=$1", [publication]);
    await tx.query("select public.lean_select_publication('store_daily',$1,null,'fixture:approval')", [publication]);
  });
}
async function seedComplete() {
  await receive(paidEnvelope(), "paid-delivery", "orders/paid");
  await receive(refundEnvelope(), "refund-delivery", "refunds/create");
  await run();
  await materialize();
}

describe("local signed receipt → worker → persisted facts → certified report", () => {
  it("handles duplicate deliveries and reads the real reporting view through a restricted reader", async () => {
    const first = await receive(paidEnvelope(), "paid-delivery", "orders/paid");
    expect(await receive(paidEnvelope(), "paid-delivery", "orders/paid")).toBe(first);
    // Same business event under a different delivery ID also must not double sales.
    await receive(paidEnvelope(), "paid-redelivery", "orders/paid");
    await receive(refundEnvelope(), "refund-delivery", "refunds/create");
    expect(await run()).toMatchObject({ claimed: 3, completed: 3, failed: 0 });
    expect(await run()).toMatchObject({ claimed: 0 });
    await materialize();
    expect((await readFacts()).orders).toHaveLength(1);
    expect((await db.query("select * from lean_analytics.store_daily")).rows).toHaveLength(0);
    await publishLocalFixture();
    await db.exec("grant usage on schema lean_analytics to local_report_reader; grant select on lean_analytics.store_daily to local_report_reader; set role local_report_reader");
    try {
      const report = await db.query(`select report_date::text, eligible_orders::int,
        total_sales_usd::text, collected_cash_usd::text, aov_usd::text, spend_usd, new_customers
        from lean_analytics.store_daily order by report_date`);
      expect(report.rows).toEqual([
        { report_date: "2026-01-01", eligible_orders: 1, total_sales_usd: "13.000000",
          collected_cash_usd: "0.000000", aov_usd: "18.000000", spend_usd: null, new_customers: null },
        { report_date: "2026-01-02", eligible_orders: 0, total_sales_usd: "0.000000",
          collected_cash_usd: "18.000000", aov_usd: null, spend_usd: null, new_customers: null },
      ]);
      await expect(db.query("select * from lean_private.receipts")).rejects.toThrow();
    } finally { await db.exec("reset role"); }
  });
  it("rejects an invalid signature before storing anything", async () => {
    await expect(receive(paidEnvelope(), "bad", "orders/paid", true)).rejects.toThrow("invalid_signature");
    expect(await run()).toMatchObject({ claimed: 0 });
    expect((await db.query("select * from lean_private.receipts")).rows).toHaveLength(0);
  });
  it("keeps incomplete transformations out of both fact tables and published reports", async () => {
    const incomplete = paidEnvelope();
    incomplete.snapshot!.linesComplete = false;
    await receive(incomplete, "incomplete", "orders/paid");
    expect(await run()).toMatchObject({ failed: 1, completed: 0 });
    await expect(materialize()).rejects.toThrow("local_batch_incomplete");
    expect((await db.query("select * from lean_private.publications")).rows).toHaveLength(0);
    expect((await db.query("select * from lean_analytics.store_daily")).rows).toHaveLength(0);
  });
  it("blocks mismatched persisted amounts and rolls back publication", async () => {
    await seedComplete();
    await db.exec("update lean_private.orders set purchase_merchandise_net_usd=99");
    await expect(publishLocalFixture()).rejects.toThrow("orders:amount_mismatch");
    expect((await db.query("select * from lean_private.certifications")).rows).toHaveLength(0);
    expect((await db.query("select * from lean_private.report_store_daily")).rows).toHaveLength(0);
    expect((await db.query("select * from lean_analytics.store_daily")).rows).toHaveLength(0);
  });
  it("rejects offsetting ledger errors even when the net still reconciles", async () => {
    await seedComplete();
    await db.exec(`update lean_private.sales_ledger set source_amount=source_amount+
      case when component='merchandise_gross' then 1 else -1 end
      where component in ('merchandise_gross','merchandise_discount')`);
    await expect(publishLocalFixture()).rejects.toThrow("local_component_reconciliation_failed");
    expect((await db.query("select * from lean_analytics.store_daily")).rows).toHaveLength(0);
  });
  it("rejects corrupted reporting-currency values even when source amounts match", async () => {
    await seedComplete();
    await db.exec("update lean_private.sales_ledger set amount_usd=999 where component='merchandise_gross'");
    await expect(publishLocalFixture()).rejects.toThrow("local_component_reconciliation_failed");
    expect((await db.query("select * from lean_private.selected_publications")).rows).toHaveLength(0);
  });
  it("does not duplicate facts after a worker completion commits but its response is lost", async () => {
    await receive(paidEnvelope(), "paid-delivery", "orders/paid");
    await receive(refundEnvelope(), "refund-delivery", "refunds/create");
    const real = workerStore();
    let first = true;
    await expect(run({ ...real, finish: async (...args) => {
      const committed = await real.finish(...args);
      if (first) { first = false; throw new Error("simulated_lost_response"); }
      return committed;
    } })).rejects.toThrow("simulated_lost_response");
    // The other claimed item was never processed; simulate its lease expiring.
    await db.exec("update lean_private.work set lease_until=now()-interval '1 second' where state='leased'");
    expect(await run()).toMatchObject({ claimed: 1, completed: 1 });
    expect((await db.query("select * from lean_private.projections")).rows).toHaveLength(2);
    await materialize();
    await publishLocalFixture();
    expect((await readFacts()).orders).toHaveLength(1);
    expect((await db.query("select * from lean_analytics.store_daily")).rows).toHaveLength(2);
  });
});
