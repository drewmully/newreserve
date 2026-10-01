import { describe, expect, it, vi } from "vitest";
import { runScheduledPipeline, scheduledPipelineConfig } from "../../scripts/analytics/scheduled-pipeline.mjs";

const env = {
  LEAN_ANALYTICS_SCHEDULE_ENABLED: "true",
  LEAN_ANALYTICS_DISPATCH_ENABLED: "true",
  LEAN_ANALYTICS_SCHEDULE_MODE: "continuous",
  LEAN_ANALYTICS_RUNNER_ORIGIN: "https://www.mymully.com",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "xnfjdbpjuaezxjgargto",
  LEAN_ANALYTICS_SUPABASE_URL: "https://xnfjdbpjuaezxjgargto.supabase.co",
  LEAN_ANALYTICS_PIPELINE_SECRET: "fixture-only-secret-not-real-123456789",
};
const health = { enabled: true, pending: 0, leased: 0, dead: 0, done: 0,
  oldestPendingSeconds: 0, expiredLeases: 0 };

describe("explicit continuous production operation", () => {
  it("still requires both opt-ins and the exact target", () => {
    expect(scheduledPipelineConfig({ ...env, LEAN_ANALYTICS_SCHEDULE_ENABLED: "false" }).state)
      .toBe("disabled");
    expect(() => scheduledPipelineConfig({ ...env, LEAN_ANALYTICS_DISPATCH_ENABLED: "false" })).toThrow();
    expect(() => scheduledPipelineConfig({ ...env, LEAN_ANALYTICS_RUNNER_ORIGIN: "https://wrong.invalid" }))
      .toThrow();
  });
  it("cannot silently extend an expired trial", () => {
    expect(() => scheduledPipelineConfig({ ...env, LEAN_ANALYTICS_SCHEDULE_STOP_AT: "2026-09-30T00:33:00Z" }))
      .toThrow("continuous_schedule_has_trial_dates");
    expect(() => scheduledPipelineConfig({ ...env, LEAN_ANALYTICS_SCHEDULE_MODE: "forever" })).toThrow();
  });
  it("does only counts-only health when production has no work", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(health));
    const result = await runScheduledPipeline(env, { fetcher });
    expect(result.state).toBe("idle");
    expect(result.calls).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error" });
    expect(JSON.stringify(result)).not.toContain(env.LEAN_ANALYTICS_PIPELINE_SECRET);
  });
  it.each([
    { dead: 1 }, { expiredLeases: 1 }, { oldestPendingSeconds: 900 },
  ])("continues bounded backlog recovery while preserving health warnings: %j", async bad => {
    const fetcher = vi.fn(async (_url, init) =>
      Response.json(init.method === "POST" ? { state: "done" } : { ...health, pending: 1, ...bad }));
    expect((await runScheduledPipeline(env, { fetcher })).state).toBe("unhealthy");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not repeatedly process dead letters when no work is pending", async () => {
    const fetcher = vi.fn(async () => Response.json({ ...health, dead: 1 }));
    expect((await runScheduledPipeline(env, { fetcher })).state).toBe("unhealthy");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("allows the existing SQL to recover one expired lease", async () => {
    const fetcher = vi.fn(async (_url, init) =>
      Response.json(init.method === "POST" ? { state: "done" } : { ...health, leased: 1, expiredLeases: 1 }));
    expect((await runScheduledPipeline(env, { fetcher })).state).toBe("unhealthy");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not process a disabled scope", async () => {
    const fetcher = vi.fn(async () => Response.json({ ...health, pending: 1, enabled: false }));
    expect(await runScheduledPipeline(env, { fetcher })).toEqual({ state: "scope_disabled", calls: 1 });
  });
  it.each([Response.json({ private: "bad-body" }), new Response(null, { status: 401 })])(
    "redacts malformed or unauthorized health and performs no POST", async response => {
      const fetcher = vi.fn(async () => response);
      expect(await runScheduledPipeline(env, { fetcher })).toEqual({ state: "health_unavailable", calls: 1 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  it("advances at most one receipt and verifies health, with no raw response output", async () => {
    const fetcher = vi.fn(async (_url, options) => Response.json(
      options.method === "POST" ? { state: "done" } : { ...health, pending: 1 }));
    const result = await runScheduledPipeline(env, { fetcher });
    expect(result.state).toBe("complete");
    expect(result.calls).toBe(3);
    expect(fetcher.mock.calls.map(([, options]) => options.method)).toEqual(["GET", "POST", "GET"]);
    expect(fetcher.mock.calls.every(([, options]) => !("body" in options))).toBe(true);
  });
  it("does not retry an ambiguous processing response", async () => {
    const fetcher = vi.fn(async (_url, options) => {
      if (options.method === "POST") throw new Error("private upstream text");
      return Response.json({ ...health, pending: 1 });
    });
    const result = await runScheduledPipeline(env, { fetcher });
    expect(result.state).toBe("failed");
    expect(result.calls).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("private upstream");
  });
  it("charges preflight time to the existing per-invocation deadline", async () => {
    let now = 0;
    const fetcher = vi.fn(async () => {
      now = 181000;
      return Response.json({ ...health, pending: 1 });
    });
    expect((await runScheduledPipeline(env, { fetcher, now: () => now })).state).toBe("deadline");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not perform any calls after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    expect(await runScheduledPipeline(env, { fetcher, signal: controller.signal }))
      .toEqual({ state: "cancelled", calls: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("aborts an in-flight POST at the original deadline after a slow preflight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    // Node's native AbortSignal.timeout uses internal timers; bridge it to the
    // fake clock so this exercises the real shared-signal wiring without sleep.
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    try {
      let postSignal: AbortSignal | undefined;
      const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
        if (options?.method === "GET") {
          await new Promise(resolve => setTimeout(resolve, 90000));
          return Response.json({ ...health, pending: 1 });
        }
        postSignal = options?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          postSignal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      });
      const pending = runScheduledPipeline(env, { fetcher });
      await vi.advanceTimersByTimeAsync(179999);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(postSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(postSignal?.aborted).toBe(true);
      expect(await pending).toMatchObject({ state: "deadline", calls: 2 });
      expect(Date.now()).toBe(180000);
    } finally { timeout.mockRestore(); vi.clearAllTimers(); vi.useRealTimers(); }
  });
});
