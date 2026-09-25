import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as history } from "@/app/api/analytics/ingest/history/route";
import { POST as spend } from "@/app/api/analytics/ingest/spend/route";
import { POST as reports } from "@/app/api/analytics/ingest/reports/route";
import { POST as full } from "@/app/api/analytics/ingest/full/route";

const ports = vi.hoisted(() => ({ database: vi.fn(() => { throw new Error("database_forbidden"); }) }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: ports.database }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it.each([
  ["HISTORY", history], ["SPEND", spend], ["REPORTS", reports], ["FULL", full],
] as const)("keeps %s default-off before client construction or network access", async (name, post) => {
  const network = vi.fn(() => { throw new Error("network_forbidden"); });
  vi.stubGlobal("fetch", network);
  for (const value of [undefined, "", "false", "1", "TRUE"]) {
    vi.stubEnv(`LEAN_ANALYTICS_${name}_ENABLED`, value);
    const response = await post(new NextRequest("https://fixture.invalid/api/analytics/ingest", { method: "POST" }));
    expect(response.status).toBe(404);
  }
  expect(ports.database).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it("installs no analytics schedule and disables review-branch deployment", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  expect(config.crons.some((row: { path: string }) => row.path.startsWith("/api/analytics/"))).toBe(false);
  expect(config.git.deploymentEnabled["review/analytics-initial-validation"]).toBe(false);
});
