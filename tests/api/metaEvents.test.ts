import { describe, expect, it } from "vitest";
import {
  META_CUSTOM_EVENTS,
  META_STANDARD_EVENTS,
  buildMetaCapiCustomData,
  buildMetaStandardData,
  shopifyNumericId,
} from "@/lib/metaEvents";

describe("META_STANDARD_EVENTS", () => {
  it("maps shop PDP views to ViewContent", () => {
    expect(META_STANDARD_EVENTS.proshop_product_viewed).toBe("ViewContent");
  });
  it("sends quiz progress as custom events, not cart/checkout", () => {
    expect(META_STANDARD_EVENTS.quiz_step_completed).toBe("QuizStep");
    expect(META_STANDARD_EVENTS.quiz_started).toBe("QuizStart");
    expect(META_CUSTOM_EVENTS.has("QuizStep")).toBe(true);
    expect(META_CUSTOM_EVENTS.has("QuizStart")).toBe(true);
  });
  it("keeps the real Reserve checkout start and Purchase standard", () => {
    expect(META_STANDARD_EVENTS.reveal_cta_clicked).toBe("InitiateCheckout");
    for (const e of ["AddToCart", "InitiateCheckout", "Purchase", "ViewContent"]) {
      expect(META_CUSTOM_EVENTS.has(e)).toBe(false);
    }
  });
  it("keeps the existing funnel mappings", () => {
    expect(META_STANDARD_EVENTS.add_to_cart).toBe("AddToCart");
    expect(META_STANDARD_EVENTS.checkout_clicked).toBe("InitiateCheckout");
    expect(META_STANDARD_EVENTS.purchase).toBe("Purchase");
    expect(META_STANDARD_EVENTS.page_view).toBe("PageView");
  });
});

describe("shopifyNumericId", () => {
  it("strips Shopify variant GIDs to the numeric id", () => {
    expect(shopifyNumericId("gid://shopify/ProductVariant/50380713099456")).toBe("50380713099456");
  });
  it("keeps non-GID strings (slugs) as-is", () => {
    expect(shopifyNumericId("winston-golf-tour-towel")).toBe("winston-golf-tour-towel");
  });
});

describe("buildMetaStandardData", () => {
  it("builds ViewContent product data from a PDP view", () => {
    const d = buildMetaStandardData("proshop_product_viewed", {
      product_slug: "winston-golf-tour-towel",
      variant_id: "gid://shopify/ProductVariant/50380713099456",
      name: "Winston Golf Tour Towel",
      brand: "Winston",
      price: 19.99,
    });
    expect(d).toMatchObject({
      content_ids: ["50380713099456"],
      content_type: "product",
      content_name: "Winston Golf Tour Towel",
      value: 19.99,
      currency: "USD",
    });
  });

  it("builds AddToCart data with quantity", () => {
    const d = buildMetaStandardData("add_to_cart", {
      product_id: "polo",
      variant_id: "gid://shopify/ProductVariant/123456789",
      value: "98.00",
      quantity: 2,
    });
    expect(d.content_ids).toEqual(["123456789"]);
    expect(d.contents).toEqual([{ id: "123456789", quantity: 2, item_price: 98 }]);
    expect(d.value).toBe(98);
  });

  it("builds InitiateCheckout value from the cart", () => {
    expect(
      buildMetaStandardData("checkout_clicked", { cart_total: 120, cart_items: 3, currency: "USD" })
    ).toEqual({ value: 120, currency: "USD", num_items: 3 });
  });

  it("returns nothing for PageView and unmapped events", () => {
    expect(buildMetaStandardData("page_view", { path: "/" })).toEqual({});
    expect(buildMetaStandardData("proshop_view", { path: "/shop" })).toEqual({});
  });
});

describe("buildMetaCapiCustomData", () => {
  it("drops identifiers, tokens and raw query strings", () => {
    const d = buildMetaCapiCustomData("add_to_cart", {
      fbp: "fb.1.1.1",
      fbc: "fb.1.1.abc",
      anonymous_id: "anon-1",
      session_id: "s",
      $session_id: "s",
      event_id: "evt-1",
      query: "?email=a@b.com",
      checkout_url: "https://checkout.mymully.com/cart/c/token",
      variant_id: "gid://shopify/ProductVariant/123456789",
      value: 10,
      path: "/shop/polo",
    });
    for (const k of ["fbp", "fbc", "anonymous_id", "session_id", "$session_id", "event_id", "query", "checkout_url"]) {
      expect(d).not.toHaveProperty(k);
    }
    expect(d.path).toBe("/shop/polo");
    expect(d.content_ids).toEqual(["123456789"]);
  });
});
