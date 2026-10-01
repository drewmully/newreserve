/** Actual Node/TS operators -> SQL via synthetic transport. No hosted calls. */
/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic JSON RPC rows are deliberately mutated */
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { runHistoryTargetReportOperator, historyTargetReportQueries } from "@/lib/analytics/historyTargetReportOperator";
const require = createRequire(import.meta.url);
const C = require("../../scripts/analytics/history-target-contract.cjs");
const O = require("../../scripts/analytics/history-target-operator.cjs");
const old = require("../../scripts/analytics/history-import-contract.cjs");
const project = C.PROJECT, shop = C.SHOP;
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
const gid = (kind: string, id = "1") => `gid://shopify/${kind}/${id}`;
const env = { LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_SHOPIFY_SHOP_DOMAIN: shop,
  LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`, LEAN_HISTORY_TARGET_OPERATOR_REF: "synthetic-owner",
  LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "synthetic-db", LEAN_SHOPIFY_ANALYTICS_READ_TOKEN: "synthetic-source" };
const order = () => ({
  __typename: "Order", id: gid("Order"), createdAt: "2026-09-28T12:00:00Z", updatedAt: "2026-09-28T12:00:00Z",
  processedAt: null, cancelledAt: null, test: false, edited: false, taxesIncluded: false, currencyCode: "USD",
  displayFinancialStatus: "PAID", totalPriceSet: money("10"), currentTotalPriceSet: money("10"),
  subtotalPriceSet: money("10"), totalTaxSet: money("0"), totalDiscountsSet: money("0"), totalRefundedSet: money("0"), refunds: [],
});
const line = () => ({
  __typename: "LineItem", __parentId: gid("Order"), id: gid("LineItem"), quantity: 1, currentQuantity: 1,
  isGiftCard: false, requiresShipping: true, taxable: false, product: { id: gid("Product", "3") }, variant: null,
  originalTotalSet: money("10"), originalUnitPriceSet: money("10"), totalDiscountSet: money("0"),
});
function manifest(customer = false, importMs = 3600000, reportMs = 7200000) {
  const query = C.compile("2026-09-30T00:00:00Z");
  return { approvalId: "synthetic-approval", projection: C.PROJECTION, inventoryRef: "synthetic-independent-population",
    operatorRef: env.LEAN_HISTORY_TARGET_OPERATOR_REF,
    scope: { jobId: "synthetic-import", projectRef: project, shop, appId: gid("App", "659756777664"),
      installationId: gid("AppInstallation", "999"), apiVersion: "2026-07", untilTime: "2026-09-30T00:00:00Z",
      queryText: query.QUERY, queryHash: query.HASH, expectedOrders: 1,
      expiresAt: new Date(Date.now() + importMs).toISOString(), purgeAfter: new Date(Date.now() + 86400000).toISOString(),
      approvalRef: "synthetic-approval", actorRef: env.LEAN_HISTORY_TARGET_OPERATOR_REF },
    report: { runId: "synthetic-report", expiresAt: new Date(Date.now() + reportMs).toISOString(),
      fromDate: "2026-09-28", throughDate: "2026-09-28", includeCustomerId: customer, policy: null, spendRuns: [],
      queries: historyTargetReportQueries(customer) } };
}
function packet(customer: boolean) {
  const o = order(), l = line();
  return { commerce: { shop, apiVersion: "2026-07", projection: customer ? "financial_customer_id" : "financial_no_geo",
    order: { id: o.id, createdAt: o.createdAt, updatedAt: o.updatedAt, currencyCode: "USD",
      edited: false, taxesIncluded: false, test: false, cancelledAt: null,
      ...(customer ? { customer: { id: gid("Customer", "90") } } : {}),
      originalTotalPriceSet: money("10"), subtotalPriceSet: money("10"),
      transactionsCount: { count: 1, precision: "EXACT" },
      transactions: [{ id: gid("OrderTransaction"), kind: "SALE", status: "SUCCESS", gateway: "synthetic",
        test: false, createdAt: o.createdAt, processedAt: o.createdAt, amountSet: money("10"), parentTransaction: null }],
      lineItems: { nodes: [{ id: l.id, sku: "SYNTHETIC", quantity: 1, isGiftCard: false, product: l.product,
        originalUnitPriceSet: money("10"), originalTotalSet: money("10"), discountAllocations: [] }],
      pageInfo: { hasNextPage: false, endCursor: null } } } },
    financial: { id: o.id, updatedAt: o.updatedAt, currencyCode: "USD", originalTotalPriceSet: money("10"),
      totalTaxSet: money("0"), originalTotalDutiesSet: null, originalTotalAdditionalFeesSet: null,
      totalTipReceivedSet: money("0"), shippingLines: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, refunds: [] },
    refunds: [] };
}
describe("private current-target history compatibility", () => {
  let db: { exec: (sql: string) => Promise<unknown>; query: (sql: string, args?: unknown[]) => Promise<{ rows: unknown[] }>;
    close: () => Promise<void> };
  let control: Client | undefined, m: ReturnType<typeof manifest>, bytes: Buffer, seen: string[], errors: string[];
  let mutate: (data: Record<string, unknown>, query: string) => void, version: string;
  let hook: (name: string, args: Record<string, unknown>) => Promise<void>;
  const query = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as Record<string, any>[];
  const rpc = async (name: string, args: Record<string, unknown>, runtime = false) => {
    expect(name).toMatch(/^lean_history_[a-z_]+$/);
    if (runtime) await db.exec("set role service_role");
    try {
      return (await query(`select public.${name}(${Object.keys(args).map((k, i) => `${k}=>$${i + 1}`).join(",")}) v`,
        Object.values(args).map(v => v !== null && typeof v === "object" ? JSON.stringify(v) : v)))[0].v;
    } finally { if (runtime) await db.exec("reset role"); }
  };
  const common = (token = randomUUID()) => ({ p_job: m.scope.jobId, p_project: project, p_shop: shop, p_token: token });
  const call = (mode: string, config = {}) => O.check(env, { enabled: true, jobId: m.scope.jobId, mode, ...config }, transport);
  const transport: typeof fetch = async (url, init) => {
    expect(init?.redirect).toBe("error"); init?.signal?.throwIfAborted();
    const u = String(url), body = init?.body ? JSON.parse(String(init.body)) : {};
    if (u.startsWith(`https://${project}.supabase.co/rest/v1/rpc/`)) {
      const name = u.split("/").at(-1)!;
      seen.push(name); await hook(name, body);
      try { return Response.json(await rpc(name, body, true)); }
      catch (e) { errors.push(String(e)); return Response.json({ error: "synthetic" }, { status: 400 }); }
    }
    if (u.startsWith("https://storage.googleapis.com/")) {
      seen.push("download");
      return new Response(new Uint8Array(bytes), { headers: { "content-length": String(bytes.length) } });
    }
    expect(u).toBe(`https://${shop}/admin/api/2026-07/graphql.json`);
    seen.push(body.query);
    const identity = { shop: { myshopifyDomain: shop }, currentAppInstallation: { id: m.scope.installationId,
      app: { id: m.scope.appId }, accessScopes: ["read_orders", "read_all_orders", "read_products", "read_customers"].map(handle => ({ handle })) } };
    let data: Record<string, any>;
    if (body.query.includes("HistoryImportPreflight")) data = { ...identity,
      ordersCount: { count: 1, precision: "EXACT" }, bulkOperations: { nodes: [], pageInfo: { hasNextPage: false } } };
    else if (body.query.includes("HistoryImportStart")) data = {
      bulkOperationRunQuery: { userErrors: [], bulkOperation: { id: gid("BulkOperation"), status: "CREATED" } } };
    else if (body.query.includes("HistoryImportCheck")) data = { ...identity, ordersCount: { count: 1, precision: "EXACT" },
      node: { id: gid("BulkOperation"), type: "QUERY", query: m.scope.queryText, status: "COMPLETED",
        rootObjectCount: "1", objectCount: "2", fileSize: String(bytes.length), url: "https://storage.googleapis.com/synthetic",
        partialDataUrl: null, errorCode: null, createdAt: "2026-09-30T01:00:00Z", completedAt: "2026-09-30T01:01:00Z" } };
    else if (body.query.includes("HistoryTargetIdentity")) data = identity;
    else if (body.query.includes("AnalyticsOrder")) data = { order: packet(m.report.includeCustomerId).commerce.order };
    else if (body.query.includes("AnalyticsFinancial")) data = { order: packet(m.report.includeCustomerId).financial };
    else throw new Error("unexpected synthetic query");
    mutate(data, body.query);
    return Response.json({ data }, { headers: { "X-Shopify-API-Version": version } });
  };
  beforeAll(async () => {
    const local = process.env.HISTORY_TARGET_TEST_URL;
    if (local) {
      const u = new URL(local);
      if (u.hostname !== "127.0.0.1" || u.port !== "55439" || u.username !== "fixture_shopify_install" || u.pathname !== "/postgres")
        throw new Error("disposable loopback only");
      control = new Client({ connectionString: u.href }); await control.connect();
      await control.query("drop database if exists analytics_test_history_target");
      await control.query("create database analytics_test_history_target"); u.pathname = "/analytics_test_history_target";
      const client = new Client({ connectionString: u.href }); await client.connect();
      db = { exec: sql => client.query(sql), query: (sql, args) => client.query(sql, args), close: () => client.end() };
    } else db = new PGlite();
    await db.exec(`do $$ declare r text;begin foreach r in array array['anon','authenticated','service_role','inherited_runtime'] loop
      if not exists(select 1 from pg_roles where rolname=r) then execute format('create role %I',r);end if;
      end loop;execute format('grant service_role to %I with inherit false, set true',current_user);
      end $$;grant inherited_runtime to service_role`);
    for (const file of ["001_staging", "013_release", "014_reporting_views", "019_spend_jobs", "040_shopify_history_import", "041_history_report_bridge"])
      await db.exec(readFileSync(`sql/analytics/${file}.sql`, "utf8"));
    await db.exec(readFileSync("sql/analytics/proposed_history_target_boundary.sql", "utf8"));
  }, 30000);
  afterAll(async () => {
    await db?.close();
    if (control) { await control.query("drop database if exists analytics_test_history_target"); await control.end(); }
  });
  beforeEach(async () => {
    await db.exec(`truncate lean_private.history_target_approvals,lean_private.history_import_jobs,
      lean_private.publications cascade;drop trigger if exists zzz_target_delay on lean_private.history_import_jobs;
      drop trigger if exists zzz_target_delay on lean_private.history_report_sources;
      drop trigger if exists aaa_target_delay on lean_private.history_import_orders;`);
    m = manifest(); bytes = Buffer.from([order(), line()].map(v => JSON.stringify(v)).join("\n") + "\n");
    seen = []; errors = []; version = "2026-07"; mutate = () => {}; hook = async () => {};
  });
  async function stage(enable = true) {
    expect(await rpc("lean_history_target_stage", { p_manifest: m })).toBe(true);
    expect(await rpc("lean_history_target_import_register", { p_approval: m.approvalId })).toBe(true);
    if (enable) await db.exec("update lean_private.history_import_jobs set enabled=true");
  }
  async function imported() {
    await stage();
    expect(await call("start")).toMatchObject({ status: "source_operation_submitted" });
    expect(await call("check")).toMatchObject({ status: "source_download_ready" });
    expect(await call("import")).toMatchObject({ status: "source_history_imported" });
    expect(errors).toEqual([]);
  }
  async function report(enable = true) {
    const h = (await query("select encode(sha256(convert_to(completion::text,'UTF8')),'hex') h from lean_private.history_import_jobs"))[0].h;
    await rpc("lean_history_target_report_register", { p_approval: m.approvalId, p_source_hash: h });
    if (enable) await db.exec("update lean_private.history_report_jobs set enabled=true");
  }
  const advance = async (steps = 3) => {
    try { return await runHistoryTargetReportOperator(env,
      { enabled: true, runId: m.report.runId, maxSteps: steps, maxProviderRequests: 24 }, transport); }
    catch (error) { throw new Error(`${error}; SQL: ${errors.join("; ")}`); }
  };
  it("is empty/default-off and neither operator touches transport when disabled", async () => {
    expect(await O.check(env, {}, transport)).toMatchObject({ status: "disabled" });
    expect(await runHistoryTargetReportOperator(env, { enabled: false } as never, transport)).toEqual({ status: "disabled" });
    expect((await query("select count(*)::int n from lean_private.history_target_approvals"))[0].n).toBe(0);
    expect(seen).toEqual([]);
    expect(await call("start")).toMatchObject({ status: "failed", reason: "private_rpc_rejected", sourceRequests: 0 });
  });
  it("new registrations remain disabled; runtime cannot stage, register, revoke or use aliases", async () => {
    await stage(false);
    expect(await call("start")).toMatchObject({ status: "failed", sourceRequests: 0 });
    for (const [name, args] of [
      ["lean_history_target_stage", { p_manifest: m }],
      ["lean_history_target_import_register", { p_approval: m.approvalId }],
      ["lean_history_target_report_register", { p_approval: m.approvalId, p_source_hash: "a".repeat(64) }],
      ["lean_history_target_revoke", { p_approval: m.approvalId, p_reason: "stop" }],
    ] as const) await expect(rpc(name, args, true)).rejects.toThrow("permission denied");
    const rows = await query(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='lean_private' and (proname like 'history_target_%' or proname in ('history_import_lock','history_report_lock'))
      and has_function_privilege('service_role',p.oid,'EXECUTE')`);
    expect(rows).toEqual([]);
  });
  it("runs start/bind/check/observe/batch/finish and exact completed replay against real SQL", async () => {
    await imported();
    expect((await query("select state,orders,lines,provider_requests from lean_private.history_import_jobs"))[0])
      .toEqual({ state: "complete", orders: 1, lines: 1, provider_requests: 6 });
    expect((await query("select source from lean_private.history_import_orders"))[0].source).toEqual(order());
    const count = seen.length;
    expect(await call("import")).toMatchObject({ status: "source_import_already_complete", sourceRequests: 0 });
    expect(seen.slice(count).every(v => v.startsWith("lean_history_"))).toBe(true);
    await expect(rpc("lean_history_import_finish", { ...common(), p_evidence: {} }, true)).rejects.toThrow("completion replay mismatch");
  });
  it.each(["app", "install", "shop", "scope", "version", "count", "query"])("fails closed on source %s mismatch", async kind => {
    await stage();
    if (kind === "query") {
      expect(await call("start")).toMatchObject({ status: "source_operation_submitted" });
      mutate = data => { (data.node as any).query = "{}"; };
      expect(await call("check")).toMatchObject({ status: "failed", reason: "operation_identity_mismatch" });
    } else {
      if (kind === "version") version = "2026-10";
      mutate = data => {
        const d = data as any;
        if (kind === "app") d.currentAppInstallation.app.id = gid("App", "8");
        if (kind === "install") d.currentAppInstallation.id = gid("AppInstallation", "8");
        if (kind === "shop") d.shop.myshopifyDomain = "other.myshopify.com";
        if (kind === "scope") d.currentAppInstallation.accessScopes = [];
        if (kind === "count") d.ordersCount.count = 2;
      };
      expect(await call("start")).toMatchObject({ status: "failed", sourceRequests: 1 });
    }
    expect((await query("select orders from lean_private.history_import_jobs"))[0].orders).toBe(0);
  });
  it.each(["project", "operator", "hash", "projection", "cutoff", "inventory", "expiry", "reportQuery"])("rejects invalid approval %s", async kind => {
    if (kind === "project") m.scope.projectRef = old.PROJECT;
    if (kind === "operator") m.scope.actorRef = "not-owner";
    if (kind === "hash") m.scope.queryHash = "a".repeat(64);
    if (kind === "projection") m.projection = "financial_customer_id";
    if (kind === "cutoff") m.scope.untilTime = "2026-09-31T00:00:00Z";
    if (kind === "inventory") m.inventoryRef = "";
    if (kind === "expiry") m.scope.expiresAt = new Date(Date.now() + 86400001 * 2).toISOString();
    if (kind === "reportQuery") m.report.queries.order += " customer { email }";
    await expect(stage()).rejects.toThrow();
  });
  it("cannot renew, mutate or delete staged approval, and revocation blocks replay", async () => {
    await imported();
    await expect(db.exec("update lean_private.history_target_approvals set manifest=manifest")).rejects.toThrow("immutable");
    await expect(db.exec("delete from lean_private.history_target_approvals")).rejects.toThrow("immutable");
    await rpc("lean_history_target_revoke", { p_approval: m.approvalId, p_reason: "synthetic stop" });
    await expect(db.exec("delete from lean_private.history_target_revocations")).rejects.toThrow("immutable");
    expect(await call("import")).toMatchObject({ status: "failed", sourceRequests: 0 });
  });
  it("rejects projection/cutoff in JS and actual SQL batch without rewriting source fields", async () => {
    await stage(); await call("start"); await call("check");
    const args = common(); await rpc("lean_history_import_claim", { ...args, p_mode: "import" }, true);
    for (const o of [{ ...order(), customer: { id: gid("Customer") } }, { ...order(), createdAt: m.scope.untilTime }]) {
      expect(() => C.row(o, m.scope.untilTime)).toThrow();
      await expect(rpc("lean_history_import_batch", { ...args, p_rows: [{ kind: "order", source: o }] }, true)).rejects.toThrow();
    }
    expect(() => old.row(order())).toThrow("source_outside_scope");
    expect(C.row(order(), m.scope.untilTime).source).toEqual(order());
  });
  it("blocks authority change after claim before bind, batch and finish", async () => {
    await stage();
    hook = async name => {
      if (name === "lean_history_import_bind") await rpc("lean_history_target_revoke", { p_approval: m.approvalId, p_reason: "after claim" });
    };
    expect(await call("start")).toMatchObject({ status: "failed", reason: "private_rpc_rejected" });
    expect((await query("select operation_id from lean_private.history_import_jobs"))[0].operation_id).toBeNull();
  });
  it.each(["lean_history_import_batch", "lean_history_import_finish"])("blocks stop at %s", async stopAt => {
    await stage(); await call("start"); await call("check");
    hook = async name => {
      if (name === stopAt) await rpc("lean_history_target_revoke", { p_approval: m.approvalId, p_reason: "mid import" });
    };
    expect(await call("import")).toMatchObject({ status: "failed" });
    expect((await query("select state from lean_private.history_import_jobs"))[0].state).not.toBe("complete");
  });
  it("honors finite stop, lease, attempts, download and row budgets", async () => {
    const abort = new AbortController(); abort.abort();
    expect(await O.check(env, { enabled: true, jobId: m.scope.jobId, mode: "start" }, transport, abort.signal))
      .toMatchObject({ status: "failed", sourceRequests: 0 });
    await stage(); await call("start"); await call("check");
    await db.exec("update lean_private.history_import_jobs set imports=3");
    expect(await call("import")).toMatchObject({ status: "failed", sourceRequests: 0 });
    await db.exec("update lean_private.history_import_jobs set imports=0,reserved_download_bytes=268435456");
    expect(await call("import")).toMatchObject({ status: "failed", sourceRequests: 0 });
    await db.exec("update lean_private.history_import_jobs set reserved_download_bytes=0");
    const args = common(); await rpc("lean_history_import_claim", { ...args, p_mode: "import" }, true);
    await expect(rpc("lean_history_import_batch", { ...args, p_rows: Array.from({ length: 251 }, () => C.row(order(), m.scope.untilTime)) }, true))
      .rejects.toThrow("invalid history batch");
    await db.exec("update lean_private.history_import_jobs set lease_until=clock_timestamp()-interval '1 second'");
    await expect(rpc("lean_history_import_batch", { ...args, p_rows: [C.row(order(), m.scope.untilTime)] }, true)).rejects.toThrow("fence expired");
  });
  it.each([false, true])("drives existing 041 enrichment/report flow with explicit customer=%s", async customer => {
    m = manifest(customer); await imported(); await report();
    expect(await advance()).toMatchObject({ status: "complete_unverified", lastState: "complete", providerRequests: 5 });
    const retained = (await query("select source from lean_private.history_report_sources"))[0].source;
    expect(retained.commerce.projection).toBe(customer ? "financial_customer_id" : "financial_no_geo");
    expect("customer" in retained.commerce.order).toBe(customer);
    expect((await query("select customer_id from lean_private.orders"))[0].customer_id).toBeNull();
    expect((await query("select new_customers from lean_private.report_store_daily"))[0].new_customers).toBeNull();
    expect(await advance()).toMatchObject({ lastState: "complete", providerRequests: 0 });
    expect(errors).toEqual([]);
  });
  it("rejects arbitrary report source hash, disabled report, wrong compiled query and customer access", async () => {
    m = manifest(true); await imported();
    await expect(rpc("lean_history_target_report_register", { p_approval: m.approvalId, p_source_hash: "a".repeat(64) }))
      .rejects.toThrow("unavailable completed");
    await report(false); await expect(advance()).rejects.toThrow();
    await db.exec("update lean_private.history_report_jobs set enabled=true");
    mutate = (d, q) => { if (q.includes("HistoryTargetIdentity")) (d as any).currentAppInstallation.accessScopes.pop(); };
    await expect(advance()).rejects.toThrow("pipeline_storage_unavailable");
    expect((await query("select count(*)::int n from lean_private.orders"))[0].n).toBe(0);
  });
  it("preserves separately approved report expiry after original collection expires", async () => {
    m = manifest(false, 700, 3600000); await imported();
    await new Promise(resolve => setTimeout(resolve, 750));
    expect(await call("import")).toMatchObject({ status: "failed", sourceRequests: 0 });
    await report();
    expect(await advance()).toMatchObject({ lastState: "complete" });
  });
  it("rolls back import expiry during actual batch write, not just before it", async () => {
    m = manifest(false, 700, 3600000); await stage(); await call("start"); await call("check");
    await db.exec(`create or replace function public.synthetic_delay() returns trigger language plpgsql as $$
      begin perform pg_sleep(0.8);return new;end $$;
      create trigger aaa_target_delay before insert on lean_private.history_import_orders
      for each row execute function public.synthetic_delay();`);
    expect(await call("import")).toMatchObject({ status: "failed" });
    expect((await query("select count(*)::int n from lean_private.history_import_orders"))[0].n).toBe(0);
  });
  it("rolls back report expiry during actual retain write", async () => {
    m = manifest(false, 3600000, 700); await imported(); await report();
    await db.exec(`create or replace function public.synthetic_delay() returns trigger language plpgsql as $$
      begin if new.source is not null then perform pg_sleep(0.8);end if;return new;end $$;
      create trigger zzz_target_delay before update on lean_private.history_report_sources
      for each row execute function public.synthetic_delay();`);
    await expect(advance()).rejects.toThrow();
    expect((await query("select source from lean_private.history_report_sources"))[0].source).toBeNull();
    expect((await query("select count(*)::int n from lean_private.orders"))[0].n).toBe(0);
  });
  it("rolls back expiry during actual completion update", async () => {
    m = manifest(false, 700, 3600000); await stage(); await call("start"); await call("check");
    await db.exec(`create or replace function public.synthetic_delay() returns trigger language plpgsql as $$
      begin if new.state='complete' then perform pg_sleep(0.8);end if;return new;end $$;
      create trigger zzz_target_delay before update on lean_private.history_import_jobs
      for each row execute function public.synthetic_delay();`);
    expect(await call("import")).toMatchObject({ status: "failed" });
    const row = (await query("select state,completion from lean_private.history_import_jobs"))[0];
    expect(row).toEqual({ state: "importing", completion: null });
  });
  it("report source kill and completion hash change reject actual next operator step", async () => {
    await imported(); await report();
    await db.exec("update lean_private.history_import_jobs set enabled=false");
    await expect(advance()).rejects.toThrow();
    await db.exec(`update lean_private.history_import_jobs set enabled=true,completion='{"changed":true}'`);
    await expect(advance()).rejects.toThrow();
    expect((await query("select count(*)::int n from lean_private.history_report_sources"))[0].n).toBe(0);
  });
  it("report revocation after claim blocks retain and canonical write", async () => {
    await imported(); await report();
    hook = async name => {
      if (name === "lean_history_report_retain")
        await rpc("lean_history_target_revoke", { p_approval: m.approvalId, p_reason: "after report claim" });
    };
    await expect(advance()).rejects.toThrow();
    expect((await query("select source from lean_private.history_report_sources"))[0].source).toBeNull();
    expect((await query("select count(*)::int n from lean_private.orders"))[0].n).toBe(0);
  });
  it("stops streaming on byte/count/duplicate and source authority failures without finish", async () => {
    const parse = (content: Buffer, override = {}) => C.parseStream(new Response(new Uint8Array(content)).body, {
      untilTime: m.scope.untilTime, fileSize: content.length, expectedOrders: 1, objectCount: 2,
      batch: async () => {}, ...override,
    });
    await expect(parse(bytes, { fileSize: bytes.length - 1 })).rejects.toThrow("download_byte_budget");
    await expect(parse(bytes, { expectedOrders: 2 })).rejects.toThrow("download_count_mismatch");
    const duplicate = Buffer.from([order(), order()].map(v => JSON.stringify(v)).join("\n"));
    await expect(parse(duplicate)).rejects.toThrow("duplicate_source_row");
    await imported(); await report();
    await expect(runHistoryTargetReportOperator(env, { enabled: true, runId: m.report.runId,
      maxSteps: 101, maxProviderRequests: 800 }, transport)).rejects.toThrow("history_target_operator_scope");
  });
  it("preserves old registrar/lock/batch rejection and old completed durable report access", async () => {
    await expect(rpc("lean_history_import_register", { p_scope: m.scope })).rejects.toThrow("invalid history import scope");
    await db.exec(`insert into lean_private.history_import_jobs(job_id,scope,expires_at,enabled,state,completion)
      values('legacy','{"projectRef":"${old.PROJECT}","shop":"${shop}"}',clock_timestamp()-interval '1 day',true,'complete','{"eof":true}')`);
    const sourceHash = (await query("select encode(sha256(convert_to(completion::text,'UTF8')),'hex') h from lean_private.history_import_jobs"))[0].h;
    await rpc("lean_history_report_register", { p_scope: { runId: "legacy", sourceJob: "legacy", sourceHash,
      projectRef: old.PROJECT, shop, expiresAt: new Date(Date.now() + 3600000).toISOString(),
      fromDate: "2026-09-28", throughDate: "2026-09-28", includeCustomerId: false, policy: null, spendRuns: [],
      approvalRef: "legacy-unchanged", actorRef: "legacy-owner" } });
    expect(await rpc("lean_history_report_claim", { p_run: "legacy", p_project: old.PROJECT, p_token: randomUUID() }, true))
      .toEqual({ state: "disabled" });
  });
});
