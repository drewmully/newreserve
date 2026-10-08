import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readSourceSessionNativeWindow, sourceReportHash, sourceSessionWindowQuery } from "@/lib/analytics/sourceSessionNativeWindow";
import type { JourneyRuntime } from "@/lib/analytics/journeyRuntime";

const sdk = vi.hoisted(() => ({ __loaded: true, get_session_id: vi.fn(), capture: vi.fn(), reset: vi.fn(), identify: vi.fn() }));
vi.mock("posthog-js", () => ({ default: sdk }));
vi.mock("@/lib/analytics/journeyNativeFilterConfig", () => ({
  nativeEntryFilterSha256: "61504f7e32de2ff2d4197a26e25ba57f412891b9c03e6d27b3ef7568e3829819",
  nativeFilterRules: () => ({ hostRegex: "^synthetic_host$",
    negativeEmailValues: ["synthetic_a", "synthetic_b", "synthetic_c", "synthetic_d", "synthetic_e"] }),
}));
const now = Date.parse("2026-10-09T04:00:01.000Z");
const native = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002";
const cart = "gid://shopify/Cart/synthetic_cart?key=synthetic_key";
const state = (expiresAt = new Date(now + 60000).toISOString()) => Response.json({ active: true, expiresAt });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function tick() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
async function client() {
  vi.stubGlobal("window", {}); vi.stubEnv("NEXT_PUBLIC_LEAN_SOURCE_SESSIONS_ENABLED", "true");
  return import("@/lib/analytics/journeySourceSessionClient");
}
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(now);
  sdk.__loaded = true; sdk.get_session_id.mockReset().mockReturnValue(native);
  sdk.capture.mockClear(); sdk.reset.mockClear(); sdk.identify.mockClear();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("waits for an already-started real navigation bind before emitting the cart association", async () => {
  const c = await client(), binding = deferred<Response>(), started = deferred<void>();
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input); calls.push(url);
    if (url.endsWith("status")) return state();
    if (url.endsWith("bind")) { started.resolve(); return binding.promise; }
    expect(JSON.parse(String(init?.body))).toEqual({ cartId: cart, nativeSessionId: native });
    return new Response(null, { status: 204 });
  }));
  const navigation = c.recordSourceSessionNavigation(); await started.promise;
  const checkout = c.recordSourceSessionCart(cart); await tick();
  expect(calls.filter(x => x.endsWith("cart"))).toHaveLength(0);
  binding.resolve(new Response(null, { status: 204 })); await navigation; await checkout;
  expect(calls.filter(x => x.endsWith("bind"))).toHaveLength(1);
  expect(calls.filter(x => x.endsWith("cart"))).toHaveLength(1);
  expect(sdk.capture).not.toHaveBeenCalled(); expect(sdk.reset).not.toHaveBeenCalled(); expect(sdk.identify).not.toHaveBeenCalled();
});
it("also waits when navigation is still checking the existing permission status", async () => {
  const c = await client(), status = deferred<Response>(); const calls: string[] = []; let statusCalls = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
    const url = String(input); calls.push(url);
    if (url.endsWith("status")) return ++statusCalls === 1 ? status.promise : state();
    return new Response(null, { status: 204 });
  }));
  const navigation = c.recordSourceSessionNavigation(), checkout = c.recordSourceSessionCart(cart); await tick();
  expect(calls.some(x => x.endsWith("cart"))).toBe(false);
  status.resolve(state()); await navigation; await checkout;
  expect(calls.findIndex(x => x.endsWith("bind"))).toBeLessThan(calls.findIndex(x => x.endsWith("cart")));
});
it("does not forget an earlier pending navigation when a newer status check finishes first", async () => {
  const c = await client(), binding = deferred<Response>(), started = deferred<void>(); const calls: string[] = []; let statusCalls = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
    const url = String(input); calls.push(url);
    if (url.endsWith("status")) {
      statusCalls++;
      return statusCalls === 2 ? new Response(null, { status: 503 }) : state();
    }
    if (url.endsWith("bind")) { started.resolve(); return binding.promise; }
    return new Response(null, { status: 204 });
  }));
  const earlier = c.recordSourceSessionNavigation(); await started.promise;
  await c.recordSourceSessionNavigation();
  const checkout = c.recordSourceSessionCart(cart); await tick();
  expect(calls.some(x => x.endsWith("cart"))).toBe(false);
  binding.resolve(new Response(null, { status: 204 })); await earlier; await checkout;
  expect(calls.findIndex(x => x.endsWith("bind"))).toBeLessThan(calls.findIndex(x => x.endsWith("cart")));
});
it("does not extend the existing two-second cart budget while waiting for navigation", async () => {
  const c = await client(), binding = deferred<Response>(), started = deferred<void>(); const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
    const url = String(input); calls.push(url);
    if (url.endsWith("status")) return state();
    if (url.endsWith("bind")) { started.resolve(); return binding.promise; }
    return new Response(null, { status: 204 });
  }));
  const navigation = c.recordSourceSessionNavigation(); await started.promise;
  const checkout = c.recordSourceSessionCart(cart); await tick();
  await vi.advanceTimersByTimeAsync(2000); await checkout;
  expect(calls.some(x => x.endsWith("cart"))).toBe(false);
  binding.resolve(new Response(null, { status: 204 })); await navigation;
});
it.each(["expired", "changed_native"])("does not dispatch a stale cart after waiting: %s", async reason => {
  const c = await client(), binding = deferred<Response>(), started = deferred<void>(); const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
    const url = String(input); calls.push(url);
    if (url.endsWith("status")) return state(new Date(now + 1000).toISOString());
    if (url.endsWith("bind")) { started.resolve(); return binding.promise; }
    return new Response(null, { status: 204 });
  }));
  const navigation = c.recordSourceSessionNavigation(); await started.promise;
  const checkout = c.recordSourceSessionCart(cart); await tick();
  if (reason === "expired") await vi.advanceTimersByTimeAsync(1001); else sdk.get_session_id.mockReturnValue(other);
  binding.resolve(new Response(null, { status: 204 })); await navigation; await checkout;
  expect(calls.some(x => x.endsWith("cart"))).toBe(false);
});
it("preserves server-verified cart attempts after reload without inventing a navigation or binding", async () => {
  const c = await client(), calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
    const url = String(input); calls.push(url); return url.endsWith("status") ? state() : new Response(null, { status: 202 });
  }));
  await c.recordSourceSessionCart(cart);
  expect(calls).toEqual(["/api/analytics/source-session/status", "/api/analytics/source-session/cart"]);
  expect(sdk.capture).not.toHaveBeenCalled(); expect(sdk.reset).not.toHaveBeenCalled();
});
it("does not read or transmit a native ID without active server permission", async () => {
  const c = await client(), fetcher = vi.fn(async () => Response.json({ active: false, expiresAt: null }));
  vi.stubGlobal("fetch", fetcher); await c.recordSourceSessionNavigation(); await c.recordSourceSessionCart(cart);
  expect(fetcher.mock.calls).toHaveLength(2); expect(sdk.get_session_id).not.toHaveBeenCalled();
  expect(sdk.capture).not.toHaveBeenCalled(); expect(sdk.reset).not.toHaveBeenCalled();
});
it("keeps the disabled lane silent", async () => {
  const c = await client(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  vi.stubEnv("NEXT_PUBLIC_LEAN_SOURCE_SESSIONS_ENABLED", "false");
  await c.recordSourceSessionNavigation(); await c.recordSourceSessionCart(cart);
  expect(fetcher).not.toHaveBeenCalled(); expect(sdk.get_session_id).not.toHaveBeenCalled();
});

const columns = ["native_session_id", "started_at", "ended_at", "entry_matches", "entry_uuid",
  "filter_0", "filter_1", "filter_2", "filter_3", "filter_4", "filter_5"];
function nativeRead(extra: Record<string, unknown>) {
  const key = "synthetic-read-key";
  const envelope = { columns, results: [[native, "2026-10-08T05:00:00Z", "2026-10-08T05:30:00Z", 1,
    other, true, true, true, true, true, true]], is_cached: false, query_status: null, ...extra };
  const request = vi.fn<typeof fetch>(async () => Response.json(envelope));
  const runtime: JourneyRuntime = { env: { NODE_ENV: "test", LEAN_POSTHOG_PROJECT_ID: "353503", LEAN_POSTHOG_QUERY_READ_KEY: key },
    request, now: () => now, rpc: vi.fn() };
  return { request, runtime, read: () => readSourceSessionNativeWindow("2026-10-08", sourceReportHash(key), runtime) };
}
it.each([undefined, null, false])("accepts the provider's non-paginated shape with fixed fresh request: %j", async hasMore => {
  const f = nativeRead({ hasMore }), result = await f.read();
  expect(result.rows).toHaveLength(1); expect(f.request).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(f.request.mock.calls[0][1]?.body))).toEqual({
    query: { kind: "HogQLQuery", query: sourceSessionWindowQuery("2026-10-08", f.runtime.env) },
    name: "lean-source-entry-day-v1", refresh: "force_blocking",
  });
});
it.each([true, 0, "false", [], {}])("still rejects truncated or malformed pagination: %j", async hasMore => {
  await expect(nativeRead({ hasMore }).read()).rejects.toThrow("source_report_native_incomplete");
});
it.each([{ is_cached: true }, { query_status: { complete: false } }, { error: "synthetic" }, { columns: ["wrong"] }])
  ("nullable hasMore does not bypass existing source checks: %j", async extra => {
    await expect(nativeRead({ hasMore: null, ...extra }).read()).rejects.toThrow("source_report_native_incomplete");
  });
