import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { scheduledPipelineConfig, runScheduledPipeline } from "../../scripts/analytics/scheduled-pipeline.mjs";

const start = Date.parse("2026-09-29T20:00:00Z");
const scope = (extra = {}) => ({
  LEAN_ANALYTICS_SCHEDULE_ENABLED: "true",
  LEAN_ANALYTICS_DISPATCH_ENABLED: "true",
  LEAN_ANALYTICS_SCHEDULE_START_AT: "2026-09-29T20:00:00Z",
  LEAN_ANALYTICS_SCHEDULE_STOP_AT: "2026-10-06T20:00:00Z",
  LEAN_ANALYTICS_RUNNER_ORIGIN: "https://www.mymully.com",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "xnfjdbpjuaezxjgargto",
  LEAN_ANALYTICS_SUPABASE_URL: "https://xnfjdbpjuaezxjgargto.supabase.co",
  LEAN_ANALYTICS_PIPELINE_SECRET: "fixture-only-secret-not-real-123456789",
  ...extra,
});
const healthy = { enabled: true, pending: 0, leased: 0, dead: 0, done: 1,
  oldestPendingSeconds: 0, expiredLeases: 0 };
const wire = (health = healthy) => vi.fn(async (_url, options) =>
  Response.json(options.method === "POST" ? { state: "done" } : health));

describe("bounded production schedule", () => {
  it("is default-off before parsing configuration or requesting anything", async () => {
    const fetcher = vi.fn();
    expect(await runScheduledPipeline({}, { fetcher })).toEqual({ state: "disabled", calls: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["before", start - 1, "not_started"],
    ["at stop", start + 7 * 86400000, "expired"],
    ["after stop", start + 8 * 86400000, "expired"],
    ["last partial second", start + 7 * 86400000 - 999, "expired"],
  ])("makes zero calls %s", async (_name, now, state) => {
    const fetcher = vi.fn();
    expect(await runScheduledPipeline(scope(), { fetcher, now: () => Number(now) }))
      .toEqual({ state, calls: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { LEAN_ANALYTICS_SCHEDULE_STOP_AT: undefined },
    { LEAN_ANALYTICS_SCHEDULE_START_AT: "2026-02-30T20:00:00Z" },
    { LEAN_ANALYTICS_SCHEDULE_START_AT: "2026-09-29T13:00:00-07:00" },
    { LEAN_ANALYTICS_SCHEDULE_STOP_AT: "2026-09-29T20:00:00Z" },
    { LEAN_ANALYTICS_SCHEDULE_STOP_AT: "2026-10-06T20:00:01Z" },
    { LEAN_ANALYTICS_RUNNER_ORIGIN: "https://fixture.invalid" },
    { LEAN_ANALYTICS_RUNNER_ORIGIN: "https://www.mymully.com/?override=true" },
    { LEAN_ANALYTICS_RUNNER_ORIGIN: "https://user:pass@www.mymully.com/" },
    { LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "aaaaaaaaaaaaaaaaaaaa" },
    { LEAN_ANALYTICS_SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co" },
    { LEAN_ANALYTICS_DISPATCH_ENABLED: "false" },
    { LEAN_ANALYTICS_PIPELINE_SECRET: "" },
  ])("rejects invalid active configuration before network: %j", async change => {
    const fetcher = vi.fn();
    await expect(runScheduledPipeline(scope(change), { fetcher, now: () => start })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("advances one receipt then reads health, without scope arguments or extra calls", async () => {
    const fetcher = wire();
    const result = await runScheduledPipeline(scope({
      LEAN_ANALYTICS_DISPATCH_MAX_CALLS: "120", // Cannot increase this wrapper's ceiling.
    }), { fetcher, now: () => start });
    expect(result).toEqual({ state: "complete", calls: 2,
      health: { healthy: true, pending: 0, dead: 0, oldestPendingSeconds: 0 } });
    expect(fetcher.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
      ["https://www.mymully.com/api/analytics/ingest/process", "POST"],
      ["https://www.mymully.com/api/analytics/ingest/process", "GET"],
    ]);
    expect(fetcher.mock.calls.every(([, options]) => !("body" in options) && options.redirect === "error")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-only-secret");
  });

  it("shortens its overall deadline to the approved stop time", () => {
    const config = scheduledPipelineConfig(scope({
      LEAN_ANALYTICS_SCHEDULE_STOP_AT: "2026-09-29T20:00:02Z",
    }), start);
    expect(config.config?.deadlineSeconds).toBe(2);
  });

  it("does not fetch health or retry if the POST crosses the stop time", async () => {
    let clock = start;
    const fetcher = vi.fn(async () => {
      clock += 3000;
      return Response.json({ state: "done" });
    });
    expect(await runScheduledPipeline(scope({
      LEAN_ANALYTICS_SCHEDULE_STOP_AT: "2026-09-29T20:00:02Z",
    }), { fetcher, now: () => clock })).toEqual({ state: "deadline", calls: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("charges setup time against the approved stop instead of extending it", async () => {
    let calls = 0;
    const fetcher = vi.fn();
    const now = () => calls++ === 0 ? start : start + 3000;
    expect(await runScheduledPipeline(scope({
      LEAN_ANALYTICS_SCHEDULE_STOP_AT: "2026-09-29T20:00:02Z",
    }), { fetcher, now })).toEqual({ state: "deadline", calls: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports unhealthy state without a second processing attempt", async () => {
    const fetcher = wire({ ...healthy, dead: 1 });
    expect((await runScheduledPipeline(scope(), { fetcher, now: () => start })).state).toBe("unhealthy");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry an ambiguous request or log a provider response", async () => {
    const fetcher = vi.fn(async () => { throw new Error("private provider content"); });
    const result = await runScheduledPipeline(scope(), { fetcher, now: () => start });
    expect(result).toEqual({ state: "failed", calls: 1 });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("performs no calls after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    expect(await runScheduledPipeline(scope(), { fetcher, now: () => start, signal: controller.signal }))
      .toEqual({ state: "cancelled", calls: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps scheduled execution main-only, non-overlapping and independently opt-in", () => {
    const workflow = readFileSync(".github/workflows/analytics-production-dispatch.yml", "utf8");
    expect(workflow).toContain('cron: "2-59/5 * * * *"');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("vars.LEAN_ANALYTICS_SCHEDULE_ENABLED == 'true'");
    expect(workflow).toContain("vars.LEAN_ANALYTICS_DISPATCH_ENABLED == 'true'");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toMatch(/^\s+pull_request(?:_target)?:/m);
    expect(workflow).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
