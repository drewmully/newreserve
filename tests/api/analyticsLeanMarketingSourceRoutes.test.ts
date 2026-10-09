import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), server: vi.fn() }));
vi.mock("@/app/api/_lib/adminAuth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/analytics/marketingSourceServer", () => ({ marketingSourceServer: mocks.server }));
import { GET as cron } from "@/app/api/admin/cron/marketing-source/[provider]/route";
import { GET as health, POST as admin } from "@/app/api/admin/marketing-sources/route";
describe("mounted marketing source routes", () => {
  it("rejects unauthenticated cron before constructing credential-backed runtime", async () => {
    process.env.CRON_SECRET = "fixture-cron";
    const result = await cron(new Request("https://fixture.invalid/api/admin/cron/marketing-source/google?lane=primary",
      { headers: { "user-agent": "vercel-cron" } }), { params: Promise.resolve({ provider: "google" }) });
    expect(result.status).toBe(401); expect(mocks.server).not.toHaveBeenCalled();
  });
  it("mounted cron reaches default-off claim without native HTTP", async () => {
    process.env.CRON_SECRET = "fixture-cron";
    const request = vi.fn(), rpc = vi.fn(async () => ({ state: "disabled" }));
    mocks.server.mockReturnValue({ env: { CRON_SECRET: "fixture-cron", VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main" }, now: Date.now, request, rpc });
    const result = await cron(new Request("https://fixture.invalid/api/admin/cron/marketing-source/meta?lane=correction",
      { headers: { authorization: "Bearer fixture-cron" } }), { params: Promise.resolve({ provider: "meta" }) });
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ state: "disabled" });
    expect(rpc).toHaveBeenCalledWith("lean_marketing_source_claim", expect.objectContaining({
      p_provider: "meta_ads", p_lane: "correction",
    })); expect(request).not.toHaveBeenCalled();
  });
  it("both mounted admin methods reuse requireAdmin before config, parsing or RPC", async () => {
    mocks.admin.mockResolvedValue({ ok: false });
    for (const [method, handler] of [["GET", health], ["POST", admin]] as const) {
      const result = await handler(new NextRequest("https://fixture.invalid/api/admin/marketing-sources", { method }));
      expect(result.status).toBe(401);
    }
    expect(mocks.admin).toHaveBeenCalledTimes(2); expect(mocks.server).not.toHaveBeenCalled();
  });
});
