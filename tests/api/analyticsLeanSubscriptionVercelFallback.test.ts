import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { autoImplementMethods } from "next/dist/server/route-modules/app-route/helpers/auto-implement-methods";
import { GET, maxDuration } from "@/app/api/analytics/subscriptions/scheduled/route";
import { GET as commerceGET } from "@/app/api/analytics/ingest/scheduled/route";
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

const start = Date.parse("2026-09-30T21:48:23.557Z");
const secret = "synthetic-cron-not-a-credential";
const subSecret = "synthetic-subscriptions-not-a-credential";
const path = "https://www.mymully.com/api/analytics/subscriptions/scheduled";
const endpoint = "https://www.mymully.com/api/analytics/subscriptions/process";
let network: ReturnType<typeof vi.fn<typeof fetch>>;
const request = (url = path, bearer = secret, signal?: AbortSignal) =>
  new NextRequest(url, { headers: { authorization: `Bearer ${bearer}` }, signal });
beforeEach(() => {
  Object.assign(process.env, {
    VERCEL_ENV: "production", CRON_SECRET: secret,
    LEAN_SUBSCRIPTIONS_VERCEL_SCHEDULE_ENABLED: "true",
    LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED: "true",
    LEAN_SUBSCRIPTIONS_DISPATCH_ENABLED: "true",
    LEAN_SUBSCRIPTIONS_SCHEDULE_START_AT: "2026-09-30T21:48:23.557Z",
    LEAN_SUBSCRIPTIONS_SCHEDULE_STOP_AT: "2026-10-07T21:48:23.557Z",
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "xnfjdbpjuaezxjgargto",
    LEAN_ANALYTICS_SUBSCRIPTIONS_SECRET: subSecret,
  });
  delete process.env.LEAN_ANALYTICS_RUNNER_ORIGIN;
  vi.spyOn(Date, "now").mockReturnValue(start);
  vi.spyOn(console, "info").mockImplementation(() => {});
  network = vi.fn<typeof fetch>(async () => Response.json({ state: "observation_saved" }));
  vi.stubGlobal("fetch", network);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("independent default-off subscription fallback", () => {
  it("leaves both timers disabled when their dedicated flags are absent", async () => {
    delete process.env.LEAN_SUBSCRIPTIONS_VERCEL_SCHEDULE_ENABLED;
    delete process.env.LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED;
    expect((await GET(request())).status).toBe(404);
    expect((await commerceGET(request())).status).toBe(404);
    expect(network).not.toHaveBeenCalled();
  });
  it.each([
    ["LEAN_SUBSCRIPTIONS_VERCEL_SCHEDULE_ENABLED", "", 404],
    ["VERCEL_ENV", "preview", 404],
    ["CRON_SECRET", "", 503],
    ["LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED", "false", 503],
    ["LEAN_SUBSCRIPTIONS_DISPATCH_ENABLED", "false", 503],
    ["LEAN_SUBSCRIPTIONS_SCHEDULE_START_AT", "", 503],
    ["LEAN_SUBSCRIPTIONS_SCHEDULE_STOP_AT", "2026-10-08T21:48:23.557Z", 503],
    ["LEAN_SUBSCRIPTIONS_SCHEDULE_START_AT", "2026-02-30T21:48:23.557Z", 503],
    ["LEAN_ANALYTICS_PIPELINE_PROJECT_REF", "aaaaaaaaaaaaaaaaaaaa", 503],
    ["LEAN_ANALYTICS_RUNNER_ORIGIN", "https://other.invalid", 503],
    ["LEAN_ANALYTICS_SUBSCRIPTIONS_SECRET", "short", 503],
  ])("refuses invalid admission %s with no POST", async (key, value, status) => {
    process.env[key] = String(value);
    expect((await GET(request())).status).toBe(status);
    expect(network).not.toHaveBeenCalled();
  });
  it("rejects caller authorization and scope arguments", async () => {
    expect((await GET(request(path, "wrong"))).status).toBe(401);
    expect((await GET(request(`${path}?plan=override`))).status).toBe(400);
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
    [start - 1, "not_started"], [start + 7 * 86400000 - 999, "expired"],
    [start + 7 * 86400000, "expired"],
  ])("does not dispatch outside the finite window (%s)", async (clock, state) => {
    vi.mocked(Date.now).mockReturnValue(Number(clock));
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state, calls: 0 });
    expect(network).not.toHaveBeenCalled();
  });
  it("reuses one fixed empty POST and exposes/logs only the safe state", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ state: "observation_saved", calls: 1 });
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][0]).toBe(endpoint);
    expect(network.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${subSecret}` } });
    expect(network.mock.calls[0][1]?.body).toBeUndefined();
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("synthetic");
    expect(maxDuration).toBe(120);
  });
  it.each(["throw", "error", "oversized", "extra_fields", "lost_lease"])("never retries %s", async mode => {
    if (mode === "throw") network.mockRejectedValueOnce(new Error("private-source-error"));
    else if (mode === "error") network.mockResolvedValueOnce(new Response("private", { status: 503 }));
    else if (mode === "oversized") network.mockResolvedValueOnce(new Response("x".repeat(1025)));
    else if (mode === "extra_fields") network.mockResolvedValueOnce(Response.json({ state: "observation_saved", private: "must-hide" }));
    else network.mockResolvedValueOnce(Response.json({ state: "lost_lease" }));
    const response = await GET(request());
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text).calls).toBe(1);
    expect(text + JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/private|must-hide/);
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("honors cancellation without a dispatch", async () => {
    const controller = new AbortController(); controller.abort();
    const response = await GET(request(path, secret, controller.signal));
    expect(await response.json()).toEqual({ state: "cancelled", calls: 0 });
    expect(network).not.toHaveBeenCalled();
  });
  it("has its own overlap guard without blocking or enabling commerce", async () => {
    let resolve!: (value: Response) => void;
    network.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
    const first = GET(request());
    expect((await GET(request())).status).toBe(409);
    process.env.LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED = "false";
    expect((await commerceGET(request())).status).toBe(404);
    expect(network).toHaveBeenCalledTimes(1);
    Object.assign(process.env, {
      LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED: "true", LEAN_ANALYTICS_PIPELINE_ENABLED: "true",
      LEAN_ANALYTICS_DISPATCH_ENABLED: "true", LEAN_ANALYTICS_SCHEDULE_MODE: "continuous",
      LEAN_ANALYTICS_PIPELINE_SECRET: "synthetic-commerce-not-a-credential",
      LEAN_ANALYTICS_SUPABASE_URL: "https://xnfjdbpjuaezxjgargto.supabase.co",
    });
    delete process.env.LEAN_ANALYTICS_SCHEDULE_START_AT;
    delete process.env.LEAN_ANALYTICS_SCHEDULE_STOP_AT;
    network.mockResolvedValueOnce(Response.json({ enabled: true, pending: 0, leased: 0,
      dead: 0, done: 0, expiredLeases: 0, oldestPendingSeconds: 0 }));
    expect((await commerceGET(request())).status).toBe(200);
    expect(network).toHaveBeenCalledTimes(2);
    resolve(Response.json({ state: "waiting" }));
    expect((await first).status).toBe(200);
    expect((await GET(request())).status).toBe(200);
    expect(network).toHaveBeenCalledTimes(3);
    process.env.LEAN_SUBSCRIPTIONS_VERCEL_SCHEDULE_ENABLED = "false";
    expect((await GET(request())).status).toBe(404);
  });
});
