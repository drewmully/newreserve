import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const ports = vi.hoisted(() => ({ attach: vi.fn(), capture: vi.fn(), auth: vi.fn(), limit: vi.fn(),
  apps: vi.fn(), clientAuth: vi.fn(), token: vi.fn() }));
vi.mock("firebase/app", () => ({ getApps: ports.apps }));
vi.mock("firebase/auth", () => ({ getAuth: ports.clientAuth }));
vi.mock("@/lib/analytics/journeyRuntime", () => ({ attachJourneyCart: ports.attach, captureJourney: ports.capture }));
vi.mock("@/lib/firebase-admin", () => ({ adminAuth: { verifyIdToken: ports.auth } }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: ports.limit }));
import { POST as cart } from "@/app/api/analytics/journey/cart/route";
import { POST as event } from "@/app/api/analytics/journey/event/route";
import { recordJourneyCart } from "@/lib/analytics/journeyClient";
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("https://fixture.invalid/api/analytics/journey/cart", { method: "POST",
    headers: { origin: "https://fixture.invalid", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); ports.limit.mockReturnValue({ allowed: true }); ports.auth.mockResolvedValue({ uid: "verified" });
  ports.attach.mockResolvedValue(false); ports.capture.mockResolvedValue(false);
  ports.apps.mockReturnValue([{ name: "[DEFAULT]" }]);
  ports.clientAuth.mockReturnValue({ currentUser: { getIdToken: ports.token } });
  ports.token.mockResolvedValue("existing_token");
  vi.stubEnv("LEAN_ANALYTICS_JOURNEYS_ENABLED", "true");
  vi.stubEnv("LEAN_ANALYTICS_SITE_ORIGIN", "https://fixture.invalid");
});
it("reuses the existing Firebase principal but never invents one or downgrades auth errors", async () => {
  vi.stubGlobal("window", {}); vi.stubEnv("NEXT_PUBLIC_LEAN_ANALYTICS_JOURNEYS_ENABLED", "true");
  const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetcher);
  await recordJourneyCart("cart");
  expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer existing_token" });
  fetcher.mockClear(); ports.token.mockRejectedValue(new Error("expired"));
  await expect(recordJourneyCart("cart")).resolves.toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
  ports.apps.mockReturnValue([]);
  await recordJourneyCart("cart");
  expect(fetcher.mock.calls[0][1]?.headers).toEqual({ "Content-Type": "application/json" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("does no work by default and refuses cross-site or oversized bodies", async () => {
  vi.stubEnv("LEAN_ANALYTICS_JOURNEYS_ENABLED", "false");
  expect((await cart(req({ cartId: "cart" }))).status).toBe(404);
  vi.stubEnv("LEAN_ANALYTICS_JOURNEYS_ENABLED", "true");
  expect((await cart(req({ cartId: "cart" }, { origin: "https://attacker.invalid" }))).status).toBe(403);
  expect((await cart(req({ cartId: "x".repeat(1100) }))).status).toBe(413);
  expect(ports.attach).not.toHaveBeenCalled();
});
it("rejects client identity or consent claims and verifies optional Firebase tokens", async () => {
  expect((await cart(req({ cartId: "cart", analytics_permitted: true }))).status).toBe(400);
  expect((await cart(req({ cartId: "cart", uid: "forged" }))).status).toBe(400);
  expect((await cart(req({ cartId: "cart" }, { authorization: "Bearer token" }))).status).toBe(204);
  expect(ports.auth).toHaveBeenCalledWith("token", true);
  expect(ports.attach).toHaveBeenCalledWith(expect.any(NextRequest), "cart", "verified");
  ports.auth.mockRejectedValue(new Error("revoked"));
  expect((await cart(req({ cartId: "cart" }, { authorization: "Bearer revoked" }))).status).toBe(401);
});
it("does not disclose whether permission exists and limits requests", async () => {
  const response = await event(req({ eventName: "sg_begin", actionId: "fixture" }));
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  ports.limit.mockReturnValue({ allowed: false });
  expect((await event(req({ eventName: "sg_begin", actionId: "fixture" }))).status).toBe(429);
});
it("keeps the client handoff default-off and nonfatal on network failure", async () => {
  vi.stubGlobal("window", {});
  const fetcher = vi.fn(async () => { throw new Error("offline"); }); vi.stubGlobal("fetch", fetcher);
  await recordJourneyCart("cart"); expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv("NEXT_PUBLIC_LEAN_ANALYTICS_JOURNEYS_ENABLED", "true");
  await expect(recordJourneyCart("cart", "verified_token")).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledWith("/api/analytics/journey/cart", expect.objectContaining({
    credentials: "same-origin", body: JSON.stringify({ cartId: "cart" }),
    headers: { "Content-Type": "application/json", Authorization: "Bearer verified_token" },
  }));
});
