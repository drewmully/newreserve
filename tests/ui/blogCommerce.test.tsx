import Link from "next/link";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ph = vi.hoisted(() => ({
  __loaded: true,
  capture: vi.fn(),
  getFeatureFlag: vi.fn(),
  onFeatureFlags: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: ph }));

import {
  ARCHIVE_COMMERCE,
  BLOG_COMMERCE,
  END_COPY,
  RESERVE_MID_COPY,
  ROW_COPY,
  endIntentFor,
  productHandlesFor,
  splitRows,
} from "@/lib/blogCommerce";
import { LEGACY_HANDLES } from "@/lib/legacyBlog";
import { BlogCommerceProvider, BlogCommerceSlot } from "@/app/blog/commerce/BlogCommerceClient";

function page() {
  return render(
    <BlogCommerceProvider slug="best-golf-polos-2026-quiet-golf-rhone" template="blog">
      <BlogCommerceSlot show="control" block="end_block" targetPath="/shop"><Link href="/shop">control link</Link></BlogCommerceSlot>
      <BlogCommerceSlot show="test" block="product_row_top" targetPath="/shop"><Link href="/shop/rhone-commuter-polo">test card</Link></BlogCommerceSlot>
    </BlogCommerceProvider>,
  );
}

describe("blog commerce config", () => {
  it("covers every archive post", () => {
    expect(Object.keys(ARCHIVE_COMMERCE).sort()).toEqual([...LEGACY_HANDLES].sort());
  });

  it("uses 3 to 4 products per configured post (or none on purpose)", () => {
    for (const [slug, entry] of Object.entries({ ...BLOG_COMMERCE, ...ARCHIVE_COMMERCE })) {
      const n = entry.products?.length ?? 0;
      if (slug === "best-golf-subscription-boxes-2026-compared" || slug === "greyson-vs-peter-millar-golf-comparison") continue;
      expect(n, slug).toBeGreaterThanOrEqual(3);
      expect(n, slug).toBeLessThanOrEqual(4);
    }
  });

  it("maps intent by config, gift keyword, then category", () => {
    expect(endIntentFor("what-to-wear-private-golf-club-dress-code", "Guides", BLOG_COMMERCE["what-to-wear-private-golf-club-dress-code"])).toBe("reserve-club");
    expect(endIntentFor("best-golf-subscription-boxes-2026-compared", "Gear", BLOG_COMMERCE["best-golf-subscription-boxes-2026-compared"])).toBe("reserve");
    expect(endIntentFor("golf-gift-guide-2026", "Guides")).toBe("gift");
    expect(endIntentFor("best-golf-polos-2026-quiet-golf-rhone", "Gear")).toBe("shop");
    expect(endIntentFor("pinehurst-golf-trip-packing-list-spring-2026", "Travel")).toBe("reserve-trip");
    expect(endIntentFor("private-golf-club-membership-cost-2026", "The Craft")).toBe("reserve-club");
    expect(endIntentFor("mully-pro-shop-may-2026-refresh", "Inside the Reserve")).toBe("reserve");
  });

  it("collects inline /shop/<handle> links first, then config, de-duplicated", () => {
    const sections = [{ heading: "A", paragraphs: ["See the [Polo](/shop/rhone-commuter-polo) and the [shop](/shop).", "[Hat](/shop/sloat-organic-cotton-six-panel-hat)"] }];
    expect(productHandlesFor(sections, { products: ["rhone-commuter-polo", "duckhead-stretch-belt"] }))
      .toEqual(["rhone-commuter-polo", "sloat-organic-cotton-six-panel-hat", "duckhead-stretch-belt"]);
  });

  it("splits rows: top takes 4, bottom prefers the rest", () => {
    const p = (n: number) => Array.from({ length: n }, (_, i) => ({ slug: `p${i}` }));
    expect(splitRows(p(3))).toEqual({ top: p(3), bottom: p(3) });
    expect(splitRows(p(6)).bottom.map(x => x.slug)).toEqual(["p4", "p5", "p0", "p1"]);
    expect(splitRows(p(8)).bottom.map(x => x.slug)).toEqual(["p4", "p5", "p6", "p7"]);
  });

  it("copy has no em or double dashes, prices or the word box", () => {
    const all = JSON.stringify([END_COPY, RESERVE_MID_COPY, ROW_COPY]);
    expect(all).not.toMatch(/\u2014|\u2013|--/);
    expect(all).not.toMatch(/\$\d/);
    expect(all.toLowerCase()).not.toMatch(/\bbox\b|mullybox/);
  });
});

describe("blog commerce variant gate", () => {
  beforeEach(() => {
    ph.capture.mockReset();
    ph.getFeatureFlag.mockReset();
    ph.onFeatureFlags.mockReset();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/blog/best-golf-polos-2026-quiet-golf-rhone");
  });

  it("renders control until flags resolve and stays control if they never do", () => {
    ph.onFeatureFlags.mockReturnValue(() => {});
    page();
    expect(screen.getByText("control link")).toBeVisible();
    expect(screen.getByText("test card")).not.toBeVisible();
    expect(ph.capture).not.toHaveBeenCalled();
  });

  it("reveals test blocks for the test variant and records exposure", () => {
    let cb: () => void = () => {};
    ph.onFeatureFlags.mockImplementation((fn: () => void) => { cb = fn; return () => {}; });
    ph.getFeatureFlag.mockReturnValue("test");
    page();
    act(() => cb());
    expect(screen.getByText("test card")).toBeVisible();
    expect(screen.getByText("control link")).not.toBeVisible();
    expect(ph.capture).toHaveBeenCalledWith(
      "blog_commerce_exposure",
      { slug: "best-golf-polos-2026-quiet-golf-rhone", variant: "test", template: "blog" },
      expect.anything(),
    );
  });

  it("tracks clicks with the product handle", () => {
    let cb: () => void = () => {};
    ph.onFeatureFlags.mockImplementation((fn: () => void) => { cb = fn; return () => {}; });
    ph.getFeatureFlag.mockReturnValue("test");
    page();
    act(() => cb());
    screen.getByText("test card").addEventListener("click", e => e.preventDefault());
    act(() => screen.getByText("test card").click());
    expect(ph.capture).toHaveBeenCalledWith(
      "blog_cta_clicked",
      expect.objectContaining({ block: "product_row_top", variant: "test", target_path: "/shop/rhone-commuter-polo", product_handle: "rhone-commuter-polo" }),
      expect.anything(),
    );
  });

  it("keeps control when the flag is missing", () => {
    let cb: () => void = () => {};
    ph.onFeatureFlags.mockImplementation((fn: () => void) => { cb = fn; return () => {}; });
    ph.getFeatureFlag.mockReturnValue(undefined);
    page();
    act(() => cb());
    expect(screen.getByText("control link")).toBeVisible();
    expect(ph.capture).not.toHaveBeenCalled();
  });

  it("honours ?bc=test without waiting for flags", () => {
    window.history.replaceState(null, "", "/blog/x?bc=test");
    page();
    expect(screen.getByText("test card")).toBeVisible();
    expect(ph.onFeatureFlags).not.toHaveBeenCalled();
    expect(ph.capture).toHaveBeenCalledWith("blog_commerce_exposure", expect.objectContaining({ variant: "test", bc_override: true }), expect.anything());
  });
});
