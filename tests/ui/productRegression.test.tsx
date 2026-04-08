import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/context/MembershipContext", () => ({
  useMembership: () => {
    throw new Error("No membership provider");
  },
}));

describe("product regression smoke tests", () => {
  it("shows retail pricing to free users while still surfacing the member price", async () => {
    const { ProductPriceDisplay } = await import(
      "@/app/shop/components/ShopClient"
    );

    render(<ProductPriceDisplay price={38} reservePrice={28} />);

    expect(screen.getByText("$38")).toBeInTheDocument();
    expect(screen.getByText("Members pay $28")).toBeInTheDocument();
    expect(screen.queryByText("Mill River Price")).not.toBeInTheDocument();
  });

  it("keeps single-variant quick add working without opening the variant modal", async () => {
    const user = userEvent.setup();
    const addToCart = vi.fn().mockResolvedValue(undefined);

    const { QuickAddToCartButton } = await import(
      "@/app/components/QuickAddToCartButton"
    );

    render(
      <QuickAddToCartButton
        product={{
          slug: "course-cap",
          name: "Course Cap",
          brand: "Titleist",
          price: 38,
          reservePrice: 28,
          variantId: "gid://shopify/ProductVariant/3",
          images: ["https://cdn.shopify.com/s/files/test-cap.jpg"],
        }}
        isPaid={false}
        onAddToCart={addToCart}
        idleClassName="quick-add-idle"
        addedClassName="quick-add-added"
        idleContent={<span>+</span>}
        addedContent={<span>ok</span>}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add to cart" }));

    await waitFor(() =>
      expect(addToCart).toHaveBeenCalledWith({
        slug: "course-cap",
        name: "Course Cap",
        brand: "Titleist",
        price: 38,
        variantId: "gid://shopify/ProductVariant/3",
        image: "https://cdn.shopify.com/s/files/test-cap.jpg",
      })
    );

    expect(screen.queryByText("Choose your variant")).not.toBeInTheDocument();
  });
});
