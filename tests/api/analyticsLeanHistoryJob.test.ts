import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { runHistoryJob } from "@/lib/analytics/historyJob";
import { runShopifyHistory } from "@/lib/analytics/shopifyHistory";
import { POST } from "@/app/api/analytics/ingest/history/route";
import { nyDate } from "@/lib/analytics/primitives";

vi.mock("@/lib/analytics/shopifyHistory", () => ({ runShopifyHistory: vi.fn() }));
const port = vi.hoisted(() => ({ client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => port.client }));
const shop = "fixture.myshopify.com", project = "a".repeat(20);
let db: PGlite;
const args = { p_run: "fixture", p_project_ref: project, p_shop: shop };
const client: AnalyticsRpcClient = { async rpc(name, input) {
  if (!["lean_history_read", "lean_history_commit", "lean_history_page"].includes(name)) throw new Error("unknown_rpc");
  const pairs = Object.entries(input);
  try {
    const result = await db.query<{ result: unknown }>(
      `select public.${name}(${pairs.map(([k], i) => `${k}=>$${i + 1}${k === "p_rows" ? "::jsonb" : ""}`).join(",")}) result`,
      pairs.map(([k, v]) => k === "p_rows" ? JSON.stringify(v) : v));
    return { data: result.rows[0].result, error: null };
  } catch (error) { return { data: null, error }; }
} };
// Metadata-only source fixture for the mocked reader and registry tests.
const row = (id = "1") => ({ source: { commerce: { shop, apiVersion: "2026-07" as const, order: {
  id: `gid://shopify/Order/${id}`, createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-02T12:00:00Z",
} }, financial: {}, refunds: [] } });
const commit = (overrides: Record<string, unknown> = {}) => client.rpc("lean_history_commit", {
  ...args, p_expected_page: 0, p_expected_cursor: null, p_next_cursor: "next", p_complete: false,
  p_rows: [row()], ...overrides,
});
const options = () => ({ client, projectRef: project, databaseUrl: `https://${project}.supabase.co`,
  shop, runId: "fixture", accessToken: "fixture-not-real", now: "2026-09-23T00:00:00Z", signal: AbortSignal.timeout(20000) });
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role service_role; create role anon; create role authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const name of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs", "019_spend_jobs",
    "020_observed_report_jobs", "021_full_report_jobs", "022_full_release", "023_posthog_export",
    "024_full_orchestration", "025_refresh_queue", "027_history_update_scans"])
    await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
}, 30000);
beforeEach(async () => {
  vi.mocked(runShopifyHistory).mockReset(); port.client = client;
  vi.stubGlobal("fetch", () => { throw new Error("external_network_forbidden"); });
  await db.exec("truncate lean_private.history_jobs cascade");
  await db.query(`insert into lean_private.history_jobs
    (run_id,project_ref,shop,from_time,until_time,page_size,max_pages,approval_ref,actor_ref,enabled)
    values('fixture',$1,$2,'2026-01-01T00:00:00Z','2026-02-01T00:00:00Z',2,2,
      'fixture:approval','fixture:operator',true)`, [project, shop]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => { await db?.close(); });
it("returns UTC scope accepted by the source reader, not database offset strings", async () => {
  const result = await client.rpc("lean_history_read", args);
  expect(result.error).toBeNull();
  expect(nyDate((result.data as { fromTime: string }).fromTime)).toBe("2025-12-31");
});
it("persists update-time scope and accepts an older order only when its update is inside that scope", async () => {
  await db.exec("truncate lean_private.history_jobs cascade");
  await db.query(`insert into lean_private.history_jobs
    (run_id,project_ref,shop,from_time,until_time,page_size,max_pages,approval_ref,actor_ref,enabled,scan_basis)
    values('fixture',$1,$2,'2026-01-02T00:00:00Z','2026-01-03T00:00:00Z',2,2,
      'fixture','fixture',true,'updated_at')`, [project, shop]);
  expect((await client.rpc("lean_history_read", args)).data).toMatchObject({ scanBasis: "updated_at" });
  const old = row(); old.source.commerce.order.createdAt = "2025-01-01T00:00:00Z";
  expect((await commit({ p_rows: [old] })).data).toBe(true);
  await expect(db.exec("update lean_private.history_jobs set scan_basis='created_at'")).rejects.toThrow("immutable");
  const wrong = row("2"); wrong.source.commerce.order.updatedAt = "2026-01-03T00:00:00Z";
  expect((await commit({ p_rows: [wrong], p_expected_page: 1, p_expected_cursor: "next",
    p_next_cursor: null, p_complete: true })).error).toBeTruthy();
  expect((await client.rpc("lean_history_read", args)).data).toMatchObject({ pageCount: 1, cursor: "next" });
});
it("rejects backwards update-time pages without advancing the checkpoint", async () => {
  await db.exec("truncate lean_private.history_jobs cascade");
  await db.query(`insert into lean_private.history_jobs
    (run_id,project_ref,shop,from_time,until_time,page_size,max_pages,approval_ref,actor_ref,enabled,scan_basis)
    values('fixture',$1,$2,'2026-01-01T00:00:00Z','2026-02-01T00:00:00Z',2,2,
      'fixture','fixture',true,'updated_at')`, [project, shop]);
  expect((await commit()).data).toBe(true);
  const earlier = row("2"); earlier.source.commerce.order.updatedAt = "2026-01-02T00:00:00Z";
  expect((await commit({ p_rows: [earlier], p_expected_page: 1, p_expected_cursor: "next",
    p_next_cursor: null, p_complete: true })).error).toBeTruthy();
  expect((await client.rpc("lean_history_read", args)).data).toMatchObject({ rowCount: 1, state: "ready" });
});
it("atomically stores rows with a cursor and rejects duplicate commits", async () => {
  expect((await commit()).data).toBe(true);
  expect((await commit()).data).toBe(false);
  const state = (await client.rpc("lean_history_read", args)).data;
  expect(state).toMatchObject({ pageCount: 1, rowCount: 1, cursor: "next", state: "ready" });
});
it("rolls back the entire page for a bad source", async () => {
  const invalid = row("2"); invalid.source.commerce.shop = "wrong.myshopify.com";
  expect((await commit({ p_rows: [row(), invalid] })).error).toBeTruthy();
  expect((await client.rpc("lean_history_read", args)).data).toMatchObject({ pageCount: 0, rowCount: 0 });
});
it("rejects cross-page duplicate orders and cursor loops", async () => {
  await commit();
  expect((await commit({ p_expected_page: 1, p_expected_cursor: "next", p_next_cursor: null, p_complete: true })).error).toBeTruthy();
  expect((await commit({ p_expected_page: 1, p_expected_cursor: "next", p_rows: [row("2")] })).error).toBeTruthy();
});
it("enforces page budget and refuses incomplete downstream reads", async () => {
  await commit();
  expect((await commit({ p_expected_page: 1, p_expected_cursor: "next", p_next_cursor: "last", p_rows: [row("2")] })).data).toBe(true);
  expect((await client.rpc("lean_history_read", args)).data).toMatchObject({ state: "budget_exhausted" });
  expect((await client.rpc("lean_history_page", { ...args, p_page: 1 })).error).toBeTruthy();
  expect((await commit({ p_expected_page: 2, p_expected_cursor: "last" })).data).toBe(false);
});
it("only reads complete retained pages within the approved target", async () => {
  expect((await commit({ p_complete: true, p_next_cursor: null })).data).toBe(true);
  expect((await client.rpc("lean_history_page", { ...args, p_page: 1 })).data).toEqual([row()]);
  expect((await client.rpc("lean_history_page", { ...args, p_page: 2 })).error).toBeTruthy();
  expect((await client.rpc("lean_history_read", { ...args, p_project_ref: "b".repeat(20) })).error).toBeTruthy();
});
it("requires new registration for scope changes and permits stopping a job", async () => {
  await expect(db.exec("update lean_private.history_jobs set page_size=5")).rejects.toThrow("immutable");
  await db.exec("update lean_private.history_jobs set enabled=false");
  expect((await commit()).data).toBe(false);
  expect(await runHistoryJob(options())).toEqual({ state: "disabled" });
  expect(runShopifyHistory).not.toHaveBeenCalled();
});
it("removes hosted default grants and denies direct runtime table access", async () => {
  const grants = await db.query<{ role: string; read: boolean; table_write: boolean }>(`select r as role,
    has_function_privilege(r,'public.lean_history_read(text,text,text)','execute') as read,
    has_table_privilege(r,'lean_private.history_jobs','insert') as table_write
    from unnest(array['anon','authenticated','service_role']) r`);
  expect(grants.rows).toEqual([{ role: "anon", read: false, table_write: false },
    { role: "authenticated", read: false, table_write: false }, { role: "service_role", read: true, table_write: false }]);
});
it("dispatches one page from saved state and commits through the atomic RPC", async () => {
  vi.mocked(runShopifyHistory).mockImplementation(async input => {
    expect(input).toMatchObject({ maxPages: 1, pageSize: 2, approvalRef: "fixture:approval", cursor: null });
    expect(await input.store.commitPage(null, { rows: [], nextCursor: null, complete: true })).toBe(true);
    return { cursor: null, written: 0, complete: true };
  });
  expect(await runHistoryJob(options())).toEqual({ state: "complete", written: 0 });
  expect(await runHistoryJob(options())).toEqual({ state: "complete" });
  expect(runShopifyHistory).toHaveBeenCalledTimes(1);
});
it("forwards a fixed private projection through both durable page invocations", async () => {
  const config = Object.freeze({ ...options(), projection: "financial_no_geo" as const });
  vi.mocked(runShopifyHistory).mockImplementation(async input => {
    expect(input.projection).toBe("financial_no_geo");
    const first = input.cursor === null;
    const page = { rows: [row(first ? "1" : "2")], nextCursor: first ? "next" : null, complete: !first };
    expect(await input.store.commitPage(input.cursor, page)).toBe(true);
    return { cursor: page.nextCursor, written: 1, complete: page.complete };
  });
  expect(await runHistoryJob(config)).toEqual({ state: "partial", written: 1 });
  expect(await runHistoryJob(config)).toEqual({ state: "complete", written: 1 });
  expect(await runHistoryJob(config)).toEqual({ state: "complete" });
  expect(runShopifyHistory).toHaveBeenCalledTimes(2);
});
it("does not replay ambiguous storage failures", async () => {
  const rpc = vi.fn().mockRejectedValue(new Error("response lost"));
  await expect(runHistoryJob({ ...options(), client: { rpc } })).rejects.toThrow("storage_unavailable");
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("keeps routes disabled and rejects unauthorized or request-supplied scope", async () => {
  const request = (suffix = "", body?: string, secret = "x".repeat(32)) =>
    new NextRequest(`https://fixture.invalid/api/analytics/ingest/history${suffix}`, {
      method: "POST", headers: { authorization: `Bearer ${secret}` }, ...(body ? { body } : {}),
    });
  expect((await POST(request())).status).toBe(404);
  vi.stubEnv("LEAN_ANALYTICS_HISTORY_ENABLED", "true");
  vi.stubEnv("LEAN_ANALYTICS_HISTORY_SECRET", "x".repeat(32));
  expect((await POST(request("", undefined, "wrong"))).status).toBe(401);
  expect((await POST(request("?shop=other"))).status).toBe(400);
  expect((await POST(request("", "{}"))).status).toBe(400);
  expect(runShopifyHistory).not.toHaveBeenCalled();
});
