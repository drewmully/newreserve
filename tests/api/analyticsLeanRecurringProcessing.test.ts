/** Synthetic HMAC -> production RPC transport -> actual 017/047/050 SQL.
 * No hosted database, Shopify or destination calls. */
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { boundedPipelineClient, runShopifyPipeline } from "@/lib/analytics/shopifyPipeline";
import { acceptShopifyReceipt } from "@/lib/analytics/receipts";
import { createReceiptStore, type AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { SHOPIFY_FINANCIAL_ORDER_QUERY, sourceObject } from "@/lib/analytics/shopifySource";
import { PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY, type PilotSource } from "@/lib/analytics/shopifyPilotSource";
import { GET, POST } from "@/app/api/analytics/ingest/process/route";
import { runtimeSource, runtimePolicy, runtimeMoney, runtimeConnection } from "../fixtures/analyticsRetainedRuntime";

const port = vi.hoisted(() => ({ client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => port.client }));
const shop = "mullybox-store.myshopify.com", project = "xnfjdbpjuaezxjgargto";
const databaseUrl = `https://${project}.supabase.co`;
const secret = "fixture-only-process-secret-32-characters";
let db: PGlite;
let client: AnalyticsRpcClient;
let calls: string[], signals: AbortSignal[], sourceCalls: number;
let source: PilotSource;
let intercept: ((name: string, args: Record<string, unknown>) => Promise<Response> | undefined) | undefined;
const rpcNames = new Set(["lean_accept_receipt", "lean_pipeline_claim", "lean_pipeline_retain",
  "lean_pipeline_finish_extended", "lean_pipeline_fail", "lean_pipeline_health"]);
const jsonArgs = new Set(["p_payload", "p_source", "p_facts", "p_reports", "p_product_reports", "p_order_item_sizes"]);

async function sqlResponse(name: string, args: Record<string, unknown>) {
  const entries = Object.entries(args);
  const json = (key: string) => jsonArgs.has(key) && (key !== "p_source" || name === "lean_pipeline_retain");
  try {
    const result = await db.query<{ result: unknown }>(
      `select public.${name}(${entries.map(([k], i) => `${k} => $${i + 1}${json(k) ? "::jsonb" : ""}`).join(",")}) result`,
      entries.map(([k, v]) => json(k) && v !== null ? JSON.stringify(v) : v));
    return new Response(JSON.stringify(result.rows[0].result), { headers: { "Content-Type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ message: "fixture_sql_rejected" }), { status: 400 });
  }
}
const transport: typeof fetch = async (url, init) => {
  const name = new URL(String(url)).pathname.split("/").pop()!;
  expect(rpcNames.has(name)).toBe(true);
  const args = JSON.parse(String(init?.body));
  calls.push(name);
  if (name !== "lean_accept_receipt") {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    signals.push(init!.signal!);
  }
  return intercept?.(name, args) ?? sqlResponse(name, args);
};
function fixture(id = "1", revision = "2026-01-02T12:00:00Z"): PilotSource {
  const value = runtimeSource();
  value.commerce.shop = shop;
  value.commerce.order.id = `gid://shopify/Order/${id}`;
  value.financial.id = value.commerce.order.id;
  value.commerce.order.updatedAt = revision;
  value.financial.updatedAt = revision;
  const line = sourceObject((sourceObject(value.commerce.order.lineItems).nodes as unknown[])[0]);
  line.id = `gid://shopify/LineItem/${id}2`;
  sourceObject((value.commerce.order.transactions as unknown[])[0]).id = `gid://shopify/OrderTransaction/${id}4`;
  return value;
}
function refunded(): PilotSource {
  const value = fixture("1", "2026-01-03T12:02:00Z"), money = runtimeMoney, connection = runtimeConnection;
  value.commerce.order.transactionsCount = { count: 2, precision: "EXACT" };
  (value.commerce.order.transactions as unknown[]).push({
    id: "gid://shopify/OrderTransaction/15", kind: "REFUND", status: "SUCCESS", gateway: "fixture", test: false,
    createdAt: "2026-01-03T12:00:00Z", processedAt: "2026-01-03T12:01:00Z", amountSet: money("6"),
    parentTransaction: { id: "gid://shopify/OrderTransaction/14", gateway: "fixture" },
  });
  value.financial.refunds = [{ id: "gid://shopify/Refund/17", updatedAt: "2026-01-03T12:00:00Z" }];
  value.refunds = [{
    id: "gid://shopify/Refund/17", order: { id: value.commerce.order.id },
    createdAt: "2026-01-03T12:00:00Z", updatedAt: "2026-01-03T12:00:00Z", totalRefundedSet: money("6"),
    duties: [], orderAdjustments: connection([]), refundShippingLines: connection([]),
    refundLineItems: connection([{ id: "gid://shopify/RefundLineItem/18", quantity: 1,
      lineItem: { id: "gid://shopify/LineItem/12" }, subtotalSet: money("5"), totalTaxSet: money("1") }]),
    transactions: connection([{ id: "gid://shopify/OrderTransaction/15", kind: "REFUND", status: "SUCCESS",
      processedAt: "2026-01-03T12:01:00Z", amountSet: money("6") }]),
  }];
  return value;
}
const shopify: typeof fetch = async (url, init) => {
  expect(String(url)).toBe(`https://${shop}/admin/api/2026-07/graphql.json`);
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(init?.redirect).toBe("error");
  const { query } = JSON.parse(String(init?.body));
  sourceCalls++;
  const data = query === SHOPIFY_FINANCIAL_ORDER_QUERY ? { order: source.commerce.order }
    : query === PILOT_FINANCIAL_QUERY ? { order: source.financial }
    : query === PILOT_REFUND_QUERY ? { refund: source.refunds[0] } : null;
  expect(data).not.toBeNull();
  return new Response(JSON.stringify({ data }), { headers: { "X-Shopify-API-Version": "2026-07" } });
};
async function receipt(deliveryId = randomUUID(), topic = "orders/paid") {
  const payload = topic === "refunds/create" ? { id: "17", order_id: source.commerce.order.id }
    : { admin_graphql_api_id: source.commerce.order.id, updated_at: source.commerce.order.updatedAt };
  const body = Buffer.from(JSON.stringify(payload));
  return acceptShopifyReceipt({ body, secret: "fixture-hmac", shop, allowedShop: shop, topic, deliveryId,
    retention: "financial_allowlist_v1",
    signature: createHmac("sha256", "fixture-hmac").update(body).digest("base64") }, createReceiptStore(client));
}
const req = (method: string, signal?: AbortSignal) => new NextRequest("https://fixture.invalid/api/analytics/ingest/process", {
  method, headers: { authorization: `Bearer ${secret}` }, signal,
});
const read = async () => (await db.query<{ r: { store_daily: Record<string, unknown>[]; product_daily: Record<string, unknown>[] } }>(
  "select public.lean_production_reports_read() r")).rows[0].r;
const heads = async () => (await db.query("select order_gid,work_id,revision from lean_private.pipeline_heads order by order_gid")).rows;
beforeEach(async () => {
  calls = []; signals = []; sourceCalls = 0; intercept = undefined; source = fixture();
  vi.stubGlobal("fetch", shopify);
  db = new PGlite();
  await db.exec("create role service_role; create role anon; create role authenticated;");
  for (const name of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views",
    "017_shopify_pipeline", "047_pipeline_extended", "050_production_report_delivery", "052_pipeline_before_window_exclusion"])
    await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
  await db.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-01-01','2026-02-01',$3::jsonb,'fixture:scope','fixture:owner')`,
  [shop, project, JSON.stringify(runtimePolicy)]);
  await db.exec("update lean_private.production_report_delivery set enabled=true,approval_ref='fixture:only'");
  client = createClient(databaseUrl, "fixture-service-key", { global: { fetch: transport }, auth: { persistSession: false } });
  port.client = client;
  for (const [key, value] of Object.entries({
    LEAN_ANALYTICS_PIPELINE_ENABLED: "true", LEAN_ANALYTICS_PIPELINE_SECRET: secret,
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: databaseUrl,
    LEAN_SHOPIFY_SHOP_DOMAIN: shop, LEAN_SHOPIFY_ANALYTICS_READ_TOKEN: "fixture-only",
  })) vi.stubEnv(key, value);
}, 30000);
afterEach(async () => { await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("existing automatic observed processing with bounded RPCs", () => {
  it("processes genuine changed fixture input, repeats, refund correction and older revisions without double counting", async () => {
    const delivery = randomUUID();
    await receipt(delivery);
    expect(await (await POST(req("POST"))).json()).toEqual({ state: "done" });
    const firstHeads = await heads(), first = await read();
    expect(first.store_daily[0]).toMatchObject({ eligible_orders: "1", total_sales_usd: "22.000000",
      certified: false, complete_window: false, report_scope: "webhook_observed_only" });
    expect(first.product_daily[0]).toMatchObject({ units: "2.000000", net_merchandise_sales_usd: "18.000000" });
    await receipt(delivery);
    expect(await (await POST(req("POST"))).json()).toEqual({ state: "idle" });
    expect(await heads()).toEqual(firstHeads);
    source = fixture("2");
    await receipt();
    expect(await (await POST(req("POST"))).json()).toEqual({ state: "done" });
    expect((await read()).store_daily[0]).toMatchObject({ eligible_orders: "2", total_sales_usd: "44.000000" });
    expect((await read()).product_daily[0]).toMatchObject({ units: "4.000000", net_merchandise_sales_usd: "36.000000" });
    source = refunded();
    await receipt(undefined, "refunds/create");
    expect(await (await POST(req("POST"))).json()).toEqual({ state: "done" });
    const corrected = await read(), correctedHeads = await heads();
    expect(corrected.store_daily[1]).toMatchObject({ report_date: "2026-01-03", refunds_usd: "5.000000",
      tax_net_usd: "-1.000000", total_sales_usd: "-6.000000", eligible_orders: "0" });
    expect(corrected.product_daily[1]).toMatchObject({ refunds_usd: "5.000000", net_merchandise_sales_usd: "-5.000000" });
    await receipt();
    expect(await (await POST(req("POST"))).json()).toEqual({ state: "done" });
    expect(await heads()).toEqual(correctedHeads);
    source = fixture();
    await receipt();
    expect(await (await POST(req("POST"))).json()).toEqual({ state: "done" });
    expect(await heads()).toEqual(correctedHeads);
    expect(await read()).toEqual(corrected);
    const health = await GET(req("GET"));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ pending: 0, leased: 0, dead: 0, done: 5 });
    expect(signals.every(signal => !signal.aborted)).toBe(true);
  });

  it("withholds an unsupported correction without replacing the last successful head", async () => {
    await receipt(); await POST(req("POST"));
    const prior = await heads();
    source = fixture("1", "2026-01-04T12:00:00Z");
    source.commerce.order.edited = true;
    await receipt();
    const response = await POST(req("POST"));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ state: "failed" });
    expect(await heads()).toEqual(prior);
    expect((await GET(req("GET"))).status).toBe(200);
    expect((await db.query("select pipeline_stale from lean_analytics.observed_order_daily")).rows)
      .toEqual([{ pipeline_stale: true }]);
  });

  it("rejects changed retained content at the same revision, retaining the successful head", async () => {
    await receipt(); await POST(req("POST"));
    const prior = await heads();
    sourceObject((sourceObject(source.commerce.order.lineItems).nodes as unknown[])[0]).sku = "DIFFERENT";
    await receipt();
    expect((await POST(req("POST"))).status).toBe(503);
    expect(await heads()).toEqual(prior);
    expect(calls.filter(name => name === "lean_pipeline_fail")).toHaveLength(0);
  });

  it("does not initiate any RPC or source read when already aborted", async () => {
    const stop = new AbortController(); stop.abort();
    expect((await POST(req("POST", stop.signal))).status).toBe(503);
    expect((await GET(req("GET", stop.signal))).status).toBe(503);
    expect(calls).toEqual([]); expect(sourceCalls).toBe(0);
  });

  for (const stage of ["lean_pipeline_claim", "lean_pipeline_retain", "lean_pipeline_finish_extended"]) {
    it(`settles an aborted ${stage} without rollback claims, follow-on dispatch or failure/retry`, async () => {
      await receipt();
      const stop = new AbortController();
      let release!: () => Promise<void>, entered!: () => void;
      const reached = new Promise<void>(resolve => { entered = resolve; });
      intercept = (name, args) => {
        if (name !== stage) return;
        return new Promise<Response>(resolve => {
          release = async () => { resolve(await sqlResponse(name, args)); };
          entered();
        });
      };
      const response = POST(req("POST", stop.signal));
      await reached; stop.abort();
      expect((await response).status).toBe(503);
      expect(signals.at(-1)?.aborted).toBe(true);
      const before = [...calls];
      await release(); await new Promise(resolve => setTimeout(resolve, 5));
      expect(calls).toEqual(before);
      expect(calls).not.toContain("lean_pipeline_fail");
      expect(sourceCalls).toBe(stage === "lean_pipeline_claim" ? 0 : 4);
      // The in-flight mutation can still commit. No response claims otherwise.
      expect((await heads()).length).toBe(stage === "lean_pipeline_finish_extended" ? 1 : 0);
    });
  }

  it("rejects an actual late finish after lease expiry", async () => {
    await receipt();
    intercept = (name, args) => name === "lean_pipeline_finish_extended" ? (async () => {
      await db.exec("update lean_private.work set lease_until=clock_timestamp()-interval '1 second' where state='leased'");
      return sqlResponse(name, args);
    })() : undefined;
    const response = await POST(req("POST"));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ state: "lost_lease" });
    expect(await heads()).toEqual([]);
    expect(await read()).toEqual({ store_daily: [], product_daily: [] });
  });

  it("bounds a nonsettling health transport and passes the actual abort signal", async () => {
    const stop = new AbortController();
    let entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    intercept = name => {
      if (name !== "lean_pipeline_health") return;
      entered(); return new Promise<Response>(() => {});
    };
    const response = GET(req("GET", stop.signal));
    await reached; stop.abort();
    expect((await response).status).toBe(503);
    expect(signals[0].aborted).toBe(true);
    expect(calls).toEqual(["lean_pipeline_health"]);
  });

  it("enforces the route's own five-second health deadline without a caller abort", async () => {
    intercept = name => name === "lean_pipeline_health" ? new Promise<Response>(() => {}) : undefined;
    const started = Date.now(), response = await GET(req("GET"));
    expect(response.status).toBe(503);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
    expect(Date.now() - started).toBeLessThan(6500);
    expect(signals[0].aborted).toBe(true);
  }, 10000);

  it("does not dispatch later source or failure RPCs after an aborted source transport settles", async () => {
    await receipt();
    const stop = new AbortController();
    let entered!: () => void, release!: (response: Response) => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const native = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      entered();
      return new Promise<Response>(resolve => { release = resolve; });
    });
    vi.stubGlobal("fetch", native);
    const response = POST(req("POST", stop.signal));
    await reached; stop.abort();
    expect((await response).status).toBe(503);
    release(new Response(JSON.stringify({ data: { order: source.commerce.order } }),
      { headers: { "X-Shopify-API-Version": "2026-07" } }));
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(native).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["lean_accept_receipt", "lean_pipeline_claim"]);
    expect(await heads()).toEqual([]);
  });

  it("refuses a Promise-only production RPC port rather than pretending to abort it", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: { state: "idle" }, error: null }));
    const signal = new AbortController().signal;
    await expect(runShopifyPipeline({ client: boundedPipelineClient({ rpc }, signal),
      projectRef: project, databaseUrl, shop, accessToken: "fixture", signal, fetcher: shopify }))
      .rejects.toThrow("pipeline_storage_unavailable");
    expect(sourceCalls).toBe(0);
  });
});
