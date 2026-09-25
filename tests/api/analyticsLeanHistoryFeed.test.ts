import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { runHistoryFeed } from "@/lib/analytics/historyFeed";
import { runShopifyHistory } from "@/lib/analytics/shopifyHistory";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
vi.mock("@/lib/analytics/shopifyHistory", () => ({ runShopifyHistory: vi.fn() }));
const port = vi.hoisted(() => ({ client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => port.client }));
import { POST } from "@/app/api/analytics/ingest/history-feed/route";
const project = "a".repeat(20), shop = "fixture.myshopify.com";
let db: PGlite;
const client: AnalyticsRpcClient = { async rpc(name, args) {
  if (!["lean_history_feed_next", "lean_history_read", "lean_history_commit"].includes(name)) throw new Error("unexpected_rpc");
  const pairs = Object.entries(args);
  try {
    const r = await db.query<{ result: unknown }>(`select public.${name}(${
      pairs.map(([k], i) => `${k}=>$${i + 1}${k === "p_rows" ? "::jsonb" : ""}`).join(",")}) result`,
    pairs.map(([k, v]) => k === "p_rows" ? JSON.stringify(v) : v));
    return { data: r.rows[0].result, error: null };
  } catch (error) { return { data: null, error }; }
} };
const next = () => client.rpc("lean_history_feed_next", { p_feed: "fixture", p_project_ref: project, p_shop: shop });
const options = () => ({ client, projectRef: project, databaseUrl: `https://${project}.supabase.co`,
  shop, feedId: "fixture", accessToken: "fixture", now: new Date().toISOString(), signal: AbortSignal.timeout(10000) });
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role service_role; create role anon; create role authenticated");
  for (const name of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs",
    "019_spend_jobs", "020_observed_report_jobs", "021_full_report_jobs", "022_full_release",
    "023_posthog_export", "024_full_orchestration", "025_refresh_queue", "027_history_update_scans", "032_history_feeds"])
    await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
}, 30000);
beforeEach(async () => {
  vi.clearAllMocks(); port.client = client;
  await db.exec("truncate lean_private.history_jobs cascade");
  await db.query(`insert into lean_private.history_feeds
    (feed_id,project_ref,shop,scan_basis,start_time,stop_time,watermark,window_seconds,overlap_seconds,
    lag_seconds,page_size,max_pages,max_daily_steps,approval_ref,actor_ref)
    values('fixture',$1,$2,'updated_at','2026-01-01T00:00:00Z','2026-01-04T00:00:00Z',
      '2026-01-01T00:00:00Z',86400,3600,300,5,2,10,'fixture:approval','fixture:operator')`,
  [project, shop]);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => db?.close());
it("starts disabled and never allows runtime to alter the approved feed", async () => {
  expect(await runHistoryFeed(options())).toEqual({ state: "disabled" });
  expect(runShopifyHistory).not.toHaveBeenCalled();
  expect((await db.query("select * from lean_private.history_jobs")).rows).toHaveLength(0);
  expect((await db.query(`select
    has_table_privilege('service_role','lean_private.history_feeds','update') edit,
    has_function_privilege('anon','public.lean_history_feed_next(text,text,text)','execute') anon,
    has_function_privilege('service_role','public.lean_history_feed_next(text,text,text)','execute') run`)).rows)
    .toEqual([{ edit: false, anon: false, run: true }]);
});
it("resumes the same immutable window and advances only after complete storage", async () => {
  await db.exec("update lean_private.history_feeds set enabled=true");
  expect((await next()).data).toEqual({ state: "ready", runId: "feed:fixture:1" });
  expect((await next()).data).toEqual({ state: "ready", runId: "feed:fixture:1" });
  expect((await db.query(`select to_char(watermark at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS"Z"') watermark from lean_private.history_feeds`)).rows)
    .toEqual([{ watermark: "2026-01-01T00:00:00Z" }]);
  const committed = await client.rpc("lean_history_commit", {
    p_run: "feed:fixture:1", p_project_ref: project, p_shop: shop, p_expected_page: 0,
    p_expected_cursor: null, p_next_cursor: null, p_complete: true, p_rows: [],
  });
  expect(committed).toEqual({ data: true, error: null });
  expect((await next()).data).toEqual({ state: "ready", runId: "feed:fixture:2" });
  const windows = await db.query(`select run_id,
    to_char(from_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from_time,
    to_char(until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') until_time
    from lean_private.history_jobs order by run_id`);
  expect(windows.rows).toEqual([
    { run_id: "feed:fixture:1", from_time: "2026-01-01T00:00:00Z", until_time: "2026-01-02T00:00:00Z" },
    { run_id: "feed:fixture:2", from_time: "2026-01-01T23:00:00Z", until_time: "2026-01-03T00:00:00Z" },
  ]);
  expect((await db.query("select * from lean_private.history_feed_completions")).rows).toHaveLength(1);
});
it("never advances on exhausted pages and prevents runtime budget escalation", async () => {
  await db.exec("update lean_private.history_feeds set enabled=true");
  await next();
  await db.exec("update lean_private.history_jobs set page_count=max_pages");
  expect((await next()).data).toEqual({ state: "budget_exhausted" });
  expect((await db.query("select * from lean_private.history_feed_completions")).rows).toHaveLength(0);
  await expect(db.exec("update lean_private.history_feeds set max_pages=2000")).rejects.toThrow("immutable");
});
it("enforces daily invocation limits and isolates project/shop", async () => {
  await db.exec("update lean_private.history_feeds set enabled=true");
  for (let i = 0; i < 10; i++) expect((await next()).data).toMatchObject({ state: "ready" });
  expect((await next()).data).toEqual({ state: "daily_budget_exhausted" });
  expect((await client.rpc("lean_history_feed_next", { p_feed: "fixture", p_project_ref: "b".repeat(20), p_shop: shop })).error).toBeTruthy();
  await db.exec("update lean_private.history_feeds set counter_date=current_date-1");
  expect((await next()).data).toMatchObject({ state: "ready" });
});
it("disables an in-flight history job with its feed and does not silently re-enable it", async () => {
  await db.exec("update lean_private.history_feeds set enabled=true");
  await next();
  await db.exec("update lean_private.history_feeds set enabled=false");
  expect((await db.query("select enabled from lean_private.history_jobs")).rows).toEqual([{ enabled: false }]);
  expect((await next()).data).toEqual({ state: "disabled" });
  await db.exec("update lean_private.history_feeds set enabled=true");
  expect((await next()).data).toEqual({ state: "blocked" });
});
it("runs one real job checkpoint at a time and terminates the approved backfill", async () => {
  await db.exec("update lean_private.history_feeds set enabled=true");
  vi.mocked(runShopifyHistory).mockImplementation(async input => {
    expect(input.maxPages).toBe(1);
    expect(await input.store.commitPage(null, { rows: [], complete: true, nextCursor: null })).toBe(true);
    return { cursor: null, written: 0, complete: true };
  });
  for (let i = 0; i < 3; i++) expect(await runHistoryFeed(options())).toEqual({ state: "partial" });
  expect(await runHistoryFeed(options())).toEqual({ state: "complete" });
  expect(runShopifyHistory).toHaveBeenCalledTimes(3);
  expect((await db.query("select * from lean_private.history_feed_completions")).rows).toHaveLength(3);
});
it("does not automatically repeat an ambiguous request", async () => {
  const bad: AnalyticsRpcClient = { rpc: vi.fn(async () => { throw new Error("lost response"); }) };
  await expect(runHistoryFeed({ ...options(), client: bad })).rejects.toThrow();
  expect(bad.rpc).toHaveBeenCalledTimes(1);
});
it("route rejects caller scope and uses only the enabled server-side target", async () => {
  const req = (extra = "") => new NextRequest(`https://fixture.invalid/api/analytics/ingest/history-feed${extra}`,
    { method: "POST", headers: { authorization: `Bearer ${"s".repeat(32)}` } });
  expect((await POST(req())).status).toBe(404);
  vi.stubEnv("LEAN_ANALYTICS_HISTORY_FEED_ENABLED", "true");
  vi.stubEnv("LEAN_ANALYTICS_HISTORY_FEED_SECRET", "s".repeat(32));
  expect((await POST(req("?shop=attacker"))).status).toBe(400);
  expect((await POST(new NextRequest("https://fixture.invalid", { method: "POST" }))).status).toBe(401);
  vi.stubEnv("LEAN_ANALYTICS_PIPELINE_PROJECT_REF", project);
  vi.stubEnv("LEAN_ANALYTICS_SUPABASE_URL", `https://${project}.supabase.co`);
  vi.stubEnv("LEAN_SHOPIFY_SHOP_DOMAIN", shop);
  vi.stubEnv("LEAN_ANALYTICS_HISTORY_FEED_ID", "fixture");
  const response = await POST(req());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ state: "disabled" });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
