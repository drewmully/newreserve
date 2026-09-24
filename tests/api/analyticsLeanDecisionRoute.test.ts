import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const port = vi.hoisted(() => ({ decide: vi.fn(), auth: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/analytics/journeyDecision", () => ({
  journeyCookieName: "__Host-mully_analytics", decideJourney: port.decide,
}));
vi.mock("@/lib/firebase-admin", () => ({ adminAuth: { verifyIdToken: port.auth } }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: port.limit }));
import { POST } from "@/app/api/analytics/journey/decision/route";
const request = (decision: string, headers: Record<string, string> = {}) =>
  new NextRequest("https://fixture.invalid/api/analytics/journey/decision", {
    method: "POST", headers: { origin: "https://fixture.invalid", "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ decision }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LEAN_ANALYTICS_JOURNEYS_ENABLED", "true");
  vi.stubEnv("LEAN_ANALYTICS_SITE_ORIGIN", "https://fixture.invalid");
  port.limit.mockReturnValue({ allowed: true }); port.auth.mockResolvedValue({ uid: "verified" });
  port.decide.mockResolvedValue({ token: "b".repeat(64), maxAge: 3600 });
});
afterEach(() => vi.unstubAllEnvs());
it("sets only the secure opaque cookie after a confirmed decision", async () => {
  const response = await POST(request("allow", { authorization: "Bearer fixture" }));
  expect(response.status).toBe(204);
  expect(port.decide).toHaveBeenCalledWith(expect.any(NextRequest), "allow", "verified");
  expect(response.headers.get("set-cookie")).toContain("__Host-mully_analytics=" + "b".repeat(64));
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-cookie")).toContain("Secure");
  expect(response.headers.get("set-cookie")).toContain("SameSite=strict");
});
it("clears the cookie only after confirmed withdrawal and fails closed otherwise", async () => {
  port.decide.mockResolvedValueOnce({ token: "", maxAge: 0 });
  const removed = await POST(request("withdraw"));
  expect(removed.status).toBe(204);
  expect(removed.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  port.decide.mockRejectedValueOnce(new Error("ambiguous"));
  const failed = await POST(request("withdraw"));
  expect(failed.status).toBe(503);
  expect(failed.headers.get("set-cookie")).toBeNull();
});
it("rejects unknown decisions, cross-origin calls and disabled collection", async () => {
  expect((await POST(request("marketing_opt_in"))).status).toBe(400);
  expect((await POST(request("allow", { origin: "https://attacker.invalid" }))).status).toBe(403);
  vi.stubEnv("LEAN_ANALYTICS_JOURNEYS_ENABLED", "false");
  expect((await POST(request("allow"))).status).toBe(404);
  expect(port.decide).not.toHaveBeenCalled();
  port.decide.mockResolvedValueOnce({ token: "", maxAge: 0 });
  expect((await POST(request("withdraw"))).status).toBe(204);
});
