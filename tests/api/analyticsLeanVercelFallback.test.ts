import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { autoImplementMethods } from "next/dist/server/route-modules/app-route/helpers/auto-implement-methods";
import { GET, maxDuration } from "@/app/api/analytics/ingest/scheduled/route";
vi.mock("@/lib/analytics/serverClient", async () => {
  const { createClient } = await vi.importActual<typeof import("@supabase/supabase-js")>("@supabase/supabase-js");
  const client = createClient("https://xnfjdbpjuaezxjgargto.supabase.co", "fixture-only", {
    auth: { persistSession: false }, global: { fetch: async (url, init) => {
      expect(String(url)).toBe("https://xnfjdbpjuaezxjgargto.supabase.co/rest/v1/rpc/lean_pipeline_ordinary_batch_admission");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ state: "off" });
    } },
  });
  return { getAnalyticsSupabase: () => client };
});
vi.mock("@/lib/analytics/scheduledPipelineCatchup", () => ({
  runScheduledPipelineCatchup: vi.fn(async () => ({ state: "off" })),
}));

const secret = "synthetic-cron-secret-not-a-credential";
const pipelineSecret = "synthetic-pipeline-secret-not-a-credential";
const path = "https://www.mymully.com/api/analytics/ingest/scheduled";
const endpoint = "https://www.mymully.com/api/analytics/ingest/process";
const health = { enabled: true, pending: 0, leased: 0, dead: 0, done: 0,
  excluded: 0, expiredLeases: 0, oldestPendingSeconds: 0 };
let network: ReturnType<typeof vi.fn<typeof fetch>>;
function request(url = path, bearer = secret, signal?: AbortSignal) {
  return new NextRequest(url, { headers: { authorization: `Bearer ${bearer}` }, signal });
}
beforeEach(() => {
  Object.assign(process.env, {
    VERCEL_ENV: "production",
    LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED: "true",
    LEAN_ANALYTICS_PIPELINE_ENABLED: "true",
    LEAN_ANALYTICS_DISPATCH_ENABLED: "true",
    LEAN_ANALYTICS_SCHEDULE_MODE: "continuous",
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "xnfjdbpjuaezxjgargto",
    LEAN_ANALYTICS_SUPABASE_URL: "https://xnfjdbpjuaezxjgargto.supabase.co",
    LEAN_ANALYTICS_PIPELINE_SECRET: pipelineSecret,
    CRON_SECRET: secret,
  });
  for (const key of ["LEAN_ANALYTICS_RUNNER_ORIGIN", "LEAN_ANALYTICS_SCHEDULE_START_AT",
    "LEAN_ANALYTICS_SCHEDULE_STOP_AT"]) delete process.env[key];
  network = vi.fn<typeof fetch>(async () => Response.json(health));
  vi.stubGlobal("fetch", network);
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("default-off commerce Vercel fallback", () => {
  it.each(["false", "", undefined])("is disabled with flag=%s, before credentials or network", async value => {
    if (value === undefined) delete process.env.LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED;
    else process.env.LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED = value;
    delete process.env.CRON_SECRET;
    expect((await GET(request())).status).toBe(404);
    expect(network).not.toHaveBeenCalled();
  });
  it.each(["preview", "development", ""])("is unavailable outside production (%s)", async value => {
    process.env.VERCEL_ENV = value;
    expect((await GET(request())).status).toBe(404);
    expect(network).not.toHaveBeenCalled();
  });
  it("refuses missing server secret and wrong authorization without any work", async () => {
    expect((await GET(request(path, "wrong"))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(request())).status).toBe(503);
    expect(network).not.toHaveBeenCalled();
  });
  it("rejects caller query arguments", async () => {
    expect((await GET(request(`${path}?order=1`))).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });
  it("rejects authenticated HEAD forwarded by Next.js before network", async () => {
    const req = new NextRequest(path, { method: "HEAD",
      headers: { authorization: `Bearer ${secret}` } });
    const response = await autoImplementMethods({ GET }).HEAD(req, {});
    expect(response).toMatchObject({ status: 405 });
    expect(network).not.toHaveBeenCalled();
  });
  it.each([
    ["content-length", "1"],
    ["transfer-encoding", "chunked"],
  ])("rejects body-framing header %s before network", async (name, value) => {
    const req = request();
    req.headers.set(name, value);
    expect(req.body).toBeNull();
    expect((await GET(req)).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });
  it("permits an explicit zero content length for an ordinary GET", async () => {
    const req = request();
    req.headers.set("content-length", "0");
    expect((await GET(req)).status).toBe(200);
    expect(network).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["LEAN_ANALYTICS_PIPELINE_ENABLED", "false"],
    ["LEAN_ANALYTICS_DISPATCH_ENABLED", "false"],
    ["LEAN_ANALYTICS_SCHEDULE_MODE", "bounded"],
    ["LEAN_ANALYTICS_PIPELINE_PROJECT_REF", "aaaaaaaaaaaaaaaaaaaa"],
    ["LEAN_ANALYTICS_SUPABASE_URL", "https://aaaaaaaaaaaaaaaaaaaa.supabase.co"],
    ["LEAN_ANALYTICS_RUNNER_ORIGIN", "https://other.invalid"],
    ["LEAN_ANALYTICS_PIPELINE_SECRET", ""],
    ["LEAN_ANALYTICS_SCHEDULE_STOP_AT", "2026-10-01T00:00:00Z"],
  ])("rejects invalid server configuration %s without network", async (key, value) => {
    process.env[key] = value;
    expect((await GET(request())).status).toBe(503);
    expect(network).not.toHaveBeenCalled();
  });
  it("uses the real bounded supervisor for idle health only", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ state: "idle", calls: 1 });
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][0]).toBe(endpoint);
    expect(network.mock.calls[0][1]?.method).toBe("GET");
    expect(network.mock.calls[0][1]?.headers).toEqual({ authorization: `Bearer ${pipelineSecret}` });
  });
  it("advances at most one saved receipt and returns aggregate health, never provider content", async () => {
    network
      .mockResolvedValueOnce(Response.json({ ...health, pending: 1 }))
      .mockResolvedValueOnce(Response.json({ state: "excluded", private: "must-not-return" }))
      .mockResolvedValueOnce(Response.json({ ...health, done: 1, excluded: 1 }));
    const response = await GET(request());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ state: "complete", calls: 3, health: { pending: 0 } });
    expect(text).not.toMatch(/must-not-return|synthetic|credential/);
    expect(console.info).toHaveBeenCalledTimes(1);
    const logged = String(vi.mocked(console.info).mock.calls[0][0]);
    expect(JSON.parse(logged)).toMatchObject({ event: "analytics_vercel_scheduled_invocation",
      state: "complete", calls: 3 });
    expect(logged).not.toMatch(/must-not-return|synthetic|credential/);
    expect(network.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [endpoint, "GET"], [endpoint, "POST"], [endpoint, "GET"],
    ]);
    for (const [, init] of network.mock.calls) {
      expect(init?.body).toBeUndefined();
      expect(init?.redirect).toBe("error");
    }
  });
  it("does not retry an ambiguous POST or expose its error", async () => {
    network.mockResolvedValueOnce(Response.json({ ...health, pending: 1 }))
      .mockRejectedValueOnce(new Error("private-provider-error"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ state: "failed", calls: 2,
      health: { healthy: true, pending: 1, dead: 0, oldestPendingSeconds: 0 } });
    expect(text).not.toContain("private-provider-error");
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("private-provider-error");
    expect(network).toHaveBeenCalledTimes(2);
  });
  it("keeps database-disabled scope off", async () => {
    network.mockResolvedValueOnce(Response.json({ ...health, enabled: false }));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ state: "scope_disabled", calls: 1 });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("charges health time against the existing180-second bound", async () => {
    let clock = Date.parse("2026-09-30T22:35:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    network.mockImplementationOnce(async () => {
      clock += 181000;
      return Response.json({ ...health, pending: 1 });
    });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ state: "deadline", calls: 1 });
    expect(network).toHaveBeenCalledTimes(1);
    expect(maxDuration).toBe(240);
  });
  it("honors request cancellation before processing", async () => {
    const controller = new AbortController();
    network.mockImplementationOnce(async () => {
      controller.abort();
      return Response.json({ ...health, pending: 1 });
    });
    const response = await GET(request(path, secret, controller.signal));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ state: "cancelled", calls: 1 });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("rejects overlapping calls in this isolate and releases the guard after completion", async () => {
    let resolve!: (response: Response) => void;
    network.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
    const first = GET(request());
    const second = await GET(request());
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ state: "busy" });
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1));
    expect(network).toHaveBeenCalledTimes(1);
    resolve(Response.json(health));
    expect((await first).status).toBe(200);
    expect((await GET(request())).status).toBe(200);
    expect(network).toHaveBeenCalledTimes(2);
  });
});
