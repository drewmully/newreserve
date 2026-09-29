import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "src/app/shop/components/shop-redesign.css"),
  "utf8",
);

describe("shop progressive enhancement", () => {
  it("does not require an animation observer to reveal product and category cards", () => {
    const rule = css.match(
      /\.shop-redesign \.grid \.card,\.shop-redesign \.tiles \.tile\{([^}]+)\}/,
    )?.[1];
    expect(rule).toBeDefined();
    expect(rule).toContain("opacity:1");
    expect(rule).toContain("transform:none");
    expect(rule).not.toContain("opacity:0");
  });

  it("keeps generic reveal content visible before hydration", () => {
    const rule = css.match(/\.shop-redesign \.reveal\{([^}]+)\}/)?.[1];
    expect(rule).toContain("opacity:1");
    expect(rule).toContain("transform:none");
  });
});
