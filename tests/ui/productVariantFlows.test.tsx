import type {
  AnchorHTMLAttributes,
  ReactNode,
} from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows variant selectors on the PDP add-to-cart flow and sends the chosen variant", async () => {
    const user = userEvent.setup();
    mocks.membershipState.tier = "member";
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
    mocks.membershipState.tier = "member";
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

  it("renders the quick-add dialog in a body portal and keeps entry and exit animation classes", async () => {
    const user = userEvent.setup();
    mocks.membershipState.tier = "member";

    const { QuickAddToCartButton } = await import(
      "@/app/components/QuickAddToCartButton"
    );

    const { container } = render(
      <div className="relative overflow-hidden product-tile-hover">
        <QuickAddToCartButton
          product={multiVariantProduct}
          isPaid
          onAddToCart={mocks.addToCart}
          idleClassName="quick-add-idle"
          addedClassName="quick-add-added"
          idleContent={<span>+</span>}
          addedContent={<span>ok</span>}
        />
      </div>
    );

    await user.click(screen.getByRole("button", { name: "Add to cart" }));

    const dialog = screen.getByTestId("quick-add-dialog");
    const backdrop = screen.getByTestId("quick-add-backdrop");

    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(container).not.toContainElement(dialog);
    expect(dialog.className).toContain("animate-quick-add-panel-in");
    expect(dialog.className).toContain("w-[min(92vw,34rem)]");
    expect(backdrop.className).toContain("animate-quick-add-backdrop-in");

    await user.click(screen.getByRole("button", { name: "Close quick add" }));

    expect(screen.getByTestId("quick-add-dialog").className).toContain(
      "animate-quick-add-panel-out"
    );
    expect(screen.getByTestId("quick-add-backdrop").className).toContain(
      "animate-quick-add-backdrop-out"
    );

    await new Promise((resolve) => setTimeout(resolve, 260));

    await waitFor(() =>
      expect(screen.queryByTestId("quick-add-dialog")).not.toBeInTheDocument()
    );
  }, 10000);

  it("keeps PDP add-to-cart on the retail price for free users", async () => {
    const user = userEvent.setup();
    mocks.membershipState.tier = "free";
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
        price: 124,
        variantId: "gid://shopify/ProductVariant/4",
        image: "https://cdn.shopify.com/s/files/test-polo.jpg",
      })
    );
  });

  it("respects a preferred initial color on the PDP add-to-cart flow", async () => {
    const user = userEvent.setup();
    mocks.membershipState.tier = "member";
    mocks.membershipState.addToCart.mockClear();

    const { AddToCartButton } = await import(
      "@/app/shop/components/ShopClient"
    );

    render(
      <AddToCartButton
        product={{
          ...multiVariantProduct,
          initialSelection: { Color: "Sand" },
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() =>
      expect(mocks.membershipState.addToCart).toHaveBeenCalledWith({
        slug: "reserve-polo",
        name: "Reserve Polo",
        brand: "Greyson",
        price: 84,
        variantId: "gid://shopify/ProductVariant/3",
        image: "https://cdn.shopify.com/s/files/test-polo.jpg",
      })
    );
  });

  it("opens quick add with the preferred color preselected", async () => {
    const user = userEvent.setup();
    mocks.membershipState.tier = "member";
    mocks.addToCart.mockClear();

    const { QuickAddToCartButton } = await import(
      "@/app/components/QuickAddToCartButton"
    );

    render(
      <QuickAddToCartButton
        product={{
          ...multiVariantProduct,
          initialSelection: { Color: "Sand" },
        }}
        isPaid
        onAddToCart={mocks.addToCart}
        idleClassName="quick-add-idle"
        addedClassName="quick-add-added"
        idleContent={<span>+</span>}
        addedContent={<span>ok</span>}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add to cart" }));
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() =>
      expect(mocks.addToCart).toHaveBeenCalledWith({
        slug: "reserve-polo",
        name: "Reserve Polo",
        brand: "Greyson",
        price: 84,
        variantId: "gid://shopify/ProductVariant/3",
        image: "https://cdn.shopify.com/s/files/test-polo.jpg",
      })
    );
  });
});
