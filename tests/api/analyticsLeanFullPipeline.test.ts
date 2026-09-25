import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runFullPipeline } from "@/lib/analytics/fullPipeline";
import { deferredOrders, verifyDeferredReplacements } from "@/lib/analytics/deferredCommerce";
import { fullFixture, fullProject, fullShop } from "../fixtures/analyticsFull";

const jobs = vi.hoisted(() => ({
  history: vi.fn(), spend: vi.fn(), reports: vi.fn(), full: vi.fn(),
}));
vi.mock("@/lib/analytics/historyJob", () => ({ runHistoryJob: jobs.history }));
vi.mock("@/lib/analytics/googleSpendJob", () => ({ runGoogleSpendJob: jobs.spend }));
vi.mock("@/lib/analytics/observedReportJob", () => ({ runObservedReportJob: jobs.reports }));
vi.mock("@/lib/analytics/fullReportJob", () => ({ runFullReportJob: jobs.full }));
const options = (next: unknown) => ({
  client: { rpc: vi.fn(async () => ({ data: next, error: null })) },
  projectRef: fullProject, databaseUrl: `https://${fullProject}.supabase.co`, runId: "full-run",
  shop: fullShop, shopifyToken: "fixture:shopify", posthogKey: "fixture:posthog",
  googleClientId: "fixture:client", googleClientSecret: "fixture:secret",
  googleRefreshToken: "fixture:refresh",
  now: "2026-03-02T00:00:00Z",
});
beforeEach(() => {
  vi.stubGlobal("fetch", () => { throw new Error("external_network_forbidden"); });
  for (const fn of Object.values(jobs)) fn.mockReset().mockResolvedValue({ state: "complete" });
});
afterEach(() => vi.unstubAllGlobals());
it("runs only the exact saved dependency and carries server credentials to the proper adapter", async () => {
  for (const stage of ["history", "spend", "reports", "full"] as const) {
    for (const fn of Object.values(jobs)) fn.mockClear();
    const input = options({ state: "ready", stage, runId: `${stage}-saved`, shop: fullShop });
    expect(await runFullPipeline(input)).toMatchObject({ state: stage === "full" ? "complete" : "partial" });
    expect(input.client.rpc).toHaveBeenCalledWith("lean_full_next", { p_run: "full-run", p_project_ref: fullProject });
    expect(jobs[stage]).toHaveBeenCalledTimes(1);
    expect(jobs[stage].mock.calls[0][0]).toMatchObject({ runId: `${stage}-saved`, projectRef: fullProject });
    for (const [name, fn] of Object.entries(jobs)) if (name !== stage) expect(fn).not.toHaveBeenCalled();
    if (stage === "spend") expect(jobs.spend.mock.calls[0][0]).toMatchObject({ refreshToken: "fixture:refresh" });
  }
});
it("stops before any source read when disabled, blocked, completed, or scoped to another shop", async () => {
  for (const state of ["disabled", "blocked", "complete"])
    expect(await runFullPipeline(options({ state }))).toEqual({ state });
  await expect(runFullPipeline(options({ state: "ready", stage: "history", runId: "h", shop: "other.myshopify.com" })))
    .rejects.toThrow("pipeline_shop_mismatch");
  for (const fn of Object.values(jobs)) expect(fn).not.toHaveBeenCalled();
});
it("does not retry failed or busy source jobs and rejects unknown stages", async () => {
  jobs.spend.mockResolvedValue({ state: "failed" });
  expect(await runFullPipeline(options({ state: "ready", stage: "spend", runId: "s" })))
    .toEqual({ state: "failed", stage: "spend" });
  expect(jobs.spend).toHaveBeenCalledTimes(1);
  await expect(runFullPipeline(options({ state: "ready", stage: "publish", runId: "s" }))).rejects.toThrow("invalid_full_stage");
});
it("requires an exact revision and evidence reference for each deferred original purchase", () => {
  const f = fullFixture();
  const rows = deferredOrders([{ orderGid: "gid://shopify/Order/1",
    sourceUpdatedAt: f.snapshot.updatedAt, evidenceRef: "fixture:original" }]);
  expect(() => verifyDeferredReplacements(rows, f.evidence, fullShop)).toThrow("missing_revision_bound");
  f.evidence.replacements = [{ snapshot: f.snapshot, decision: {
    eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: true, approvalRef: "fixture:approved",
  }, movements: [], payments: [], evidenceRef: "fixture:original" }];
  expect(() => verifyDeferredReplacements(rows, f.evidence, fullShop)).not.toThrow();
  f.evidence.replacements[0].snapshot.updatedAt = "2026-01-02T00:00:00Z";
  expect(() => verifyDeferredReplacements(rows, f.evidence, fullShop)).toThrow("missing_revision_bound");
  expect(() => deferredOrders([...rows, ...rows])).toThrow("invalid_deferred_order");
});
