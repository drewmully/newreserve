import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { collectPartitionRefresh, preparePartitionRefresh } from "@/lib/analytics/partitionRefresh";
import { registerPartitionRefresh } from "@/lib/analytics/partitionRegistration";
import { runRefreshPipeline } from "@/lib/analytics/refreshPipeline";
import { runFullPipeline } from "@/lib/analytics/fullPipeline";
import { canonicalJson, evidenceDigest } from "@/lib/analytics/evidenceIntake";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { partitionInput, partitionEnv } from "../fixtures/analyticsPartition";
import { partitionTransport } from "../fixtures/partition-collection-source.mjs";
let db: PGlite;
let fixture: Awaited<ReturnType<typeof collectPartitionRefresh>>;
const client: AnalyticsRpcClient = { async rpc(name, args) {
  if (!/^lean_(refresh|report|full|partition)_/.test(name)) throw new Error("unexpected_rpc");
  const entries = Object.entries(args);
  try {
    const result = await db.query<{ result: unknown }>(`select public.${name}(${
      entries.map(([key], i) => `${key}=>$${i + 1}`).join(",")}) result`,
    entries.map(([, value]) => typeof value === "object" ? JSON.stringify(value) : value));
    return { data: result.rows[0].result, error: null };
  } catch (error) { return { data: null, error }; }
} };
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const name of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs", "019_spend_jobs",
    "020_observed_report_jobs", "021_full_report_jobs", "022_full_release", "023_posthog_export",
    "024_full_orchestration", "025_refresh_queue", "027_history_update_scans", "034_commerce_only_refresh",
    "035_discovery_inventory_fence", "036_partitioned_refresh"])
    await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
  fixture = await collectPartitionRefresh(partitionInput(), partitionEnv, partitionTransport());
}, 30000);
beforeEach(async () => {
  vi.stubGlobal("fetch", () => { throw new Error("external_network_forbidden"); });
  await db.exec(`truncate lean_private.refresh_queue; truncate lean_private.full_builds cascade;
    truncate lean_private.report_builds cascade; truncate lean_private.publications cascade;
    truncate lean_private.spend_jobs; truncate lean_private.refresh_limits;`);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await db?.close(); });
const options = { client, projectRef: partitionEnv.LEAN_MULLY_SOURCE_PROJECT_REF,
  databaseUrl: `https://${partitionEnv.LEAN_MULLY_SOURCE_PROJECT_REF}.supabase.co`,
  shop: partitionEnv.LEAN_SHOPIFY_SHOP_DOMAIN, shopifyToken: "", posthogKey: "",
  googleClientId: "", googleClientSecret: "", googleRefreshToken: "" };
async function activate() {
  await db.exec(`insert into lean_private.refresh_limits(project_ref,enabled,max_daily_steps,approval_ref,actor_ref)
    values('${options.projectRef}',true,5,'fixture:approval','fixture:owner');
    update lean_private.refresh_queue set enabled=true;
    update lean_private.full_builds set enabled=true;
    update lean_private.report_builds set enabled=true;`);
}
const register = (r = fixture) => registerPartitionRefresh({ ...options, bundle: r.bundle, pages: r.sources.pages });
const step = (rpc = client) => runRefreshPipeline({ ...options, client: rpc, now: new Date().toISOString() });
async function noFull() {
  expect((await db.query("select count(*) n from lean_private.publications where publication_id like 'full:%'")).rows).toEqual([{ n: 0 }]);
  expect((await db.query("select count(*) n from lean_analytics.store_daily")).rows).toEqual([{ n: 0 }]);
}
it("collects >100 orders, stages hidden pages and runs the actual global base/full pipeline", async () => {
  const input = partitionInput(), r = await collectPartitionRefresh(input, partitionEnv, partitionTransport());
  expect(r.sources.pages).toHaveLength(21);
  expect(r.bundle.base.policy.partitionInventory.children.map(c => c.inventory.orders.length)).toEqual([100, 1]);
  expect(preparePartitionRefresh(JSON.parse(JSON.stringify(r.refresh)))).toEqual(r.bundle);
  await db.query("select public.lean_refresh_register($1)", [JSON.stringify(r.bundle)]);
  await expect(registerPartitionRefresh({ ...options, bundle: r.bundle, pages: r.sources.pages }))
    .resolves.toMatchObject({ enabled: false, published: false });
  expect((await db.query("select count(*) n from lean_private.publications")).rows).toEqual([{ n: 0 }]);
  expect((await db.query("select count(*) n from lean_private.history_jobs")).rows).toEqual([{ n: 0 }]);
  await activate();
  expect(await runRefreshPipeline({ ...options, now: new Date().toISOString() })).toMatchObject({ state: "partial" });
  expect(await runRefreshPipeline({ ...options, now: new Date().toISOString() })).toMatchObject({ state: "complete" });
  const orders = (await db.query<{ customer_id: string }>("select * from lean_private.orders where publication_id like 'full:%'")).rows;
  expect(orders).toHaveLength(101);
  expect(new Set(orders.map(o => o.customer_id))).toEqual(new Set(["customer-fixture"]));
  expect((await db.query("select count(*) n from lean_private.customers where publication_id like 'full:%'")).rows).toEqual([{ n: 1 }]);
  const ledger = (await db.query<{ source_amount: string }>("select source_amount from lean_private.sales_ledger where publication_id like 'full:%' and movement_kind='refund'")).rows;
  expect(ledger.map(r => r.source_amount)).toEqual(expect.arrayContaining(["-9.000000", "-1.000000"]));
  expect((await db.query("select count(*) n from lean_analytics.store_daily")).rows).toEqual([{ n: 0 }]);
  expect((await db.query("select count(*) n from lean_private.publications")).rows).toEqual([{ n: 2 }]); // ONE global base + full; no children.
}, 120000);

it("stages only disabled immutable pages; equal concurrent submissions serialize without duplicate rows", async () => {
  await db.query("select public.lean_refresh_register($1)", [JSON.stringify(fixture.bundle)]);
  const p = fixture.sources.pages[0];
  const args = { p_run: fixture.bundle.base.runId, p_project_ref: options.projectRef,
    p_child: p.child, p_number: p.number, p_payload: p.payload };
  const responses = await Promise.all([client.rpc("lean_partition_stage_page", args), client.rpc("lean_partition_stage_page", args)]);
  expect(responses.map(r => r.data)).toEqual([true, true]);
  expect((await db.query("select count(*) n from lean_private.partition_pages")).rows).toEqual([{ n: 1 }]);
  for (const sql of [
    "update lean_private.partition_pages set payload='[]'",
    "delete from lean_private.partition_pages",
    "update lean_private.report_builds set policy=policy-'partitionInventory'",
    "update lean_private.full_builds set evidence='{}'",
    "update lean_private.refresh_queue set expires_at=expires_at+interval '1 hour'",
  ]) await expect(db.exec(sql)).rejects.toThrow("immutable");
  for (const mutation of [{ p_payload: p.payload.replace('"SKU"', '"TAMPER"') }, { p_number: 19 }, { p_child: "extra" }])
    expect((await client.rpc("lean_partition_stage_page", { ...args, ...mutation })).error).toBeTruthy();
  await activate();
  expect((await client.rpc("lean_partition_stage_page", args)).error).toBeTruthy();
  expect(await step()).toMatchObject({ state: "blocked" });
  await noFull();
});
it("stages the actual CLI's files through the explicit owner helper without auto-enabling", async () => {
  const root = mkdtempSync(join(tmpdir(), "partition-register-cli-")), path = join(root, "input.json"), out = join(root, "out");
  try {
    writeFileSync(path, JSON.stringify(partitionInput()));
    const result = spawnSync(process.execPath, ["--import", resolve("tests/fixtures/partition-cli-preload.mjs"),
      resolve("scripts/analytics/prepare-refresh.mjs"), "--collect-sources", path, out],
    { encoding: "utf8", env: { ...process.env, ...partitionEnv, NODE_ENV: "test" }, timeout: 120000 });
    expect(result.stderr).toBe(""); expect(result.status).toBe(0);
    const bundle = JSON.parse(readFileSync(join(out, "refresh-bundle.json"), "utf8"));
    const { pages } = JSON.parse(readFileSync(join(out, "collected-sources.json"), "utf8"));
    expect(await registerPartitionRefresh({ ...options, bundle, pages })).toMatchObject({ state: "registered_disabled", pages: 21 });
    expect((await db.query(`select enabled from lean_private.report_builds
      union all select enabled from lean_private.full_builds
      union all select enabled from lean_private.refresh_queue`)).rows).toEqual([{ enabled: false }, { enabled: false }, { enabled: false }]);
    expect((await db.query("select count(*) n from lean_private.publications")).rows).toEqual([{ n: 0 }]);
    expect(await step()).toMatchObject({ state: "disabled" });
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120000);
it("rejects missing last child page and never exposes partial reports", async () => {
  await db.query("select public.lean_refresh_register($1)", [JSON.stringify(fixture.bundle)]);
  for (const p of fixture.sources.pages.slice(0, -1)) {
    const result = await client.rpc("lean_partition_stage_page", { p_run: fixture.bundle.base.runId,
      p_project_ref: options.projectRef, p_child: p.child, p_number: p.number, p_payload: p.payload });
    expect(result.error).toBeNull();
  }
  await activate();
  expect((await client.rpc("lean_report_inputs", { p_run: fixture.bundle.base.runId, p_project_ref: options.projectRef })).data)
    .toMatchObject({ state: "blocked" });
  expect(await step()).toMatchObject({ state: "blocked" });
  expect((await db.query("select count(*) n from lean_private.publications")).rows).toEqual([{ n: 0 }]);
  await noFull();
});
it("compares actual payload bytes to manifest, and the consumer rejects an unchanged-head transport tamper", async () => {
  await register(); await activate();
  const args = { p_run: fixture.bundle.base.runId, p_project_ref: options.projectRef };
  expect((await client.rpc("lean_partition_page", { ...args, p_child: "first", p_number: 0, p_input_hash: "changed" })).error).toBeTruthy();
  const tampered: AnalyticsRpcClient = { async rpc(name, args) {
    const result = await client.rpc(name, args);
    if (name === "lean_partition_page") {
      const data = result.data as { payload: string }; data.payload = data.payload.replace('"SKU"', '"TAMPER"');
    }
    return result;
  } };
  await expect(step(tampered)).rejects.toThrow("refresh_step_ambiguous");
  expect((await db.query("select count(*) n from lean_private.publications")).rows).toEqual([{ n: 0 }]);
});
it.each(["new", "revised", "duplicated"] as const)("database rejects rehashed %s IDs/revisions, even if the owner bypasses the helper", async mode => {
  const r = structuredClone(fixture), page = r.sources.pages[0], rows = JSON.parse(page.payload);
  if (mode === "new") rows[0].source.commerce.order.id = "gid://shopify/Order/999";
  if (mode === "revised") rows[0].source.commerce.order.updatedAt = "2026-01-04T00:00:00Z";
  if (mode === "duplicated") rows[0] = rows[1];
  rows[0].evidenceRef = `partition-source:sha256:${evidenceDigest(rows[0].source)}`;
  page.payload = canonicalJson(rows);
  const m = r.refresh.manifest;
  Object.assign(m.children[0].pages[0], { bytes: Buffer.byteLength(page.payload), digest: evidenceDigest(rows) });
  const { digest: ignored, ...body } = m; void ignored; m.digest = evidenceDigest(body);
  r.bundle = preparePartitionRefresh(r.refresh);
  await db.query("select public.lean_refresh_register($1)", [JSON.stringify(r.bundle)]);
  const result = await client.rpc("lean_partition_stage_page", { p_run: r.bundle.base.runId,
    p_project_ref: options.projectRef, p_child: page.child, p_number: page.number, p_payload: page.payload });
  if (mode !== "duplicated") expect(result.error).toBeTruthy();
  else {
    expect(result.error).toBeNull();
    for (const p of r.sources.pages.slice(1)) expect((await client.rpc("lean_partition_stage_page", {
      p_run: r.bundle.base.runId, p_project_ref: options.projectRef, p_child: p.child, p_number: p.number, p_payload: p.payload })).error).toBeNull();
    await activate();
    expect((await client.rpc("lean_report_inputs", { p_run: r.bundle.base.runId, p_project_ref: options.projectRef })).error).toBeTruthy();
  }
  await noFull();
});
it.each([false, true])("database globally dedupes exact cross-child source but rejects conflict=%s", async conflict => {
  const r = structuredClone(fixture), m = r.refresh.manifest;
  const child = structuredClone(m.children[1]); child.id = "overlap"; m.children.push(child);
  const page = { ...r.sources.pages.at(-1)!, child: "overlap" };
  if (conflict) {
    const rows = JSON.parse(page.payload); rows[0].source.commerce.order.cartToken = "conflicting";
    rows[0].evidenceRef = `partition-source:sha256:${evidenceDigest(rows[0].source)}`;
    page.payload = canonicalJson(rows);
    Object.assign(child.pages[0], { bytes: Buffer.byteLength(page.payload), digest: evidenceDigest(rows) });
  }
  r.sources.pages.push(page); m.owners["gid://shopify/Order/101"] = "overlap";
  const { digest: ignored, ...body } = m; void ignored; m.digest = evidenceDigest(body);
  r.bundle = preparePartitionRefresh(r.refresh);
  await db.query("select public.lean_refresh_register($1)", [JSON.stringify(r.bundle)]);
  for (const p of r.sources.pages) expect((await client.rpc("lean_partition_stage_page", {
    p_run: r.bundle.base.runId, p_project_ref: options.projectRef, p_child: p.child, p_number: p.number, p_payload: p.payload })).error).toBeNull();
  await activate();
  if (conflict) {
    expect((await client.rpc("lean_report_inputs", { p_run: r.bundle.base.runId, p_project_ref: options.projectRef })).error).toBeTruthy();
    await noFull();
  } else {
    await step(); await step();
    expect((await db.query("select count(*) n from lean_private.orders where publication_id like 'full:%'")).rows).toEqual([{ n: 101 }]);
  }
});
it.each(["base", "full"] as const)("rechecks the kill switch at %s commit and leaves no selected report", async stage => {
  await register(); await activate();
  if (stage === "full") await step();
  const killer: AnalyticsRpcClient = { async rpc(name, args) {
    if (name === (stage === "base" ? "lean_report_finish" : "lean_full_finish"))
      await db.exec("update lean_private.refresh_limits set enabled=false");
    return client.rpc(name, args);
  } };
  if (stage === "base") expect(await step(killer)).toMatchObject({ state: "changed" });
  else await expect(step(killer)).rejects.toThrow("refresh_step_ambiguous");
  await noFull();
});
it.each(["overflow", "rollback"] as const)("rejects %s in final global transaction without partial full facts", async mode => {
  await register(); await activate(); await step();
  const breaker: AnalyticsRpcClient = { async rpc(name, args) {
    if (name === "lean_full_finish") {
      if (mode === "overflow") (args.p_facts as { orders: unknown[] }).orders = Array(10001).fill((args.p_facts as { orders: unknown[] }).orders[0]);
      else (args.p_reports as { store_daily: { shop_id: string }[] }).store_daily[0].shop_id = "wrong.myshopify.com";
    }
    return client.rpc(name, args);
  } };
  await expect(step(breaker)).rejects.toThrow("refresh_step_ambiguous");
  await noFull();
  expect((await db.query("select count(*) n from lean_private.orders where publication_id like 'full:%'")).rows).toEqual([{ n: 0 }]);
  expect((await db.query("select completed_at from lean_private.full_builds")).rows).toEqual([{ completed_at: null }]);
});
it("equal completed replay is no-op; changed result and source revision cannot replay over it", async () => {
  await register(); await activate();
  const recording = { rpc: vi.fn(client.rpc) };
  await step(recording); await step(recording);
  for (const name of ["lean_report_finish", "lean_full_finish"]) {
    const args = recording.rpc.mock.calls.find(([n]) => n === name)![1];
    expect((await client.rpc(name, args)).data).toBe(true);
    const changed = structuredClone(args); (changed.p_facts as { orders: unknown[] }).orders = [];
    expect((await client.rpc(name, changed)).error).toBeTruthy();
  }
  const p = fixture.sources.pages[0];
  expect((await client.rpc("lean_partition_stage_page", { p_run: fixture.bundle.base.runId,
    p_project_ref: options.projectRef, p_child: p.child, p_number: p.number, p_payload: p.payload })).error).toBeTruthy();
  expect((await db.query("select count(*) n from lean_private.publications")).rows).toEqual([{ n: 2 }]);
});
it("expired parent cannot stage or commit a full candidate after an earlier successful base", async () => {
  const r = structuredClone(fixture);
  r.refresh.refresh.expiresAt = r.refresh.manifest.expiresAt = new Date(Date.now() + 5000).toISOString();
  const { digest: ignored, ...body } = r.refresh.manifest; void ignored; r.refresh.manifest.digest = evidenceDigest(body);
  r.bundle = preparePartitionRefresh(r.refresh);
  await register(r); await activate();
  // Model a previously claimed run entering its last five seconds. The queue
  // normally refuses *new* claims inside 90 seconds; do not weaken that guard.
  await db.exec(`update lean_private.refresh_queue set lease_token='00000000-0000-4000-8000-000000000001',
    lease_until=clock_timestamp()+interval '120 seconds'`);
  expect(await runFullPipeline({ ...options, runId: r.bundle.runId, now: new Date().toISOString() }))
    .toMatchObject({ state: "partial" });
  const delayed: AnalyticsRpcClient = { async rpc(name, args) {
    if (name === "lean_full_finish") await new Promise(resolve => setTimeout(resolve,
      Math.max(1, Date.parse(r.refresh.manifest.expiresAt) - Date.now() + 20)));
    return client.rpc(name, args);
  } };
  await expect(runFullPipeline({ ...options, client: delayed, runId: r.bundle.runId, now: new Date().toISOString() }))
    .rejects.toThrow();
  await expect(db.query("select public.lean_refresh_register($1)", [JSON.stringify(r.bundle)])).rejects.toThrow();
  await db.exec("update lean_private.report_builds set enabled=false; update lean_private.full_builds set enabled=false; update lean_private.refresh_queue set enabled=false");
  const p = r.sources.pages[0];
  expect((await client.rpc("lean_partition_stage_page", { p_run: r.bundle.base.runId,
    p_project_ref: options.projectRef, p_child: p.child, p_number: p.number, p_payload: p.payload })).error).toBeTruthy();
  await noFull();
}, 15000);
it("grants only runtime reads/finish, never registration, staging, direct pages or legacy bypasses", async () => {
  expect((await db.query(`select r,has_function_privilege(r,'public.lean_partition_page(text,text,text,integer,text)','execute') runtime,
    has_function_privilege(r,'public.lean_partition_stage_page(text,text,text,integer,text)','execute') stage,
    has_function_privilege(r,'public.lean_refresh_register(jsonb)','execute') register,
    has_function_privilege(r,'public.lean_full_finish_ordinary(text,text,uuid,text,jsonb,jsonb,jsonb)','execute') bypass,
    has_table_privilege(r,'lean_private.partition_pages','insert,update,delete,select') direct
    from unnest(array['anon','authenticated','service_role','lean_posthog_reader']) r`)).rows)
    .toEqual(["anon", "authenticated", "service_role", "lean_posthog_reader"].map(r =>
      ({ r, runtime: r === "service_role", stage: false, register: false, bypass: false, direct: false })));
});
it.each(["payload", "binding", "capture", "lineage"] as const)("rejects tampered %s evidence with unchanged manifest/header seal", async mode => {
  const bundle = structuredClone(fixture.bundle);
  if (mode === "payload") bundle.full.evidence.proofs = [];
  if (mode === "binding") bundle.evidenceBindings[0].approvalRef = "different-approval";
  if (mode === "capture") bundle.lineage[0].capturedAt = new Date().toISOString();
  if (mode === "lineage") bundle.lineage[0] = bundle.lineage[1];
  await expect(registerPartitionRefresh({ ...options, bundle, pages: fixture.sources.pages })).rejects.toThrow();
  await expect(db.query("select public.lean_refresh_register($1)", [JSON.stringify(bundle)])).rejects.toThrow();
  expect((await db.query("select count(*) n from lean_private.refresh_queue")).rows).toEqual([{ n: 0 }]);
});
