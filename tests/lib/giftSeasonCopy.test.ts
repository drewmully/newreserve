import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Customer-facing season UI files. Comments are stripped before checking so
// developer notes can still say "box".
const FILES = [
  "src/app/lp/gift-season/page.tsx",
  "src/app/lp/gift-season/GiftSeasonLPClient.tsx",
  "src/app/lp/gift-season/GiftSeasonHero.tsx",
  "src/app/gift-continue/[token]/page.tsx",
  "src/app/gift-continue/[token]/GiftContinueClient.tsx",
  "src/app/gift-card/[token]/page.tsx",
  "src/app/gift-card/[token]/GiftCardView.tsx",
  "src/app/gift-sizing/[token]/GiftSizingClient.tsx",
];

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("Gift a Season pricing copy", () => {
  it("LP has no hard-coded per-season price", () => {
    const src = readFileSync(path.resolve(__dirname, "../..", "src/app/lp/gift-season/GiftSeasonLPClient.tsx"), "utf8");
    expect(src).not.toMatch(/\$250 per season|\* ?250/);
    expect(src).toMatch(/perSeasonPrice\(option\.price, option\.seasons\)/);
    expect(src).toMatch(/perSeasonPrice\(o\.price, o\.seasons\)/);
    expect(src).toMatch(/seasonSavings\(o\.price, o\.seasons, singlePrice\)/);
    expect(src).not.toMatch(/Save \$\d/);
    expect(src).toMatch(/Paid once, never renews\./);
    expect(src).toMatch(/Paid once\. Never renews\. Secure Shopify checkout\./);
    expect(src).toMatch(/Full year, best value/);
  });
  it("LP: no $300+ claim, free shipping behind the flag, timing from config", () => {
    const src = readFileSync(path.resolve(__dirname, "../..", "src/app/lp/gift-season/GiftSeasonLPClient.tsx"), "utf8");
    expect(src).not.toMatch(/\$300/);
    expect(src).toMatch(/Hand-picked by a Mully stylist\./);
    expect(src).toMatch(/giftSeasonTimingLine\(\{ now/);
    for (const m of src.matchAll(/[^\n]*[Ff]ree shipping[^\n]*/g)) {
      const at = m.index ?? 0;
      expect(src.slice(Math.max(0, at - 200), at)).toMatch(/GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES/);
    }
    expect(src.match(/<details/g)?.length).toBe(1);
    expect(src.match(/\bq: "/g)?.length).toBeGreaterThanOrEqual(4);
  });
  it("hero: real images only, both options, trust row, From price from variants", () => {
    const hero = readFileSync(path.resolve(__dirname, "../..", "src/app/lp/gift-season/GiftSeasonHero.tsx"), "utf8");
    const lp = readFileSync(path.resolve(__dirname, "../..", "src/app/lp/gift-season/GiftSeasonLPClient.tsx"), "utf8");
    expect(hero).not.toMatch(/\$300|reserve-founders-hero|fall-fairway|fall-firepit/);
    expect(hero).toMatch(/\/lp\/gift-season\/flatlay\//);
    expect(hero).toMatch(/Pieces from past Reserves\. Every Reserve is styled to them\./);
    // Unboxing-7 is the gift moment band below the fold, never in the hero.
    expect(hero).not.toMatch(/Unboxing-7/);
    expect(lp).toMatch(/\/lp\/discover\/Unboxing-7\.jpg/);
    expect(lp).toMatch(/data-testid="gift-moment"/);
    expect(lp).not.toMatch(/In a typical Reserve|gift-season-examples/);
    expect(lp).toMatch(/Step 1 of 2 · Choose a gift length/);
    expect(lp).toMatch(/returnsLabel="Easy Returns"/);
    expect(lp).toMatch(/gift-order-summary/);
    expect(hero).toMatch(/\/shop\/hero-fall-2026\.jpg/);
    expect(hero).toMatch(/"Paid once\. Never renews\."/);
    expect(hero).toMatch(/"They pick their own sizes"/);
    expect(hero).toMatch(/"Secure Shopify checkout\."/);
    expect(lp).toMatch(/Choose a gift length/);
    expect(lp).toMatch(/ShopSeasonalHeader/);
    expect(lp).not.toMatch(/GlassHeader/);
    // Recipient form is step 2, after the picker.
    expect(lp.indexOf('id="gift-picker"')).toBeLessThan(lp.indexOf('id="gift-details"'));
    expect(lp.indexOf('id="gift-details"')).toBeLessThan(lp.indexOf('name="recipientName"'));
    expect(lp).toMatch(/Math\.min\(\.\.\.options\.map\(\(o\) => o\.price\)\)/);
    expect(lp).not.toMatch(/reserve-founders-hero/);
  });
  it("season sizing reveal drops the $300+ claim", () => {
    const src = readFileSync(path.resolve(__dirname, "../..", "src/app/gift-sizing/[token]/GiftSizingClient.tsx"), "utf8");
    const season = src.slice(src.indexOf("{isSeason ? ("), src.indexOf("Mully Reserve \\u00b7 Gift Box"));
    expect(season).not.toMatch(/\$300/);
  });
});

describe("Gift a Season UI copy", () => {
  for (const f of FILES) {
    const src = stripComments(readFileSync(path.resolve(__dirname, "../..", f), "utf8"));
    it(`${f}: no em dashes, en dashes or double dashes`, () => {
      expect(src).not.toMatch(/\u2014|\u2013|\\u2014|\\u2013|&mdash;|&ndash;/);
      // "--" outside CSS custom properties / class names
      expect(src.replace(/var\(--[\w-]+\)|--[\w-]+:/g, "")).not.toMatch(/\s--\s|\w--\s/);
    });
    it(`${f}: never says box or Mullybox`, () => {
      expect(src).not.toMatch(/mullybox/i);
      expect(src.replace(/box-(border|content|shadow)|\bcheckbox\b/g, "")).not.toMatch(/\bbox(es)?\b/i);
    });
  }
});
