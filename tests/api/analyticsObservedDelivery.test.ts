/** Disposable SQL + ordinary pipeline entrypoints + actual HTTP/consumer code. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { productionObservedDeliveryGet, observedDeliveryPath, observedDeliveryManifestHash } from "@/lib/analytics/productionObservedDelivery";
import { observedDeliveryView, validObservedDeliveryPayload, type ObservedImports } from "@/lib/analytics/observedDeliveryConsumer";
import { composeRetainedOrderReports } from "@/lib/analytics/shopifyRetainedOrder";
import { runtimePolicy, runtimeSource } from "../fixtures/analyticsRetainedRuntime";

const project = "xnfjdbpjuaezxjgargto", shop = "mullybox-store.myshopify.com";
const token = "fixture-observed-current-not-a-real-credential";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const sql = (n: string) => readFileSync(`sql/analytics/${n}.sql`, "utf8");
const env = { LEAN_PRODUCTION_REPORTS_ENABLED: "true", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
  LEAN_PRODUCTION_REPORTS_SECRET: "fixture-existing-observed-not-a-real-credential",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
  LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key" };
let db: PGlite;
type Payload = Record<string, Record<string, unknown>[]>;
async function query<T = unknown>(sqlText: string, params: unknown[] = []) {
  return (await db.query<{ r: T }>(sqlText, params)).rows[0].r;
}
async function rpc(name: string, body: Record<string, string>) {
  await db.exec("set role service_role");
  try {
    return await query(`select public.${name}(${Object.keys(body).map((k, i) => `${k}=>$${i + 1}`).join(",")}) r`,
      Object.values(body));
  } finally { await db.exec("reset role"); }
}
const transport = (afterAuth?: () => Promise<void>) => vi.fn<typeof fetch>(async (url, init) => {
  expect(String(url).startsWith(`https://${project}.supabase.co/rest/v1/rpc/`)).toBe(true);
  expect(init?.signal).toBeInstanceOf(AbortSignal); expect(init?.redirect).toBe("error");
  const name = String(url).split("/").at(-1)!;
  expect(["lean_observed_delivery_auth", "lean_observed_delivery_read"]).toContain(name);
  const data = await rpc(name, JSON.parse(String(init?.body)));
  if (name.endsWith("_auth")) await afterAuth?.();
  return Response.json(data);
});
const request = (bearer = token) => new Request(`https://www.mymully.com${observedDeliveryPath}`,
  { headers: { authorization: `Bearer ${bearer}` } });
async function grant() {
  await db.exec("update lean_private.production_report_delivery set enabled=true,approval_ref='fixture:delivery'");
  await db.query(`insert into lean_private.observed_delivery_authorization
    (enabled,revision,project_ref,shop,source_id,audience,path,manifest_sha256,scope_sha256,token_sha256,
      approval_ref,delivery_approval_ref,not_before,expires_at)
    values(true,1,$1,$2,'01a0f3c6-8758-0000-378b-d15c40a96f3a',
      'posthog:353503:source:01a0f3c6-8758-0000-378b-d15c40a96f3a',$3,$4,
      lean_private.observed_delivery_scope_hash(),$5,'fixture:grant','fixture:delivery',
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,
    [project, shop, observedDeliveryPath, observedDeliveryManifestHash, hash(token)]);
}
async function materialize(id = "1", revision = "2026-01-02T12:00:00Z", doubled = false) {
  const source = runtimeSource();
  source.commerce.shop = shop;
  source.commerce.order.id = `gid://shopify/Order/${id}`; source.financial.id = source.commerce.order.id;
  source.commerce.order.updatedAt = revision; source.financial.updatedAt = revision;
  if (doubled) {
    const scale = (v: unknown) => {
      if (!v || typeof v !== "object") return;
      for (const [k, value] of Object.entries(v)) {
        if (k === "amount" && typeof value === "string") (v as Record<string, unknown>)[k] = String(Number(value) * 2);
        else scale(value);
      }
    };
    scale(source);
  }
  await db.query("select public.lean_accept_receipt('shopify',$1,$2,'orders/paid',$3,$4::jsonb)",
    [randomUUID(), JSON.stringify([shop, id]), "a".repeat(64), JSON.stringify({ id })]);
  const lease = randomUUID();
  const claim = await query<{ workId: string; publication: string }>(
    "select public.lean_pipeline_claim($1::uuid,$2,$3) r", [lease, project, shop]);
  await db.query("select public.lean_pipeline_retain($1::bigint,$2::uuid,$3::jsonb)",
    [claim.workId, lease, JSON.stringify(source)]);
  const out = composeRetainedOrderReports(source, { ...runtimePolicy, lineClasses: { "2": "merchandise" } },
    claim.publication, "fixture:retained", "shopify-observed-v1");
  expect(await query("select public.lean_pipeline_finish_extended($1::bigint,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb,null) r",
    [claim.workId, lease, JSON.stringify(out.facts), JSON.stringify(out.reports), JSON.stringify(out.productReports)])).toBe(true);
}
async function body() {
  const result = await productionObservedDeliveryGet(request(), env, transport());
  expect(result.status).toBe(200);
  const value: Payload = await result.json();
  expect(validObservedDeliveryPayload(value)).toBe(true);
  return value;
}
function imports(p: Payload): ObservedImports {
  return Object.fromEntries(["store_daily", "product_daily", "report_status"].map(k => [k, {
    rows: p[k], rowCount: p[k].length, complete: true, unfiltered: true,
    importedAt: null,
    capturedAt: new Date().toISOString().replace(/(\.\d{3})Z$/, "$1000Z"),
  }])) as ObservedImports;
}
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("hosted_network_forbidden"); }));
  db = new PGlite();
  await db.exec(`create role service_role;create role anon;create role authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const name of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views",
    "017_shopify_pipeline", "047_pipeline_extended", "050_production_report_delivery", "052_pipeline_before_window_exclusion"]) {
    await db.exec(sql(name));
  }
  await db.exec(sql("observed_delivery_runtime.review"));
  await db.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-01-01','2026-02-01',$3::jsonb,'fixture:scope','fixture:owner')`,
    [shop, project, JSON.stringify(runtimePolicy)]);
}, 30000);
afterEach(async () => {
  await db.close(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it("installs empty, denies private table/column/alias access and never changes old readers", async () => {
  expect(await query("select count(*)::int r from lean_private.observed_delivery_authorization")).toBe(0);
  expect((await productionObservedDeliveryGet(request(), env, transport())).status).toBe(503);
  expect(await query("select has_function_privilege('anon','public.lean_observed_delivery_read(text,text,text)','EXECUTE') r")).toBe(false);
  await db.exec("create role fixture_inherited; grant fixture_inherited to service_role; grant select(token_sha256) on lean_private.observed_delivery_authorization to fixture_inherited");
  await expect(db.exec("select lean_private.observed_delivery_acl_check()")).rejects.toThrow();
  await db.exec("revoke select(token_sha256) on lean_private.observed_delivery_authorization from fixture_inherited");
  await db.exec("select lean_private.observed_delivery_acl_check()");
  expect(await query("select public.lean_production_reports_read() r")).toBeNull();
});
it("two real pipeline generations and a correction reach HTTP under one standing grant", async () => {
  await grant(); await materialize();
  const first = await body(), firstStatus = first.report_status[0];
  expect(first.store_daily[0].gross_merchandise_sales_usd).toBe("20.000000");
  await materialize("2");
  const second = await body();
  expect(second.store_daily[0].eligible_orders).toBe("2");
  expect(second.product_daily[0].gross_merchandise_sales_usd).toBe("40.000000");
  expect(second.report_status[0].publication_id).not.toBe(firstStatus.publication_id);
  await materialize("1", "2026-01-03T12:00:00Z", true);
  const corrected = await body();
  expect(corrected.store_daily[0].eligible_orders).toBe("2");
  expect(corrected.store_daily[0].gross_merchandise_sales_usd).toBe("60.000000");
  expect(corrected.product_daily[0].gross_merchandise_sales_usd).toBe("60.000000");
  expect(corrected.report_status[0].head_count).toBe("2");
  expect(corrected.report_status[0].publication_id).not.toBe(second.report_status[0].publication_id);
  expect(corrected.store_daily[0].is_stale).toBe(true);
  expect(corrected.store_daily[0].certified).toBe(false);
  expect(observedDeliveryView(imports(corrected), Date.now()).state).toBe("current");
  expect(observedDeliveryView(imports(corrected), Date.now()).producer_liveness).toBe("not_proven");
  expect(await query("select revision::text r from lean_private.observed_delivery_authorization")).toBe("1");
});
it("status heartbeat does not change generation or last successful processing; pending/dead work remains visible", async () => {
  await grant(); await materialize();
  const first = await body(), second = await body();
  expect(second.report_status[0].publication_id).toBe(first.report_status[0].publication_id);
  expect(second.report_status[0].last_processed_at).toBe(first.report_status[0].last_processed_at);
  expect(JSON.stringify(first)).not.toContain("gid://shopify/");
  expect(JSON.stringify(first)).not.toContain("work_id");
  await db.query("select public.lean_accept_receipt('shopify',$1,$2,'orders/updated',$3,$4::jsonb)",
    [randomUUID(), JSON.stringify([shop, "3"]), "b".repeat(64), '{"id":"3"}']);
  const pending = await body();
  expect(observedDeliveryView(imports(pending), Date.now()).state).toBe("pending");
  await db.exec("update lean_private.work set state='dead' where state='pending'");
  const failed = await body();
  expect(observedDeliveryView(imports(failed), Date.now()).state).toBe("failed");
  expect(failed.report_status[0].last_processed_at).toBe(first.report_status[0].last_processed_at);
});
it("separate imports never expose mixed totals; expired status and incomplete evidence hide retained rows", async () => {
  await grant(); await materialize(); const first = await body();
  await materialize("2"); const second = await body();
  const mixed = imports(second); mixed.product_daily = imports(first).product_daily;
  expect(observedDeliveryView(mixed, Date.now())).toMatchObject({ state: "mixed", store_daily: [], product_daily: [] });
  expect(observedDeliveryView(imports(second), Date.parse(second.report_status[0].valid_until as string)).state).toBe("stale");
  const partial = imports(second); partial.store_daily.rowCount++;
  expect(observedDeliveryView(partial, Date.now()).state).toBe("invalid");
  const missed = imports(second);
  missed.store_daily.rows = missed.store_daily.rows.map(r => ({
    ...(r as Record<string, unknown>), snapshot_checked_at: "2026-01-01T00:00:00.000000Z",
  }));
  expect(observedDeliveryView(missed, Date.now()).state).toBe("stale");
});
it("revocation between RPCs denies delivery and rotation requires a distinct token plus new approval", async () => {
  await grant(); await materialize();
  const response = await productionObservedDeliveryGet(request(), env, transport(async () => {
    await db.exec("update lean_private.observed_delivery_authorization set enabled=false,revision=2");
  }));
  expect(response.status).toBe(503); expect(await response.text()).toBe("");
  await expect(db.exec("update lean_private.observed_delivery_authorization set enabled=true,revision=3")).rejects.toThrow();
  await db.query(`update lean_private.observed_delivery_authorization set enabled=true,revision=3,
    token_sha256=$1,approval_ref='fixture:rotation'`, [hash(`${token}-rotated`)]);
  expect((await productionObservedDeliveryGet(request(), env, transport())).status).toBe(401);
  expect((await productionObservedDeliveryGet(request(`${token}-rotated`), env, transport())).status).toBe(200);
});
it("expiry without UPDATE, changed scope and non-RC isolation fail closed", async () => {
  await grant();
  await db.exec(`update lean_private.observed_delivery_authorization set revision=2,approval_ref='fixture:expired',
    token_sha256=repeat('d',64),not_before=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '200 milliseconds'`);
  expect(await rpc("lean_observed_delivery_auth", { p_project_ref: project })).not.toBeNull();
  await new Promise(resolve => setTimeout(resolve, 220));
  expect(await rpc("lean_observed_delivery_auth", { p_project_ref: project })).toBeNull();
  await db.exec("delete from lean_private.observed_delivery_authorization"); await grant();
  await db.exec("begin isolation level repeatable read");
  expect(await query("select public.lean_observed_delivery_auth('xnfjdbpjuaezxjgargto') r")).toBeNull();
  await db.exec("rollback");
  await db.exec("update lean_private.pipeline_scope set until_time='2026-02-02',approval_ref='fixture:scope2'");
  expect(await rpc("lean_observed_delivery_auth", { p_project_ref: project })).toBeNull();
});
it("duration, route, manifest and bearer guards are fixed and closed by default", async () => {
  await grant();
  await expect(db.exec(`update lean_private.observed_delivery_authorization set revision=2,
    approval_ref='fixture:too-long',token_sha256=repeat('d',64),expires_at=not_before+interval '8 days'`)).rejects.toThrow();
  const manifest = readFileSync("docs/analytics/production-observed-posthog-manifest.json", "utf8");
  expect(hash(manifest)).toBe(observedDeliveryManifestHash);
  const document = JSON.parse(manifest);
  expect(document.resources).toHaveLength(6);
  expect(document.resources.every((r: { endpoint: { path: string } }) => r.endpoint.path === observedDeliveryPath)).toBe(true);
  const noCall = vi.fn<typeof fetch>(() => { throw new Error("unexpected_transport"); });
  expect((await productionObservedDeliveryGet(request(env.LEAN_PRODUCTION_REPORTS_SECRET), env, noCall)).status).toBe(401);
  expect((await productionObservedDeliveryGet(request(), { ...env, VERCEL_ENV: "preview" }, noCall)).status).toBe(404);
  expect(noCall).not.toHaveBeenCalled();
});
it("one shared abortable HTTP deadline stops a non-settling RPC without response/error disclosure", async () => {
  vi.useFakeTimers();
  const stalled = vi.fn<typeof fetch>(async (_url, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal); return new Promise(() => {});
  });
  const result = productionObservedDeliveryGet(request(), env, stalled);
  await vi.advanceTimersByTimeAsync(15001);
  const response = await result;
  expect(response.status).toBe(503); expect(await response.text()).toBe("");
  expect(stalled).toHaveBeenCalledTimes(1);
});
