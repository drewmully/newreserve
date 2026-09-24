import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const ports = vi.hoisted(() => ({
  attach: vi.fn(), verify: vi.fn(), get: vi.fn(), set: vi.fn(),
}));
vi.mock("@/lib/analytics/journeyRuntime", () => ({ attachJourneyDraft: ports.attach }));
vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken: ports.verify },
  adminDb: { collection: () => ({ doc: () => ({ get: ports.get, set: ports.set }) }) },
}));
vi.mock("@/lib/shopify", () => ({ MEMBER_DISCOUNT_RATE: .15 }));
import { POST } from "@/app/api/shopify/checkout/route";
const invoice = "https://fixture.myshopify.com/invoice/1";
function request() {
  return new NextRequest("https://fixture.invalid/api/shopify/checkout", {
    method: "POST", headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" },
    body: JSON.stringify({ checkoutUrl: "https://fixture.myshopify.com/checkouts/cart",
      cartItems: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1, retailPrice: 20 }] }),
  });
}
function draft(id = 123, status = "open") {
  return Response.json({ draft_order: { id, status, invoice_url: invoice } });
}
beforeEach(() => {
  vi.clearAllMocks();
  ports.verify.mockResolvedValue({ uid: "fixture-uid" });
  ports.get.mockResolvedValue({ data: () => ({ tier: "access" }) });
  ports.set.mockResolvedValue(undefined); ports.attach.mockResolvedValue(false);
  vi.stubEnv("SHOPIFY_STORE_DOMAIN", "fixture.myshopify.com");
  vi.stubEnv("SHOPIFY_ADMIN_TOKEN", "fixture-token");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("records only the successfully created draft and preserves checkout when tracking declines", async () => {
  const transport = vi.fn<typeof fetch>(async () => draft());
  vi.stubGlobal("fetch", transport);
  const req = request(), response = await POST(req);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ checkoutUrl: invoice });
  expect(ports.attach).toHaveBeenCalledWith(req, "123", "fixture.myshopify.com", "fixture-uid");
  expect(transport).toHaveBeenCalledTimes(1);
  expect(ports.verify).toHaveBeenCalledWith("fixture", true);
});
it("records a reused draft only when both lookup and update return the same ID", async () => {
  ports.get.mockResolvedValue({ data: () => ({ tier: "access", shopify_open_draft_id: 123 }) });
  const transport = vi.fn().mockResolvedValueOnce(draft()).mockResolvedValueOnce(draft());
  vi.stubGlobal("fetch", transport);
  expect((await POST(request())).status).toBe(200);
  expect(ports.attach.mock.calls[0][1]).toBe("123");
  expect(transport.mock.calls.map(c => c[1]?.method ?? "GET")).toEqual(["GET", "PUT"]);
});
it.each([[456, 123], [123, 456]])("does not guess an identity from mismatched draft responses (%s/%s)", async (lookup, update) => {
  ports.get.mockResolvedValue({ data: () => ({ tier: "access", shopify_open_draft_id: 123 }) });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(draft(lookup)).mockResolvedValueOnce(draft(update)));
  const response = await POST(request());
  expect(await response.json()).toEqual({ checkoutUrl: invoice });
  expect(ports.attach).not.toHaveBeenCalled();
});
it("does not convert a rounded REST ID into an analytics identity", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => draft(Number.MAX_SAFE_INTEGER + 1)));
  expect((await POST(request())).status).toBe(200);
  expect(ports.attach).not.toHaveBeenCalled();
});
it("keeps free checkout outside the paid-draft path", async () => {
  ports.get.mockResolvedValue({ data: () => ({ tier: "free" }) });
  const transport = vi.fn(); vi.stubGlobal("fetch", transport);
  const response = await POST(request());
  expect(await response.json()).toEqual({ checkoutUrl: "https://fixture.myshopify.com/checkouts/cart" });
  expect(transport).not.toHaveBeenCalled(); expect(ports.attach).not.toHaveBeenCalled();
});
it("creates no analytics receipt on an authentication or vendor failure", async () => {
  const transport = vi.fn(async () => new Response("fixture failure", { status: 503 }));
  vi.stubGlobal("fetch", transport);
  ports.verify.mockRejectedValueOnce(new Error("invalid"));
  expect((await POST(request())).status).toBe(401);
  expect(transport).not.toHaveBeenCalled();
  expect((await POST(request())).status).toBe(500);
  expect(ports.attach).not.toHaveBeenCalled();
});
