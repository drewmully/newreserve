/** Network-blocked source-shaped integration tests, NOT downloaded real orders. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runShopifyPilot, validatePilotTarget } from "@/lib/analytics/shopifyPilotRunner";
import { mapPilotSource, type PilotPolicy } from "@/lib/analytics/shopifyPilotMapping";
import { readPilotSource, PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY, type PilotSource } from "@/lib/analytics/shopifyPilotSource";
import { SHOPIFY_ANALYTICS_ORDER_QUERY, SHOPIFY_ANALYTICS_API_VERSION, sourceObject } from "@/lib/analytics/shopifySource";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/analytics/ingest/pilot/route";

const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const publication = `pilot:${runId}`;
const projectRef = "aaaaaaaaaaaaaaaaaaaa";
const shop = "pilot-fixture.myshopify.com";
const gid = (kind: string, id: string) => `gid://shopify/${kind}/${id}`;
const bag = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
const connection = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const policy: PilotPolicy = {
  decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: false, approvalRef: "fixture:catalog" },
  lineClasses: { "2": "merchandise" }, financialApprovalRef: "fixture:financial",
  saleClock: "paid_at", refundClock: "refund_created_at",
};
function fixture(): PilotSource {
  const original = {
    id: gid("Order", "9007199254740993"), createdAt: "2026-01-01T12:00:00Z",
    updatedAt: "2026-01-02T15:00:00Z", currencyCode: "USD", edited: false, taxesIncluded: false,
    test: false, cancelledAt: null, shippingAddress: null,
    originalTotalPriceSet: bag("27"), subtotalPriceSet: bag("18"),
    transactionsCount: { count: 2, precision: "EXACT" },
    transactions: [
      { id: gid("OrderTransaction", "4"), kind: "SALE", status: "SUCCESS", gateway: "fixture",
        test: false, createdAt: "2026-01-01T12:00:00Z", processedAt: "2026-01-01T12:01:00Z",
        amountSet: bag("27"), parentTransaction: null },
      { id: gid("OrderTransaction", "5"), kind: "REFUND", status: "SUCCESS", gateway: "fixture",
        test: false, createdAt: "2026-01-02T12:00:00Z", processedAt: "2026-01-02T12:01:00Z",
        amountSet: bag("6"), parentTransaction: { id: gid("OrderTransaction", "4"), gateway: "fixture" } },
    ],
    lineItems: connection([{ id: gid("LineItem", "2"), sku: "FIXTURE", quantity: 2, isGiftCard: false,
      product: { id: gid("Product", "3") }, originalUnitPriceSet: bag("10"), originalTotalSet: bag("20"),
      discountAllocations: [{ allocatedAmountSet: bag("2") }] }]),
  };
  return {
    commerce: { shop, apiVersion: SHOPIFY_ANALYTICS_API_VERSION, order: original },
    financial: { id: original.id, updatedAt: original.updatedAt, currencyCode: "USD",
      originalTotalPriceSet: bag("27"), totalTaxSet: bag("4"),
      originalTotalDutiesSet: null, originalTotalAdditionalFeesSet: null, totalTipReceivedSet: bag("0"),
      shippingLines: connection([{ id: gid("ShippingLine", "6"), discountedPriceSet: bag("5") }]),
      refunds: [{ id: gid("Refund", "7"), updatedAt: "2026-01-02T12:02:00Z" }] },
    refunds: [{
      id: gid("Refund", "7"), createdAt: "2026-01-02T12:00:00Z", updatedAt: "2026-01-02T12:02:00Z",
      order: { id: original.id }, totalRefundedSet: bag("6"), duties: [], orderAdjustments: connection([]),
      refundLineItems: connection([{ id: gid("RefundLineItem", "8"), quantity: 1,
        lineItem: { id: gid("LineItem", "2") }, subtotalSet: bag("5"), totalTaxSet: bag("1") }]),
      refundShippingLines: connection([]),
      transactions: connection([{ id: gid("OrderTransaction", "5"), kind: "REFUND", status: "SUCCESS",
        processedAt: "2026-01-02T12:01:00Z", amountSet: bag("6") }]),
    }],
  };
}
function mockedShopify(source = fixture()) {
  return vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe(`https://${shop}/admin/api/2026-07/graphql.json`);
    expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
    const { query, variables } = JSON.parse(String(init?.body));
    let data;
    if (query === SHOPIFY_ANALYTICS_ORDER_QUERY) {
      expect(variables.id).toBe(source.commerce.order.id); data = { order: source.commerce.order };
    } else if (query === PILOT_FINANCIAL_QUERY) {
      expect(variables.id).toBe(source.financial.id); data = { order: source.financial };
    } else {
      expect(query).toBe(PILOT_REFUND_QUERY); expect(variables.id).toBe(source.refunds[0]?.id);
      data = { refund: source.refunds[0] };
    }
    expect(query.trim().startsWith("query ")).toBe(true);
    return new Response(JSON.stringify({ data }), { headers: { "X-Shopify-API-Version": "2026-07" } });
  });
}
let db: PGlite;
let network: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  network = vi.fn(() => { throw new Error("external_network_forbidden"); });
  vi.stubGlobal("fetch", network);
  db = new PGlite();
  await db.exec("create role service_role; create role anon; create role authenticated;");
  // Model broad Supabase public-function defaults: the pilot must revoke these.
  await db.exec("alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;");
  for (const file of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views", "015_backfill", "016_shopify_pilot"])
    await db.exec(readFileSync(`sql/analytics/${file}.sql`, "utf8"));
  await db.query("insert into lean_private.pilot_environment(project_ref,approval_ref) values($1,'fixture:test-only')", [projectRef]);
  await db.query("select public.lean_pilot_register($1,$2,$3,$4::jsonb,'fixture:test-only','fixture:operator')",
    [runId, shop, fixture().commerce.order.id, JSON.stringify(policy)]);
}, 30000);
afterEach(async () => {
  expect(network).not.toHaveBeenCalled();
  await db?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
const client: AnalyticsRpcClient = {
  async rpc(name, args) {
    const names = ["lean_pilot_claim", "lean_pilot_retain", "lean_pilot_finish", "lean_pilot_fail"];
    if (!names.includes(name)) throw new Error("unknown_rpc");
    const entries = Object.entries(args);
    if (entries.some(([k]) => !/^p_[a-z_]+$/.test(k))) throw new Error("invalid_argument");
    const json = new Set(["p_source", "p_facts", "p_reports"]);
    const parameters = entries.map(([k], i) => `${k} => $${i + 1}${json.has(k) ? "::jsonb" : ""}`).join(",");
    try {
      const result = await db.query<{ result: unknown }>(`select public.${name}(${parameters}) result`,
        entries.map(([k, v]) => json.has(k) ? JSON.stringify(v) : v));
      return { data: result.rows[0].result, error: null };
    } catch { return { data: null, error: "sanitized_sql_error" }; }
  },
};
const run = (fetcher = mockedShopify(), rpcClient = client) => runShopifyPilot({
  client: rpcClient, runId, projectRef, databaseUrl: `https://${projectRef}.supabase.co`,
  shop, accessToken: "fixture-not-a-real-token", fetcher,
});
const map = (source = fixture()) => mapPilotSource(source, policy, publication, "fixture:retained-source");

describe("wired Shopify -> retained source -> actual SQL facts -> sample report", () => {
  it("runs the actual reader, mapper, durable runner and report export with an independent numeric oracle", async () => {
    const fetcher = mockedShopify();
    expect(await run(fetcher)).toEqual({ state: "done" }); expect(fetcher).toHaveBeenCalledTimes(5);
    const rows = (await db.query(`select report_date::text, gross_merchandise_sales_usd::text gross,
      discounts_usd::text discounts, refunds_usd::text refunds, total_sales_usd::text sales,
      collected_cash_usd, new_customers, spend_usd, sample_scope, certification
      from lean_analytics.pilot_store_daily order by report_date`)).rows;
    expect(rows).toEqual([
      { report_date: "2026-01-01", gross: "20.000000", discounts: "2.000000", refunds: "0.000000",
        sales: "27.000000", collected_cash_usd: null, new_customers: null, spend_usd: null,
        sample_scope: "single_order", certification: "unverified" },
      { report_date: "2026-01-02", gross: "0.000000", discounts: "0.000000", refunds: "5.000000",
        sales: "-6.000000", collected_cash_usd: null, new_customers: null, spend_usd: null,
        sample_scope: "single_order", certification: "unverified" },
    ]);
    expect((await db.query("select count(*)::int n from lean_private.orders")).rows).toEqual([{ n: 1 }]);
    expect((await db.query("select count(*)::int n from lean_private.sales_ledger")).rows).toEqual([{ n: 7 }]);
    expect((await db.query("select state from lean_private.publications")).rows).toEqual([{ state: "candidate" }]);
    expect((await db.query("select * from lean_private.certifications")).rows).toEqual([]);
    expect((await db.query("select * from lean_analytics.store_daily")).rows).toEqual([]);
  });
  it("replays a completed run without a second Shopify read or duplicate facts", async () => {
    const fetcher = mockedShopify(); await run(fetcher);
    expect(await run(fetcher)).toEqual({ state: "done" }); expect(fetcher).toHaveBeenCalledTimes(5);
    expect((await db.query("select count(*)::int n from lean_analytics.pilot_store_daily")).rows).toEqual([{ n: 2 }]);
  });
  it("handles a lost finish response without overwriting committed done", async () => {
    const ambiguous: AnalyticsRpcClient = { async rpc(name, args) {
      const result = await client.rpc(name, args);
      if (name === "lean_pilot_finish") throw new Error("lost response");
      return result;
    } };
    const fetcher = mockedShopify();
    await expect(run(fetcher, ambiguous)).rejects.toThrow("pilot_storage_unavailable");
    expect(await run(fetcher)).toEqual({ state: "done" }); expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("reuses retained evidence after an ambiguous retain, fencing out a stale owner", async () => {
    let oldToken: unknown;
    const ambiguous: AnalyticsRpcClient = { async rpc(name, args) {
      const result = await client.rpc(name, args);
      if (name === "lean_pilot_retain") { oldToken = args.p_token; throw new Error("lost response"); }
      return result;
    } };
    const fetcher = mockedShopify();
    await expect(run(fetcher, ambiguous)).rejects.toThrow("pilot_storage_ambiguous");
    expect(await run(fetcher)).toEqual({ state: "busy" });
    await db.exec("update lean_private.pilot_runs set lease_until=now()-interval '1 second'");
    expect(await run(fetcher)).toEqual({ state: "done" }); expect(fetcher).toHaveBeenCalledTimes(5);
    expect(await client.rpc("lean_pilot_finish", { p_run_id: runId, p_token: oldToken, p_facts: {}, p_reports: [] }))
      .toEqual({ data: false, error: null });
  });
  it("retains unsupported source evidence but emits no facts or report", async () => {
    const source = fixture(); source.commerce.order.taxesIncluded = true;
    expect(await run(mockedShopify(source))).toEqual({ state: "failed" });
    expect((await db.query("select state,source is not null retained from lean_private.pilot_runs")).rows)
      .toEqual([{ state: "failed", retained: true }]);
    expect((await db.query("select * from lean_private.orders")).rows).toEqual([]);
    expect((await db.query("select * from lean_analytics.pilot_store_daily")).rows).toEqual([]);
  });
  it("rolls back all materialization if one report is invalid", async () => {
    const token = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await client.rpc("lean_pilot_claim", { p_run_id: runId, p_token: token, p_project_ref: projectRef });
    await client.rpc("lean_pilot_retain", { p_run_id: runId, p_token: token, p_source: fixture() });
    const output = map(); output.reports[1].collected_cash_usd = "6.000000";
    expect((await client.rpc("lean_pilot_finish", { p_run_id: runId, p_token: token,
      p_facts: output.facts, p_reports: output.reports })).error).toBeTruthy();
    expect((await db.query("select * from lean_private.orders")).rows).toEqual([]);
  });
  it("grants the test reader only the sample output and denies clients pilot RPCs", async () => {
    await run();
    await db.exec("set role lean_pilot_reader");
    expect((await db.query("select count(*)::int n from lean_analytics.pilot_store_daily")).rows).toEqual([{ n: 2 }]);
    await expect(db.query("select * from lean_private.pilot_runs")).rejects.toThrow();
    await expect(db.query("delete from lean_analytics.pilot_store_daily")).rejects.toThrow();
    await db.exec("reset role");
    const privileges = (await db.query(`select
      has_function_privilege('anon','public.lean_pilot_claim(uuid,uuid,text)','execute') anonymous,
      has_function_privilege('authenticated','public.lean_pilot_finish(uuid,uuid,jsonb,jsonb)','execute') authenticated,
      has_function_privilege('service_role','public.lean_pilot_register(uuid,text,text,jsonb,text,text)','execute') register,
      has_function_privilege('service_role','public.lean_pilot_claim(uuid,uuid,text)','execute') claim`)).rows;
    expect(privileges).toEqual([{ anonymous: false, authenticated: false, register: false, claim: true }]);
  });
  it("prevents immutable run scope and production target changes", async () => {
    await expect(db.query("select public.lean_pilot_register($1,$2,$3,$4::jsonb,'fixture:test-only','fixture:operator')",
      [runId, shop, gid("Order", "99"), JSON.stringify(policy)])).rejects.toThrow("run scope immutable");
    expect(() => validatePilotTarget("xnfjdbpjuaezxjgargto", "https://xnfjdbpjuaezxjgargto.supabase.co"))
      .toThrow("pilot_isolated_target_required");
    expect(() => validatePilotTarget(projectRef, "https://other.supabase.co")).toThrow();
    await expect(db.exec("update lean_private.pilot_environment set project_ref='xnfjdbpjuaezxjgargto'")).rejects.toThrow();
  });
  it("rejects a changed financial revision during source reads", async () => {
    const source = fixture(); source.financial.updatedAt = "2026-01-03T00:00:00Z";
    await expect(readPilotSource({ shop, accessToken: "fixture", fetcher: mockedShopify(source),
      signal: AbortSignal.timeout(1000) }, source.commerce.order.id as string)).rejects.toThrow("changed_during_read");
  });
  it.each(["shippingLines", "refundLineItems", "refundShippingLines", "transactions", "orderAdjustments"])(
    "fails closed for truncated %s", field => {
      const source = fixture();
      const target = field === "shippingLines" ? source.financial : source.refunds[0];
      sourceObject(sourceObject(target[field]).pageInfo).hasNextPage = true;
      expect(() => map(source)).toThrow("pilot_incomplete_connection");
    });
  it.each(["PENDING", "FAILURE"])("withholds reports for %s refund transactions", status => {
    const source = fixture();
    (sourceObject(source.refunds[0].transactions).nodes as Record<string, unknown>[])[0].status = status;
    expect(() => map(source)).toThrow("pilot_refund_payment_unproven");
  });
  it("rejects missing refunds, unexplained original totals, and excessive line refunds", () => {
    const missing = fixture(); missing.financial.refunds = []; missing.refunds = [];
    expect(() => map(missing)).toThrow("pilot_unallocated_refund");
    const totals = fixture(); totals.financial.totalTaxSet = bag("3");
    expect(() => map(totals)).toThrow("allocation_does_not_reconcile");
    const excess = fixture();
    (sourceObject(excess.refunds[0].refundLineItems).nodes as Record<string, unknown>[])[0].quantity = 3;
    expect(() => map(excess)).toThrow("pilot_refund_exceeds_purchase");
  });
  it("keeps the HTTP runner disabled and requires a dedicated secret before any database or Shopify call", async () => {
    const req = () => new NextRequest(`https://fixture.invalid/api/analytics/ingest/pilot?run_id=${runId}`, { method: "POST" });
    vi.stubEnv("LEAN_ANALYTICS_PILOT_ENABLED", "false");
    expect((await POST(req())).status).toBe(404);
    vi.stubEnv("LEAN_ANALYTICS_PILOT_ENABLED", "true");
    vi.stubEnv("LEAN_ANALYTICS_ENVIRONMENT", "isolated-test");
    vi.stubEnv("LEAN_ANALYTICS_PILOT_RUNNER_SECRET", "fixture-secret-with-at-least-32-characters");
    expect((await POST(req())).status).toBe(401);
    vi.stubEnv("LEAN_ANALYTICS_PILOT_PROJECT_REF", "xnfjdbpjuaezxjgargto");
    vi.stubEnv("LEAN_ANALYTICS_SUPABASE_URL", "https://xnfjdbpjuaezxjgargto.supabase.co");
    const authorized = new NextRequest(req().url, { method: "POST",
      headers: { authorization: "Bearer fixture-secret-with-at-least-32-characters" } });
    expect((await POST(authorized)).status).toBe(503);
  });
});
