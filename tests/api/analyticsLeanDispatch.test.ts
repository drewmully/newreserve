import { expect, it, vi } from "vitest";
import { dispatchConfig, runDispatch } from "../../scripts/analytics/dispatch-pipeline.mjs";

const config = (extra = {}) => dispatchConfig({ LEAN_ANALYTICS_DISPATCH_ENABLED: "true",
  LEAN_ANALYTICS_RUNNER_ORIGIN: "https://fixture.invalid", LEAN_ANALYTICS_PIPELINE_SECRET: "x".repeat(32), ...extra });
const healthy = { enabled: true, pending: 0, leased: 0, dead: 0, done: 1, expiredLeases: 0, oldestPendingSeconds: 0 };
const wire = (health = healthy) => vi.fn(async (_url, init) => {
  expect(init.redirect).toBe("error");
  expect(init.signal).toBeInstanceOf(AbortSignal);
  return Response.json(init.method === "POST" ? { state: "idle" } : health);
});
it("defaults to a single finite cycle and remains disabled unless explicitly approved", async () => {
  expect(() => dispatchConfig({})).toThrow("disabled");
  const fetcher = wire();
  expect(await runDispatch(config(), { fetcher })).toEqual({ state: "complete", calls: 2 });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("reserves POST and health calls together and stops exactly at the global budget", async () => {
  let clock = 0;
  const fetcher = wire(), pause = vi.fn(async milliseconds => { clock += milliseconds; });
  expect(await runDispatch(config({ LEAN_ANALYTICS_DISPATCH_MAX_CALLS: "4" }), {
    fetcher, pause, now: () => clock,
  })).toEqual({ state: "complete", calls: 4 });
  expect(fetcher).toHaveBeenCalledTimes(4); expect(pause).toHaveBeenCalledTimes(1);
});
it.each(["0", "1", "3", "121", "Infinity", "2.5"])("rejects invalid request budget %s", value => {
  expect(() => config({ LEAN_ANALYTICS_DISPATCH_MAX_CALLS: value })).toThrow("invalid_dispatch_budget");
});
it("does not reset the deadline between cycles or sleep beyond it", async () => {
  expect(await runDispatch(config({ LEAN_ANALYTICS_DISPATCH_MAX_CALLS: "4",
    LEAN_ANALYTICS_DISPATCH_DEADLINE_SECONDS: "60" }), { fetcher: wire(), now: () => 0 }))
    .toEqual({ state: "deadline", calls: 2 });
});
it("rejects late success and does not issue the next health request", async () => {
  let clock = 0;
  const fetcher = vi.fn(async () => { clock = 300001; return Response.json({ state: "idle" }); });
  expect(await runDispatch(config(), { fetcher, now: () => clock })).toEqual({ state: "deadline", calls: 1 });
});
it("honors cancellation before calls and stops after unhealthy or failed replies without retries", async () => {
  const stop = new AbortController(); stop.abort();
  const fetcher = wire();
  expect(await runDispatch(config(), { fetcher, signal: stop.signal })).toEqual({ state: "cancelled", calls: 0 });
  expect(fetcher).not.toHaveBeenCalled();
  expect(await runDispatch(config(), { fetcher: wire({ ...healthy, dead: 1 }) })).toEqual({ state: "unhealthy", calls: 2 });
  expect(await runDispatch(config(), { fetcher: async () => new Response("private", { status: 503 }) }))
    .toEqual({ state: "failed", calls: 1 });
});
