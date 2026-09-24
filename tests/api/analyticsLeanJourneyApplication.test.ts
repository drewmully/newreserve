import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
const ports = vi.hoisted(() => ({ attach: vi.fn(), capture: vi.fn(), legacy: vi.fn(), lead: vi.fn() }));
vi.mock("@/lib/analytics/journeyRuntime", () => ({
  attachJourneyCart: ports.attach, captureJourney: ports.capture,
  stableJourneyAction: (value: string) => `stable:${value}`,
}));
vi.mock("@/lib/stylegame/analytics", () => ({ captureStylegameEvent: ports.legacy }));
vi.mock("@/lib/stylegame/lead", () => ({ insertPlayedLead: ports.lead }));
import { GET as checkout } from "@/app/api/stylegame/checkout/route";
import { POST as played } from "@/app/api/stylegame/played/route";
const cart = "gid://shopify/Cart/cart_fixture?key=fixture_key";
const checkoutUrl = "https://fixture.myshopify.com/checkouts/fixture";
beforeEach(() => {
  vi.clearAllMocks();
  ports.attach.mockResolvedValue(false); ports.capture.mockResolvedValue(false);
  ports.legacy.mockResolvedValue(undefined);
  ports.lead.mockResolvedValue({ id: "fixture-lead", created: true });
  vi.stubEnv("NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN", "fixture.myshopify.com");
  vi.stubEnv("NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN", "fixture");
  vi.stubEnv("SHOPIFY_STYLEGAME_SELLING_PLAN_ID", "123");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("preserves a real checkout redirect when auxiliary tracking declines", async () => {
  const request = new NextRequest("https://fixture.invalid/api/stylegame/checkout?profile=fixture");
  const transport = vi.fn<typeof fetch>(async () => Response.json({
    data: { cartCreate: { cart: { id: cart, checkoutUrl }, userErrors: [] } },
  }));
  vi.stubGlobal("fetch", transport);
  const response = await checkout(request);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(checkoutUrl);
  expect(ports.attach).toHaveBeenCalledWith(request, cart);
  expect(ports.capture).toHaveBeenCalledWith(request, "sg_checkout_start", `stable:${cart}`);
  expect(ports.legacy).toHaveBeenCalledTimes(1);
  const query = JSON.parse(String(transport.mock.calls[0][1]?.body)).query;
  expect(query).toContain("cart { id checkoutUrl }");
});
it("does not emit new checkout evidence when Shopify fails to create a cart", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    data: { cartCreate: { cart: null, userErrors: [{ message: "fixture unavailable" }] } },
  })));
  const response = await checkout(new NextRequest("https://fixture.invalid/api/stylegame/checkout"));
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(ports.attach).not.toHaveBeenCalled();
  expect(ports.capture).not.toHaveBeenCalled();
});
it("uses the saved lead action on retries without duplicating the existing advertising event", async () => {
  const request = () => new NextRequest("https://fixture.invalid/api/stylegame/played", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quiz_result: { profile: "fixture", name: "Fixture", confidence: 1 } }),
  });
  expect((await played(request())).status).toBe(200);
  ports.lead.mockResolvedValue({ id: "fixture-lead", created: false });
  expect((await played(request())).status).toBe(200);
  expect(ports.legacy).toHaveBeenCalledTimes(1);
  expect(ports.capture).toHaveBeenCalledTimes(2);
  expect(ports.capture.mock.calls.map(c => c.slice(1))).toEqual([
    ["sg_played", "stable:stylegame-played:fixture-lead"],
    ["sg_played", "stable:stylegame-played:fixture-lead"],
  ]);
});
it("keeps all executable Style Game inline scripts syntactically valid", () => {
  const html = readFileSync("public/lp/stylegame/index.html", "utf8");
  let checked = 0;
  for (const [, attributes, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(attributes) || /\btype\s*=\s*["']application\//.test(attributes) || !code.trim()) continue;
    expect(() => new Script(code)).not.toThrow();
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
});
