import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShopAnnouncementBar } from "@/app/shop/components/ShopAnnouncementBar";

describe("shop announcement styling", () => {
  const fall = new Date("2026-10-15T17:00:00Z");
  const holiday = new Date("2026-12-01T17:00:00Z");
  const lateHoliday = new Date("2026-12-20T17:00:00Z");
  it("uses muted olive in fall and the site sans font without changing the header height", () => {
    render(<ShopAnnouncementBar now={fall} />);
    const bar=screen.getByTestId("shop-announcement");
    expect(bar).toHaveClass("text-[#FAF9F6]");
    expect(bar).toHaveStyle({ backgroundColor: "#5B613F" });
    expect(bar.firstElementChild).toHaveClass("font-sans", "h-8");
    expect(bar.firstElementChild).not.toHaveClass("font-mono", "uppercase");
  });
  it("turns evergreen for the holiday edit", () => {
    render(<ShopAnnouncementBar now={holiday} />);
    const bar=screen.getByTestId("shop-announcement");
    expect(bar).toHaveStyle({ backgroundColor: "#1F3A2E" });
    expect(bar).toHaveAttribute("data-season", "holiday");
  });
  it("preserves full and compact offer labels", () => {
    render(<ShopAnnouncementBar now={fall} />);
    for (const text of ["Ships from Mully Fulfillment", "Buy 2, take 15% off one", "Mully Fulfillment", "Buy 2, 15% off one"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    // Same label on desktop and mobile.
    expect(screen.getAllByText("Easy Returns")).toHaveLength(2);
    expect(screen.queryByText(/free/i)).toBeNull();
    expect(screen.queryByText(/BOGO/)).toBeNull();
  });
  it("shows the Christmas order-by date during the holiday edit, then falls back", () => {
    const { unmount } = render(<ShopAnnouncementBar now={holiday} />);
    expect(screen.getByText("Order by Dec 14 for Christmas")).toBeInTheDocument();
    expect(screen.getByText("Order by Dec 14")).toBeInTheDocument();
    unmount();
    render(<ShopAnnouncementBar now={lateHoliday} />);
    expect(screen.getByText("Ships from Mully Fulfillment")).toBeInTheDocument();
    expect(screen.queryByText(/Order by/)).toBeNull();
  });
  it("accepts a page-level returns label override", () => {
    render(<ShopAnnouncementBar returnsLabel="Easy Returns" />);
    expect(screen.getAllByText("Easy Returns")).toHaveLength(2);
    expect(screen.queryByText("Free U.S. Returns")).toBeNull();
    expect(screen.queryByText("Free Returns")).toBeNull();
  });
});
