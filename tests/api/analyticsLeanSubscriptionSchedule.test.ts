import { describe, expect, it, vi } from "vitest";
import { runScheduledSubscriptions } from "../../scripts/analytics/scheduled-subscriptions.mjs";

const env = {
  LEAN_SUBSCRIPTIONS_SCHEDULE_ENABLED: "true",
  LEAN_SUBSCRIPTIONS_DISPATCH_ENABLED: "true",
  LEAN_SUBSCRIPTIONS_SCHEDULE_START_AT: "2026-09-30T00:00:00.000Z",
  LEAN_SUBSCRIPTIONS_SCHEDULE_STOP_AT: "2026-10-01T00:00:00.000Z",
  LEAN_ANALYTICS_RUNNER_ORIGIN: "https://www.mymully.com",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "xnfjdbpjuaezxjgargto",
  LEAN_ANALYTICS_SUBSCRIPTIONS_SECRET: "fixture-subscription-not-a-real-secret-12345",
};
const now = () => Date.parse("2026-09-30T01:00:00.000Z");
describe("independent finite subscription dispatch", () => {
  it.each(["LEAN_SUBSCRIPTIONS_SCHEDULE_ENABLED", "LEAN_SUBSCRIPTIONS_DISPATCH_ENABLED"])(
    "requires opt-in %s before any access", async key => {
      const fetcher = vi.fn();
      expect(await runScheduledSubscriptions({ ...env, [key]: "false" }, { fetcher, now }))
        .toEqual({ state: "disabled", calls: 0 });
      expect(fetcher).not.toHaveBeenCalled();
    });
  it.each([
    ["2026-09-29T23:59:59.000Z", "not_started"],
    ["2026-09-30T23:59:59.500Z", "expired"],
    ["2026-10-01T00:00:00.000Z", "expired"],
  ])("does not dispatch outside its window %s", async (time, state) => {
    const fetcher = vi.fn();
    expect(await runScheduledSubscriptions(env, { fetcher, now: () => Date.parse(time) }))
      .toEqual({ state, calls: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { LEAN_SUBSCRIPTIONS_SCHEDULE_STOP_AT: "2026-10-08T00:00:00.000Z" },
    { LEAN_SUBSCRIPTIONS_SCHEDULE_START_AT: "2026-02-30T00:00:00.000Z" },
    { LEAN_ANALYTICS_RUNNER_ORIGIN: "https://wrong.invalid" },
    { LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "other" },
    { LEAN_ANALYTICS_SUBSCRIPTIONS_SECRET: "short" },
  ])("rejects scope/configuration drift without requests: %j", async change => {
    const fetcher = vi.fn();
    await expect(runScheduledSubscriptions({ ...env, ...change }, { fetcher, now })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends one empty-body POST and emits no secret or source data", async () => {
    const fetcher = vi.fn(async () => Response.json({ state: "observation_saved" }));
    expect(await runScheduledSubscriptions(env, { fetcher, now })).toEqual({ state: "observation_saved", calls: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.mymully.com/api/analytics/subscriptions/process");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(init).not.toHaveProperty("body");
  });
  it.each(["waiting", "busy", "completed", "halted", "failed", "lost_lease", "attempts_exhausted"])(
    "never replays a response state %s", async state => {
      const fetcher = vi.fn(async () => Response.json({ state }));
      expect(await runScheduledSubscriptions(env, { fetcher, now })).toEqual({ state, calls: 1 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  it.each([
    () => new Response(null, { status: 401 }),
    () => Response.json({ state: "observation_saved", private: "must-not-log" }),
    () => new Response("x".repeat(1025)),
    () => { throw new Error("secret upstream error"); },
  ])("redacts unexpected or ambiguous responses without retry", async reply => {
    const fetcher = vi.fn(async () => reply());
    expect(await runScheduledSubscriptions(env, { fetcher, now })).toEqual({ state: "unavailable", calls: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("honors cancellation before dispatch", async () => {
    const fetcher = vi.fn(), controller = new AbortController();
    controller.abort();
    expect(await runScheduledSubscriptions(env, { fetcher, now, signal: controller.signal }))
      .toEqual({ state: "cancelled", calls: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
