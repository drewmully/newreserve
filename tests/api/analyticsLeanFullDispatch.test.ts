import { expect, it, vi } from "vitest";
// JavaScript entry point is also importable without starting a scheduler.
import { fullDispatchConfig, dispatchFull } from "../../scripts/analytics/dispatch-full.mjs";
const env = () => Object.fromEntries([["LEAN_ANALYTICS_FULL_DISPATCH_ENABLED", "true"],
  ["LEAN_ANALYTICS_RUNNER_ORIGIN", "https://fixture.invalid"],
  ...["HISTORY", "SPEND", "REPORTS", "FULL"].map(s => [`LEAN_ANALYTICS_${s}_SECRET`, "x".repeat(32)])]);
it("is opt-in and disallows caller-supplied paths or credentials in the origin", () => {
  expect(() => fullDispatchConfig({})).toThrow("disabled");
  expect(() => fullDispatchConfig({ ...env(), LEAN_ANALYTICS_RUNNER_ORIGIN: "https://user:pass@fixture.invalid" })).toThrow("origin");
});
it("resumes saved dependency checkpoints until the full publication completes", async () => {
  const states = ["partial", "partial", "partial", "partial", "complete"];
  const request = vi.fn(async () => Response.json({ state: states.shift() }));
  expect(await dispatchFull(fullDispatchConfig(env()), request)).toEqual({ state: "complete", calls: 5, publication: "private_candidate" });
  expect(request).toHaveBeenCalledTimes(5);
});
it("stops on a missing prerequisite instead of querying later stages", async () => {
  const request = vi.fn(async () => Response.json({ state: "blocked" }));
  expect(await dispatchFull(fullDispatchConfig(env()), request)).toEqual({ state: "stopped", calls: 1 });
  expect(request).toHaveBeenCalledTimes(1);
});
it("does not exceed the configured call budget or automatically retry an HTTP failure", async () => {
  const request = vi.fn(async () => Response.json({ state: "partial" }));
  expect(await dispatchFull(fullDispatchConfig({ ...env(), LEAN_ANALYTICS_FULL_MAX_CALLS: "2" }), request))
    .toEqual({ state: "bounded", calls: 2 });
  const failed = vi.fn(async () => new Response(null, { status: 503 }));
  await expect(dispatchFull(fullDispatchConfig(env()), failed)).rejects.toThrow("unavailable");
  expect(failed).toHaveBeenCalledTimes(1);
});
