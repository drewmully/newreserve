/** Disposable SQL + actual caller, retained synthetic inputs only. No hosted/source calls. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mappingPolicy, PIPELINE_VERSION, runShopifyPipeline } from "@/lib/analytics/shopifyPipeline";
import { composeRetainedOrderReports } from "@/lib/analytics/shopifyRetainedOrder";
import { projectPilotRetention } from "@/lib/analytics/shopifyRetention";
import { sourceObject } from "@/lib/analytics/shopifySource";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { runtimePolicy, runtimeProject as project, runtimeShop as shop, runtimeSource } from "../fixtures/analyticsRetainedRuntime";

let db: PGlite, network: ReturnType<typeof vi.fn<typeof fetch>>, healthAcl: unknown;
const migration = "sql/analytics/052_pipeline_before_window_exclusion.sql";
const rpc = "lean_pipeline_exclude_before_window";
const jsonArgs = new Set(["p_payload", "p_facts", "p_reports", "p_product_reports", "p_order_item_sizes"]);
const rpcNames = new Set(["lean_accept_receipt", "lean_pipeline_claim", "lean_pipeline_retain", "lean_pipeline_finish",
  "lean_pipeline_finish_extended", "lean_pipeline_fail", "lean_pipeline_health", rpc]);
async function sqlRpc(name: string, args: Record<string, unknown>) {
  if (!rpcNames.has(name)) throw new Error("unexpected_rpc");
  const entries = Object.entries(args);
  const json = (key: string) => jsonArgs.has(key) || (name === "lean_pipeline_retain" && key === "p_source");
  return (await db.query<{ value: unknown }>(
    `select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}${json(key) ? "::jsonb" : ""}`).join(",")}) value`,
    entries.map(([key, value]) => json(key) && value !== null ? JSON.stringify(value) : value))).rows[0].value;
}
const client: AnalyticsRpcClient = { async rpc(name, args) {
  try { return { data: await sqlRpc(name, args), error: null }; }
  catch { return { data: null, error: "synthetic_sql_failure" }; }
} };
const rows = async (sql: string) => (await db.query(sql)).rows;
const run = (rpcClient = client) => runShopifyPipeline({ client: rpcClient, projectRef: project,
  databaseUrl: `https://${project}.supabase.co`, shop, accessToken: "fixture", fetcher: network });
const oldSource = () => {
  const source = runtimeSource();
  source.commerce.order.createdAt = "2025-12-31T23:59:59Z";
  return projectPilotRetention(source);
};
beforeEach(async () => {
  network = vi.fn<typeof fetch>(() => { throw new Error("no_source_or_hosted_io"); });
  vi.stubGlobal("fetch", network);
  db = new PGlite();
  await db.exec("create role service_role;create role anon;create role authenticated");
  for (const n of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views",
    "017_shopify_pipeline", "047_pipeline_extended"])
    await db.exec(readFileSync(`sql/analytics/${n}.sql`, "utf8"));
  healthAcl = await rows("select proacl::text from pg_proc where oid='public.lean_pipeline_health(text,text)'::regprocedure");
  await db.exec(`create role lean_posthog_reader;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role,lean_posthog_reader`);
  await db.exec(readFileSync(migration, "utf8"));
  await db.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-01-01T00:00:00Z','2026-02-01T00:00:00Z',$3::jsonb,'fixture:approved','fixture:actor')`,
  [shop, project, JSON.stringify(runtimePolicy)]);
}, 30000);
afterEach(async () => { await db?.close(); expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

async function retained(source = oldSource(), payload: Record<string, unknown> = { id: "1", updated_at: "2026-01-02T12:00:00Z" }, topic = "orders/updated") {
  await sqlRpc("lean_accept_receipt", { p_source: "shopify", p_delivery_id: "fixture",
    p_business_key: JSON.stringify([shop, String(payload.admin_graphql_api_id ?? payload.id)]),
    p_topic: topic, p_payload_hash: "a".repeat(64), p_payload: payload });
  const token = randomUUID();
  const claim = sourceObject(await sqlRpc("lean_pipeline_claim", { p_token: token, p_project_ref: project, p_shop: shop }));
  const args = { p_work_id: claim.workId, p_token: token };
  expect(await sqlRpc("lean_pipeline_retain", { ...args, p_source: source })).toBe(true);
  return { args, claim, source };
}
async function releaseForCaller() {
  await db.exec("update lean_private.work set state='pending',available_at=now(),lease_token=null,lease_until=null");
}
const materializedTables = ["orders", "order_items", "sales_ledger", "payments", "report_store_daily", "report_product_daily", "pipeline_heads"];
async function noFacts() {
  for (const t of materializedTables) expect(await rows(`select count(*)::int n from lean_private.${t}`)).toEqual([{ n: 0 }]);
}
async function provenance() {
  return Promise.all(["receipts", "pipeline_snapshots", "pipeline_scope", "pipeline_operator_audit", "publications"]
    .map(t => rows(`select to_jsonb(x) row from lean_private.${t} x order by to_jsonb(x)::text`)));
}

describe("052 source-derived terminal exclusion", () => {
  it("terminates only queue work, preserves provenance/ACL, never reports success or reclaims exclusion", async () => {
    const { args } = await retained(), before = await provenance();
    expect(await sqlRpc(rpc, args)).toBe(true);
    expect(await rows("select state,last_error_code,lease_token,lease_until,completed_at is not null completed from lean_private.work"))
      .toEqual([{ state: "done", last_error_code: "excluded_before_window", lease_token: null, lease_until: null, completed: true }]);
    expect(await provenance()).toEqual(before); await noFacts();
    expect(await sqlRpc(rpc, args)).toBe(false);
    expect(await sqlRpc("lean_pipeline_claim", { p_token: randomUUID(), p_project_ref: project, p_shop: shop })).toEqual({ state: "idle" });
    expect(await sqlRpc("lean_pipeline_health", { p_project_ref: project, p_shop: shop })).toMatchObject({ done: 1, excluded: 1, pending: 0, dead: 0 });
    expect(await rows("select proacl::text from pg_proc where oid='public.lean_pipeline_health(text,text)'::regprocedure")).toEqual(healthAcl);
    expect(await rows(`select has_function_privilege('service_role','public.${rpc}(bigint,uuid)','EXECUTE') service,
      has_function_privilege('anon','public.${rpc}(bigint,uuid)','EXECUTE') anon,
      has_function_privilege('authenticated','public.${rpc}(bigint,uuid)','EXECUTE') authenticated,
      has_function_privilege('lean_posthog_reader','public.${rpc}(bigint,uuid)','EXECUTE') reader`))
      .toEqual([{ service: true, anon: false, authenticated: false, reader: false }]);
  });
  it("aborts installation rather than committing an unexpected default grantee", async () => {
    await db.exec(`drop function public.${rpc}(bigint,uuid);create role unknown_reader;
      alter default privileges in schema public grant execute on functions to unknown_reader`);
    await expect(db.exec(readFileSync(migration, "utf8"))).rejects.toThrow("unexpected exclusion function grantee");
    await db.exec("rollback");
    expect(await rows(`select to_regprocedure('public.${rpc}(bigint,uuid)') name`)).toEqual([{ name: null }]);
    expect(await rows("select proacl::text from pg_proc where oid='public.lean_pipeline_health(text,text)'::regprocedure")).toEqual(healthAcl);
  });
  it.each([false, true])("requires a visible fresh refund for old-order refund event (stale=%s)", async stale => {
    const source = oldSource(), updatedAt = "2026-01-02T11:00:00Z";
    source.refunds = [{ id: "gid://shopify/Refund/2", order: { id: source.commerce.order.id }, updatedAt }];
    source.financial.refunds = [{ id: "gid://shopify/Refund/2", updatedAt }];
    const { args } = await retained(source, { id: "2", order_id: "1",
      updated_at: stale ? "2026-01-02T11:01:00Z" : updatedAt }, "refunds/create");
    if (stale) await expect(sqlRpc(rpc, args)).rejects.toThrow("exclusion refund behind event");
    else expect(await sqlRpc(rpc, args)).toBe(true);
    await noFacts();
  });
  it.each(["wrong_token", "expired", "null_lease", "disabled"])("fences %s with no writes", async mode => {
    const { args } = await retained();
    if (mode === "wrong_token") args.p_token = randomUUID();
    if (mode === "expired") await db.exec("update lean_private.work set lease_until=now()-interval '1 second'");
    if (mode === "null_lease") await db.exec("update lean_private.work set lease_until=null");
    if (mode === "disabled") await db.exec("update lean_private.pipeline_scope set enabled=false");
    const before = await rows("select to_jsonb(w) row from lean_private.work w");
    expect(await sqlRpc(rpc, args)).toBe(false);
    expect(await rows("select to_jsonb(w) row from lean_private.work w")).toEqual(before); await noFacts();
  });
  it("uses frozen window even if current enabled scope is later revised", async () => {
    const { args } = await retained();
    await db.exec("update lean_private.pipeline_scope set from_time='2025-12-01',approval_ref='fixture:new'");
    const before = await provenance();
    expect(await sqlRpc(rpc, args)).toBe(true); expect(await provenance()).toEqual(before);
  });
  it.each(["2026-01-01T00:00:00Z", "2026-01-01T12:00:00Z"])("refuses at/inside from boundary %s", async created => {
    const source = oldSource(); source.commerce.order.createdAt = created;
    const { args } = await retained(source);
    await expect(sqlRpc(rpc, args)).rejects.toThrow("order not before snapshot window"); await noFacts();
  });
  it.each([
    ["createdAt", "not-a-date"], ["createdAt", "2025-02-30T00:00:00Z"], ["createdAt", "infinity"],
    ["updatedAt", "2025-01-01T00:00:00Z"],
  ])("rejects invalid retained clock %s=%s", async (key, value) => {
    const { args } = await retained();
    await db.query("update lean_private.pipeline_snapshots set source=jsonb_set(source,$1::text[],$2::jsonb)",
      [["commerce", "order", key], JSON.stringify(value)]);
    await expect(sqlRpc(rpc, args)).rejects.toThrow(); await noFacts();
  });
  it.each([
    "update lean_private.pipeline_snapshots set source=jsonb_set(source,'{commerce,projection}','\"financial_no_geo_order_size\"')",
    "update lean_private.pipeline_snapshots set source=jsonb_set(source,'{commerce,shop}','\"other.myshopify.com\"')",
    "update lean_private.pipeline_snapshots set order_gid='gid://shopify/Order/99'",
    "update lean_private.pipeline_snapshots set revision=revision+interval '1 second'",
    "update lean_private.receipts set payload=jsonb_set(payload,'{updated_at}','\"2026-01-03T00:00:00Z\"')",
    "update lean_private.receipts set payload=jsonb_set(payload,'{created_at}','\"not-a-date\"')",
    "update lean_private.receipts set business_key='[\"wrong.myshopify.com\",\"1\"]'",
    "update lean_private.pipeline_snapshots set from_time='infinity'",
  ])("refuses lineage/projection/freshness drift %#", async mutation => {
    const { args } = await retained(); await db.exec(mutation);
    await expect(sqlRpc(rpc, args)).rejects.toThrow(); await noFacts();
  });
  it.each(["orders", "report_product_daily", "pipeline_heads", "projections"])("refuses existing %s without deletion", async table => {
    const { args, claim, source } = await retained();
    if (table === "pipeline_heads") await db.exec(`insert into lean_private.pipeline_heads
      select shop,order_gid,work_id,revision,source from lean_private.pipeline_snapshots`);
    else if (table === "projections") await db.exec("insert into lean_private.projections(receipt_id,transform_version,facts) select receipt_id,'fixture','{}' from lean_private.work");
    else {
      const mapped = composeRetainedOrderReports(source, mappingPolicy(source, runtimePolicy), String(claim.publication), "fixture", PIPELINE_VERSION);
      const values = table === "orders" ? mapped.facts.orders : mapped.productReports;
      await db.query(`insert into lean_private.${table} select * from jsonb_populate_recordset(null::lean_private.${table},$1::jsonb)`, [JSON.stringify(values)]);
    }
    const before = await rows(`select to_jsonb(x) row from lean_private.${table} x`);
    await expect(sqlRpc(rpc, args)).rejects.toThrow(/already materialized|already projected/);
    expect(await rows(`select to_jsonb(x) row from lean_private.${table} x`)).toEqual(before);
    expect(await rows("select state from lean_private.work")).toEqual([{ state: "leased" }]);
  });
});

describe("actual retained-source caller", () => {
  it.each([false, true])("old source excluded independently of unknown catalog=%s", async unknown => {
    const source = oldSource();
    if (unknown) (sourceObject(source.commerce.order.lineItems).nodes as Record<string, unknown>[])[0].product = { id: "gid://shopify/Product/999" };
    await retained(source); await releaseForCaller();
    expect(await run()).toEqual({ state: "excluded", reason: "excluded_before_window" }); await noFacts();
  });
  it.each([false, true])("legacy/extended in-window path remains materialization (extended=%s)", async extended => {
    if (!extended) await db.exec("update lean_private.pipeline_scope set policy=policy-'retainedReports',approval_ref='fixture:legacy'");
    const source = runtimeSource(); source.commerce.order.createdAt = "2026-01-01T00:00:00Z";
    await retained(source); await releaseForCaller();
    expect(await run()).toEqual({ state: "done" });
    expect(await rows("select count(*)::int n from lean_private.orders")).toEqual([{ n: 1 }]);
    expect(await sqlRpc("lean_pipeline_health", { p_project_ref: project, p_shop: shop })).toMatchObject({ done: 1, excluded: 0 });
  });
  it.each(["malformed", "after_until", "projection", "freshness", "catalog"])("keeps %s errors nonterminal", async mode => {
    const source = mode === "catalog" ? runtimeSource() : oldSource();
    if (mode === "catalog") (sourceObject(source.commerce.order.lineItems).nodes as Record<string, unknown>[])[0].product = { id: "gid://shopify/Product/999" };
    await retained(source);
    if (mode === "malformed") await db.exec(`update lean_private.pipeline_snapshots set source=jsonb_set(source,'{commerce,order,createdAt}','"2025-02-30T00:00:00Z"')`);
    if (mode === "after_until") await db.exec("update lean_private.pipeline_snapshots set until_time='2025-12-31',from_time='2025-12-01'");
    if (mode === "projection") await db.exec(`update lean_private.pipeline_snapshots set source=jsonb_set(source,'{commerce,projection}','"financial_no_geo_order_size"')`);
    if (mode === "freshness") await db.exec(`update lean_private.receipts set payload=jsonb_set(payload,'{updated_at}','"2026-01-03T00:00:00Z"')`);
    await releaseForCaller(); expect(await run()).toEqual({ state: "failed" });
    expect(await rows("select state,last_error_code from lean_private.work")).toEqual([{ state: "pending", last_error_code: "mapping_rejected" }]);
    await noFacts();
  });
  it.each(["missing", "lost_after_commit", "invalid_response", "lost_lease"])("handles %s exclusion RPC without catch-and-fail", async mode => {
    await retained(); await releaseForCaller();
    if (mode === "missing") await db.exec(`drop function public.${rpc}(bigint,uuid)`);
    const names: string[] = [];
    const wrapper: AnalyticsRpcClient = { async rpc(name, args) {
      names.push(name);
      if (name === rpc && mode === "invalid_response") return { data: null, error: null };
      if (name === rpc && mode === "lost_lease") return { data: false, error: null };
      const result = await client.rpc(name, args);
      if (name === rpc && mode === "lost_after_commit") throw new Error("response_lost");
      return result;
    } };
    if (mode === "lost_lease") expect(await run(wrapper)).toEqual({ state: "lost_lease" });
    else await expect(run(wrapper)).rejects.toThrow(mode === "invalid_response" ? "pipeline_invalid_exclusion" : "pipeline_storage_unavailable");
    expect(names).not.toContain("lean_pipeline_fail");
    expect(names).not.toContain("lean_pipeline_finish"); expect(names).not.toContain("lean_pipeline_finish_extended");
    expect(await rows("select state from lean_private.work")).toEqual([{ state: mode === "lost_after_commit" ? "done" : "leased" }]);
    await noFacts();
  });
});
