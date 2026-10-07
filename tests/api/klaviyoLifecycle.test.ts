/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  identityCookie,
  identityKey,
  profileAttributes,
  resolveKlaviyoIdentity,
  signIdentityToken,
  verifyIdentityToken,
} from "@/lib/klaviyo/identity";
import { mapSiteEvent, sendSiteEventToKlaviyo } from "@/lib/klaviyo/siteEvents";
import { buildMemberProfiles, countByStatus } from "@/lib/klaviyo/memberSync";
import { backInStockEventProperties, decideRestock } from "@/lib/klaviyo/restock";
import { isLifecycleEnabled, LIFECYCLE_METRICS } from "@/lib/klaviyo/lifecycleConfig";
import type { ShopifyProduct } from "@/lib/shopify";

const SECRET = "test-secret-test-secret-test-secret-123";
const EMAIL = "drew+synctest1@mullybox.com";
const NOW = Date.parse("2026-10-07T18:00:00Z");

beforeEach(() => {
  process.env.KLAVIYO_IDENTITY_SECRET = SECRET;
  process.env.KLAVIYO_PRIVATE_API_KEY = "pk_test";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KLAVIYO_SITE_EVENTS_ENABLED;
});

describe("feature flags", () => {
  it("is off unless the flag and the key are both set", () => {
    expect(isLifecycleEnabled("site_events")).toBe(false);
    process.env.KLAVIYO_SITE_EVENTS_ENABLED = "true";
    expect(isLifecycleEnabled("site_events")).toBe(true);
    delete process.env.KLAVIYO_PRIVATE_API_KEY;
    expect(isLifecycleEnabled("site_events")).toBe(false);
  });
});

describe("identity", () => {
  it("round-trips a signed token and rejects tampering and expiry", () => {
    const token = signIdentityToken(EMAIL, SECRET, NOW);
    expect(verifyIdentityToken(token, SECRET, NOW)).toBe(EMAIL);
    expect(verifyIdentityToken(token, "another-secret-another-secret-12345", NOW)).toBeNull();
    const [v, , exp, mac] = token.split(".");
    const forged = [v, Buffer.from("victim@example.com").toString("base64url"), exp, mac].join(".");
    expect(verifyIdentityToken(forged, SECRET, NOW)).toBeNull();
    expect(verifyIdentityToken(token, SECRET, NOW + 181 * 86_400_000)).toBeNull();
    expect(verifyIdentityToken("garbage", SECRET, NOW)).toBeNull();
  });

  it("prefers verified email, then cookie, then Klaviyo exchange id", () => {
    const cookie = `other=1; mully_kid=${encodeURIComponent(signIdentityToken(EMAIL, SECRET, NOW))}`;
    expect(resolveKlaviyoIdentity({ verifiedEmail: "Member@Example.com", cookieHeader: cookie, exchangeId: "abcdefgh123" }, NOW))
      .toEqual({ kind: "verified", email: "member@example.com" });
    expect(resolveKlaviyoIdentity({ cookieHeader: cookie, exchangeId: "abcdefgh123" }, NOW))
      .toEqual({ kind: "cookie", email: EMAIL });
    expect(resolveKlaviyoIdentity({ exchangeId: "abcdefgh123" }, NOW)).toEqual({ kind: "exchange", kx: "abcdefgh123" });
    expect(resolveKlaviyoIdentity({ exchangeId: "<script>" }, NOW)).toBeNull();
    expect(resolveKlaviyoIdentity({}, NOW)).toBeNull();
  });

  it("ignores the cookie when no signing secret is configured", () => {
    const cookie = `mully_kid=${encodeURIComponent(signIdentityToken(EMAIL, SECRET, NOW))}`;
    delete process.env.KLAVIYO_IDENTITY_SECRET;
    expect(resolveKlaviyoIdentity({ cookieHeader: cookie }, NOW)).toBeNull();
    expect(identityCookie(EMAIL, NOW)).toBeNull();
  });

  it("builds an httpOnly cookie and never exposes email in the unique key", () => {
    const c = identityCookie(EMAIL, NOW)!;
    expect(c).toMatchObject({ name: "mully_kid", httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    const key = identityKey({ kind: "cookie", email: EMAIL });
    expect(key).toMatch(/^[a-f0-9]{24}$/);
    expect(key).not.toContain("drew");
    expect(profileAttributes({ kind: "exchange", kx: "abcdefgh123" })).toEqual({ _kx: "abcdefgh123" });
  });
});

describe("mapSiteEvent", () => {
  it("maps a product view with a safe URL and image", () => {
    const m = mapSiteEvent("proshop_product_viewed", {
      product_slug: "rhone-polo", name: "Rhone Polo", brand: "Rhone", collection: "Polos",
      price: 108, reserve_price: 91.8, image_url: "https://cdn.shopify.com/s/files/x.jpg", variant_id: "gid://shopify/ProductVariant/1",
    }, NOW)!;
    expect(m.metric).toBe(LIFECYCLE_METRICS.viewedProduct);
    expect(m.properties).toMatchObject({
      ProductID: "rhone-polo", ProductName: "Rhone Polo", Brand: "Rhone", Categories: ["Polos"],
      Price: 108, MemberPrice: 91.8, URL: "https://www.mymully.com/shop/rhone-polo",
      ImageURL: "https://cdn.shopify.com/s/files/x.jpg",
    });
    expect(m.value).toBe(108);
  });

  it("drops unsafe image and checkout hosts", () => {
    const view = mapSiteEvent("proshop_product_viewed", { product_slug: "a", name: "A", image_url: "https://evil.example/x.jpg" }, NOW)!;
    expect(view.properties.ImageURL).toBeUndefined();
    const cart = mapSiteEvent("add_to_cart", {
      product_id: "a", name: "A", value: 50, checkout_url: "https://evil.example/cart",
    }, NOW)!;
    expect(cart.properties.CheckoutURL).toBeUndefined();
  });

  it("maps add to cart with the restorable checkout link and cart context", () => {
    const m = mapSiteEvent("add_to_cart", {
      product_id: "duck-head-shorts", name: "Duck Head Shorts", brand: "Duck Head", value: 98,
      variant_id: "gid://shopify/ProductVariant/9", variant_title: "34",
      checkout_url: "https://checkout.mymully.com/cart/c/abc?key=1", cart_total: 206, cart_item_count: 2,
      cart_item_names: ["Duck Head Shorts", "Rhone Polo"],
    }, NOW)!;
    expect(m.metric).toBe(LIFECYCLE_METRICS.addedToCart);
    expect(m.value).toBe(206);
    expect(m.properties).toMatchObject({
      AddedItemProductID: "duck-head-shorts", AddedItemVariantTitle: "34",
      CheckoutURL: "https://checkout.mymully.com/cart/c/abc?key=1", CartItemCount: 2,
      ItemNames: ["Duck Head Shorts", "Rhone Polo"],
    });
  });

  it("counts checkout_clicked as Reserve intent only for plan checkouts", () => {
    expect(mapSiteEvent("checkout_clicked", { source: "shop_cart", cart_total: 90 }, NOW)).toBeNull();
    expect(mapSiteEvent("checkout_clicked", { cart_total: 90 }, NOW)).toBeNull();
    expect(mapSiteEvent("checkout_clicked", { source: "choose_plan", plan: "member" }, NOW)!.properties)
      .toMatchObject({ IntentSource: "checkout_clicked", Plan: "member" });
  });

  it("maps Reserve intent events and ignores everything else", () => {
    const m = mapSiteEvent("shop_outfit_reserve_clicked", { source: "shop_guided_outfit", products: ["a", "b", "BAD SLUG"] }, NOW)!;
    expect(m.metric).toBe(LIFECYCLE_METRICS.reserveIntent);
    expect(m.properties.Products).toEqual(["a", "b"]);
    expect(m.properties.ReserveURL).toBe("https://www.mymully.com/subscription");
    expect(mapSiteEvent("page_view", {}, NOW)).toBeNull();
    expect(mapSiteEvent("proshop_product_viewed", { name: "No slug" }, NOW)).toBeNull();
  });

  it("dedupes repeat views inside the window but not across windows", () => {
    const a = mapSiteEvent("proshop_product_viewed", { product_slug: "a", name: "A" }, NOW)!;
    const b = mapSiteEvent("proshop_product_viewed", { product_slug: "a", name: "A" }, NOW + 5 * 60_000)!;
    const c = mapSiteEvent("proshop_product_viewed", { product_slug: "a", name: "A" }, NOW + 45 * 60_000)!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(a.dedupeKey).not.toBe(c.dedupeKey);
  });
});

describe("sendSiteEventToKlaviyo", () => {
  it("posts one event with a unique_id and identity source, and never throws", async () => {
    const calls: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("", { status: 202 });
    }));
    const mapped = mapSiteEvent("proshop_product_viewed", { product_slug: "a", name: "A" }, NOW)!;
    expect(await sendSiteEventToKlaviyo({ kind: "exchange", kx: "abcdefgh123" }, mapped, NOW)).toBe("sent");
    const attrs = calls[0].body.data.attributes;
    expect(calls[0].url).toBe("https://a.klaviyo.com/api/events");
    expect(attrs.profile.data.attributes).toEqual({ _kx: "abcdefgh123" });
    expect(attrs.metric.data.attributes.name).toBe("Mully Viewed Product");
    expect(attrs.properties.IdentitySource).toBe("exchange");
    expect(attrs.unique_id).toMatch(/^[a-f0-9]{24}:view:a:\d+$/);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    expect(await sendSiteEventToKlaviyo({ kind: "cookie", email: EMAIL }, mapped, NOW)).toBe("failed");
  });
});

describe("buildMemberProfiles", () => {
  const loop = [
    { email: "A@x.com", status: "inactive", sku: "RES-MEM", completed_orders: 3, next_billing_at: null, last_payment_status: "SUCCESS", last_loop_order_at: "2026-01-01T00:00:00Z" },
    { email: "a@x.com", status: "active", sku: "RES-MEM", completed_orders: 2, next_billing_at: "2026-11-01T00:00:00Z", last_payment_status: "SUCCESS", last_loop_order_at: "2026-08-01T00:00:00Z" },
    { email: "b@x.com", status: "paused", sku: "RES-ACC", completed_orders: 5, next_billing_at: "2026-12-01T00:00:00Z", last_payment_status: null, last_loop_order_at: null },
    { email: "c@x.com", status: "inactive", sku: "BCK-9", completed_orders: 1, next_billing_at: null, last_payment_status: "FAILED", last_loop_order_at: null },
  ];
  const subs = [
    { email: "a@x.com", status: "active", acquired_at: "2025-03-01T00:00:00Z", churned_at: null, plan_code: "reserve_member", updated_at: "2026-10-07T00:00:00Z" },
    { email: "c@x.com", status: "inactive", acquired_at: "2025-01-01T00:00:00Z", churned_at: "2026-09-30T00:00:00Z", plan_code: "back9_legacy", updated_at: "2026-10-01T00:00:00Z" },
    { email: "old@x.com", status: "inactive", acquired_at: "2023-01-01T00:00:00Z", churned_at: "2024-02-01T00:00:00Z", plan_code: null, updated_at: "2026-05-22T00:00:00Z" },
  ];

  it("collapses to one profile per email with the strongest status", () => {
    const out = buildMemberProfiles(loop, subs, { now: new Date(NOW) });
    const a = out.find((p) => p.email === "a@x.com")!;
    expect(a.properties).toMatchObject({
      mully_member_status: "active", mully_member_plan: "reserve_member", mully_member_completed_orders: 5,
      mully_member_since: "2025-03-01T00:00:00.000Z", mully_member_next_billing_at: "2026-11-01T00:00:00.000Z",
      mully_member_last_order_at: "2026-08-01T00:00:00.000Z",
    });
    expect(a.properties.mully_member_cancelled_at).toBeUndefined();
    const c = out.find((p) => p.email === "c@x.com")!;
    expect(c.properties).toMatchObject({ mully_member_status: "cancelled", mully_member_cancelled_at: "2026-09-30T00:00:00.000Z" });
    expect(c.properties.mully_member_next_billing_at).toBeUndefined();
    expect(countByStatus(out)).toEqual({ active: 1, paused: 1, cancelled: 1 });
  });

  it("adds historical cancellations only when asked", () => {
    expect(buildMemberProfiles(loop, subs).some((p) => p.email === "old@x.com")).toBe(false);
    const full = buildMemberProfiles(loop, subs, { cancelledHistory: () => true });
    expect(full.find((p) => p.email === "old@x.com")!.properties).toMatchObject({ mully_member_status: "cancelled" });
  });
});

describe("decideRestock", () => {
  const variant = (id: string, size: string, available: boolean, preorder = false) => ({
    id, title: size, price: 120, reservePrice: 102, availableForSale: available, currentlyNotInStock: preorder,
    selectedOptions: [{ name: "Size", value: size }],
  });
  const product = (variants: any[]): ShopifyProduct => ({
    slug: "layer", name: "Layer", brand: "Olydoe", collection: "Layers", price: 120, reservePrice: 102,
    images: ["https://cdn.shopify.com/x.jpg"], description: "", material: "", aboutBrand: "", whyWeLikeIt: "",
    sizing: "", options: [], variants, variantId: variants[0]?.id,
  });
  const req = { id: "r1", email: EMAIL, productSlug: "layer", variantId: "v-m", size: "M", createdAt: new Date(NOW - 86_400_000) };

  it("notifies only when the requested variant is buyable", () => {
    expect(decideRestock(req, product([variant("v-m", "M", false), variant("v-l", "L", true)]), new Date(NOW)).action).toBe("wait");
    const d = decideRestock(req, product([variant("v-m", "M", true, true)]), new Date(NOW));
    expect(d.action).toBe("notify");
    if (d.action === "notify") {
      const props = backInStockEventProperties(product([d.variant]), d.variant, req);
      expect(props).toMatchObject({ ProductID: "layer", Size: "M", Preorder: true, URL: "https://www.mymully.com/shop/layer" });
    }
  });

  it("falls back to size when the variant id changed, and expires stale or missing products", () => {
    expect(decideRestock({ ...req, variantId: "old" }, product([variant("v-new", "M", true)]), new Date(NOW)).action).toBe("notify");
    expect(decideRestock(req, null, new Date(NOW))).toEqual({ action: "expire", reason: "product_gone" });
    expect(decideRestock({ ...req, createdAt: new Date(NOW - 200 * 86_400_000) }, product([]), new Date(NOW)))
      .toEqual({ action: "expire", reason: "too_old" });
  });
});
