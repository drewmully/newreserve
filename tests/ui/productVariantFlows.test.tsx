import type {
  AnchorHTMLAttributes,
  ReactNode,
} from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addToCart: vi.fn().mockResolvedValue(undefined),
  membershipState: {
    tier: "member",
    addToCart: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/app/context/MembershipContext", () => ({
  useMembership: () => ({
    ...mocks.membershipState,
    cartCount: 0,
    cartOpen: false,
    setCartOpen: vi.fn(),
    removeFromCart: vi.fn(),
    updateCartItem: vi.fn(),
  }),
}));

const multiVariantProduct = {
  slug: "reserve-polo",
  name: "Reserve Polo",
  brand: "Greyson",
  price: 120,
  reservePrice: 88,
  variantId: "gid://shopify/ProductVariant/1",
  images: ["https://cdn.shopify.com/s/files/test-polo.jpg"],
  options: [
    { name: "Color", values: ["Navy", "Sand"] },
    { name: "Size", values: ["M", "L"] },
  ],
  variants: [
    {
      id: "gid://shopify/ProductVariant/1",
      title: "Navy / M",
      price: 120,
      reservePrice: 88,
      availableForSale: true,
      selectedOptions: [
        { name: "Color", value: "Navy" },
        { name: "Size", value: "M" },
      ],
    },
    {
      id: "gid://shopify/ProductVariant/2",
      title: "Navy / L",
      price: 122,
      reservePrice: 90,
      availableForSale: true,
      selectedOptions: [
        { name: "Color", value: "Navy" },
        { name: "Size", value: "L" },
      ],
    },
    {
      id: "gid://shopify/ProductVariant/3",
      title: "Sand / M",
      price: 118,
      reservePrice: 84,
      availableForSale: true,
      selectedOptions: [
        { name: "Color", value: "Sand" },
        { name: "Size", value: "M" },
      ],
    },
    {
      id: "gid://shopify/ProductVariant/4",
      title: "Sand / L",
      price: 124,
      reservePrice: 92,
      availableForSale: true,
      selectedOptions: [
        { name: "Color", value: "Sand" },
        { name: "Size", value: "L" },
      ],
    },
  ],
};

describe("product variant flows", () => {
  it("shows variant selectors on the PDP add-to-cart flow and sends the chosen variant", async () => {
    const user = userEvent.setup();
    mocks.membershipState.addToCart.mockClear();

    const { AddToCartButton } = await import(
      "@/app/shop/components/ShopClient"
    );

    render(<AddToCartButton product={multiVariantProduct} />);

    await user.click(screen.getByRole("button", { name: "Sand" }));
    await user.click(screen.getByRole("button", { name: "L" }));
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() =>
      expect(mocks.membershipState.addToCart).toHaveBeenCalledWith({
        slug: "reserve-polo",
        name: "Reserve Polo",
        brand: "Greyson",
        price: 92,
        variantId: "gid://shopify/ProductVariant/4",
        image: "https://cdn.shopify.com/s/files/test-polo.jpg",
      })
    );
  });

  it("opens a quick-add variant picker and submits the selected variant id", async () => {
    const user = userEvent.setup();
    mocks.addToCart.mockClear();

    const { QuickAddToCartButton } = await import(
      "@/app/components/QuickAddToCartButton"
    );

    render(
      <QuickAddToCartButton
        product={multiVariantProduct}
        isPaid
        onAddToCart={mocks.addToCart}
        idleClassName="quick-add-idle"
        addedClassName="quick-add-added"
        idleContent={<span>+</span>}
        addedContent={<span>ok</span>}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(screen.getByText("Choose your variant")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sand" }));
    await user.click(screen.getByRole("button", { name: "L" }));
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() =>
      expect(mocks.addToCart).toHaveBeenCalledWith({
        slug: "reserve-polo",
        name: "Reserve Polo",
        brand: "Greyson",
        price: 92,
        variantId: "gid://shopify/ProductVariant/4",
        image: "https://cdn.shopify.com/s/files/test-polo.jpg",
      })
    );
  });
});
