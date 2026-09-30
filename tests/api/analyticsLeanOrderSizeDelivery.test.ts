/** Actual existing worker -> minimized retention ->047/046->051->GET, synthetic only. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { orderSizeReportGet, orderSizeReportPath, validOrderSizeReportPayload } from "@/lib/analytics/orderSizeReportDelivery";
import { productionReportGet } from "@/lib/analytics/productionReportDelivery";
import { GET } from "@/app/api/analytics/reports/order-size/route";
import { OWNER_ORDER_SIZE_REPORT_SQL } from "@/lib/analytics/orderSizeReporting";
import { runShopifyPipeline, type PipelinePolicy } from "@/lib/analytics/shopifyPipeline";
import { acceptShopifyReceipt } from "@/lib/analytics/receipts";
import { createReceiptStore, type AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { runtimePolicy, runtimeSource } from "../fixtures/analyticsRetainedRuntime";
import { SHOPIFY_FINANCIAL_ORDER_QUERY, SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY, sourceObject } from "@/lib/analytics/shopifySource";
import { PILOT_FINANCIAL_QUERY } from "@/lib/analytics/shopifyPilotSource";

const project = "xnfjdbpjuaezxjgargto", shop = "mullybox-store.myshopify.com", product = "8501257044160";
const base: PipelinePolicy = { ...runtimePolicy, productClasses: { [product]: "merchandise" } };
const sized: PipelinePolicy = { ...base, sourceProjection: "financial_no_geo_order_size",
  orderSize: { policyRef: "synthetic:size-approval", productSemantics: { [product]: "requested_box_top_size" } } };
const env = { LEAN_ORDER_SIZE_REPORTS_ENABLED: "true", LEAN_PRODUCTION_REPORTS_ENABLED: "true",
  VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", LEAN_PRODUCTION_REPORTS_SECRET: "synthetic-report-secret-32-characters",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
  LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key" };
const request = (path = orderSizeReportPath, auth = `Bearer ${env.LEAN_PRODUCTION_REPORTS_SECRET}`) =>
  new Request(`https://fixture.invalid${path}`, { headers: { authorization: auth } });
const row = { purchase_date: "2026-09-30", sku_bucket: "RESERVE", size_semantics: "requested_box_top_size",
  size_status: "known", size_value: "M", unit_basis: "requested_box_units", line_count: 1, quantity: "2.000000",
  scope: "selected_observed_latest_heads", is_stale: true, certification: "unverified", certified: false,
  fulfillment_proven: false, return_adjusted: false, complete_history: false,
  definition_version: "order-size-report-v1", coverage_status: "selected_observed" };
const payload = { coverage_status: "selected_observed", order_size_daily: [row] };
const sql = (name: string) => readFileSync(`sql/analytics/${name}.sql`, "utf8");
let network: ReturnType<typeof vi.fn>;
beforeEach(() => { network = vi.fn(() => { throw new Error("hosted_network_forbidden"); }); vi.stubGlobal("fetch", network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("is independent/default-off, authenticates before transport and rejects every caller selector", async () => {
  const transport = vi.fn();
  for (const [change, req, status] of [
    [{ LEAN_ORDER_SIZE_REPORTS_ENABLED: undefined }, request(), 404], [{ LEAN_ORDER_SIZE_REPORTS_ENABLED: "false" }, request(), 404],
    [{ VERCEL_ENV: "preview" }, request(), 404], [{ VERCEL_GIT_COMMIT_REF: "review/branch" }, request(), 404],
    [{}, request(orderSizeReportPath, "wrong"), 401], [{}, request(`${orderSizeReportPath}?date=2026-09-30`), 400],
    [{}, request("/wrong"), 400], [{ LEAN_ANALYTICS_SUPABASE_URL: "https://wrong.invalid" }, request(), 503],
    [{ LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "wrong" }, request(), 503],
    [{ LEAN_PRODUCTION_REPORTS_SECRET: "" }, request(), 503],
  ] as const) expect((await orderSizeReportGet(req, { ...env, ...change }, transport)).status).toBe(status);
  for (const name of ["transfer-encoding", "content-length"]) {
    const req = request(); req.headers.set(name, "1");
    expect((await orderSizeReportGet(req, env, transport)).status).toBe(400);
  }
  const body = request(); Object.defineProperty(body, "body", { value: new ReadableStream() });
  expect((await orderSizeReportGet(body, env, transport)).status).toBe(400);
  expect((await orderSizeReportGet(new Request(`https://fixture.invalid${orderSizeReportPath}`, { method: "POST" }), env, transport)).status).toBe(405);
  expect(transport).not.toHaveBeenCalled();
});
it("positively validates exact scope/tuples/budgets and sanitizes unavailable or malformed responses", async () => {
  expect(validOrderSizeReportPayload(payload)).toBe(true);
  const badRows = [{ ...row, customer_id: "PRIVATE" }, { ...row, certified: true }, { ...row, is_stale: false },
    { ...row, size_status: "missing" }, { ...row, quantity: 2 }, { ...row, quantity: "0.000000" },
    { ...row, size_value: "medium" }, { ...row, line_count: 0 }, { ...row, purchase_date: "2026-02-30" },
    { ...row, size_semantics: "purchased_shirt_variant", unit_basis: "purchased_shirt_variant_units" }];
  for (const bad of [null, {}, { ...payload, raw: [] }, { ...payload, order_size_daily: [] },
    ...badRows.map(r => ({ ...payload, order_size_daily: [r] })),
    { ...payload, order_size_daily: [row, row] }, { coverage_status: "no_selected_orders", order_size_daily: [row] }]) {
    const response = await orderSizeReportGet(request(), env, async () => Response.json(bad));
    expect(response.status).toBe(503); expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(validOrderSizeReportPayload({ ...payload, order_size_daily: Array(10001).fill(row) })).toBe(false);
  for (const transport of [
    async () => new Response("PRIVATE", { status: 500 }),
    async () => { throw new Error("PRIVATE"); }, async () => new Response(" ".repeat(4194305)),
  ]) expect((await orderSizeReportGet(request(), env, transport)).status).toBe(503);
  expect((await orderSizeReportGet(request(), env, async () => Response.json({
    coverage_status: "no_selected_orders", order_size_daily: [],
  }))).status).toBe(200);
});
async function database() {
  const db = new PGlite();
  await db.exec(`create role service_role;create role anon;create role authenticated;create role lean_posthog_reader;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role,lean_posthog_reader;`);
  for (const name of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views",
    "017_shopify_pipeline", "047_pipeline_extended", "050_production_report_delivery"]) await db.exec(sql(name));
  await db.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-09-30T19:19:02.220236Z','9999-12-31T00:00:00Z',$3,'synthetic:base','synthetic:owner')`,
    [shop, project, JSON.stringify(base)]);
  await db.exec("update lean_private.production_report_delivery set enabled=true,approval_ref='synthetic:delivery'");
  return db;
}
async function read(db: PGlite, size = true) {
  await db.exec("set role service_role");
  try { return (await db.query<{ r: unknown }>(`select public.${size ? "lean_order_size_reports_read" : "lean_production_reports_read"}() r`)).rows[0].r; }
  finally { await db.exec("reset role"); }
}
async function policy(db: PGlite, value: PipelinePolicy) {
  await db.query("update lean_private.pipeline_scope set policy=$1,approval_ref=$2", [JSON.stringify(value), `synthetic:${randomUUID()}`]);
}
async function run(db: PGlite, id: string, values = ["M"], revision = "2026-09-30T20:05:00Z") {
  const client: AnalyticsRpcClient = { async rpc(name, args) {
    if (!["lean_accept_receipt", "lean_pipeline_claim", "lean_pipeline_retain", "lean_pipeline_finish_extended", "lean_pipeline_fail"].includes(name))
      throw new Error("unexpected_fixture_rpc");
    const entries = Object.entries(args), json = (k: string) => ["p_payload", "p_facts", "p_reports", "p_product_reports", "p_order_item_sizes"].includes(k) ||
      (name === "lean_pipeline_retain" && k === "p_source");
    try {
      const out = await db.query<{ r: unknown }>(`select public.${name}(${entries.map(([k], i) => `${k}=>$${i + 1}${json(k) ? "::jsonb" : ""}`).join(",")}) r`,
        entries.map(([k, v]) => json(k) && v !== null ? JSON.stringify(v) : v));
      return { data: out.rows[0].r, error: null };
    } catch { return { data: null, error: "synthetic_storage_error" }; }
  } };
  const body = Buffer.from(JSON.stringify({ id, email: "PRIVATE-RECEIPT" }));
  await acceptShopifyReceipt({ body, secret: "synthetic", deliveryId: randomUUID(), topic: "orders/updated",
    shop, allowedShop: shop, retention: "financial_allowlist_v1",
    signature: createHmac("sha256", "synthetic").update(body).digest("base64") }, createReceiptStore(client));
  const s = runtimeSource(); s.commerce.shop = shop;
  s.commerce.order.id = s.financial.id = `gid://shopify/Order/${id}`;
  s.commerce.order.createdAt = "2026-09-30T20:00:00Z"; s.commerce.order.updatedAt = s.financial.updatedAt = revision;
  Object.assign((s.commerce.order.transactions as Record<string, unknown>[])[0],
    { createdAt: "2026-09-30T20:00:00Z", processedAt: "2026-09-30T20:01:00Z" });
  const line = (sourceObject(s.commerce.order.lineItems).nodes as Record<string, unknown>[])[0];
  Object.assign(line, { product: { id: `gid://shopify/Product/${product}` }, variantTitle: null,
    customAttributes: [...values.map(value => ({ key: "Top size", value })), { key: "_quiz_profile_id", value: "PRIVATE-PROFILE" }] });
  s.financial.email = "PRIVATE-FINANCIAL"; s.commerce.order.note = "PRIVATE-NOTE";
  const queries: string[] = [];
  const result = await runShopifyPipeline({ client, projectRef: project, databaseUrl: `https://${project}.supabase.co`,
    shop, accessToken: "synthetic-only", fetcher: async (_, init) => {
      const query = JSON.parse(String(init?.body)).query; queries.push(query);
      if (![SHOPIFY_FINANCIAL_ORDER_QUERY, SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY, PILOT_FINANCIAL_QUERY].includes(query))
        throw new Error("unexpected_fixture_query");
      return Response.json({ data: { order: query === PILOT_FINANCIAL_QUERY ? s.financial : s.commerce.order } },
        { headers: { "X-Shopify-API-Version": "2026-07" } });
    } });
  expect(result).toEqual({ state: "done" }); return queries;
}
it("runs the unchanged actual reader/retention/047 path through046 and new RPC/route, leaving financial050 unchanged", async () => {
  const db = await database();
  try {
    const queries = await run(db, "1"); expect(queries).not.toContain(SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY);
    expect(queries).toHaveLength(4);
    const financial = await read(db, false);
    const oldFunction = (await db.query("select pg_get_functiondef('public.lean_production_reports_read()'::regprocedure) d")).rows;
    const tables = (await db.query("select tablename from pg_tables where schemaname='lean_private' order by 1")).rows;
    await db.exec(sql("051_order_size_report_delivery"));
    expect(await read(db)).toBeNull(); expect(await read(db, false)).toEqual(financial);
    expect((await db.query("select tablename from pg_tables where schemaname='lean_private' order by 1")).rows).toEqual(tables);
    await db.exec(sql("046_order_item_sizes")); await policy(db, sized);
    const absent = await read(db) as { order_size_daily: Record<string, unknown>[] };
    expect(absent.order_size_daily[0]).toMatchObject({ size_status: "not_collected", quantity: "2.000000" });
    expect(await run(db, "2")).toContain(SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY);
    const known = await read(db) as { order_size_daily: Record<string, unknown>[] };
    expect(validOrderSizeReportPayload(known)).toBe(true);
    expect(known.order_size_daily.some(r => r.size_status === "known" && r.size_value === "M" &&
      r.quantity === "2.000000" && r.unit_basis === "requested_box_units")).toBe(true);
    await run(db, "3", ["M", "L"]);
    await run(db, "2", [], "2026-09-30T21:00:00Z");
    const data = await read(db) as { order_size_daily: Record<string, unknown>[] };
    expect(validOrderSizeReportPayload(data)).toBe(true);
    expect(data.order_size_daily.map(r => r.size_status).sort()).toEqual(["conflict", "missing", "not_collected"]);
    expect(data.order_size_daily.every(r => r.size_value === null && r.quantity === "2.000000")).toBe(true);
    expect(data.order_size_daily.filter(r => r.size_status !== "not_collected").every(r =>
      r.size_semantics === "requested_box_top_size" && r.unit_basis === "requested_box_units" && r.fulfillment_proven === false)).toBe(true);
    expect(JSON.stringify((await db.query("select source from lean_private.pipeline_snapshots")).rows)).not.toContain("PRIVATE");
    expect(JSON.stringify(data)).not.toMatch(/publication_id|order_id|customer|policy_ref|evidence_ref|gid:|PRIVATE/);
    // An unselected candidate cannot alter either aggregate feed.
    const moneyBefore = await read(db, false);
    await db.query("insert into lean_private.publications(publication_id,contract_version) values('synthetic:old-unselected','fixture')");
    for (const table of ["orders", "order_items", "order_item_sizes"]) {
      await db.query(`insert into lean_private.${table}
        select (jsonb_populate_record(null::lean_private.${table},
          to_jsonb(x)||'{"publication_id":"synthetic:old-unselected"}'::jsonb)).*
        from lean_private.${table} x where x.publication_id=(select publication_id
          from lean_private.order_item_sizes where size_value='M' limit 1)`);
    }
    expect(await read(db)).toEqual(data); expect(await read(db, false)).toEqual(moneyBefore);
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe(`https://${project}.supabase.co/rest/v1/rpc/lean_order_size_reports_read`);
      expect(init).toMatchObject({ method: "POST", redirect: "error", body: "{}" }); return Response.json(await read(db));
    });
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", transport);
    const response = await GET(request()); expect(response.status).toBe(200); expect(await response.json()).toEqual(data);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(transport).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", network);
    await db.exec("begin read only"); expect(await read(db)).toEqual(data); await db.exec("commit");
    expect(await read(db, false)).toEqual(moneyBefore);
    for (const mutate of [
      "update lean_private.order_item_sizes set policy_ref='wrong'",
      "update lean_private.orders set purchase_date=null",
      "update lean_private.pipeline_heads set revision=revision+interval '1 second'",
    ]) {
      await db.exec("begin"); await db.exec(mutate); expect(await read(db)).toBeNull(); await db.exec("rollback");
    }
    const off = { ...env, LEAN_ORDER_SIZE_REPORTS_ENABLED: "false" };
    expect((await orderSizeReportGet(request(), off, transport)).status).toBe(404);
    expect((await productionReportGet(request("/api/analytics/reports/production"), off, async () => Response.json(await read(db, false)))).status).toBe(200);
    await policy(db, base); expect(await read(db)).toBeNull(); expect(await read(db, false)).toEqual(moneyBefore);
    expect((await db.query("select pg_get_functiondef('public.lean_production_reports_read()'::regprocedure) d")).rows).toEqual(oldFunction);
  } finally { await db.close(); }
}, 30000);
it("installs a single STABLE narrow RPC, distinguishes no heads, pins reused SQL and aborts unknown ACL inheritance", async () => {
  const db = await database();
  try {
    const migration = sql("051_order_size_report_delivery");
    expect(migration.split("$order_size$")[1].trim()).toBe(OWNER_ORDER_SIZE_REPORT_SQL.trim());
    await db.exec(migration); await db.exec(sql("046_order_item_sizes")); await policy(db, sized);
    expect(await read(db)).toEqual({ coverage_status: "no_selected_orders", order_size_daily: [] });
    expect((await db.query(`select provolatile,prosecdef from pg_proc where oid='public.lean_order_size_reports_read()'::regprocedure`)).rows)
      .toEqual([{ provolatile: "s", prosecdef: true }]);
    for (const role of ["anon", "authenticated", "lean_posthog_reader", "service_role"]) {
      expect((await db.query(`select has_function_privilege($1,'public.lean_order_size_reports_read()','EXECUTE') rpc,
        has_table_privilege($1,'lean_private.order_item_sizes','SELECT') private`, [role])).rows)
        .toEqual([{ rpc: role === "service_role", private: false }]);
    }
    await db.exec(`drop function public.lean_order_size_reports_read();create role unexpected_size_reader;
      alter default privileges in schema public grant execute on functions to unexpected_size_reader;`);
    await expect(db.exec(migration)).rejects.toThrow("unexpected size function grantee"); await db.exec("rollback");
    expect((await db.query("select to_regprocedure('public.lean_order_size_reports_read()') r")).rows).toEqual([{ r: null }]);
    expect(await read(db, false)).toEqual({ store_daily: [], product_daily: [] });
  } finally { await db.close(); }
}, 30000);
