import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/analytics/ingest/scheduled/route";
import { runScheduledFinancialCheckpoint } from "@/lib/analytics/scheduledFinancialCheckpoint";
import { HISTORY_ACCESS_QUERY, HISTORY_ORDERS_QUERY } from "@/lib/analytics/shopifyHistory";
import { SHOPIFY_FINANCIAL_ORDER_QUERY } from "@/lib/analytics/shopifySource";
import { PILOT_FINANCIAL_QUERY } from "@/lib/analytics/shopifyPilotSource";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";

const project = "xnfjdbpjuaezxjgargto", shop = "mullybox-store.myshopify.com";
const port = vi.hoisted(() => ({ client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => port.client }));
let db: PGlite, from: string, until: string, created: string, updated: string;
let legacyOid: number, legacyBody: string;
const orderId = "gid://shopify/Order/100";
const inventory = () => [{ id: orderId, createdAt: created, updatedAt: updated }];
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
const connection = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
function order() {
  return { id: orderId, createdAt: created, updatedAt: updated, currencyCode: "USD",
    edited: false, taxesIncluded: false, test: false, cancelledAt: null,
    originalTotalPriceSet: money("250"), subtotalPriceSet: money("250"),
    transactionsCount: { count: 1, precision: "EXACT" }, transactions: [{
      id: "gid://shopify/OrderTransaction/101", kind: "SALE", status: "SUCCESS",
      gateway: "fixture", test: false, createdAt: created, processedAt: updated,
      amountSet: money("250"), parentTransaction: null,
    }],
    lineItems: connection([{ id: "gid://shopify/LineItem/102", sku: "fixture", quantity: 1,
      isGiftCard: false, product: { id: "gid://shopify/Product/103" },
      originalUnitPriceSet: money("250"), originalTotalSet: money("250"), discountAllocations: [] }]),
  };
}
const financial = () => ({ id: orderId, updatedAt: updated, currencyCode: "USD",
  originalTotalPriceSet: money("250"), totalTaxSet: money("0"), originalTotalDutiesSet: null,
  originalTotalAdditionalFeesSet: null, totalTipReceivedSet: money("0"), shippingLines: connection([]), refunds: [] });
const native = (changeInventory = false, headers = true) => vi.fn<typeof fetch>(async (_url, init) => {
  const { query } = JSON.parse(String(init?.body));
  let data;
  if (query === HISTORY_ACCESS_QUERY) data = { currentAppInstallation: { accessScopes: [{ handle: "read_orders" }] } };
  else if (query === HISTORY_ORDERS_QUERY) data = { orders: connection(changeInventory ? [] : inventory()) };
  else if (query === SHOPIFY_FINANCIAL_ORDER_QUERY) data = { order: order() };
  else if (query === PILOT_FINANCIAL_QUERY) data = { order: financial() };
  else throw new Error("unexpected source query");
  return Response.json({ data }, { headers: headers ? { "X-Shopify-API-Version": "2026-07" } : {} });
});
const client: AnalyticsRpcClient = { async rpc(name, args) {
  if (!["lean_financial_checkpoint_claim", "lean_financial_checkpoint_commit", "lean_history_read"].includes(name))
    throw new Error("unexpected RPC");
  const pairs = Object.entries(args);
  try {
    const result = await db.query<{ value: unknown }>(
      `select public.${name}(${pairs.map(([key], i) => `${key}=>$${i + 1}${key === "p_rows" ? "::jsonb" : ""}`).join(",")}) value`,
      pairs.map(([key, value]) => key === "p_rows" ? JSON.stringify(value) : value));
    return { data: result.rows[0].value, error: null };
  } catch (error) { return { data: null, error }; }
} };
const options = (fetcher: typeof fetch = native()) => ({ client, projectRef: project,
  databaseUrl: `https://${project}.supabase.co`, shop, accessToken: "fixture-not-a-token",
  signal: new AbortController().signal, now: new Date().toISOString(), fetcher });
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema lean_private; create role anon; create role authenticated;
    create role service_role; create role lean_posthog_reader;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role,lean_posthog_reader;`);
  for (const file of ["018_history_jobs", "027_history_update_scans"])
    await db.exec(readFileSync(`sql/analytics/${file}.sql`, "utf8"));
  const original = await db.query<{ oid: number; prosrc: string }>(`select oid,prosrc from pg_proc
    where oid='public.lean_history_commit(text,text,text,integer,text,text,boolean,jsonb)'::regprocedure`);
  legacyOid = original.rows[0].oid; legacyBody = original.rows[0].prosrc;
  await db.exec(readFileSync("sql/analytics/054_scheduled_financial_checkpoint.sql", "utf8"));
  const result = await db.query<{ from_time: string; until_time: string }>(`select
    to_char(((current_timestamp at time zone 'America/New_York')::date-1)::timestamp at time zone 'America/New_York'
      at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from_time,
    to_char(((current_timestamp at time zone 'America/New_York')::date)::timestamp at time zone 'America/New_York'
      at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') until_time`);
  from = result.rows[0].from_time; until = result.rows[0].until_time;
  created = new Date(Date.parse(from) + 3600000).toISOString();
  updated = new Date(Date.parse(created) + 5000).toISOString();
}, 30000);
beforeEach(async () => {
  port.client = client;
  await db.exec("truncate lean_private.history_jobs cascade");
  await db.query(`insert into lean_private.history_jobs
    (run_id,project_ref,shop,from_time,until_time,page_size,max_pages,approval_ref,actor_ref,enabled)
    values('fixture',$1,$2,$3,$4,5,1,'fixture:approval','fixture:parent',true)`, [project, shop, from, until]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { await db?.close(); });
async function register() {
  await db.query(`insert into lean_private.financial_checkpoints
    (run_id,project_ref,shop,inventory,inventory_ref,approval_ref,actor_ref,expires_at,enabled)
    values('fixture',$1,$2,$3::jsonb,'fixture:independent-inventory','fixture:approval','fixture:parent',
      clock_timestamp()+interval '1 hour',true)`, [project, shop, JSON.stringify(inventory())]);
}
it("makes no source requests with the default-empty selector", async () => {
  const fetcher = native();
  expect(await runScheduledFinancialCheckpoint(options(fetcher))).toEqual({ state: "disabled", calls: 0 });
  expect(fetcher).not.toHaveBeenCalled();
});
it("uses real bounded history/readers and SQL to commit one financial-only page once", async () => {
  await register();
  const fetcher = native();
  expect(await runScheduledFinancialCheckpoint(options(fetcher))).toEqual({ state: "complete", calls: 6 });
  expect(fetcher).toHaveBeenCalledTimes(6);
  expect(await runScheduledFinancialCheckpoint(options(fetcher))).toEqual({ state: "complete", calls: 0 });
  expect(fetcher).toHaveBeenCalledTimes(6);
  const saved = await db.query<{ rows: unknown; complete: boolean; row_count: number }>(
    "select p.rows,h.complete,h.row_count from lean_private.history_pages p join lean_private.history_jobs h using(run_id)");
  expect(saved.rows[0]).toMatchObject({ complete: true, row_count: 1,
    rows: [{ source: { commerce: { apiVersion: "2026-07", projection: "financial_no_geo" } } }] });
  expect(JSON.stringify(saved.rows)).not.toMatch(/cartToken|customer|shippingAddress|customAttributes|fixture-not-a-token/);
});
it("rejects changed native inventory before hydrating an order and holds the attempt", async () => {
  await register();
  const fetcher = native(true);
  await expect(runScheduledFinancialCheckpoint(options(fetcher))).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await runScheduledFinancialCheckpoint(options(fetcher))).toEqual({ state: "held", calls: 0 });
  expect((await db.query("select * from lean_private.history_pages")).rows).toHaveLength(0);
});
it("does not turn headerless connector data into an accepted native source", async () => {
  await register();
  const fetcher = native(false, false);
  await expect(runScheduledFinancialCheckpoint(options(fetcher))).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await db.query("select * from lean_private.history_pages")).rows).toHaveLength(0);
});
it("holds a lost commit response without replaying a successful write", async () => {
  await register();
  const lost: AnalyticsRpcClient = { async rpc(name, args) {
    const response = await client.rpc(name, args);
    if (name === "lean_financial_checkpoint_commit") throw new Error("lost response");
    return response;
  } };
  await expect(runScheduledFinancialCheckpoint({ ...options(), client: lost })).rejects.toThrow();
  expect(await runScheduledFinancialCheckpoint(options())).toEqual({ state: "complete", calls: 0 });
  expect((await db.query("select * from lean_private.history_pages")).rows).toHaveLength(1);
});
it("rechecks disablement at commit and retains no source", async () => {
  await register();
  const paused: AnalyticsRpcClient = { async rpc(name, args) {
    if (name === "lean_financial_checkpoint_commit")
      await db.exec("update lean_private.financial_checkpoints set enabled=false");
    return client.rpc(name, args);
  } };
  await expect(runScheduledFinancialCheckpoint({ ...options(), client: paused })).rejects.toThrow("checkpoint_conflict");
  expect((await db.query("select * from lean_private.history_pages")).rows).toHaveLength(0);
});
it("refuses extended history budgets and never hydrates a source", async () => {
  await db.exec("truncate lean_private.history_jobs cascade");
  await db.query(`insert into lean_private.history_jobs
    (run_id,project_ref,shop,from_time,until_time,page_size,max_pages,approval_ref,actor_ref,enabled)
    values('fixture',$1,$2,$3,$4,5,2,'fixture:approval','fixture:parent',true)`, [project, shop, from, until]);
  await register();
  const fetcher = native();
  await expect(runScheduledFinancialCheckpoint(options(fetcher))).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it("denies checkpoint source access/activation to public and destination roles", async () => {
  for (const role of ["anon", "authenticated", "lean_posthog_reader"]) {
    const result = await db.query<{ claim: boolean; commit: boolean; table_read: boolean }>(`select
      has_function_privilege($1,'public.lean_financial_checkpoint_claim(text,text,uuid)','EXECUTE') claim,
      has_function_privilege($1,'public.lean_financial_checkpoint_commit(text,text,text,uuid,jsonb)','EXECUTE') commit,
      has_table_privilege($1,'lean_private.financial_checkpoints','SELECT') table_read`, [role]);
    expect(result.rows[0]).toEqual({ claim: false, commit: false, table_read: false });
  }
});
it("keeps source and inventory immutable after any attempt", async () => {
  await register();
  await runScheduledFinancialCheckpoint(options());
  await expect(db.exec("update lean_private.financial_checkpoints set attempted_at=null,lease_token=null")).rejects.toThrow("immutable");
  await expect(db.exec("update lean_private.financial_checkpoints set inventory='[]'")).rejects.toThrow();
});
it("requires READ COMMITTED before a claim or commit can inspect authority", async () => {
  await register();
  await db.exec("begin isolation level repeatable read");
  const claimed = await client.rpc("lean_financial_checkpoint_claim", {
    p_project_ref: project, p_shop: shop, p_token: "00000000-0000-4000-8000-000000000001",
  });
  expect(String(claimed.error)).toContain("requires read committed");
  await db.exec("rollback");
  await db.exec("begin isolation level repeatable read");
  const committed = await client.rpc("lean_financial_checkpoint_commit", {
    p_run: "fixture", p_project_ref: project, p_shop: shop,
    p_token: "00000000-0000-4000-8000-000000000001", p_rows: [],
  });
  expect(String(committed.error)).toContain("requires read committed");
  await db.exec("rollback");
});
it("stops if the source changes after the exact native metadata inventory", async () => {
  await register();
  const good = native();
  const changed: typeof fetch = async (url, init) => {
    if (JSON.parse(String(init?.body)).query === SHOPIFY_FINANCIAL_ORDER_QUERY)
      return Response.json({ data: { order: { ...order(), updatedAt: new Date(Date.parse(updated) + 1000).toISOString() } } },
        { headers: { "X-Shopify-API-Version": "2026-07" } });
    return good(url, init);
  };
  await expect(runScheduledFinancialCheckpoint(options(changed))).rejects.toThrow();
  expect((await db.query("select * from lean_private.history_pages")).rows).toHaveLength(0);
});
function timerConfig() {
  Object.assign(process.env, {
    VERCEL_ENV: "production", LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED: "true",
    LEAN_ANALYTICS_PIPELINE_ENABLED: "true", LEAN_ANALYTICS_DISPATCH_ENABLED: "true",
    LEAN_ANALYTICS_SCHEDULE_MODE: "continuous", LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project,
    LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`, LEAN_SHOPIFY_SHOP_DOMAIN: shop,
    LEAN_SHOPIFY_ANALYTICS_READ_TOKEN: "fixture-not-a-token",
    LEAN_ANALYTICS_PIPELINE_SECRET: "fixture-pipeline-secret-not-real-123456789",
    CRON_SECRET: "fixture-cron-secret-not-real-123456789",
  });
}
const timerRequest = () => new NextRequest("https://www.mymully.com/api/analytics/ingest/scheduled", {
  headers: { authorization: "Bearer fixture-cron-secret-not-real-123456789" },
});
const health = { enabled: true, pending: 0, leased: 0, dead: 0, done: 0,
  expiredLeases: 0, oldestPendingSeconds: 0 };
it("runs the new bound source through the actual authenticated idle timer without changing commerce success", async () => {
  await register(); timerConfig();
  const shopify = native();
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) =>
    String(url).endsWith("/ingest/process") ? Response.json(health) : shopify(url, init)));
  vi.spyOn(console, "info").mockImplementation(() => {});
  const response = await GET(timerRequest()), text = await response.text();
  expect(response.status).toBe(200);
  expect(JSON.parse(text)).toMatchObject({ state: "idle", calls: 1,
    financialCheckpoint: { state: "complete", calls: 6 } });
  expect(text).not.toMatch(/gid:|250|fixture|2026-07/);
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/gid:|250|fixture|2026-07/);
});
it("does not add a 65-second source lane when the commerce supervisor consumed the shared deadline", async () => {
  await register(); timerConfig();
  let clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const fetcher = vi.fn<typeof fetch>(async () => { clock += 120000; return Response.json(health); });
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(console, "info").mockImplementation(() => {});
  const response = await GET(timerRequest());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ state: "idle", financialCheckpoint: { state: "deadline", calls: 0 } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await db.query<{ attempted_at: string | null }>("select attempted_at from lean_private.financial_checkpoints")).rows[0].attempted_at).toBeNull();
});
it("rolls back installation if a destination role inherits execution through another role", async () => {
  const unsafe = new PGlite();
  try {
    await unsafe.exec(`create schema lean_private; create role anon; create role authenticated;
      create role service_role; create role lean_posthog_reader; grant service_role to lean_posthog_reader;`);
    for (const file of ["018_history_jobs", "027_history_update_scans"])
      await unsafe.exec(readFileSync(`sql/analytics/${file}.sql`, "utf8"));
    await expect(unsafe.exec(readFileSync("sql/analytics/054_scheduled_financial_checkpoint.sql", "utf8")))
      .rejects.toThrow("inherited execution denied");
    await unsafe.exec("rollback");
    expect((await unsafe.query<{ table_name: unknown }>("select to_regclass('lean_private.financial_checkpoints') table_name"))
      .rows[0].table_name).toBeNull();
  } finally { await unsafe.close(); }
}, 30000);
const retainedRow = () => ({ source: {
  commerce: { shop, apiVersion: "2026-07", projection: "financial_no_geo", order: order() },
  financial: financial(), refunds: [],
} });
async function legacyRuntimeCommit() {
  await db.exec("set role service_role");
  try {
    return await db.query<{ committed: boolean }>(`select public.lean_history_commit(
      'fixture',$1,$2,0,null,null,true,$3::jsonb) committed`,
    [project, shop, JSON.stringify([retainedRow()])]);
  } finally { await db.exec("reset role"); }
}
it.each(["disabled", "expired", "unclaimed", "held"])(
  "blocks direct legacy runtime commit for a bound %s checkpoint", async state => {
    if (state === "expired") {
      await db.query(`insert into lean_private.financial_checkpoints
        (run_id,project_ref,shop,inventory,inventory_ref,approval_ref,actor_ref,created_at,expires_at,enabled)
        values('fixture',$1,$2,$3::jsonb,'fixture:inventory','fixture:approval','fixture:parent',
          clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',true)`,
      [project, shop, JSON.stringify(inventory())]);
    } else await register();
    if (state === "disabled") await db.exec("update lean_private.financial_checkpoints set enabled=false");
    if (state === "held") await client.rpc("lean_financial_checkpoint_claim", {
      p_project_ref: project, p_shop: shop, p_token: "00000000-0000-4000-8000-000000000001",
    });
    await expect(legacyRuntimeCommit()).rejects.toThrow("bound history requires financial checkpoint commit");
    expect((await db.query("select * from lean_private.history_pages")).rows).toHaveLength(0);
    expect((await db.query<{ complete: boolean }>("select complete from lean_private.history_jobs")).rows[0].complete).toBe(false);
  },
);
it("preserves the original runtime commit for unbound legacy history jobs", async () => {
  expect((await legacyRuntimeCommit()).rows[0].committed).toBe(true);
  expect((await db.query("select * from lean_private.history_pages")).rows).toHaveLength(1);
});
it("denies runtime and destination execution of the owner-only original helper", async () => {
  for (const role of ["service_role", "anon", "authenticated", "lean_posthog_reader"]) {
    expect((await db.query<{ allowed: boolean }>(`select has_function_privilege($1,
      'lean_private.history_commit_checkpoint_027(text,text,text,integer,text,text,boolean,jsonb)',
      'EXECUTE') allowed`, [role])).rows[0].allowed).toBe(false);
  }
  await db.exec("set role service_role");
  try {
    await expect(db.query(`select lean_private.history_commit_checkpoint_027(
      'fixture',$1,$2,0,null,null,true,$3::jsonb)`, [project, shop, JSON.stringify([retainedRow()])]))
      .rejects.toThrow("permission denied");
  } finally { await db.exec("reset role"); }
});
it("preserves the public legacy OID and the exact reviewed implementation body in its private helper", async () => {
  const current = await db.query<{ oid: number; prosrc: string }>(`select
    'public.lean_history_commit(text,text,text,integer,text,text,boolean,jsonb)'::regprocedure::oid oid,
    (select prosrc from pg_proc where oid=
      'lean_private.history_commit_checkpoint_027(text,text,text,integer,text,text,boolean,jsonb)'::regprocedure) prosrc`);
  expect(current.rows[0]).toEqual({ oid: legacyOid, prosrc: legacyBody });
});
it("rejects a stale-snapshot legacy commit before checking a checkpoint binding", async () => {
  await db.exec("begin isolation level repeatable read");
  await expect(db.query(`select public.lean_history_commit('fixture',$1,$2,0,null,null,true,$3::jsonb)`,
    [project, shop, JSON.stringify([retainedRow()])])).rejects.toThrow("requires read committed");
  await db.exec("rollback");
  expect((await db.query("select * from lean_private.history_pages")).rows).toHaveLength(0);
});
it("does not delegate when no history row was locked, closing a later-registration race", async () => {
  await db.exec("begin");
  await db.exec(`create or replace function lean_private.history_commit_checkpoint_027(
    p_run text,p_project_ref text,p_shop text,p_expected_page integer,p_expected_cursor text,
    p_next_cursor text,p_complete boolean,p_rows jsonb) returns boolean
    language plpgsql security definer set search_path=pg_catalog as $$
    begin raise exception 'delegate called without a locked history target'; end $$`);
  await expect(db.query(`select public.lean_history_commit('missing',$1,$2,0,null,null,true,$3::jsonb)`,
    [project, shop, JSON.stringify([retainedRow()])])).rejects.toThrow("unapproved history target");
  await db.exec("rollback");
});
