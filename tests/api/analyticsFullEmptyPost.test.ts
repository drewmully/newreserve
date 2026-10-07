import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NodeNextRequest } from "next/dist/server/base-http/node";
import { NextRequestAdapter, signalFromNodeResponse } from "next/dist/server/web/spec-extension/adapters/next-request";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), full: vi.fn() }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/analytics/fullPipeline", () => ({ runFullPipeline: mocks.full }));
import { POST } from "@/app/api/analytics/ingest/full/route";

const secret = "local-full-capability-".repeat(2);
const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
let server: Server | undefined;
const bodies: { present: boolean; length: string | null; legacyWouldReject: boolean }[] = [];
beforeEach(() => {
  bodies.length = 0;
  Object.assign(process.env, { LEAN_ANALYTICS_FULL_ENABLED: "true", LEAN_ANALYTICS_FULL_SECRET: secret,
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "xnfjdbpjuaezxjgargto",
    LEAN_ANALYTICS_SUPABASE_URL: "https://xnfjdbpjuaezxjgargto.supabase.co",
    LEAN_SHOPIFY_SHOP_DOMAIN: "mullybox-store.myshopify.com", LEAN_GOOGLE_ADS_AUTH_MODE: "service_account",
    LEAN_GOOGLE_STANDING_ENABLED: "true", LEAN_GOOGLE_STANDING_POLICY_ID: "fixture_policy",
    LEAN_GOOGLE_STANDING_POLICY_REVISION: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" });
  delete process.env.LEAN_ANALYTICS_FULL_RUN_ID;
  mocks.full.mockResolvedValue({ state: "partial" });
  mocks.rpc.mockImplementation((name: string) => ({ abortSignal: () => Promise.resolve({ error: null,
    data: name === "lean_google_standing_next"
      ? { state: "ready", runId: "fixture_pending_run", deadline: new Date(Date.now() + 60000).toISOString() }
      : { state: "partial" } }) }));
});
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
});
async function origin() {
  server = createServer(async (incoming, outgoing) => {
    try {
      const req = NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(incoming), signalFromNodeResponse(outgoing));
      bodies.push({ present: req.body !== null, length: req.headers.get("content-length"),
        legacyWouldReject: !!req.nextUrl.search || req.body !== null });
      const result = await POST(req);
      outgoing.writeHead(result.status, Object.fromEntries(result.headers)); outgoing.end(await result.text());
    } catch { outgoing.statusCode = 500; outgoing.end(); }
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/analytics/ingest/full`;
}

describe("actual Node HTTP to installed Next adapter to full route", () => {
  it("accepts the frozen caller's undefined-body JSON POST, whose Next body is a nonnull empty stream", async () => {
    const result = await fetch(await origin(), { method: "POST", redirect: "error", headers });
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ state: "partial" });
    expect(bodies).toEqual([{ present: true, length: "0", legacyWouldReject: true }]);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["lean_google_standing_next", "lean_google_standing_finish"]);
    expect(mocks.full).toHaveBeenCalledTimes(1);
  });

  it("removing Content-Type alone would not repair the old null-identity guard", async () => {
    const result = await fetch(await origin(), { method: "POST", headers: { authorization: headers.authorization } });
    expect(result.status).toBe(200); expect(bodies[0].legacyWouldReject).toBe(true);
    expect(bodies[0].present).toBe(true);
  });

  it("rejects every nonempty native request and query before any standing claim", async () => {
    const url = await origin();
    for (const body of [" ", "{}", "0", "x"])
      expect((await fetch(url, { method: "POST", headers, body })).status).toBe(400);
    expect((await fetch(url + "?scope=other", { method: "POST", headers })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.full).not.toHaveBeenCalled();
  });

  it("preserves disabled, missing capability and unauthorized refusals before body admission", async () => {
    const url = await origin();
    process.env.LEAN_ANALYTICS_FULL_ENABLED = "false";
    expect((await fetch(url, { method: "POST", headers })).status).toBe(404);
    process.env.LEAN_ANALYTICS_FULL_ENABLED = "true"; process.env.LEAN_ANALYTICS_FULL_SECRET = "";
    expect((await fetch(url, { method: "POST", headers })).status).toBe(503);
    process.env.LEAN_ANALYTICS_FULL_SECRET = secret;
    expect((await fetch(url, { method: "POST" })).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("preserves fixed-run ambiguity and wrong-shop preclaim configuration refusals", async () => {
    const url = await origin(); process.env.LEAN_ANALYTICS_FULL_RUN_ID = "unexpected_fixed_run";
    expect((await fetch(url, { method: "POST", headers })).status).toBe(503);
    delete process.env.LEAN_ANALYTICS_FULL_RUN_ID; process.env.LEAN_SHOPIFY_SHOP_DOMAIN = "other.myshopify.com";
    expect((await fetch(url, { method: "POST", headers })).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("empty-stream refusal boundaries", () => {
  const request = (body?: ReadableStream<Uint8Array>, extra: Record<string, string> = {}, signal?: AbortSignal) => {
    const init = { method: "POST", headers: { ...headers, ...extra }, body, duplex: "half" as const, signal };
    return new NextRequest("https://www.mymully.com/api/analytics/ingest/full", init);
  };
  it("preserves a genuinely null body and refuses transfer encoding or deceptive length", async () => {
    expect((await POST(request())).status).toBe(200);
    mocks.rpc.mockClear(); mocks.full.mockClear();
    expect((await POST(request(undefined, { "transfer-encoding": "chunked" }))).status).toBe(400);
    expect((await POST(request(undefined, { "content-length": "1" }))).status).toBe(400);
    const bytes = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("x")); c.close(); } });
    expect((await POST(request(bytes, { "content-length": "0" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a stalled stream within the existing one-second body-check bound", async () => {
    const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ cancel });
    const started = Date.now(); expect((await POST(request(body))).status).toBe(400);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(cancel).toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects aborted, locked and errored streams before standing dispatch", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await POST(request(undefined, {}, controller.signal))).status).toBe(400);
    const locked = request(new ReadableStream<Uint8Array>()), reader = locked.body!.getReader();
    expect((await POST(locked)).status).toBe(400); reader.releaseLock();
    const errored = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error("fixture")); } });
    expect((await POST(request(errored))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
