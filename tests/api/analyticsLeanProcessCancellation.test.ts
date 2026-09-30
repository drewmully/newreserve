import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const port = vi.hoisted(() => ({ run: vi.fn(), client: vi.fn(() => ({})) }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: port.client }));
vi.mock("@/lib/analytics/shopifyPipeline", () => ({
  runShopifyPipeline: port.run,
  validatePipelineTarget: vi.fn(),
  pipelineRpc: vi.fn(),
}));
import { POST } from "@/app/api/analytics/ingest/process/route";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("production request cancellation propagation", () => {
  it("passes caller cancellation through the ordinary non-pilot worker route", async () => {
    vi.stubEnv("LEAN_ANALYTICS_PIPELINE_ENABLED", "true");
    vi.stubEnv("LEAN_ANALYTICS_PIPELINE_SECRET", "fixture-only-worker-secret-32-characters");
    vi.stubEnv("LEAN_ANALYTICS_SHOPIFY_PILOT_ID", "");
    vi.stubEnv("LEAN_ANALYTICS_SHOPIFY_PILOT_ENABLED", "false");
    const controller = new AbortController();
    controller.abort();
    port.run.mockResolvedValue({ state: "idle" });
    const response = await POST(new NextRequest("https://fixture.invalid/api/analytics/ingest/process", {
      method: "POST", signal: controller.signal,
      headers: { authorization: "Bearer fixture-only-worker-secret-32-characters" },
    }));
    expect(response.status).toBe(200);
    expect(port.run).toHaveBeenCalledTimes(1);
    expect(port.run.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect(port.run.mock.calls[0][0].signal.aborted).toBe(true);
  });
  it("keeps the disabled route free of worker or database calls", async () => {
    vi.stubEnv("LEAN_ANALYTICS_PIPELINE_ENABLED", "false");
    expect((await POST(new NextRequest("https://fixture.invalid/api/analytics/ingest/process",
      { method: "POST" }))).status).toBe(404);
    expect(port.run).not.toHaveBeenCalled();
    expect(port.client).not.toHaveBeenCalled();
  });
});
