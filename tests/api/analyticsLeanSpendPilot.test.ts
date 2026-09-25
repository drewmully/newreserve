import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { advanceGoogleSpendPilot, boundedGooglePilotFetch } from "@/lib/analytics/googleSpendPilot";
import { POST } from "@/app/api/analytics/ingest/spend/advance/route";
import { spendPilotScope, spendPilotProject as project, spendPilotBase, spendPilotClient,
  spendPilotFetch, spendPilotAccount } from "../fixtures/analyticsSpendPilot";
const port = vi.hoisted(() => ({ client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => port.client }));
let db: PGlite, scope: ReturnType<typeof spendPilotScope>;
const client = spendPilotClient((sql, params) => db.query(sql, params));
const options = () => ({ client, projectRef: project, databaseUrl: `https://${project}.supabase.co`,
  pilotId: scope.pilotId, auth: { mode: "oauth_refresh" as const, clientId: "fixture", clientSecret: "fixture", refreshToken: "fixture" },
  now: new Date().toISOString(), signal: AbortSignal.timeout(10000) });
const call = async (name: string, input: Record<string, unknown>) => {
  const r = await client.rpc(name, input); if (r.error) throw r.error; return r.data;
};
const claim = (runId = scope.days[0].runId, token = randomUUID()) =>
  call("lean_spend_claim", { p_run: runId, p_project_ref: project, p_token: token });
const enable = () => db.exec("update lean_private.spend_pilots set enabled=true; update lean_private.spend_jobs set enabled=true");
const register = (value = scope) => db.query("select public.lean_spend_pilot_register($1::jsonb)", [JSON.stringify(value)]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema lean_private; create role service_role; create role anon; create role authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const migration of ["019_spend_jobs", "038_google_spend_pilot"])
    await db.exec(readFileSync(`sql/analytics/${migration}.sql`, "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec("truncate lean_private.spend_pilot_days,lean_private.spend_pilots,lean_private.spend_jobs");
  scope = spendPilotScope(); await register(); port.client = client;
  vi.stubGlobal("fetch", () => { throw new Error("external_network_forbidden"); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { await db?.close(); });

it("registers disabled atomically and has no runtime registration or ordinary bypass grant", async () => {
  expect(await advanceGoogleSpendPilot(options())).toEqual({ state: "disabled" });
  for (const fn of ["lean_spend_pilot_register(jsonb)", "lean_spend_claim_019(text,text,uuid)",
    "lean_spend_finish_019(text,text,uuid,jsonb)"]) {
    const result = await db.query<{ allowed: boolean }>("select has_function_privilege('service_role',$1,'execute') allowed", [`public.${fn}`]);
    expect(result.rows[0].allowed).toBe(false);
  }
  expect((await db.query("select attempts,base,enabled from lean_private.spend_jobs")).rows)
    .toEqual([{ attempts: 0, base: null, enabled: false }, { attempts: 0, base: null, enabled: false }]);
});
it("rejects scope mutation, duplicate registration and over-seven manifests without partial jobs", async () => {
  await expect(register()).rejects.toThrow();
  await expect(db.exec("update lean_private.spend_pilots set account_id='9999999999'")).rejects.toThrow("immutable");
  await expect(db.exec("delete from lean_private.spend_pilot_days")).rejects.toThrow("immutable");
  await expect(register({ ...scope, pilotId: "overflow", days: Array(8).fill(scope.days[0]) })).rejects.toThrow("invalid pilot days");
  await expect(register({ ...scope, pilotId: "partial", days: [{ ...scope.days[0], runId: "new" },
    { ...scope.days[1], runId: "another", date: scope.days[0].date }] })).rejects.toThrow("day order");
  expect((await db.query("select run_id from lean_private.spend_jobs")).rows).toHaveLength(2);
});
it("rejects malformed, unknown, backwards, expired or over-budget configuration", async () => {
  for (const overrides of [{ expiresAt: new Date(Date.now() - 1000).toISOString() }, { maxPages: 6 },
    { expiresAt: new Date(Date.now() + 3600000).toISOString().replace("Z", "") },
    { days: [...scope.days].reverse() }, { enabled: true }, { days: [] },
    { days: [{ ...scope.days[0], dueAt: "2020-01-01T00:00:00Z" }] }]) {
    await expect(register({ ...scope, ...overrides, pilotId: "invalid" })).rejects.toThrow();
  }
});
it("imports an actual saved due date, retains it once and stops before the next date", async () => {
  await enable();
  const fetcher = vi.fn(spendPilotFetch(scope.days[0].date));
  expect(await advanceGoogleSpendPilot({ ...options(), fetcher })).toEqual({ state: "complete", rows: 1 });
  expect(await advanceGoogleSpendPilot({ ...options(), fetcher })).toEqual({ state: "not_due" });
  expect(await claim()).toEqual({ state: "complete" });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect((await db.query<{ base: unknown }>("select base from lean_private.spend_jobs where run_id='fixture:day1'")).rows[0].base)
    .toMatchObject({ accountId: spendPilotAccount, rows: [{ costMicros: "1234567" }] });
});
it("advances to a later due date without redeployment, but direct claims cannot skip unfinished days", async () => {
  await db.exec("truncate lean_private.spend_pilot_days,lean_private.spend_pilots,lean_private.spend_jobs");
  scope = spendPilotScope(true); await register(); await enable();
  expect(await claim(scope.days[1].runId)).toEqual({ state: "disabled" });
  for (const day of scope.days)
    expect(await advanceGoogleSpendPilot({ ...options(), fetcher: spendPilotFetch(day.date) })).toEqual({ state: "complete", rows: 1 });
  const fetcher = vi.fn();
  expect(await advanceGoogleSpendPilot({ ...options(), fetcher })).toEqual({ state: "complete" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("source failures stop after one attempt and prevent advancing or direct retries", async () => {
  await enable();
  const fetcher = vi.fn<typeof fetch>(async () => new Response("private", { status: 403 }));
  expect(await advanceGoogleSpendPilot({ ...options(), fetcher })).toEqual({ state: "failed" });
  expect(await advanceGoogleSpendPilot({ ...options(), fetcher })).toEqual({ state: "blocked" });
  expect(await claim()).toEqual({ state: "attempts_exhausted" });
  expect(await claim(scope.days[1].runId)).toEqual({ state: "disabled" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("honors disabled child, wrong project/DB, unknown pilot and aborted deadline before reads", async () => {
  await db.exec("update lean_private.spend_pilots set enabled=true");
  expect(await advanceGoogleSpendPilot(options())).toEqual({ state: "disabled" });
  await expect(advanceGoogleSpendPilot({ ...options(), databaseUrl: "https://wrong.supabase.co" })).rejects.toThrow();
  await expect(advanceGoogleSpendPilot({ ...options(), pilotId: "missing" })).rejects.toThrow();
  await expect(advanceGoogleSpendPilot({ ...options(), signal: AbortSignal.abort() })).rejects.toThrow();
  await expect(call("lean_spend_pilot_next", { p_pilot: scope.pilotId, p_project_ref: "b".repeat(20) })).rejects.toThrow();
});
it("fences wrong token and kill during collection without a retained base", async () => {
  await enable();
  const token = randomUUID(); await claim(undefined, token);
  const finish = (t: string) => call("lean_spend_finish", { p_run: scope.days[0].runId, p_project_ref: project,
    p_token: t, p_base: spendPilotBase(scope.days[0].runId, scope.days[0].date) });
  expect(await finish(randomUUID())).toBe(false);
  await db.exec("update lean_private.spend_pilots set enabled=false");
  expect(await finish(token)).toBe(false);
  expect((await db.query("select base from lean_private.spend_jobs")).rows).toEqual([{ base: null }, { base: null }]);
});
it("preserves three-attempt ordinary saved jobs rather than changing019 semantics", async () => {
  await db.query(`insert into lean_private.spend_jobs
    (run_id,project_ref,account_id,report_date,max_pages,approval_ref,actor_ref,enabled)
    values('ordinary',$1,'1234567890','2026-01-01',10,'fixture','fixture',true)`, [project]);
  for (let i = 0; i < 3; i++) {
    const token = randomUUID();
    expect(await claim("ordinary", token)).toMatchObject({ state: "claimed" });
    expect(await call("lean_spend_fail", { p_run: "ordinary", p_project_ref: project, p_token: token })).toBe(true);
  }
  expect(await claim("ordinary")).toEqual({ state: "attempts_exhausted" });
});
it.each(["oauth_refresh", "service_account"])("actual HTTP %s route is default-off, authenticated, fixed-scope, and reuses the saved-job consumer", async mode => {
  const request = (suffix = "", auth = "x".repeat(32), body?: string) => new NextRequest(
    `https://fixture.invalid/api/analytics/ingest/spend/advance${suffix}`,
    { method: "POST", headers: { authorization: `Bearer ${auth}` }, ...(body ? { body } : {}) });
  expect((await POST(request())).status).toBe(404);
  vi.stubEnv("LEAN_ANALYTICS_SPEND_PILOT_ENABLED", "true");
  expect((await POST(request())).status).toBe(503);
  vi.stubEnv("LEAN_ANALYTICS_SPEND_PILOT_SECRET", "x".repeat(32));
  expect((await POST(request("", "wrong"))).status).toBe(401);
  expect((await POST(request("?date=2026-01-01"))).status).toBe(400);
  expect((await POST(request("", "x".repeat(32), "{}"))).status).toBe(400);
  for (const [key, value] of Object.entries({
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
    LEAN_ANALYTICS_SPEND_PILOT_ID: scope.pilotId, LEAN_GOOGLE_ADS_OAUTH_CLIENT_ID: "fixture",
    LEAN_GOOGLE_ADS_OAUTH_CLIENT_SECRET: "fixture", LEAN_GOOGLE_ADS_REFRESH_TOKEN: "fixture",
  })) vi.stubEnv(key, value);
  vi.stubEnv("LEAN_GOOGLE_ADS_AUTH_MODE", mode);
  if (mode === "service_account") {
    const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
    vi.stubEnv("LEAN_GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64", Buffer.from(JSON.stringify({
      client_email: "fixture@fixture.iam.gserviceaccount.com", private_key: privateKey,
    })).toString("base64"));
    vi.stubEnv("LEAN_GOOGLE_ADS_DEVELOPER_TOKEN", "fixture:developer");
  }
  const fetcher = vi.fn(spendPilotFetch(scope.days[0].date)); vi.stubGlobal("fetch", fetcher); await enable();
  expect(await (await POST(request())).json()).toEqual({ state: "complete", rows: 1 });
  expect(await (await POST(request())).json()).toEqual({ state: "not_due" });
  vi.stubEnv("LEAN_ANALYTICS_SUPABASE_URL", "https://wrong.supabase.co");
  expect((await POST(request())).status).toBe(503);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("rejects pagination overflow as failed, not empty or retriable", async () => {
  await enable();
  let pages = 0;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fixture", token_type: "Bearer" });
    const query = JSON.parse(String(init?.body)).query;
    if (query.includes("FROM customer")) return Response.json({
      results: [{ customer: { id: spendPilotAccount, timeZone: "America/New_York", currencyCode: "USD" } }],
    });
    return Response.json({ fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions",
      results: [{ campaign: { id: String(++pages) }, segments: { date: scope.days[0].date }, metrics: { costMicros: "1" } }],
      nextPageToken: `fixture:${pages}` });
  });
  expect(await advanceGoogleSpendPilot({ ...options(), fetcher })).toEqual({ state: "failed" });
  expect(fetcher).toHaveBeenCalledTimes(7);
  expect(await advanceGoogleSpendPilot({ ...options(), fetcher })).toEqual({ state: "blocked" });
  expect((await db.query("select base from lean_private.spend_jobs")).rows).toEqual([{ base: null }, { base: null }]);
});
it("does not retry a lost finish response even when the invocation then expires", async () => {
  await enable();
  const controller = new AbortController();
  const rpc = vi.fn<AnalyticsRpcClient["rpc"]>(async (name, args) => {
    const result = await client.rpc(name, args);
    if (name === "lean_spend_finish") { controller.abort(); throw new Error("lost_response"); }
    return result;
  });
  const fetcher = vi.fn(spendPilotFetch(scope.days[0].date));
  await expect(advanceGoogleSpendPilot({ ...options(), client: { rpc }, fetcher, signal: controller.signal })).rejects.toThrow("storage_unavailable");
  expect(rpc.mock.calls.filter(([name]) => name === "lean_spend_fail")).toHaveLength(0);
  expect(await advanceGoogleSpendPilot({ ...options(), fetcher })).toEqual({ state: "not_due" });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("bounds hosts, methods and total calls before another source request", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({}));
  const bounded = boundedGooglePilotFetch(spendPilotAccount, AbortSignal.timeout(5000), fetcher);
  await expect(bounded("https://evil.invalid", { method: "POST" })).rejects.toThrow("scope");
  await expect(bounded("https://oauth2.googleapis.com/token", { method: "GET" })).rejects.toThrow("scope");
  for (let i = 0; i < 7; i++) await bounded("https://oauth2.googleapis.com/token", { method: "POST" });
  await expect(bounded("https://oauth2.googleapis.com/token", { method: "POST" })).rejects.toThrow("scope");
  expect(fetcher).toHaveBeenCalledTimes(7);
});
it("bounds streamed per-response and aggregate bytes, rejects late success and actively cancels bodies", async () => {
  const response = (n: number) => new Response(new Uint8Array(n));
  const bounded = boundedGooglePilotFetch(spendPilotAccount, AbortSignal.timeout(5000),
    async () => response(8 * 1024 * 1024 + 1));
  await expect(bounded("https://oauth2.googleapis.com/token", { method: "POST" })).rejects.toThrow("byte_budget");
  const aggregate = boundedGooglePilotFetch(spendPilotAccount, AbortSignal.timeout(5000),
    async () => response(8 * 1024 * 1024));
  for (let i = 0; i < 4; i++) await aggregate("https://oauth2.googleapis.com/token", { method: "POST" });
  await expect(aggregate("https://oauth2.googleapis.com/token", { method: "POST" })).rejects.toThrow("byte_budget");
  const controller = new AbortController(), cancel = vi.fn();
  const slow = boundedGooglePilotFetch(spendPilotAccount, controller.signal, async () => new Response(new ReadableStream({
    start() { setTimeout(() => controller.abort(), 10); }, cancel,
  })));
  await expect(slow("https://oauth2.googleapis.com/token", { method: "POST" })).rejects.toThrow();
  expect(cancel).toHaveBeenCalledTimes(1);
  const lateController = new AbortController();
  const late = boundedGooglePilotFetch(spendPilotAccount, lateController.signal, async () => {
    lateController.abort(); return Response.json({});
  });
  await expect(late("https://oauth2.googleapis.com/token", { method: "POST" })).rejects.toThrow();
});
