import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GIFT_SEASON_LINK, isGiftSeason } from "@/lib/giftSeason";
import { GiftSeasonLink } from "@/app/blog/GiftSeasonLink";
import { ARCHIVE_ADDENDA, BLOG_ADDENDA, applyAddenda } from "@/lib/blogAddenda";
import { linkedProductHandles } from "@/lib/blogCommerce";
import { LEGACY_POSTS } from "@/lib/legacyBlog";
import legacyRedirects from "@/lib/legacyRedirects.json";

// Times are Eastern (EST, UTC-05:00).
const et = (iso: string) => new Date(`${iso}-05:00`);

describe("isGiftSeason (America/New_York)", () => {
  it("is false on Nov 14, even late in the day", () => {
    expect(isGiftSeason(et("2026-11-14T00:00:00"))).toBe(false);
    expect(isGiftSeason(et("2026-11-14T23:59:59"))).toBe(false);
  });
  it("is true from the first second of Nov 15", () => {
    expect(isGiftSeason(et("2026-11-15T00:00:00"))).toBe(true);
    expect(isGiftSeason(et("2026-11-15T12:00:00"))).toBe(true);
  });
  it("is true on Dec 24 through the last second", () => {
    expect(isGiftSeason(et("2026-12-24T00:00:00"))).toBe(true);
    expect(isGiftSeason(et("2026-12-24T23:59:59"))).toBe(true);
  });
  it("is false on Dec 25", () => {
    expect(isGiftSeason(et("2026-12-25T00:00:00"))).toBe(false);
    expect(isGiftSeason(et("2026-12-25T18:00:00"))).toBe(false);
  });
  it("uses Eastern time, not UTC", () => {
    // 2026-11-15T02:00Z is still Nov 14 in New York.
    expect(isGiftSeason(new Date("2026-11-15T02:00:00Z"))).toBe(false);
    // 2026-12-25T03:00Z is still Dec 24 in New York.
    expect(isGiftSeason(new Date("2026-12-25T03:00:00Z"))).toBe(true);
  });
  it("is false the rest of the year", () => {
    expect(isGiftSeason(et("2026-11-11T12:00:00"))).toBe(false);
    expect(isGiftSeason(et("2026-07-04T12:00:00"))).toBe(false);
    expect(isGiftSeason(et("2027-01-02T12:00:00"))).toBe(false);
  });
});

describe("GiftSeasonLink", () => {
  afterEach(() => vi.useRealTimers());
  it("renders nothing out of season", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(et("2026-11-14T12:00:00"));
    const { container } = render(<GiftSeasonLink />);
    expect(container.innerHTML).toBe("");
  });
  it("links to /shop/gifts in season", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(et("2026-11-15T12:00:00"));
    render(<GiftSeasonLink />);
    expect(screen.getByRole("link", { name: GIFT_SEASON_LINK.label }).getAttribute("href")).toBe("/shop/gifts");
  });
});

describe("s10 gift guide links", () => {
  const posts = [
    "best-golf-subscription-boxes-2026-compared",
    "greyson-vs-peter-millar-golf-comparison",
    "best-golf-polos-2026-quiet-golf-rhone",
    "golf-quarter-zip-vs-hoodie",
    "best-golf-belt-2026-braided-leather-stretch",
  ];
  it("each target post has exactly one /shop/gifts addendum link", () => {
    for (const slug of posts) {
      const text = JSON.stringify(BLOG_ADDENDA[slug]);
      expect(text.match(/\]\(\/shop\/gifts[^)]*\)/g)?.length, slug).toBe(1);
    }
  });
  it("archive addenda target real archive posts", () => {
    for (const handle of Object.keys(ARCHIVE_ADDENDA)) expect(LEGACY_POSTS[handle], handle).toBeTruthy();
  });
  it("copy has no em dashes or prices beyond tier names", () => {
    // Only the s10 sentences (the ones linking the gift guide).
    const paragraphs = [
      ...Object.values(ARCHIVE_ADDENDA).flat(),
      ...posts.flatMap((s) => BLOG_ADDENDA[s].flatMap((a) => (a.kind === "section" ? a.section.paragraphs : a.paragraphs))),
    ].filter((p) => p.includes("](/shop/gifts"));
    expect(paragraphs.length).toBe(posts.length + Object.keys(ARCHIVE_ADDENDA).length);
    const all = [...paragraphs, GIFT_SEASON_LINK.label].join(" ");
    expect(all).not.toMatch(/\u2014|--/);
    expect(all.replace(/under \$100/g, "")).not.toMatch(/\$\d/);
  });
  it("/shop/gifts is not treated as a product handle", () => {
    const sections = applyAddenda("best-golf-subscription-boxes-2026-compared", [
      { heading: "The Golf Mystery Box, Explained", paragraphs: [] },
    ]);
    expect(linkedProductHandles(sections)).not.toContain("gifts");
    expect(linkedProductHandles([{ heading: "x", paragraphs: ["[a](/shop/rhone-commuter-polo)"] }])).toEqual(["rhone-commuter-polo"]);
  });
  it("the three gift legacy URLs point at /shop/gifts", () => {
    const map = new Map(legacyRedirects.map((r) => [r.source, r.destination]));
    for (const s of [
      "/blogs/news/unique-golf-gifts-for-him",
      "/blogs/news/seasonal-guide-the-best-golf-gifts-to-give-this-year",
      "/blogs/news/how-to-choose-the-perfect-golf-gift-for-any-occasion",
    ]) expect(map.get(s), s).toBe("/shop/gifts");
  });
});
