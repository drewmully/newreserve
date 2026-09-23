import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { runShopifyPipeline, receiptOrderGid, PIPELINE_VERSION, type PipelinePolicy } from "@/lib/analytics/shopifyPipeline";
import { acceptShopifyReceipt } from "@/lib/analytics/receipts";
import { createReceiptStore, type AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { mapPilotSource } from "@/lib/analytics/shopifyPilotMapping";
import { type PilotSource, PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY } from "@/lib/analytics/shopifyPilotSource";
import { SHOPIFY_ANALYTICS_ORDER_QUERY, sourceObject } from "@/lib/analytics/shopifySource";
import { POST, GET } from "@/app/api/analytics/ingest/process/route";
import { dispatchConfig, dispatchOnce } from "../../scripts/analytics/dispatch-pipeline.mjs";

const routePort = vi.hoisted(() => ({ client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => routePort.client }));
const shop = "pipeline-fixture.myshopify.com", projectRef = "aaaaaaaaaaaaaaaaaaaa";
const policy: PipelinePolicy = {
  decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: false, approvalRef: "fixture:catalog" },
  productClasses: { "3": "merchandise" }, financialApprovalRef: "fixture:finance",
  saleClock: "paid_at", refundClock: "refund_created_at",
};
const gid = (type: string, id: string) => `gid://shopify/${type}/${id}`;
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
const connection = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
function fixture(id = "9007199254740993", revision = "2026-01-02T15:00:00Z", refunded = false): PilotSource {
  const order = {
    id: gid("Order", id), createdAt: "2026-01-01T12:00:00Z", updatedAt: revision,
    currencyCode: "USD", edited: false, taxesIncluded: false, test: false, cancelledAt: null, shippingAddress: null,
    originalTotalPriceSet: money("27"), subtotalPriceSet: money("18"),
    transactionsCount: { count: refunded ? 2 : 1, precision: "EXACT" },
    transactions: [
      { id: gid("OrderTransaction", "4"), kind: "SALE", status: "SUCCESS", gateway: "fixture", test: false,
        createdAt: "2026-01-01T12:00:00Z", processedAt: "2026-01-01T12:01:00Z", amountSet: money("27"), parentTransaction: null },
      ...(refunded ? [{ id: gid("OrderTransaction", "5"), kind: "REFUND", status: "SUCCESS", gateway: "fixture", test: false,
        createdAt: "2026-01-02T12:00:00Z", processedAt: "2026-01-02T12:01:00Z", amountSet: money("6"),
        parentTransaction: { id: gid("OrderTransaction", "4"), gateway: "fixture" } }] : []),
    ],
    lineItems: connection([{ id: gid("LineItem", "2"), sku: "FIXTURE", quantity: 2, isGiftCard: false,
      product: { id: gid("Product", "3") }, originalUnitPriceSet: money("10"), originalTotalSet: money("20"),
      discountAllocations: [{ allocatedAmountSet: money("2") }] }]),
  };
  return {
    commerce: { shop, apiVersion: "2026-07", order },
    financial: { id: order.id, updatedAt: revision, currencyCode: "USD", originalTotalPriceSet: money("27"),
      totalTaxSet: money("4"), originalTotalDutiesSet: null, originalTotalAdditionalFeesSet: null, totalTipReceivedSet: money("0"),
      shippingLines: connection([{ id: gid("ShippingLine", "6"), discountedPriceSet: money("5") }]),
      refunds: refunded ? [{ id: gid("Refund", "7"), updatedAt: "2026-01-02T12:02:00Z" }] : [] },
    refunds: refunded ? [{ id: gid("Refund", "7"), order: { id: order.id }, createdAt: "2026-01-02T12:00:00Z",
      updatedAt: "2026-01-02T12:02:00Z", totalRefundedSet: money("6"), duties: [], orderAdjustments: connection([]),
      refundLineItems: connection([{ id: gid("RefundLineItem", "8"), quantity: 1, lineItem: { id: gid("LineItem", "2") },
        subtotalSet: money("5"), totalTaxSet: money("1") }]), refundShippingLines: connection([]),
      transactions: connection([{ id: gid("OrderTransaction", "5"), kind: "REFUND", status: "SUCCESS",
        processedAt: "2026-01-02T12:01:00Z", amountSet: money("6") }]) }] : [],
  };
}
function shopify(source = fixture()) {
  return vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe(`https://${shop}/admin/api/2026-07/graphql.json`);
    const { query, variables } = JSON.parse(String(init?.body));
    expect(query.trim().startsWith("query ")).toBe(true);
    expect(init?.redirect).toBe("error");
    let data;
    if (query === SHOPIFY_ANALYTICS_ORDER_QUERY) data = { order: source.commerce.order };
    else if (query === PILOT_FINANCIAL_QUERY) data = { order: source.financial };
    else { expect(query).toBe(PILOT_REFUND_QUERY); data = { refund: source.refunds[0] }; }
    expect(variables.id).toBe(query === PILOT_REFUND_QUERY ? gid("Refund", "7") : source.commerce.order.id);
    return new Response(JSON.stringify({ data }), { headers: { "X-Shopify-API-Version": "2026-07" } });
  });
}
let db: PGlite;
let network: ReturnType<typeof vi.fn>;
const client: AnalyticsRpcClient = { async rpc(name, args) {
  if (!["lean_accept_receipt", "lean_pipeline_claim", "lean_pipeline_retain", "lean_pipeline_finish",
    "lean_pipeline_fail", "lean_pipeline_health"].includes(name)) throw new Error("unknown RPC");
  const entries = Object.entries(args);
  const json = new Set(["p_payload", "p_facts", "p_reports", ...(name === "lean_pipeline_retain" ? ["p_source"] : [])]);
  try {
    const result = await db.query<{ result: unknown }>(
      `select public.${name}(${entries.map(([k], i) => `${k} => $${i + 1}${json.has(k) ? "::jsonb" : ""}`).join(",")}) result`,
      entries.map(([k, v]) => json.has(k) ? JSON.stringify(v) : v));
    return { data: result.rows[0].result, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "SQL failed" };
  }
} };
beforeEach(async () => {
  routePort.client = client;
  network = vi.fn(() => { throw new Error("external_network_forbidden"); }); vi.stubGlobal("fetch", network);
  db = new PGlite();
  await db.exec(`create role service_role; create role anon; create role authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const name of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views",
    "015_backfill", "016_shopify_pilot", "017_shopify_pipeline"])
    await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
  await db.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-01-01','2026-02-01',$3::jsonb,'fixture:only','fixture:operator')`,
  [shop, projectRef, JSON.stringify(policy)]);
}, 30000);
afterEach(async () => { expect(network).not.toHaveBeenCalled(); await db?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const run = (fetcher = shopify(), rpcClient = client) => runShopifyPipeline({
  client: rpcClient, projectRef, databaseUrl: `https://${projectRef}.supabase.co`, shop, accessToken: "fixture-only", fetcher,
});
async function receipt(delivery = randomUUID(), id = "9007199254740993", topic = "orders/updated", updated?: string) {
  const payload = topic === "refunds/create" ? { id: "7", order_id: id } :
    { admin_graphql_api_id: gid("Order", id), ...(updated ? { updated_at: updated } : {}) };
  const body = Buffer.from(JSON.stringify(payload));
  return acceptShopifyReceipt({ body, secret: "fixture-hmac", allowedShop: shop, shop, topic, deliveryId: delivery,
    signature: createHmac("sha256", "fixture-hmac").update(body).digest("base64") }, createReceiptStore(client));
}
const query = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
const claim = (token = randomUUID()) => client.rpc("lean_pipeline_claim", { p_token: token, p_project_ref: projectRef, p_shop: shop });
async function finishArgs(source = fixture(), token = randomUUID()) {
  const c = sourceObject((await claim(token)).data);
  const args = { p_work_id: c.workId, p_token: token };
  expect((await client.rpc("lean_pipeline_retain", { ...args, p_source: source })).data).toBe(true);
  const mapped = mapPilotSource(source, { ...policy, lineClasses: { "2": "merchandise" } },
    c.publication as string, "fixture:retained");
  return { ...args, p_facts: mapped.facts, p_reports: mapped.reports.map(r => ({ ...r, definition_version: PIPELINE_VERSION })) };
}
describe("automatic verified receipt -> Shopify hydration -> durable candidate -> latest observed report", () => {
  it("automatically processes two orders with independent totals and no per-order registration", async () => {
    await receipt(); expect(await run()).toEqual({ state: "done" });
    await receipt(undefined, "99"); expect(await run(shopify(fixture("99")))).toEqual({ state: "done" });
    expect(await query("select count(distinct order_gid)::int orders,sum(total_sales_usd)::text sales from lean_analytics.observed_order_daily"))
      .toEqual([{ orders: 2, sales: "54.000000" }]);
    expect(await query("select distinct certification,coverage,pipeline_stale,collected_cash_usd from lean_analytics.observed_order_daily"))
      .toEqual([{ certification: "unverified", coverage: "webhook_observed_only", pipeline_stale: false, collected_cash_usd: null }]);
    expect(await query("select * from lean_private.certifications")).toEqual([]);
    expect(await query("select * from lean_analytics.store_daily")).toEqual([]);
  });
  it("runs the authenticated HTTP route and health through the actual SQL RPCs as service_role", async () => {
    await db.exec("set role service_role");
    await receipt();
    vi.stubGlobal("fetch", shopify());
    vi.stubEnv("LEAN_ANALYTICS_PIPELINE_ENABLED", "true");
    vi.stubEnv("LEAN_ANALYTICS_PIPELINE_SECRET", "fixture-secret-with-32-or-more-characters");
    vi.stubEnv("LEAN_ANALYTICS_PIPELINE_PROJECT_REF", projectRef);
    vi.stubEnv("LEAN_ANALYTICS_SUPABASE_URL", `https://${projectRef}.supabase.co`);
    vi.stubEnv("LEAN_SHOPIFY_SHOP_DOMAIN", shop);
    vi.stubEnv("LEAN_SHOPIFY_ANALYTICS_READ_TOKEN", "fixture-only");
    const req = (method: string) => new NextRequest("https://fixture.invalid/api/analytics/ingest/process",
      { method, headers: { authorization: "Bearer fixture-secret-with-32-or-more-characters" } });
    const response = await POST(req("POST"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ state: "done" });
    const health = await GET(req("GET")); expect(health.status).toBe(200);
    expect(health.headers.get("cache-control")).toBe("no-store");
    expect(await health.json()).toMatchObject({ done: 1, dead: 0, pending: 0 });
    await db.exec("reset role");
  });
  it("marks completed output stale after an approved policy or coverage change", async () => {
    await receipt(); await run();
    await db.exec(`update lean_private.pipeline_scope set until_time='2026-03-01',
      approval_ref='fixture:revised-window'`);
    expect(await query("select distinct pipeline_stale from lean_analytics.observed_order_daily"))
      .toEqual([{ pipeline_stale: true }]);
    await db.exec(`update lean_private.pipeline_scope set until_time='2026-02-01',
      policy=jsonb_set(policy,'{financialApprovalRef}','"fixture:revised-finance"'),
      approval_ref='fixture:revised-policy'`);
    expect(await query("select distinct pipeline_stale from lean_analytics.observed_order_daily"))
      .toEqual([{ pipeline_stale: true }]);
  });
  it("deduplicates delivery IDs and marks no work idle without source calls", async () => {
    const delivery = randomUUID(); await receipt(delivery); await receipt(delivery);
    const fetcher = shopify(); await run(fetcher); expect(await run(fetcher)).toEqual({ state: "idle" });
    expect(await query("select count(*)::int n from lean_private.orders")).toEqual([{ n: 1 }]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("handles refunds/create as the parent order and replaces rather than doubles its old snapshot", async () => {
    await receipt(); await run();
    await receipt(undefined, "9007199254740993", "refunds/create");
    expect(await run(shopify(fixture(undefined, "2026-01-03T00:00:00Z", true)))).toEqual({ state: "done" });
    expect(await query("select count(distinct order_gid)::int orders,sum(total_sales_usd)::text sales from lean_analytics.observed_order_daily"))
      .toEqual([{ orders: 1, sales: "21.000000" }]);
    expect(await query("select count(*)::int n from lean_private.orders")).toEqual([{ n: 2 }]);
  });
  it("does not regress current reports for an older hydrated revision", async () => {
    await receipt(); await run(shopify(fixture(undefined, "2026-01-03T00:00:00Z", true)));
    await receipt(); expect(await run()).toEqual({ state: "done" });
    expect(await query("select sum(total_sales_usd)::text sales from lean_analytics.observed_order_daily")).toEqual([{ sales: "21.000000" }]);
  });
  it("does not advance the head or duplicate current rows for identical revisions", async () => {
    await receipt(); await run(); const head = await query("select work_id from lean_private.pipeline_heads");
    await receipt(); await run();
    expect(await query("select work_id from lean_private.pipeline_heads")).toEqual(head);
    expect(await query("select count(*)::int n from lean_analytics.observed_order_daily")).toEqual([{ n: 1 }]);
  });
  it("rejects conflicting same-revision source, preserving a visibly stale last-good report", async () => {
    await receipt(); await run(); await receipt();
    const source = fixture(); source.commerce.order.shippingAddress = { countryCodeV2: "US", provinceCode: "NY" };
    await expect(run(shopify(source))).rejects.toThrow("storage_unavailable");
    expect(await query("select count(*)::int n from lean_private.orders")).toEqual([{ n: 1 }]);
    expect(await query("select pipeline_stale from lean_analytics.observed_order_daily")).toEqual([{ pipeline_stale: true }]);
  });
  it("reuses the durable source after a lost retain response and fences the old worker", async () => {
    await receipt(); const fetcher = shopify();
    const ambiguous: AnalyticsRpcClient = { async rpc(name, args) {
      const result = await client.rpc(name, args); if (name === "lean_pipeline_retain") throw new Error("lost response"); return result;
    } };
    await expect(run(fetcher, ambiguous)).rejects.toThrow("storage_ambiguous");
    const old = (await query("select work_id,lease_token from lean_private.work"))[0];
    await db.exec("update lean_private.work set lease_until=now()-interval '1 second'");
    expect(await run(fetcher)).toEqual({ state: "done" }); expect(fetcher).toHaveBeenCalledTimes(4);
    expect((await client.rpc("lean_pipeline_fail", { p_work_id: old.work_id, p_token: old.lease_token,
      p_code: "mapping_rejected" })).data).toBe(false);
  });
  it("does not mark a committed completion failed after a lost finish response", async () => {
    await receipt();
    const ambiguous: AnalyticsRpcClient = { async rpc(name, args) {
      const result = await client.rpc(name, args); if (name === "lean_pipeline_finish") throw new Error("lost response"); return result;
    } };
    await expect(run(shopify(), ambiguous)).rejects.toThrow("storage_unavailable");
    expect(await run()).toEqual({ state: "idle" });
    expect(await query("select state from lean_private.work")).toEqual([{ state: "done" }]);
  });
  it("backs off source errors, dead-letters after five attempts and exposes counts only", async () => {
    await receipt();
    const failure = vi.fn<typeof fetch>(async () => new Response("private source error", { status: 429 }));
    for (let n = 0; n < 5; n++) {
      expect(await run(failure)).toEqual({ state: "failed" });
      if (n < 4) {
        expect(await run(failure)).toEqual({ state: "idle" });
        await db.exec("update lean_private.work set available_at=now()-interval '1 second'");
      }
    }
    expect(await run(failure)).toEqual({ state: "idle" });
    const health = sourceObject((await client.rpc("lean_pipeline_health", { p_project_ref: projectRef, p_shop: shop })).data);
    expect(health).toMatchObject({ dead: 1, pending: 0, done: 0, enabled: true });
    expect(JSON.stringify(health)).not.toContain("9007199254740993");
  });
  it("retains rejected catalog records without emitting guessed classifications or reports", async () => {
    await receipt(); const source = fixture();
    sourceObject((sourceObject(source.commerce.order.lineItems).nodes as unknown[])[0]).product = { id: gid("Product", "999") };
    expect(await run(shopify(source))).toEqual({ state: "failed" });
    expect(await query("select source is not null retained from lean_private.pipeline_snapshots")).toEqual([{ retained: true }]);
    expect(await query("select * from lean_private.orders")).toEqual([]);
  });
  it("refuses a source older than the webhook without pinning it", async () => {
    await receipt(undefined, undefined, undefined, "2026-01-03T00:00:00Z");
    expect(await run()).toEqual({ state: "failed" });
    expect(await query("select source from lean_private.pipeline_snapshots")).toEqual([{ source: null }]);
  });
  it("waits for the referenced refund to appear before retaining or completing the event", async () => {
    await receipt(undefined, undefined, "refunds/create");
    expect(await run()).toEqual({ state: "failed" });
    expect(await query("select source from lean_private.pipeline_snapshots")).toEqual([{ source: null }]);
    await db.exec("update lean_private.work set available_at=now()-interval '1 second'");
    expect(await run(shopify(fixture(undefined, undefined, true)))).toEqual({ state: "done" });
  });
  it("rolls back facts, reports, head and completion if a report is invalid", async () => {
    await receipt(); const args = await finishArgs(); sourceObject(args.p_reports[0]).collected_cash_usd = "1";
    expect((await client.rpc("lean_pipeline_finish", args)).error).toBeTruthy();
    expect(await query("select * from lean_private.orders")).toEqual([]);
    expect(await query("select * from lean_private.pipeline_heads")).toEqual([]);
    expect(await query("select state from lean_private.work")).toEqual([{ state: "leased" }]);
  });
  it("enforces receipt-to-order binding in SQL as well as the runtime", async () => {
    await receipt(); const token = randomUUID(); const c = sourceObject((await claim(token)).data);
    expect((await client.rpc("lean_pipeline_retain", { p_work_id: c.workId, p_token: token, p_source: fixture("99") })).error)
      .toBe("receipt order mismatch");
  });
  it("never lets null tokens finalize retained work and does not give overlapping claims the same receipt", async () => {
    await receipt(); const args = await finishArgs();
    expect((await claim()).data).toEqual({ state: "idle" });
    expect((await client.rpc("lean_pipeline_finish", { ...args, p_token: null })).data).toBe(false);
    expect((await client.rpc("lean_pipeline_finish", args)).data).toBe(true);
  });
  it("honors database disable and refuses unregistered targets and in-flight completion after disable", async () => {
    await receipt(); const args = await finishArgs();
    await db.exec("update lean_private.pipeline_scope set enabled=false");
    expect(await run()).toEqual({ state: "disabled" });
    expect((await client.rpc("lean_pipeline_finish", args)).data).toBe(false);
    expect((await client.rpc("lean_pipeline_claim", { p_token: randomUUID(), p_project_ref: "wrong", p_shop: shop })).error).toBeTruthy();
  });
  it("requires fresh approval for scope changes and denies replaying completed materializations", async () => {
    await expect(db.exec("update lean_private.pipeline_scope set until_time='2027-01-01'")).rejects.toThrow("scope approval required");
    await receipt(); await run();
    await expect(db.exec("select public.lean_replay_work(1,'fixture:approval','fixture:operator')")).rejects.toThrow("snapshot immutable");
    await expect(db.query("select * from public.lean_claim_work($1,1,120)", [randomUUID()])).rejects.toThrow("use pipeline worker");
  });
  it("allows only audited operator recovery of dead work, preserving old source evidence", async () => {
    await receipt(); const source = fixture(); source.commerce.order.edited = true;
    expect(await run(shopify(source))).toEqual({ state: "failed" });
    await db.exec("update lean_private.work set state='dead',attempts=5");
    await db.exec("set role service_role");
    await expect(db.exec("select public.lean_pipeline_retry(1,true,'fixture:approval','fixture:operator')")).rejects.toThrow();
    await db.exec("reset role");
    expect(await query("select public.lean_pipeline_retry(1,true,'fixture:approval','fixture:operator') retried")).toEqual([{ retried: true }]);
    expect(await query("select previous_state#>>'{source,commerce,order,edited}' edited from lean_private.pipeline_operator_audit"))
      .toEqual([{ edited: "true" }]);
    expect(await run()).toEqual({ state: "done" });
    expect(await query("select public.lean_pipeline_retry(1,true,'fixture:approval','fixture:operator') retried")).toEqual([{ retried: false }]);
  });
  it("gives readers only observed output and removes inherited client and operator-RPC grants", async () => {
    await receipt(); await run(); await db.exec("set role lean_observed_reader");
    expect((await query("select * from lean_analytics.observed_order_daily")).length).toBe(1);
    await expect(db.exec("select * from lean_private.pipeline_snapshots")).rejects.toThrow();
    await expect(db.exec("delete from lean_analytics.observed_order_daily")).rejects.toThrow();
    await db.exec("reset role");
    expect(await query(`select has_function_privilege('anon','public.lean_pipeline_claim(uuid,text,text)','execute') anonymous,
      has_function_privilege('authenticated','public.lean_accept_receipt(text,text,text,text,text,jsonb)','execute') client,
      has_function_privilege('service_role','public.lean_select_publication(text,text,text,text)','execute') release,
      has_function_privilege('service_role','public.lean_replay_work(bigint,text,text)','execute') replay`))
      .toEqual([{ anonymous: false, client: false, release: false, replay: false }]);
    await db.exec("set role service_role");
    await expect(db.exec("update lean_private.pipeline_scope set enabled=true")).rejects.toThrow();
    await db.exec("reset role");
  });
  it("rejects unsafe parent identifiers instead of confusing refund IDs with order IDs", () => {
    expect(receiptOrderGid("refunds/create", { id: "7", order_id: "9007199254740993" })).toBe(gid("Order", "9007199254740993"));
    expect(() => receiptOrderGid("refunds/create", { id: "7", order_id: 9007199254740993 })).toThrow();
    expect(() => receiptOrderGid("refunds/create", { admin_graphql_api_id: gid("Refund", "7") })).toThrow();
  });
  it("keeps HTTP processing and health disabled and requires dedicated auth and target before network access", async () => {
    const req = (headers = {}) => new NextRequest("https://fixture.invalid/api/analytics/ingest/process", { method: "POST", headers });
    vi.stubEnv("LEAN_ANALYTICS_PIPELINE_ENABLED", "false");
    expect((await POST(req())).status).toBe(404); expect((await GET(req())).status).toBe(404);
    vi.stubEnv("LEAN_ANALYTICS_PIPELINE_ENABLED", "true");
    vi.stubEnv("LEAN_ANALYTICS_PIPELINE_SECRET", "fixture-secret-with-32-or-more-characters");
    expect((await POST(req())).status).toBe(401);
    vi.stubEnv("LEAN_ANALYTICS_PIPELINE_PROJECT_REF", projectRef);
    vi.stubEnv("LEAN_ANALYTICS_SUPABASE_URL", "https://wrong.supabase.co");
    expect((await POST(req({ authorization: "Bearer fixture-secret-with-32-or-more-characters" }))).status).toBe(503);
  });
  it("runs the opt-in scheduler with bounded requests and reports unhealthy backlog", async () => {
    expect(() => dispatchConfig({})).toThrow("disabled");
    const config = dispatchConfig({ LEAN_ANALYTICS_DISPATCH_ENABLED: "true", LEAN_ANALYTICS_RUNNER_ORIGIN: "https://fixture.invalid",
      LEAN_ANALYTICS_PIPELINE_SECRET: "fixture-secret-with-32-or-more-characters" });
    const fetcher = vi.fn(async (_url, init) => {
      expect(init.redirect).toBe("error");
      return new Response(JSON.stringify(init.method === "POST" ? { state: "idle" } :
        { enabled: true, pending: 2, leased: 0, dead: 1, done: 3, expiredLeases: 0, oldestPendingSeconds: 1000 }));
    });
    expect(await dispatchOnce(config, fetcher)).toEqual({ healthy: false, pending: 2, dead: 1, oldestPendingSeconds: 1000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
