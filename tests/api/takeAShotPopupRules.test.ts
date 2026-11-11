import { describe, expect, it } from "vitest";
import {
  CAPS, deviceFor, excludedPath, exitIntentReady, isEmailOrSmsVisit, isPaidSocial, klaviyoCookieKnown,
  launcherVisible, pageKindFor, pageTypeFor, suppressReason, timedTrigger, type SuppressInput,
} from "@/lib/takeAShot/popupRules";
import { takeAShotRedemption } from "@/lib/takeAShot/redemption";
import { formatQuarterPrice, quarterPriceFrom, renewalLine } from "@/lib/takeAShot/reservePrice";

const NOW = 1_800_000_000_000;
const base: SuppressInput = {
  rewardSaved: false, signedUp: false, knownEmail: false, member: false, emailSmsVisit: false,
  excludedPage: false, bag: false, snoozedUntil: 0, sessionAutoOpens: 0, autoOpens: [], now: NOW,
};

describe("storefront page scope", () => {
  it("allows every public storefront page, with a page type", () => {
    const allowed: Array<[string, string, boolean?]> = [
      ["/", "home"], ["/home", "home"], ["/shop", "shop_home"], ["/shop/", "shop_home"],
      ["/shop/collection", "listing"], ["/shop/collection/vests", "listing"], ["/shop/new-arrivals", "listing"],
      ["/shop/vests", "listing"], ["/shop/quarter-zips", "listing"],
      ["/shop/gifts", "gift_guide"], ["/shop/gifts/under-100", "gift_guide"],
      ["/shop/some-vest", "product", true],
      ["/blog", "blog"], ["/blog/letters", "blog"], ["/blog/letters/the-first-tee", "blog"], ["/blog/a-post", "blog"],
      ["/blogs/news/old-post", "blog"], ["/lp/editorial", "editorial"], ["/lp/mully100", "editorial"],
    ];
    for (const [path, type, product] of allowed) expect(pageTypeFor(path, product), path).toBe(type);
  });
  it("keeps checkout, cart, plans, gift flows, account pages and login out", () => {
    const denied = [
      "/checkout", "/checkouts/abc", "/cart", "/shop/cart", "/shop/checkout", "/subscription", "/subscription/manage",
      "/choose-plan", "/lp/gift-season", "/lp/gift-season/thanks", "/gift-address", "/gift-card/tok", "/gift-continue",
      "/gift-sizing", "/dashboard", "/dashboard/orders", "/account", "/account/profile", "/login", "/join",
    ];
    for (const path of denied) {
      expect(pageTypeFor(path, true), path).toBeNull();
      expect(excludedPath(path, true), path).toBe(true);
    }
  });
  it("defaults unknown routes, including an unrendered /shop/<slug>, to excluded", () => {
    for (const path of ["/faq", "/reserve", "/lp/subscription", "/lp/gift", "/drops/x", "/shop/a/b/c", "/admin", "/policies/privacy"])
      expect(pageTypeFor(path, true), path).toBeNull();
    expect(pageTypeFor("/shop/not-a-product")).toBeNull();
    expect(excludedPath("/shop/not-a-product")).toBe(true);
    expect(excludedPath("/shop/some-vest", true)).toBe(false);
  });
  it("maps page types to trigger kinds", () => {
    expect(pageKindFor("/")).toBe("home");
    expect(pageKindFor("/shop")).toBe("home");
    expect(pageKindFor("/shop/some-vest", true)).toBe("product");
    expect(pageKindFor("/shop/some-vest")).toBe("other");
    expect(pageKindFor("/blog")).toBe("listing");
    expect(pageKindFor("/shop/gifts")).toBe("listing");
    expect(pageKindFor("/subscription")).toBe("other");
  });
});

describe("timedTrigger", () => {
  const t = { kind: "home" as const, dwellMs: 0, scrollFraction: 0, pageViews: 1, paidSocialFirstPage: false };
  it("needs 8s AND 30% scroll on the first page", () => {
    expect(timedTrigger({ ...t, dwellMs: 7_999, scrollFraction: 0.5 })).toBeNull();
    expect(timedTrigger({ ...t, dwellMs: 8_000, scrollFraction: 0.29 })).toBeNull();
    expect(timedTrigger({ ...t, dwellMs: 8_000, scrollFraction: 0.3 })).toBe("timer_scroll");
  });
  it("opens on the second page view", () => {
    expect(timedTrigger({ ...t, pageViews: 2, dwellMs: 2_000 })).toBe("second_page");
  });
  it("waits 20s on product pages, even on the second page", () => {
    expect(timedTrigger({ ...t, kind: "product", dwellMs: 19_000, scrollFraction: 1, pageViews: 3 })).toBeNull();
    expect(timedTrigger({ ...t, kind: "product", dwellMs: 20_000, scrollFraction: 0.3 })).toBe("timer_scroll");
    expect(timedTrigger({ ...t, kind: "product", dwellMs: 20_000, pageViews: 2 })).toBe("second_page");
  });
  it("holds paid-social first pages to 30s", () => {
    expect(timedTrigger({ ...t, dwellMs: 29_000, scrollFraction: 1, paidSocialFirstPage: true })).toBeNull();
    expect(timedTrigger({ ...t, dwellMs: 30_000, scrollFraction: 1, paidSocialFirstPage: true })).toBe("timer_scroll");
  });
  it("auto-opens on listing, blog and editorial pages with the 8s rule, never on other pages", () => {
    expect(timedTrigger({ ...t, kind: "listing", dwellMs: 7_000, scrollFraction: 1 })).toBeNull();
    expect(timedTrigger({ ...t, kind: "listing", dwellMs: 8_000, scrollFraction: 0.3 })).toBe("timer_scroll");
    expect(timedTrigger({ ...t, kind: "other", dwellMs: 60_000, scrollFraction: 1, pageViews: 3 })).toBeNull();
  });
});

describe("exitIntentReady", () => {
  it("is desktop only, after 5s", () => {
    expect(exitIntentReady({ kind: "home", dwellMs: 6_000, finePointer: false, paidSocialFirstPage: false })).toBe(false);
    expect(exitIntentReady({ kind: "home", dwellMs: 4_000, finePointer: true, paidSocialFirstPage: false })).toBe(false);
    expect(exitIntentReady({ kind: "home", dwellMs: 5_000, finePointer: true, paidSocialFirstPage: false })).toBe(true);
    expect(exitIntentReady({ kind: "home", dwellMs: 10_000, finePointer: true, paidSocialFirstPage: true })).toBe(false);
  });
});

describe("suppressReason", () => {
  it("allows a fresh visitor", () => expect(suppressReason(base)).toBeNull());
  it.each([
    ["reward_saved", { rewardSaved: true }],
    ["member", { member: true }],
    ["signed_up", { signedUp: true }],
    ["known_email", { knownEmail: true }],
    ["email_sms_visit", { emailSmsVisit: true }],
    ["excluded_page", { excludedPage: true }],
    ["snoozed", { snoozedUntil: NOW + 1 }],
    ["session_cap", { sessionAutoOpens: 1 }],
    ["window_cap", { autoOpens: [NOW - 86_400_000, NOW - 2 * 86_400_000] }],
    ["bag", { bag: true }],
  ] as const)("%s", (reason, patch) => {
    expect(suppressReason({ ...base, ...patch })).toBe(reason);
  });
  it("forgets auto-opens older than 14 days", () => {
    const old = NOW - (CAPS.windowDays + 1) * 86_400_000;
    expect(suppressReason({ ...base, autoOpens: [old, old] })).toBeNull();
  });
});

describe("visit helpers", () => {
  it("detects paid social and email/sms visits", () => {
    expect(isPaidSocial(new URLSearchParams("utm_source=Instagram"))).toBe(true);
    expect(isPaidSocial(new URLSearchParams("fbclid=abc"))).toBe(true);
    expect(isPaidSocial(new URLSearchParams("utm_source=google"))).toBe(false);
    expect(isEmailOrSmsVisit(new URLSearchParams("utm_medium=sms"))).toBe(true);
    expect(isEmailOrSmsVisit(new URLSearchParams("utm_medium=cpc"))).toBe(false);
  });
  it("excludes subscription and checkout pages", () => {
    expect(excludedPath("/subscription")).toBe(true);
    expect(excludedPath("/shop/checkout")).toBe(true);
    expect(excludedPath("/shop/vest", true)).toBe(false);
  });
  it("reads a known Klaviyo cookie", () => {
    const known = encodeURIComponent(btoa(JSON.stringify({ $exchange_id: "x" })));
    const anon = encodeURIComponent(btoa(JSON.stringify({ cid: "y" })));
    expect(klaviyoCookieKnown(`a=1; __kla_id=${known}`)).toBe(true);
    expect(klaviyoCookieKnown(`__kla_id=${anon}`)).toBe(false);
    expect(klaviyoCookieKnown("__kla_id=%%%")).toBe(false);
  });
  it("labels devices", () => {
    expect(deviceFor(true, 1440)).toBe("desktop");
    expect(deviceFor(false, 1440)).toBe("mobile");
    expect(deviceFor(true, 500)).toBe("mobile");
  });
});

describe("launcherVisible", () => {
  const l = {
    rewardSaved: false, member: false, dismissedUntil: 0, now: NOW, excludedPage: false, kind: "home" as const,
    viewportWidth: 1440, cartOpen: false, modalOpen: false, closedUnplayed: false, firstVisitBeforeTrigger: true,
  };
  it("shows on a first visit before the trigger, or after an unplayed close", () => {
    expect(launcherVisible(l)).toBe(true);
    expect(launcherVisible({ ...l, firstVisitBeforeTrigger: false })).toBe(false);
    expect(launcherVisible({ ...l, firstVisitBeforeTrigger: false, closedUnplayed: true })).toBe(true);
  });
  it("hides for rewards, dismissals, small PDPs, cart and modal", () => {
    expect(launcherVisible({ ...l, rewardSaved: true })).toBe(false);
    expect(launcherVisible({ ...l, dismissedUntil: NOW + 1 })).toBe(false);
    expect(launcherVisible({ ...l, kind: "product", viewportWidth: 767 })).toBe(false);
    expect(launcherVisible({ ...l, kind: "product", viewportWidth: 768 })).toBe(true);
    expect(launcherVisible({ ...l, kind: "listing", viewportWidth: 375 })).toBe(true);
    expect(launcherVisible({ ...l, kind: "other" })).toBe(false);
    expect(launcherVisible({ ...l, cartOpen: true })).toBe(false);
    expect(launcherVisible({ ...l, cartOpen: true })).toBe(false);
    expect(launcherVisible({ ...l, modalOpen: true })).toBe(false);
    expect(launcherVisible({ ...l, excludedPage: true })).toBe(false);
  });
});

describe("takeAShotRedemption", () => {
  it("flags a SHOT code on a Reserve order", () => {
    expect(takeAShotRedemption({ discount_codes: [{ code: "shot10-4bqj4h" }], line_items: [{ variant_id: 47601025122496 }] }))
      .toEqual({ take_a_shot_code: "SHOT10-4BQJ4H", take_a_shot_percent: 10, is_reserve: true, line_type: "reserve" });
  });
  it("labels retail and mixed orders, and ignores other codes", () => {
    expect(takeAShotRedemption({ discount_codes: [{ code: "FOUNDERS50" }], line_items: [{ variant_id: 50380696027328 }] }))
      .toEqual({ take_a_shot_code: null, take_a_shot_percent: null, is_reserve: false, line_type: "retail" });
    expect(takeAShotRedemption({ discount_codes: null, line_items: [{ variant_id: 47601025122496 }, { variant_id: 50380696027328 }] }).line_type).toBe("mixed");
  });
});

describe("reserve renewal price", () => {
  const plan = "gid://shopify/SellingPlan/3241476288";
  it("uses the plan's recurring price, else the variant price", () => {
    expect(quarterPriceFrom({ price: { amount: "250.0", currencyCode: "USD" }, sellingPlanAllocations: { nodes: [
      { sellingPlan: { id: plan }, priceAdjustments: [{ price: { amount: "250.0", currencyCode: "USD" } }] },
    ] } }, plan)).toBe("$250");
    expect(quarterPriceFrom({ price: { amount: "260.5", currencyCode: "USD" } }, plan)).toBe("$260.50");
    expect(quarterPriceFrom(null, plan)).toBeNull();
    expect(formatQuarterPrice(250)).toBe("$250");
  });
  it("writes the renewal line, with or without a price", () => {
    expect(renewalLine("$250")).toBe("Reserve renewals bill at the regular $250 quarterly price.");
    expect(renewalLine(null)).toBe("Reserve renewals bill at the regular quarterly price.");
  });
});
