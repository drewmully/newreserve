import type { AnchorHTMLAttributes, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/shop/titleist-vokey-wedge",
  search: "",
  membershipState: {
    cartCount: 2,
    setCartOpen: vi.fn(),
    isSignedIn: true,
    authLoading: false,
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
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
  useMembership: () => mocks.membershipState,
}));

vi.mock("@/app/components/SlideCart", () => ({
  SlideCart: () => <div data-testid="slide-cart" />,
}));

describe("navigation document coverage", () => {
  it("keeps shop active in the shared nav on product detail routes, including mobile tabs", async () => {
    const { ClubhouseNav, ClubhouseBottomNav } = await import(
      "@/app/components/ClubhouseNav"
    );

    const { container } = render(
      <>
        <ClubhouseNav />
        <ClubhouseBottomNav />
      </>
    );

    const shopLinks = screen.getAllByRole("link", { name: /shop/i });
    expect(shopLinks.some((link) => link.className.includes("bg-forest"))).toBe(
      true
    );
    expect(
      shopLinks.some((link) => link.className.includes("text-forest"))
    ).toBe(true);
    expect(container).toHaveTextContent("free priority shipping");
  });

  it("shows the full shared shop nav for signed-in users and the simple header for guests", async () => {
    const { ShopHeader } = await import("@/app/components/ShopHeader");

    const { rerender } = render(<ShopHeader />);
    expect(screen.getAllByRole("link", { name: /shop/i }).length).toBeGreaterThan(0);

    mocks.membershipState.isSignedIn = false;
    rerender(<ShopHeader />);

    expect(screen.queryAllByRole("link", { name: /shop/i })).toHaveLength(0);
    expect(screen.getByRole("link", { name: /mully\./i })).toBeInTheDocument();

    mocks.membershipState.isSignedIn = true;
  });
});
