import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GIFT_SHIP_BY, giftOrderByCopy, giftRestockCopy, isPastGiftOrderBy } from "@/lib/giftGuideDates";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(f) ? [p] : [];
  });
}

describe("gift guide ship-by dates", () => {
  it("derives every cutoff line from GIFT_SHIP_BY", () => {
    expect(GIFT_SHIP_BY).toEqual({ standardOrderBy: "2026-12-14", restockWeeks: 2 });
    expect(giftOrderByCopy()).toBe("Order in-stock pieces by Mon, Dec 14 for Christmas delivery");
    expect(giftRestockCopy()).toBe("Order Restocking pieces by Mon, Nov 30 for the best chance by Christmas.");
    expect(isPastGiftOrderBy(new Date("2026-12-14T23:00:00-05:00"))).toBe(false);
    expect(isPastGiftOrderBy(new Date("2026-12-15T00:00:01-05:00"))).toBe(true);
  });
  it("has no hard-coded cutoff dates in the gift guide pages", () => {
    const pattern = /\b(Dec(ember)?|Nov(ember)?)\.? \d{1,2}\b/;
    for (const f of files("src/app/shop/gifts")) expect(readFileSync(f, "utf8"), f).not.toMatch(pattern);
    expect(readFileSync("src/lib/giftGuide.ts", "utf8")).not.toMatch(pattern);
  });
});
