import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { prepareFile } from "../../scripts/analytics/prepare-refresh.mjs";
import { dispatchRefresh, refreshDispatchConfig } from "../../scripts/analytics/dispatch-refresh.mjs";
afterEach(() => vi.unstubAllGlobals());
it("prepares a private bundle and diagnostic view entirely offline", () => {
  vi.stubGlobal("fetch", () => { throw new Error("network_forbidden"); });
  const dir = mkdtempSync(join(tmpdir(), "refresh-fixture-"));
  try {
    const input = join(dir, "input.json"), out = join(dir, "output");
    writeFileSync(input, JSON.stringify(refreshFixture()));
    expect(prepareFile(input, out)).toMatchObject({ state: "prepared_only", registered: false, enabled: false });
    expect(JSON.parse(readFileSync(join(out, "refresh-bundle.json"), "utf8")).history).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(out, "analytics-events-view.json"), "utf8")).materialize).toBe(false);
    expect(() => prepareFile(input, out)).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
it("keeps dispatch disabled and rejects invalid origins and call budgets", () => {
  expect(() => refreshDispatchConfig({})).toThrow("disabled");
  const env = { LEAN_ANALYTICS_REFRESH_DISPATCH_ENABLED: "true",
    LEAN_ANALYTICS_RUNNER_ORIGIN: "https://fixture.invalid", LEAN_ANALYTICS_REFRESH_SECRET: "x".repeat(32) };
  expect(refreshDispatchConfig(env).maxCalls).toBe(5);
  expect(() => refreshDispatchConfig({ ...env, LEAN_ANALYTICS_REFRESH_MAX_CALLS: "129" })).toThrow("budget");
  expect(() => refreshDispatchConfig({ ...env, LEAN_ANALYTICS_RUNNER_ORIGIN: "http://fixture.invalid" })).toThrow("origin");
});
it("dispatches only successful checkpoints and never retries failed or ambiguous calls", async () => {
  const config = { origin: "https://fixture.invalid", secret: "fixture", maxCalls: 3 };
  const request = vi.fn().mockResolvedValueOnce(Response.json({ state: "partial" }))
    .mockResolvedValueOnce(Response.json({ state: "complete" }));
  expect(await dispatchRefresh(config, request)).toMatchObject({ state: "complete", calls: 2 });
  expect(request.mock.calls[0][0].pathname).toBe("/api/analytics/ingest/refresh");
  const ambiguous = vi.fn().mockRejectedValue(new Error("lost"));
  await expect(dispatchRefresh(config, ambiguous)).rejects.toThrow("lost");
  expect(ambiguous).toHaveBeenCalledTimes(1);
  const blocked = vi.fn().mockResolvedValue(Response.json({ state: "ambiguous" }));
  expect(await dispatchRefresh(config, blocked)).toEqual({ state: "stopped", calls: 1 });
});
