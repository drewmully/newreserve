import { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { runSubscriptionRuntime } from "@/lib/analytics/subscriptionRuntime";
import { POST } from "@/app/api/analytics/subscriptions/process/route";
import { subscriptionReportGet, validSubscriptionReportPayload } from "@/lib/analytics/subscriptionReportDelivery";
const port = vi.hoisted(() => ({ client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => port.client }));
const project = "xnfjdbpjuaezxjgargto", shop = "mullybox-store.myshopify.com";
const token = "fixture-only-read-token-not-real", secret = "s".repeat(32);
const hash = createHash("sha256").update(token).digest("hex");
const policy = { definitionRef: "fixture:policy", countedStatuses: ["ACTIVE"], excludedStatuses: ["PAUSED","CANCELLED","EXPIRED"],
  deduplication: "identical_normalized_contract", subscriberBasis: "shopify_customer_id", renewalDays: 30, recurringValue: null };
let db: PGlite;
let calls: { name: string; args: Record<string, unknown> }[];
const client: AnalyticsRpcClient = { async rpc(name, args) {
  if (!["claim", "permit", "finish", "fail"].some(s => name === `lean_subscription_${s}` || name === `lean_subscription_scan_${s}`))
    throw new Error("invalid_test_rpc");
  calls.push({ name, args });
  const pairs = Object.entries(args);
  try {
    const result = await db.query<{ result: unknown }>(
      `select public.${name}(${pairs.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) result`,
      pairs.map(([, v]) => v !== null && typeof v === "object" ? JSON.stringify(v) : v));
    return { data: result.rows[0].result, error: null };
  } catch (error) { return { data: null, error }; }
} };
function source(more = false) {
  return new Response(JSON.stringify({ success: true, code: "SUCCESS", pageInfo: { hasNextPage: more, nextCursor: more ? "cursor" : null },
    data: [{ id: "123456789", status: "ACTIVE", customer: { shopifyId: "777777777", email: "never@example.invalid" },
      shippingAddress: { address1: "never persist address" }, currencyCode: "USD", isPrepaid: false,
      billingPolicy: { interval: "MONTH", intervalCount: 1 }, nextBillingDateEpoch: Math.floor(Date.now() / 1000) + 86400,
      updatedAt: new Date().toISOString(), lines: [{ price: "10.25", quantity: 2, attributes: ["private"] }] }],
  }), { headers: { "content-type": "application/json" } });
}
async function register(run = "fixture", enabled = true) {
  await db.query(`insert into lean_private.subscription_runs
    (run_id,project_ref,shop,token_sha256,binding_ref,approval_ref,traffic_approval_ref,actor_ref,policy,
      page_size,max_rows,max_bytes,enabled,expires_at) values($1,$2,$3,$4,'fixture:binding','fixture:approval',
      'fixture:traffic','fixture:actor',$5,5,5,100000,$6,clock_timestamp()+interval '1 day')`,
    [run, project, shop, hash, JSON.stringify(policy), enabled]);
}
const run = (fetcher: typeof fetch = vi.fn(async () => source()), rpcClient = client) =>
  runSubscriptionRuntime({ client: rpcClient, fetcher });
const report = async () => (await db.query<{ result: Record<string, unknown> }>(
  "select public.lean_subscription_report('fixture') result")).rows[0].result;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create role lean_posthog_reader;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role,lean_posthog_reader;`);
  await db.exec(readFileSync("sql/analytics/001_staging.sql", "utf8"));
  await db.exec(`alter default privileges in schema lean_private grant all on tables to anon,authenticated,service_role,lean_posthog_reader;
    alter default privileges in schema lean_private grant execute on functions to anon,authenticated,service_role,lean_posthog_reader;`);
  // Unknown default grantees must abort the whole migration, not leak owner reports.
  await db.exec(`create role unexpected_reader;
    alter default privileges in schema public grant execute on functions to unexpected_reader;`);
  await expect(db.exec(readFileSync("sql/analytics/048_subscription_snapshot.sql", "utf8")))
    .rejects.toThrow("unexpected subscription ACL");
  await db.exec(`rollback;
    alter default privileges in schema public revoke execute on functions from unexpected_reader;`);
  expect((await db.query<{ missing: string | null }>("select to_regclass('lean_private.subscription_runs') missing")).rows[0].missing).toBeNull();
  await db.exec(readFileSync("sql/analytics/048_subscription_snapshot.sql", "utf8"));
  await db.exec("alter default privileges in schema public grant execute on functions to unexpected_reader");
  await expect(db.exec(readFileSync("sql/analytics/049_subscription_scans.sql", "utf8"))).rejects.toThrow("unexpected subscription scan ACL");
  await db.exec("rollback; alter default privileges in schema public revoke execute on functions from unexpected_reader");
  expect((await db.query<{ missing: string | null }>("select to_regclass('lean_private.subscription_scan_plans') missing")).rows[0].missing).toBeNull();
  await db.exec(readFileSync("sql/analytics/049_subscription_scans.sql", "utf8"));
}, 30000);
beforeEach(async () => {
  calls = []; port.client = client;
  // Disposable local fixture only. No production connection exists in this suite.
  await db.exec(`truncate lean_private.subscription_report_delivery,lean_private.subscription_scan_plans,
    lean_private.subscription_gate,lean_private.subscription_runs;
    insert into lean_private.subscription_gate(singleton,enabled) values(true,true);
    insert into lean_private.subscription_report_delivery(singleton) values(true);`);
  await register();
  vi.stubGlobal("fetch", vi.fn(async () => source()));
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED", "true");
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_RUN_ID", "fixture");
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_PLAN_ID", "");
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_SHOP", shop);
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_LOOP_TOKEN", token);
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_SECRET", secret);
  vi.stubEnv("LEAN_ANALYTICS_PIPELINE_PROJECT_REF", project);
  vi.stubEnv("LEAN_ANALYTICS_SUPABASE_URL", `https://${project}.supabase.co`);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { await db?.close(); });

it("persists one private pseudonymous observation and owner status; all business metrics stay withheld", async () => {
  const fetcher = vi.fn(async () => source());
  expect(await run(fetcher)).toEqual({ state: "observation_saved" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const out = await report();
  expect(out).toMatchObject({ status: "observation_saved", scopeComplete: false, certified: false,
    targetBinding: "owner_attested_not_provider_verified" });
  for (const metric of Object.values(out.metrics as Record<string, unknown>))
    expect(metric).toMatchObject({ value: null, readiness: "withheld" });
  expect(out.observation).toMatchObject({ state: "pagination_ended", rows: [expect.objectContaining({ status: "ACTIVE",
    contractKey: expect.stringMatching(/^[a-f0-9]{64}$/), subscriberKey: expect.stringMatching(/^[a-f0-9]{64}$/) })] });
  for (const text of ["123456789","777777777","never@", "never persist", token])
    expect(JSON.stringify(out)).not.toContain(text);
  expect((await db.query("select * from lean_private.publications")).rows).toEqual([]);
});
it("stops after the first page even when more subscriptions exist", async () => {
  const fetcher = vi.fn(async () => source(true));
  expect(await run(fetcher)).toEqual({ state: "observation_saved" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await report()).observation).toMatchObject({ state: "page_limit", scopeComplete: false });
});
it("runs the actual write RPC path as service_role, but exposes data only to the owner", async () => {
  await db.exec("set role service_role");
  try { expect(await run()).toEqual({ state: "observation_saved" }); }
  finally { await db.exec("reset role"); }
  expect((await report()).selection).toEqual({ apiVersion: "2026-04", statusFilter: null,
    maxPages: 1, pageSize: 5, maxRows: 5, maxBytes: 100000 });
});
it.each(["bytes", "rows", "conflict", "missing-id"])("withholds the entire observation on source %s violation", async kind => {
  const data = await source().json();
  if (kind === "bytes") data.padding = "x".repeat(100001);
  if (kind === "rows") data.data = Array(6).fill(data.data[0]);
  if (kind === "conflict") data.data.push({ ...data.data[0], status: "PAUSED" });
  if (kind === "missing-id") delete data.data[0].id;
  const fetcher = vi.fn(async () => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } }));
  expect(await run(fetcher)).toEqual({ state: "failed" });
  expect((await report()).observation).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("has zero DB/source calls when disabled and no operational-token fallback", async () => {
  const fetcher = vi.fn();
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED", "false");
  expect(await run(fetcher)).toEqual({ state: "disabled" });
  expect(calls).toHaveLength(0); expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED", "true");
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_LOOP_TOKEN", "");
  vi.stubEnv("LOOP_ADMIN_API_TOKEN", token);
  await expect(run(fetcher)).rejects.toThrow("configuration");
  expect(calls).toHaveLength(0); expect(fetcher).not.toHaveBeenCalled();
});
it.each(["gate", "run", "project", "token"])("honors disabled/wrong %s binding with no provider call", async kind => {
  const fetcher = vi.fn();
  if (kind === "gate") await db.exec("update lean_private.subscription_gate set enabled=false");
  if (kind === "run") await db.exec("update lean_private.subscription_runs set enabled=false");
  if (kind === "project") {
    vi.stubEnv("LEAN_ANALYTICS_PIPELINE_PROJECT_REF", "b".repeat(20));
    vi.stubEnv("LEAN_ANALYTICS_SUPABASE_URL", `https://${"b".repeat(20)}.supabase.co`);
    await expect(run(fetcher)).rejects.toThrow("storage");
  } else {
    if (kind === "token") vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_LOOP_TOKEN", "another-wrong-fixture-token");
    expect(await run(fetcher)).toMatchObject({ state: kind === "token" ? "failed" : "disabled" });
  }
  expect(fetcher).not.toHaveBeenCalled();
  expect((await report()).observation).toBeNull();
});
it.each([401, 403, 429, 500])("stops on provider %i, persists no data, and never retries the failed run", async status => {
  const fetcher = vi.fn(async () => new Response("PRIVATE_TOKEN_AND_BODY", { status }));
  expect(await run(fetcher)).toEqual({ state: "failed" });
  expect((await report()).observation).toBeNull();
  expect(JSON.stringify(await report())).not.toContain("PRIVATE_TOKEN");
  await db.exec("update lean_private.subscription_gate set next_allowed_at='-infinity'");
  expect(await run(fetcher)).toEqual({ state: "attempts_exhausted" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not replay a committed finish after response loss; exact finish replay is idempotent", async () => {
  const fetcher = vi.fn(async () => source());
  const lost: AnalyticsRpcClient = { async rpc(name, args) {
    const result = await client.rpc(name, args);
    if (name === "lean_subscription_finish" && !result.error) throw new Error("lost response");
    return result;
  } };
  await expect(run(fetcher, lost)).rejects.toThrow("storage");
  expect(await run(fetcher)).toEqual({ state: "complete" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const finish = calls.find(c => c.name === "lean_subscription_finish")!;
  expect((await client.rpc(finish.name, finish.args)).data).toBe(true);
  const changed = { ...finish.args, p_payload: { ...(finish.args.p_payload as object), scopeComplete: true } };
  expect((await client.rpc(finish.name, changed)).error).toBeTruthy();
});
it("serializes workers across runs, fences expired tokens and reserves only one source request", async () => {
  await register("other");
  const a = { p_run: "fixture", p_project: project, p_token: randomUUID() };
  const b = { p_run: "other", p_project: project, p_token: randomUUID() };
  expect((await client.rpc("lean_subscription_claim", a)).data).toMatchObject({ state: "claimed" });
  expect((await client.rpc("lean_subscription_claim", b)).data).toMatchObject({ state: "busy" });
  expect((await client.rpc("lean_subscription_permit", a)).data).toBe(true);
  expect((await client.rpc("lean_subscription_permit", a)).data).toBe(false);
  await db.exec("update lean_private.subscription_gate set lease_until=clock_timestamp()-interval '1 second',next_allowed_at='-infinity'");
  expect((await client.rpc("lean_subscription_claim", b)).data).toMatchObject({ state: "claimed" });
  expect((await client.rpc("lean_subscription_permit", a)).data).toBe(false);
  expect((await client.rpc("lean_subscription_fail", a)).data).toBe(false);
});
it("honors kill switches between claim/permit and between source/finish", async () => {
  const fetcher = vi.fn(async () => source());
  const stop: AnalyticsRpcClient = { async rpc(name, args) {
    if (name === "lean_subscription_permit") await db.exec("update lean_private.subscription_gate set enabled=false");
    return client.rpc(name, args);
  } };
  expect(await run(fetcher, stop)).toEqual({ state: "failed" });
  expect(fetcher).not.toHaveBeenCalled();
  await db.exec("update lean_private.subscription_gate set enabled=true,next_allowed_at='-infinity'");
  await register("other"); vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_RUN_ID", "other");
  const stopFinish: AnalyticsRpcClient = { async rpc(name, args) {
    if (name === "lean_subscription_finish") await db.exec("update lean_private.subscription_runs set enabled=false where run_id='other'");
    return client.rpc(name, args);
  } };
  expect(await run(fetcher, stopFinish)).toEqual({ state: "lost_lease" });
  expect((await db.query("select payload from lean_private.subscription_runs where run_id='other'")).rows).toEqual([{ payload: null }]);
});
it.each(["extra-field", "raw-id", "money-metric", "completeness", "wrong-count"])(
  "rejects forged %s payload atomically at the DB boundary", async kind => {
    const wrapped: AnalyticsRpcClient = { async rpc(name, args) {
      if (name === "lean_subscription_finish") {
        const changed = structuredClone(args) as typeof args & { p_payload: {
          rows: Record<string, unknown>[]; evidence: { rawRows: number }; [k: string]: unknown } };
        if (kind === "extra-field") changed.p_payload.rows[0].email = "private@example.invalid";
        if (kind === "raw-id") changed.p_payload.rows[0].subscriberKey = "12345";
        if (kind === "money-metric") changed.p_payload.metrics = { mrr: 100 };
        if (kind === "completeness") changed.p_payload.scopeComplete = true;
        if (kind === "wrong-count") changed.p_payload.evidence.rawRows = 10;
        return client.rpc(name, changed);
      }
      return client.rpc(name, args);
    } };
    await expect(run(undefined, wrapped)).rejects.toThrow("storage");
    expect((await report()).observation).toBeNull();
    expect((await db.query("select completed_at from lean_private.subscription_runs")).rows).toEqual([{ completed_at: null }]);
  });
it("closes hosted default ACLs; service cannot read reports, rows, or register runs", async () => {
  for (const role of ["anon", "authenticated", "service_role", "lean_posthog_reader"]) {
    const row = (await db.query(`select
      has_table_privilege($1,'lean_private.subscription_runs','SELECT,INSERT,UPDATE,DELETE') as table_access,
      has_function_privilege($1,'public.lean_subscription_report(text)','EXECUTE') as report_access,
      has_function_privilege($1,'public.lean_subscription_claim(text,text,uuid)','EXECUTE') as claim_access`, [role])).rows[0];
    expect(row).toEqual({ table_access: false, report_access: false, claim_access: role === "service_role" });
  }
  await db.exec("set role service_role");
  await expect(db.query("select public.lean_subscription_report('fixture')")).rejects.toThrow(/permission denied/);
  await db.exec("reset role");
  await expect(db.exec("update lean_private.subscription_runs set max_rows=50")).rejects.toThrow("immutable");
});
it("exposes only authenticated, default-off, empty-body dispatch; no caller-supplied scope", async () => {
  const req = (suffix = "", body?: string, auth = secret) => new NextRequest(
    `https://fixture.invalid/api/analytics/subscriptions/process${suffix}`,
    { method: "POST", headers: { authorization: `Bearer ${auth}` }, ...(body ? { body } : {}) });
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED", "false");
  expect((await POST(req())).status).toBe(404);
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED", "true");
  expect((await POST(req("", undefined, "wrong"))).status).toBe(401);
  expect((await POST(req("?shop=other"))).status).toBe(400);
  expect((await POST(req("", "{}"))).status).toBe(400);
  expect(calls).toHaveLength(0);
  const response = await POST(req());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ state: "observation_saved" });
  expect(response.headers.get("cache-control")).toBe("no-store");
});

// Reuses the same disposable DB/RPC/source fixture. No second runtime harness.
async function plan(maxCycles = 2, maxPages = 3, maxRows = 10, maxBytes = 100000, countPolicy = policy, cadence = 300) {
  await db.query(`insert into lean_private.subscription_scan_plans
    (plan_id,project_ref,shop,token_sha256,binding_ref,approval_ref,traffic_approval_ref,retention_ref,actor_ref,policy,
      from_time,until_time,retain_until,cadence_seconds,max_cycles,max_pages,max_rows,max_bytes,page_size,enabled)
    values('scan-fixture',$1,$2,$3,'fixture:binding','fixture:approval','fixture:traffic','fixture:retention','fixture:actor',
      $4,clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days',
      $9,$5,$6,$7,$8,2,true)`, [project, shop, hash, JSON.stringify(countPolicy), maxCycles, maxPages, maxRows, maxBytes, cadence]);
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_RUN_ID", "");
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_PLAN_ID", "scan-fixture");
}
async function scanPage(id: string, next: string | null) {
  const body = await source().json();
  body.data[0].id = id; body.pageInfo = { hasNextPage: next !== null, nextCursor: next };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
const cooldown = () => db.exec("update lean_private.subscription_gate set next_allowed_at='-infinity'"); // Fixture clock only.
const scanReport = async () => (await db.query<{ result: Record<string, unknown> }>(
  "select public.lean_subscription_scan_report('scan-fixture') result")).rows[0].result;

it("resumes encrypted pages, enforces finite cadence, and reports observed cohort separately from withheld globals", async () => {
  await plan();
  const cursor = "private-provider-cursor-777777";
  const fetcher = vi.fn().mockImplementationOnce(() => scanPage("101", cursor))
    .mockImplementationOnce(() => scanPage("102", null)).mockImplementationOnce(() => scanPage("103", null));
  expect(await run(fetcher)).toEqual({ state: "observation_saved" });
  expect(JSON.stringify((await db.query("select * from lean_private.subscription_scan_plans")).rows)).not.toContain(cursor);
  await cooldown();
  expect(await run(fetcher)).toEqual({ state: "observation_saved" });
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get("afterCursor")).toBe(cursor);
  const first = await scanReport();
  expect(first).toMatchObject({ phase: "between_cycles", cycles: [expect.objectContaining({
    completedPages: 2, observedUniqueContractsInCapturedPages: 2, coverage: "captured_pages_only", terminal: "pagination_ended_unverified" })] });
  for (const metric of Object.values(first.metrics as Record<string, unknown>)) expect(metric).toMatchObject({ value: null, readiness: "withheld" });
  expect(await run(fetcher)).toEqual({ state: "waiting" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await db.exec("update lean_private.subscription_scan_plans set next_due=clock_timestamp()-interval '1 second'");
  await cooldown();
  expect(await run(fetcher)).toEqual({ state: "observation_saved" });
  expect(new URL(fetcher.mock.calls[2][0]).searchParams.has("afterCursor")).toBe(false);
  expect((await scanReport()).phase).toBe("completed");
  expect(await run(fetcher)).toEqual({ state: "completed" });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("commits page+progress atomically despite lost finish response; identical replay never advances twice", async () => {
  await plan(1);
  const fetcher = vi.fn().mockImplementationOnce(() => scanPage("101", "cursor-a")).mockImplementationOnce(() => scanPage("102", null));
  const lost: AnalyticsRpcClient = { async rpc(name, args) {
    const result = await client.rpc(name, args);
    if (name === "lean_subscription_scan_finish" && !result.error) throw new Error("lost private response");
    return result;
  } };
  await expect(run(fetcher, lost)).rejects.toThrow("storage");
  const prior = calls.find(c => c.name === "lean_subscription_scan_finish")!;
  expect((await client.rpc(prior.name, prior.args)).data).toBe(true);
  expect((await client.rpc(prior.name, { ...prior.args, p_fingerprint: "a".repeat(64) })).error).toBeTruthy();
  await cooldown();
  expect(await run(fetcher)).toEqual({ state: "observation_saved" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect((await scanReport()).cycles).toMatchObject([{ completedPages: 2, observedUniqueContractsInCapturedPages: 2 }]);
});
it("halts a failed scan without retrying the page or starting future cycles", async () => {
  await plan();
  const fetcher = vi.fn(async () => new Response("private", { status: 429 }));
  expect(await run(fetcher)).toEqual({ state: "failed" });
  await cooldown();
  expect(await run(fetcher)).toEqual({ state: "disabled" });
  expect(await scanReport()).toMatchObject({ phase: "halted", enabled: false, cycles: [] });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("stops at the immutable per-cycle page budget, never interprets the cut-off as complete", async () => {
  await plan(1, 1);
  const fetcher = vi.fn(() => scanPage("101", "more-cursor"));
  expect(await run(fetcher)).toEqual({ state: "observation_saved" });
  expect(await scanReport()).toMatchObject({ phase: "completed", scopeComplete: false, certified: false,
    cycles: [expect.objectContaining({ completedPages: 1, terminal: "budget_reached" })] });
  expect(await run(fetcher)).toEqual({ state: "completed" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects cross-page cursor cycles even though each ciphertext uses a fresh nonce", async () => {
  await plan(1, 4);
  const fetcher = vi.fn().mockImplementationOnce(() => scanPage("101", "cursor-a"))
    .mockImplementationOnce(() => scanPage("102", "cursor-b")).mockImplementationOnce(() => scanPage("103", "cursor-a"));
  await run(fetcher); await cooldown(); await run(fetcher); await cooldown();
  await expect(run(fetcher)).rejects.toThrow("storage");
  expect((await scanReport()).cycles).toMatchObject([{ completedPages: 2 }]);
  expect((await db.query<{ n: number }>("select count(*)::int n from lean_private.subscription_runs where payload is not null")).rows[0].n).toBe(2);
});
it("honors the plan kill switch before a permit and never grants service plan-registration/report access", async () => {
  await plan();
  const fetcher = vi.fn();
  const stop: AnalyticsRpcClient = { async rpc(name, args) {
    if (name === "lean_subscription_scan_permit") await db.exec("update lean_private.subscription_scan_plans set enabled=false");
    return client.rpc(name, args);
  } };
  expect(await run(fetcher, stop)).toEqual({ state: "failed" });
  expect(fetcher).not.toHaveBeenCalled();
  expect((await db.query("select enabled from lean_private.subscription_runs where run_id<>'fixture'")).rows).toEqual([{ enabled: false }]);
  for (const role of ["anon", "authenticated", "service_role", "lean_posthog_reader"]) {
    expect((await db.query(`select has_table_privilege($1,'lean_private.subscription_scan_plans','SELECT,INSERT,UPDATE,DELETE') t,
      has_function_privilege($1,'public.lean_subscription_scan_report(text)','EXECUTE') r`, [role])).rows[0]).toEqual({ t: false, r: false });
  }
  await expect(db.exec("update lean_private.subscription_scan_plans set max_pages=20")).rejects.toThrow("immutable");
});
it("halts an expired ambiguous claim instead of replaying a possibly sent page", async () => {
  await plan();
  const fetcher = vi.fn();
  const lost: AnalyticsRpcClient = { async rpc(name, args) {
    const out = await client.rpc(name, args);
    if (name === "lean_subscription_scan_claim" && !out.error) throw new Error("lost");
    return out;
  } };
  await expect(run(fetcher, lost)).rejects.toThrow("storage");
  await db.exec("update lean_private.subscription_gate set lease_until=clock_timestamp()-interval '1 second'");
  expect(await run(fetcher)).toEqual({ state: "halted" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("enforces total row and byte budgets across pages, not independently for every request", async () => {
  await plan(1, 20, 3);
  const first = await (await scanPage("101", "cursor-a")).json();
  first.data.push({ ...first.data[0], id: "102" });
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(first), { headers: { "content-type": "application/json" } }))
    .mockImplementationOnce(() => scanPage("103", "cursor-b"));
  await run(fetcher); await cooldown(); await run(fetcher);
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get("pageSize")).toBe("1");
  expect((await scanReport()).cycles).toMatchObject([{ completedPages: 2, observedUniqueContractsInCapturedPages: 3, terminal: "budget_reached" }]);
  expect(await run(fetcher)).toEqual({ state: "completed" });
});
it("fails a later over-budget body without losing earlier committed observations", async () => {
  const first = await (await scanPage("101", "cursor-a")).text();
  await plan(1, 20, 10, Buffer.byteLength(first) + 1);
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(first, { headers: { "content-type": "application/json" } }))
    .mockImplementationOnce(() => scanPage("102", null));
  await run(fetcher); await cooldown();
  expect(await run(fetcher)).toEqual({ state: "failed" });
  expect(await scanReport()).toMatchObject({ phase: "halted", cycles: [expect.objectContaining({
    completedPages: 1, observedUniqueContractsInCapturedPages: 1 })] });
});
it("executes finite child registration/collection as service_role without general table or report authority", async () => {
  await plan(1);
  await db.exec("set role service_role");
  try {
    expect(await run(() => scanPage("101", null))).toEqual({ state: "observation_saved" });
    await expect(db.query("select public.lean_subscription_scan_report('scan-fixture')")).rejects.toThrow(/permission denied/);
    await expect(db.query("update lean_private.subscription_scan_plans set enabled=true")).rejects.toThrow(/permission denied/);
  } finally { await db.exec("reset role"); }
  for (const suffix of ["claim(text,text,uuid)", "permit(text,text,text,uuid)", "finish(text,text,text,uuid,jsonb,boolean,text,text)", "fail(text,text,text,uuid)"]) {
    for (const role of ["anon", "authenticated", "service_role", "lean_posthog_reader"]) {
      const result = await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2,'EXECUTE') allowed",
        [role, "public.lean_subscription_scan_" + suffix]);
      expect(result.rows[0].allowed).toBe(role === "service_role");
    }
  }
});
it("counts an observed contract once across pages while flagging conflicting revisions, never certifying store totals", async () => {
  await plan(1);
  const second = await (await scanPage("101", null)).json(); second.data[0].status = "PAUSED";
  const fetcher = vi.fn().mockImplementationOnce(() => scanPage("101", "cursor-a"))
    .mockResolvedValueOnce(new Response(JSON.stringify(second), { headers: { "content-type": "application/json" } }));
  await run(fetcher); await cooldown(); await run(fetcher);
  const out = await scanReport();
  expect(out).toMatchObject({ historicalTrendsSupported: false, cycles: [expect.objectContaining({
    rawRowsCaptured: 2, observedUniqueContractsInCapturedPages: 1, revisionConflict: true, coverage: "captured_pages_only" })] });
  for (const metric of Object.values(out.metrics as Record<string, unknown>)) expect(metric).toMatchObject({ value: null });
});
it("refuses simultaneous legacy and plan selection before DB or source access", async () => {
  await plan();
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_RUN_ID", "fixture");
  const fetcher = vi.fn();
  await expect(run(fetcher)).rejects.toThrow("configuration");
  expect(calls).toHaveLength(0); expect(fetcher).not.toHaveBeenCalled();
});

// Report-only change: same injected source -> actual runtime/RPC -> owner report.
const captured = async () => (await scanReport()).cycles as {
  scanTraversal: string; paginationEnded: boolean; snapshotConsistency: string;
  capturedPageMetrics: Record<string, { value: unknown; readiness: string; reasons: string[] }>;
}[];
function metricPage(rows: Record<string, unknown>[], more = false) {
  return new Response(JSON.stringify({ success: true, code: "SUCCESS", data: rows,
    pageInfo: { hasNextPage: more, nextCursor: more ? "metric-next" : null } }),
  { headers: { "content-type": "application/json" } });
}
function contract(id: string, overrides: Record<string, unknown> = {}) {
  return { id, status: "ACTIVE", customer: { shopifyId: "777777777" },
    nextBillingDateEpoch: Math.floor(Date.now() / 1000) + 86400, updatedAt: "2026-09-30T00:00:00Z", ...overrides };
}
it("reports deduped captured active contracts/subscribers/renewals without exposing keys or promoting globals", async () => {
  await plan(1);
  const same = contract("101"), another = contract("102");
  await run(async () => metricPage([same, another], true)); await cooldown();
  await run(async () => metricPage([same, contract("103", { status: "PAUSED" })]));
  const out = await scanReport(), cycle = (await captured())[0];
  expect(cycle).toMatchObject({ scanTraversal: "all_returned_pages_traversed", paginationEnded: true,
    snapshotConsistency: "unverified", capturedPageMetrics: {
      observedActiveContractsInCapturedPages: { value: 2, readiness: "observed_unverified", reasons: [] },
      observedDistinctSubscribersInCapturedPages: { value: 1, readiness: "observed_unverified", reasons: [] },
      observedRenewingContractsInWindowInCapturedPages: { value: 2, reasons: [] },
    } });
  expect(Date.parse(String(cycle.capturedPageMetrics.observedNextRenewalAtInCapturedPages.value)))
    .toBe(same.nextBillingDateEpoch * 1000);
  for (const metric of Object.values(out.metrics as Record<string, unknown>))
    expect(metric).toMatchObject({ value: null, readiness: "withheld" });
  for (const forbidden of ["777777777", "contractKey", "subscriberKey", "nextCursor", "metric-next"])
    expect(JSON.stringify(out)).not.toContain(forbidden);
});
it.each(["missing-customer", "missing-renewal", "past-renewal", "revision-conflict"] as const)(
  "withholds only affected captured metrics for %s", async issue => {
    await plan(1);
    const row = contract("101", issue === "missing-customer" ? { customer: null } :
      issue === "missing-renewal" ? { nextBillingDateEpoch: null } :
        issue === "past-renewal" ? { nextBillingDateEpoch: 1700000000 } : {});
    await run(async () => metricPage([row], issue === "revision-conflict"));
    if (issue === "revision-conflict") {
      await cooldown(); await run(async () => metricPage([{ ...row, status: "PAUSED" }]));
    }
    const metrics = (await captured())[0].capturedPageMetrics;
    if (issue === "revision-conflict") {
      for (const metric of Object.values(metrics))
        expect(metric).toMatchObject({ value: null, readiness: "withheld", reasons: ["conflicting_contract_revisions"] });
    } else {
      expect(metrics.observedActiveContractsInCapturedPages.value).toBe(1);
      expect(metrics.observedDistinctSubscribersInCapturedPages.value).toBe(issue === "missing-customer" ? null : 1);
      expect(metrics.observedNextRenewalAtInCapturedPages.readiness).toBe(issue === "missing-customer" ? "observed_unverified" : "withheld");
      expect(metrics.observedRenewingContractsInWindowInCapturedPages.value).toBe(issue === "missing-customer" ? 1 : null);
    }
  });
it.each([false, true])("labels budget vs fully traversed empty result without confusing absence and zero (more=%s)", async more => {
  await plan(1, 1);
  expect(await captured()).toEqual([]); // Not collected is not a zero.
  await run(async () => metricPage(more ? [contract("101")] : [], more));
  const cycle = (await captured())[0];
  expect(cycle.scanTraversal).toBe(more ? "budget_limited" : "all_returned_pages_traversed");
  expect(cycle.paginationEnded).toBe(!more);
  expect(cycle.snapshotConsistency).toBe("unverified");
  expect(cycle.capturedPageMetrics.observedActiveContractsInCapturedPages.value).toBe(more ? 1 : 0);
  expect(cycle.capturedPageMetrics.observedNextRenewalAtInCapturedPages.readiness).toBe("observed_unverified");
  if (!more) expect(cycle.capturedPageMetrics.observedNextRenewalAtInCapturedPages.value).toBeNull();
});
it("does not label a different counted-status policy as observed active contracts", async () => {
  await plan(1, 3, 10, 100000, { ...policy, countedStatuses: ["PAUSED"], excludedStatuses: ["ACTIVE", "CANCELLED", "EXPIRED"] });
  await run(async () => metricPage([contract("101")]));
  for (const metric of Object.values((await captured())[0].capturedPageMetrics))
    expect(metric).toMatchObject({ value: null, readiness: "withheld", reasons: ["active_count_policy_unverified"] });
});

const deliveryEnv = { LEAN_SUBSCRIPTION_REPORTS_ENABLED: "true", LEAN_SUBSCRIPTION_REPORTS_SECRET: secret,
  VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project,
  LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`, LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture-only" };
const deliveryRequest = (suffix = "", bearer = secret) => new Request(`https://fixture.invalid/api/analytics/reports/subscriptions${suffix}`,
  { headers: { authorization: `Bearer ${bearer}` } });
async function deliveryRead() {
  await db.exec("set role service_role");
  try { return (await db.query<{ result: unknown }>("select public.lean_subscription_reports_read() result")).rows[0].result; }
  finally { await db.exec("reset role"); }
}
async function enableDelivery() {
  await db.exec(`update lean_private.subscription_report_delivery
    set enabled=true,plan_id='scan-fixture',approval_ref='fixture:aggregate-delivery'`);
}
it("delivers actual captured-page aggregates through fixed HTTP with only one new service read EXECUTE", async () => {
  expect(await deliveryRead()).toBeNull();
  await plan(1, 3, 10, 100000, policy, 86400); await enableDelivery();
  expect(await deliveryRead()).toEqual({ subscription_observations: [] });
  await run(async () => metricPage([contract("101")]));
  const data = await deliveryRead();
  expect(validSubscriptionReportPayload(data)).toBe(true);
  const transport = vi.fn(async (url, init) => {
    expect(url).toBe(`https://${project}.supabase.co/rest/v1/rpc/lean_subscription_reports_read`);
    expect(init).toMatchObject({ method: "POST", redirect: "error", body: "{}" });
    return new Response(JSON.stringify(await deliveryRead()));
  });
  const response = await subscriptionReportGet(deliveryRequest(), deliveryEnv, transport);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ subscription_observations: [{
    cycle: 1, observed_active_contracts: 1, observed_distinct_subscribers: 1,
    observed_renewing_contracts_in_window: 1, report_scope: "captured_pages_only",
    scan_traversal: "all_returned_pages_traversed", scope_complete: false, certified: false,
  }] });
  expect(transport).toHaveBeenCalledTimes(1);
  for (const forbidden of ['"101"', '"777777777"', "contractKey", "subscriberKey", "planId", "cursor", "approval", "Mrr", "Arr"])
    expect(JSON.stringify(data)).not.toContain(forbidden);
  for (const role of ["anon", "authenticated", "service_role", "lean_posthog_reader"]) {
    expect((await db.query(`select has_table_privilege($1,'lean_private.subscription_report_delivery','SELECT,INSERT,UPDATE,DELETE') t,
      has_function_privilege($1,'public.lean_subscription_reports_read()','EXECUTE') r`, [role])).rows[0])
      .toEqual({ t: false, r: role === "service_role" });
  }
  expect((await db.query<{ provolatile: string }>("select provolatile from pg_proc where oid='public.lean_subscription_reports_read()'::regprocedure")).rows[0].provolatile).toBe("s");
});
it("rejects delivery outside the explicit daily/seven-cycle plan and rejects expired retention", async () => {
  await plan(1); await enableDelivery(); await expect(deliveryRead()).rejects.toThrow("delivery scope");
  await db.exec("truncate lean_private.subscription_report_delivery,lean_private.subscription_scan_plans; insert into lean_private.subscription_report_delivery(singleton) values(true)");
  await plan(1, 3, 10, 100000, policy, 86400); await enableDelivery();
  // Fixture-only owner mutation with trigger disabled tests the expiry check, not registration.
  await db.exec(`alter table lean_private.subscription_scan_plans disable trigger subscription_scan_immutable;
    update lean_private.subscription_scan_plans set from_time=now()-interval '3 days',
      until_time=now()-interval '2 days',retain_until=now()-interval '1 day'`);
  await expect(deliveryRead()).rejects.toThrow("retention expired");
});
it("subscription delivery defaults off, rejects Preview/wrong bearer/queries/target before DB, and never falls back to sales flags", async () => {
  const transport = vi.fn();
  for (const env of [{}, { ...deliveryEnv, LEAN_SUBSCRIPTION_REPORTS_ENABLED: "false" },
    { ...deliveryEnv, VERCEL_ENV: "preview" }, { ...deliveryEnv, VERCEL_GIT_COMMIT_REF: "other" }])
    expect((await subscriptionReportGet(deliveryRequest(), env, transport)).status).toBe(404);
  expect((await subscriptionReportGet(deliveryRequest("", "wrong"), deliveryEnv, transport)).status).toBe(401);
  expect((await subscriptionReportGet(deliveryRequest("?plan=other"), deliveryEnv, transport)).status).toBe(400);
  expect((await subscriptionReportGet(deliveryRequest(), { ...deliveryEnv, LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "b".repeat(20) }, transport)).status).toBe(503);
  expect(transport).not.toHaveBeenCalled();
});
it("fails closed on aggregate PII/unknown fields, false completeness, missing amounts, oversize and database error bodies", async () => {
  await plan(1, 3, 10, 100000, policy, 86400); await enableDelivery();
  await run(async () => metricPage([contract("101", { customer: null })]));
  const data = await deliveryRead() as { subscription_observations: Record<string, unknown>[] };
  expect(data.subscription_observations[0].observed_distinct_subscribers).toBeNull();
  expect(validSubscriptionReportPayload(data)).toBe(true);
  for (const alteration of [{ contractKey: "private" }, { scope_complete: true }, { observed_active_contracts: undefined },
    { proposed_mrr: "10.00" }, { observed_next_renewal_at: "private-email" },
    { observed_active_contracts: null, observed_distinct_subscribers: 0, readiness: {
      observed_active_contracts: "withheld", observed_distinct_subscribers: "observed_unverified",
      observed_next_renewal_at: "observed_unverified", observed_renewing_contracts_in_window: "observed_unverified" } }]) {
    const changed = { subscription_observations: [{ ...data.subscription_observations[0], ...alteration }] };
    expect((await subscriptionReportGet(deliveryRequest(), deliveryEnv, async () => new Response(JSON.stringify(changed)))).status).toBe(503);
  }
  expect((await subscriptionReportGet(deliveryRequest(), deliveryEnv, async () => new Response("x".repeat(65537)))).status).toBe(503);
  const failed = await subscriptionReportGet(deliveryRequest(), deliveryEnv, async () => new Response("private-error", { status: 403 }));
  expect(failed.status).toBe(503); expect(await failed.text()).toBe("");
});
