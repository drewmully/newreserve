import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShopAnnouncementBar } from "@/app/shop/components/ShopAnnouncementBar";

describe("shop announcement styling", () => {
  it("uses muted olive and the site sans font without changing the header height", () => {
    render(<ShopAnnouncementBar />);
    const bar=screen.getByTestId("shop-announcement");
    expect(bar).toHaveClass("bg-[#5B613F]", "text-[#FAF9F6]");
    expect(bar.firstElementChild).toHaveClass("font-sans", "h-8");
    expect(bar.firstElementChild).not.toHaveClass("font-mono", "uppercase");
  });
  it("preserves full and compact offer labels", () => {
    render(<ShopAnnouncementBar />);
    for (const text of ["Ships from Mully Fulfillment", "Buy one, get 15% off the second", "Free U.S. Returns", "Mully Fulfillment", "BOGO 15%", "Free Returns"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });
});
