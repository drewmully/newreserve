import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { runGoogleSpendJob } from "@/lib/analytics/googleSpendJob";
import { POST } from "@/app/api/analytics/ingest/spend/route";
const port = vi.hoisted(() => ({ client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => port.client }));
let db: PGlite;
const project = "a".repeat(20), args = { p_run: "fixture", p_project_ref: project };
const client: AnalyticsRpcClient = { async rpc(name, input) {
  if (!["lean_spend_claim", "lean_spend_finish", "lean_spend_fail"].includes(name)) throw new Error("unknown_rpc");
  const entries = Object.entries(input);
  try {
    const result = await db.query<{ result: unknown }>(
      `select public.${name}(${entries.map(([k], i) => `${k}=>$${i + 1}${k === "p_base" ? "::jsonb" : ""}`).join(",")}) result`,
      entries.map(([k, v]) => k === "p_base" ? JSON.stringify(v) : v));
    return { data: result.rows[0].result, error: null };
  } catch (error) { return { data: null, error }; }
} };
const base = () => ({ provider: "google_ads", accountId: "1234567890", date: "2026-09-01",
  baseReportId: "fixture", sourceCurrency: "USD", sourceTimezone: "America/New_York",
  paginationComplete: true, verifiedEmpty: true, rows: [], evidenceRef: "fixture:source", completedAt: "2026-09-23T00:00:00Z" });
const options = () => ({ client, projectRef: project, databaseUrl: `https://${project}.supabase.co`, runId: "fixture",
  clientId: "fixture:client", clientSecret: "fixture:secret", refreshToken: "fixture:refresh",
  now: "2026-09-23T00:00:00Z", signal: AbortSignal.timeout(20000) });
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema lean_private; create role service_role; create role anon; create role authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  await db.exec(readFileSync("sql/analytics/019_spend_jobs.sql", "utf8"));
}, 30000);
beforeEach(async () => {
  port.client = client; vi.stubGlobal("fetch", () => { throw new Error("external_network_forbidden"); });
  await db.exec("truncate lean_private.spend_jobs");
  await db.query(`insert into lean_private.spend_jobs
    (run_id,project_ref,account_id,report_date,max_pages,approval_ref,actor_ref,enabled)
    values('fixture',$1,'1234567890','2026-09-01',1,'fixture:approval','fixture:operator',true)`, [project]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { await db?.close(); });
const claim = (token: string) => client.rpc("lean_spend_claim", { ...args, p_token: token });
const finish = (token: string, value = base()) => client.rpc("lean_spend_finish", { ...args, p_token: token, p_base: value });
it("fences owners, stores a complete immutable base and stops subsequent claims", async () => {
  const token = randomUUID(); expect((await claim(token)).data).toMatchObject({ state: "claimed" });
  expect((await claim(randomUUID())).data).toEqual({ state: "busy" });
  expect((await finish(randomUUID())).data).toBe(false);
  expect((await finish(token)).data).toBe(true);
  expect((await claim(randomUUID())).data).toEqual({ state: "complete" });
  await expect(db.exec("update lean_private.spend_jobs set base='{}'")).rejects.toThrow("immutable");
});
it("stops after three failed attempts and never leaks raw source errors", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private", { status: 403 }));
  for (let i = 0; i < 3; i++) expect(await runGoogleSpendJob({ ...options(), fetcher })).toEqual({ state: "failed" });
  expect(await runGoogleSpendJob({ ...options(), fetcher })).toEqual({ state: "attempts_exhausted" });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("rejects wrong account, incomplete, and misclassified empty bases atomically", async () => {
  const token = randomUUID(); await claim(token);
  for (const overrides of [{ accountId: "9999999999" }, { paginationComplete: false }, { verifiedEmpty: false }])
    expect((await finish(token, { ...base(), ...overrides })).error).toBeTruthy();
  expect((await db.query("select base from lean_private.spend_jobs")).rows).toEqual([{ base: null }]);
});
it("rejects changed scope and honors disabled targets before any OAuth request", async () => {
  await expect(db.exec("update lean_private.spend_jobs set report_date='2026-09-02'")).rejects.toThrow("immutable");
  await db.exec("update lean_private.spend_jobs set enabled=false");
  const fetcher = vi.fn();
  expect(await runGoogleSpendJob({ ...options(), fetcher })).toEqual({ state: "disabled" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("runs synthetic OAuth to source to retained base end-to-end without event mirroring", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (url === "https://oauth2.googleapis.com/token")
      return new Response(JSON.stringify({ access_token: "fixture:access", token_type: "Bearer" }));
    expect(url).toBe("https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search");
    const { query } = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(query.includes("FROM customer")
      ? { results: [{ customer: { id: "1234567890", timeZone: "America/New_York", currencyCode: "USD" } }] }
      : { fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions", results: [] }));
  });
  expect(await runGoogleSpendJob({ ...options(), fetcher })).toEqual({ state: "complete", rows: 0 });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect((await db.query<{ base: unknown }>("select base from lean_private.spend_jobs")).rows[0].base)
    .toMatchObject({ accountId: "1234567890", verifiedEmpty: true });
});
it("does not retry or fail a finish whose commit response was lost", async () => {
  const rpc = vi.fn<AnalyticsRpcClient["rpc"]>(async (name, input) => {
    if (name === "lean_spend_finish") throw new Error("lost response");
    return client.rpc(name, input);
  });
  const responses = [{ access_token: "fixture", token_type: "Bearer" },
    { results: [{ customer: { id: "1234567890", timeZone: "America/New_York", currencyCode: "USD" } }] },
    { fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions" }];
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(responses.shift())));
  await expect(runGoogleSpendJob({ ...options(), client: { rpc }, fetcher })).rejects.toThrow("storage_unavailable");
  expect(rpc.mock.calls.map(c => c[0])).toEqual(["lean_spend_claim", "lean_spend_finish"]);
});
it("runs the real HTTP service-account path into immutable SQL spend input and replays without another token", async () => {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
  const sa = Buffer.from(JSON.stringify({ client_email: "fixture@fixture.iam.gserviceaccount.com", private_key: key })).toString("base64");
  for (const [name, value] of Object.entries({
    LEAN_ANALYTICS_SPEND_ENABLED: "true", LEAN_ANALYTICS_SPEND_SECRET: "x".repeat(32),
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
    LEAN_ANALYTICS_SPEND_RUN_ID: "fixture", LEAN_GOOGLE_ADS_AUTH_MODE: "service_account",
    LEAN_GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: sa, LEAN_GOOGLE_ADS_IMPERSONATE_EMAIL: "fixture@example.invalid",
    LEAN_GOOGLE_ADS_DEVELOPER_TOKEN: "fixture:developer",
  })) vi.stubEnv(name, value);
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (url === "https://oauth2.googleapis.com/token") {
      expect(new URLSearchParams(String(init?.body)).get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      return Response.json({ access_token: "fixture", token_type: "Bearer" });
    }
    expect(init?.headers).toMatchObject({ "developer-token": "fixture:developer" });
    const query = JSON.parse(String(init?.body)).query;
    return Response.json(query.includes("FROM customer")
      ? { results: [{ customer: { id: "1234567890", currencyCode: "USD", timeZone: "America/New_York" } }] }
      : { fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions",
        results: [{ campaign: { id: "8" }, segments: { date: "2026-09-01" }, metrics: { costMicros: "1234567" } }] });
  });
  vi.stubGlobal("fetch", fetcher);
  const request = () => new NextRequest("https://fixture.invalid/api/analytics/ingest/spend", {
    method: "POST", headers: { authorization: `Bearer ${"x".repeat(32)}` },
  });
  expect(await (await POST(request())).json()).toEqual({ state: "complete", rows: 1 });
  expect(await (await POST(request())).json()).toEqual({ state: "complete" });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect((await db.query<{ base: unknown }>("select base from lean_private.spend_jobs")).rows[0].base)
    .toMatchObject({ accountId: "1234567890", rows: [{ campaignId: "8", costMicros: "1234567" }] });
});
it("revokes hosted defaults and keeps the route disabled and request scope fixed", async () => {
  const grants = await db.query<{ allowed: boolean }>(`select has_function_privilege('anon',
    'public.lean_spend_claim(text,text,uuid)','execute') as allowed`);
  expect(grants.rows[0].allowed).toBe(false);
  const req = (suffix = "", auth = "x".repeat(32)) => new NextRequest(`https://fixture.invalid/api/analytics/ingest/spend${suffix}`,
    { method: "POST", headers: { authorization: `Bearer ${auth}` } });
  expect((await POST(req())).status).toBe(404);
  vi.stubEnv("LEAN_ANALYTICS_SPEND_ENABLED", "true"); vi.stubEnv("LEAN_ANALYTICS_SPEND_SECRET", "x".repeat(32));
  expect((await POST(req("", "wrong"))).status).toBe(401);
  expect((await POST(req("?account=wrong"))).status).toBe(400);
});
