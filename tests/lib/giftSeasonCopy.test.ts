import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Customer-facing season UI files. Comments are stripped before checking so
// developer notes can still say "box".
const FILES = [
  "src/app/lp/gift-season/page.tsx",
  "src/app/lp/gift-season/GiftSeasonLPClient.tsx",
  "src/app/gift-continue/[token]/page.tsx",
  "src/app/gift-continue/[token]/GiftContinueClient.tsx",
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
    expect(src).toMatch(/Paid once, never renews\./);
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
