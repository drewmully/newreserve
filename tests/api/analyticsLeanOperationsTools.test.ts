import { expect, it, vi } from "vitest";
import { historyDispatchConfig, dispatchHistoryFeed } from "../../scripts/analytics/dispatch-history-feed.mjs";
import { monitorConfig, monitorRefresh } from "../../scripts/analytics/monitor-refresh.mjs";
const base = { LEAN_ANALYTICS_RUNNER_ORIGIN: "https://fixture.invalid" };
it("leaves history dispatch and alert delivery disabled until explicitly configured", () => {
  expect(() => historyDispatchConfig(base)).toThrow("disabled");
  expect(() => monitorConfig(base)).toThrow("disabled");
  const env = { ...base, LEAN_ANALYTICS_HISTORY_DISPATCH_ENABLED: "true",
    LEAN_ANALYTICS_HISTORY_FEED_SECRET: "x".repeat(32) };
  expect(historyDispatchConfig(env).maxCalls).toBe(5);
  expect(() => historyDispatchConfig({ ...env, LEAN_ANALYTICS_HISTORY_MAX_CALLS: "129" })).toThrow("budget");
  expect(() => historyDispatchConfig({ ...env, LEAN_ANALYTICS_RUNNER_ORIGIN: "https://fixture.invalid/path" })).toThrow("origin");
  const monitor = { ...base, LEAN_ANALYTICS_MONITOR_DISPATCH_ENABLED: "true",
    LEAN_ANALYTICS_MONITOR_SECRET: "x".repeat(32) };
  expect(monitorConfig(monitor).alertUrl).toBeUndefined();
  expect(() => monitorConfig({ ...monitor, LEAN_ANALYTICS_ALERT_ENABLED: "true" })).toThrow("approval");
});
it("advances saved pages only on partial and stops caught-up, bounded or ambiguous work", async () => {
  const config = { origin: base.LEAN_ANALYTICS_RUNNER_ORIGIN, secret: "fixture", maxCalls: 3 };
  const request = vi.fn().mockResolvedValueOnce(Response.json({ state: "partial" }))
    .mockResolvedValueOnce(Response.json({ state: "caught_up" }));
  expect(await dispatchHistoryFeed(config, request)).toEqual({ state: "caught_up", calls: 2 });
  expect(request.mock.calls[0][0].pathname).toBe("/api/analytics/ingest/history-feed");
  const bounded = vi.fn(async () => Response.json({ state: "partial" }));
  expect(await dispatchHistoryFeed(config, bounded)).toEqual({ state: "bounded", calls: 3 });
  const lost = vi.fn().mockRejectedValue(new Error("ambiguous"));
  await expect(dispatchHistoryFeed(config, lost)).rejects.toThrow("ambiguous");
  expect(lost).toHaveBeenCalledTimes(1);
  const stopped = vi.fn(async () => Response.json({ state: "daily_budget_exhausted" }));
  expect(await dispatchHistoryFeed(config, stopped)).toEqual({ state: "stopped", calls: 1 });
});
it("does not alert for healthy output and never certifies PostHog from database health", async () => {
  const request = vi.fn(async () => Response.json({ state: "healthy", issues: [] }));
  expect(await monitorRefresh({ origin: base.LEAN_ANALYTICS_RUNNER_ORIGIN, secret: "private" }, request))
    .toMatchObject({ state: "healthy", alerted: false, posthogReadbackVerified: false });
  expect(request).toHaveBeenCalledTimes(1);
});
it("delivers one sanitized alert only to the configured destination without leaking server fields or credentials", async () => {
  const request = vi.fn().mockResolvedValueOnce(Response.json({ state: "attention",
    issues: ["export_stale:store_daily"], customer: "do-not-send", token: "do-not-send" }, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const result = await monitorRefresh({ origin: base.LEAN_ANALYTICS_RUNNER_ORIGIN, secret: "private",
    alertUrl: "https://alert.invalid/fixture" }, request);
  expect(result).toMatchObject({ state: "attention", alerted: true });
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][0]).toBe("https://alert.invalid/fixture");
  expect(request.mock.calls[1][1].body).not.toMatch(/do-not-send|private/);
  expect(request.mock.calls[1][1].headers).toEqual({ "Content-Type": "application/json" });
  expect(request.mock.calls[1][1].redirect).toBe("error");
});
it("treats malformed or oversized health responses as unavailable rather than forwarding their data", async () => {
  for (const response of [Response.json({ state: "healthy", issues: ["oops"] }),
    Response.json({ state: "attention", issues: ["customer@example.invalid"] }, { status: 503 }),
    new Response("x".repeat(20000))]) {
    const request = vi.fn().mockResolvedValue(response);
    expect(await monitorRefresh({ origin: base.LEAN_ANALYTICS_RUNNER_ORIGIN, secret: "private" }, request))
      .toMatchObject({ state: "unavailable", issues: ["monitor_unavailable"] });
  }
});
it("never retries an alert whose delivery is ambiguous", async () => {
  const request = vi.fn().mockResolvedValueOnce(Response.json({ state: "attention",
    issues: ["privacy_removal_pending"] }, { status: 503 })).mockRejectedValueOnce(new Error("lost"));
  await expect(monitorRefresh({ origin: base.LEAN_ANALYTICS_RUNNER_ORIGIN, secret: "private",
    alertUrl: "https://alert.invalid/fixture" }, request)).rejects.toThrow("lost");
  expect(request).toHaveBeenCalledTimes(2);
});
