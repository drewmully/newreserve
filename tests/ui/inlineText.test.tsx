import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InlineText } from "@/app/blog/InlineText";

describe("InlineText links", () => {
  it("keeps balanced parentheses inside a URL", () => {
    render(<p><InlineText text="Results via the [Skins Game record](https://en.wikipedia.org/wiki/Skins_Game_(PGA_Tour))." /></p>);
    const a = screen.getByRole("link", { name: "Skins Game record" });
    expect(a.getAttribute("href")).toBe("https://en.wikipedia.org/wiki/Skins_Game_(PGA_Tour)");
    expect(a.parentElement?.textContent).toBe("Results via the Skins Game record.");
  });

  it("still renders plain internal and external links", () => {
    render(<p><InlineText text="Shop [gifts](/shop/gifts) or read [Golf Digest](https://www.golfdigest.com/story/x) (more)." /></p>);
    expect(screen.getByRole("link", { name: "gifts" }).getAttribute("href")).toBe("/shop/gifts");
    expect(screen.getByRole("link", { name: "Golf Digest" }).getAttribute("href")).toBe("https://www.golfdigest.com/story/x");
  });
});
