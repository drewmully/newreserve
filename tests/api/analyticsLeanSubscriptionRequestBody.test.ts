import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const runtime = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/subscriptionRuntime", () => ({ runSubscriptionRuntime: runtime }));
import { POST } from "@/app/api/analytics/subscriptions/process/route";

const secret = "fixture-only".padEnd(32, "x");
function request(body?: ReadableStream<Uint8Array>, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new NextRequest("https://fixture.invalid/api/analytics/subscriptions/process", {
    method: "POST", headers: { authorization: `Bearer ${secret}`, ...headers },
    ...(body ? { body, duplex: "half" } : {}), signal,
  });
}
beforeEach(() => {
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED", "true");
  vi.stubEnv("LEAN_ANALYTICS_SUBSCRIPTIONS_SECRET", secret);
  runtime.mockReset().mockResolvedValue({ state: "observation_saved" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it.each([undefined, "0"])("admits a closed zero-byte Node POST stream (length=%s)", async length => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const req = request(body, length ? { "content-length": length } : {});
  expect(req.body).not.toBeNull();
  const response = await POST(req);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ state: "observation_saved" });
  expect(runtime).toHaveBeenCalledExactlyOnceWith({ signal: req.signal });
});
it("still admits a truly null body", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(runtime).toHaveBeenCalledTimes(1);
});
it.each(["bytes", "empty-chunk", "error"])("rejects %s before any runtime/source call", async kind => {
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    if (kind === "error") controller.error(new Error("fixture-private-error"));
    else {
      controller.enqueue(new Uint8Array(kind === "bytes" ? [123] : []));
      controller.close();
    }
  } });
  expect((await POST(request(body, { "content-length": "0" }))).status).toBe(400);
  expect(runtime).not.toHaveBeenCalled();
});
it.each<Record<string, string>>([{ "content-length": "1" }, { "transfer-encoding": "chunked" }])(
  "rejects prohibited headers without reading or calling runtime", async headers => {
    const read = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull: read }, { highWaterMark: 0 });
    expect((await POST(request(body, headers))).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
    expect(runtime).not.toHaveBeenCalled();
  });
it("bounds stalled reads and does not await a stalled cancellation", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const pending = POST(request(new ReadableStream<Uint8Array>({ cancel })));
  await vi.advanceTimersByTimeAsync(1000);
  expect((await pending).status).toBe(400);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(runtime).not.toHaveBeenCalled();
});
it.each([true, false])("rejects an aborted request (already=%s)", async already => {
  const controller = new AbortController();
  if (already) controller.abort();
  const pending = POST(request(new ReadableStream<Uint8Array>(), {}, controller.signal));
  if (!already) controller.abort();
  expect((await pending).status).toBe(400);
  expect(runtime).not.toHaveBeenCalled();
});
