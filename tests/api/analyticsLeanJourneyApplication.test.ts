import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { webcrypto } from "node:crypto";
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
it.each(["randomUUID", "getRandomValues", "unavailable", "disabled"] as const)(
  "tracks Text Mully views and single clicks without claiming activation (%s)",
  async mode => {
    const page = readFileSync("src/app/text-mully/page.tsx", "utf8");
    const template = page.match(/const bootstrap = `([\s\S]*?)`;/)?.[1];
    expect(template).toBeTruthy();
    const script = template!
      .replaceAll("${leanJourneysJson}", String(mode !== "disabled"))
      .replaceAll("${defaultSrcJson}", JSON.stringify("email"))
      .replaceAll("${bodiesJson}", JSON.stringify({ email: "Fixture message" }))
      .replaceAll("${numberE164Json}", JSON.stringify("+15555550123"));
    const listeners: Record<string, () => void> = {};
    const attributes: Record<string, string> = {};
    const anchor = {
      setAttribute: (key: string, value: string) => { attributes[key] = value; },
      addEventListener: (name: string, listener: () => void) => { listeners[name] = listener; },
    };
    const requests: Blob[] = [];
    const navigator = { userAgent: "Desktop", sendBeacon: (url: string, body: Blob) => {
      expect(url).toBe("/api/analytics/track"); requests.push(body); return true;
    } };
    const location = { search: "?src=email", href: "https://fixture.invalid/text-mully?src=email" };
    const crypto = mode === "randomUUID" ? webcrypto
      : mode === "getRandomValues" ? { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } : undefined;
    new Script(script).runInNewContext({
      window: { location, crypto }, navigator, URLSearchParams, Blob, Uint8Array,
      document: { querySelectorAll: () => [anchor], addEventListener: vi.fn() },
      setTimeout: vi.fn(), Element: class {},
    });
    expect(Object.keys(listeners)).toEqual(mode === "disabled" ? ["pointerdown", "click"] : ["click"]);
    expect(attributes.href).toBe("sms:+15555550123?&body=Fixture%20message");
    listeners.click(); listeners.click();
    const payloads = await Promise.all(requests.map(async body => JSON.parse(await body.text())));
    expect(payloads.map(p => p.event_name)).toEqual(["lp_text_mully_view", "sms_click", "sms_click"]);
    const ids = payloads.map(p => p.properties.event_id);
    if (mode === "disabled") {
      expect(ids[0]).toBeUndefined();
      expect(ids.slice(1).every(id => typeof id === "string" && id.length > 0)).toBe(true);
    } else if (mode === "unavailable") expect(ids).toEqual([null, null, null]);
    else {
      for (const id of ids) expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
      expect(new Set(ids).size).toBe(3);
    }
    expect(location.href).toBe("https://fixture.invalid/text-mully?src=email");
  },
);
