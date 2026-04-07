/* eslint-disable @next/next/no-img-element */

import type { ImgHTMLAttributes, ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  const setCartOpen = vi.fn();
  const addToCart = vi.fn().mockResolvedValue(undefined);
  const refreshStoreCredit = vi.fn().mockResolvedValue(undefined);
  const refreshSubscriptionStatus = vi.fn().mockResolvedValue(undefined);
  const getIdToken = vi.fn().mockResolvedValue("token-123");
  const getCollectionProducts = vi.fn();

  const membershipState = {
    isSignedIn: true,
    authLoading: false,
    user: { getIdToken },
    username: "Santi",
    tier: "member",
    tierLabel: "Reserve Member",
    storeCredit: { balance_cents: 2400, currency: "USD" } as {
      balance_cents: number;
      currency: string;
    } | null,
    onboardingProfile: {
      birthMonth: "3",
      birthDay: "12",
      birthYear: "1992",
      handicap: "8",
      privateClub: true,
      clubName: "Oakland Hills",
      vibeCheck: "classic",
      selectedTier: "member",
    },
    fitProfile: {
      shirtSize: "L",
      gloveHand: "Right",
      gloveSize: "Cadet M",
      waistSize: "34",
      pantsInseam: "32",
      shortsInseam: "8",
      shoeSize: "10.5",
    },
    cartCount: 2,
    setCartOpen,
    addToCart,
    refreshStoreCredit,
    refreshSubscriptionStatus,
  };

  return {
    replace,
    setCartOpen,
    addToCart,
    refreshStoreCredit,
    refreshSubscriptionStatus,
    getIdToken,
    getCollectionProducts,
    membershipState,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => "/home",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...props} alt={props.alt ?? ""} />
  ),
}));

vi.mock("@/app/components/ClientComponents", () => ({
  ScrollReveal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/app/components/SlideCart", () => ({
  SlideCart: () => <div data-testid="slide-cart" />,
}));

vi.mock("@/app/components/UpgradeModal", () => ({
  UpgradeModal: ({ open }: { open: boolean }) =>
    open ? <div>Upgrade modal open</div> : null,
}));

vi.mock("@/app/context/MembershipContext", () => ({
  useMembership: () => mocks.membershipState,
}));

vi.mock("@/lib/shopify", () => ({
  PRO_SHOP_COLLECTION_HANDLE: "reserve-pro-shop",
  PRIVATE_RELEASES_COLLECTION_HANDLE: "private-releases",
  getCollectionProducts: mocks.getCollectionProducts,
  mergeCollectionProductsBySlug: (groups: Array<{ products: unknown[] }>) =>
    groups.flatMap((group) => group.products),
}));

vi.mock("@/lib/dropConfig", () => ({
  getExclusiveDropDate: () => new Date("2030-05-15T21:00:00-04:00"),
}));

async function loadPage() {
  const mod = await import("@/app/home/page");
  return mod.default;
}

function makeJsonResponse<T>(body: T, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const shopProducts = [
  {
    slug: "reserve-polo",
    name: "Reserve Polo",
    brand: "Greyson",
    collection: "Apparel",
    price: 120,
    reservePrice: 88,
    images: ["https://cdn.shopify.com/s/files/test-polo.jpg?v=1"],
    description: "Performance polo for quick spring rounds.",
    material: "",
    aboutBrand: "",
    whyWeLikeIt: "Easy first pick.",
    sizing: "Available in M / L",
    variantId: "gid://shopify/ProductVariant/1",
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
    sourceCollections: ["reserve-pro-shop"],
  },
];

describe("home page document coverage", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.setCartOpen.mockReset();
    mocks.addToCart.mockClear();
    mocks.refreshStoreCredit.mockClear();
    mocks.refreshSubscriptionStatus.mockClear();
    mocks.getIdToken.mockClear();
    mocks.getCollectionProducts.mockResolvedValue(shopProducts);

    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });

    Object.defineProperty(window.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_success: unknown, error: (error: unknown) => void) =>
          error(new Error("denied")),
      },
    });
  });

  it("renders the scorecard features from the document, including sortable round history", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/weather")) {
        return makeJsonResponse({
          temp: 72,
          feelsLike: 70,
          condition: "Partly Cloudy",
          icon: "02d",
          windSpeed: 8,
          humidity: 45,
          uvIndex: 5,
          sunrise: "6:42 AM",
          sunset: "8:15 PM",
          golfScore: 8,
          locationName: "Detroit",
          locationCountry: "US",
          requestedLat: 0,
          requestedLon: 0,
          dataSource: "live",
          locationSource: "default",
          golfSummary: "Playable with good overall conditions.",
        });
      }

      if (url.includes("/api/golf/rounds")) {
        return makeJsonResponse({
          rounds: [
            {
              id: "round-1",
              date: "2026-03-30",
              course: "Oakland Hills",
              score: 91,
              courseRating: 73.4,
              slopeRating: 132,
            },
            {
              id: "round-2",
              date: "2026-04-01",
              course: "Detroit Golf Club",
              score: 76,
              courseRating: 71.8,
              slopeRating: 128,
            },
            {
              id: "round-3",
              date: "2026-04-02",
              course: "Bel-Air",
              score: 82,
            },
          ],
        });
      }

      if (url.includes("/api/community/posts")) {
        return makeJsonResponse({
          posts: [],
        });
      }

      throw new Error(`Unexpected fetch ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const HomePage = await loadPage();
    render(<HomePage />);

    await screen.findByText("The Scorecard");
    expect(screen.getByText("Handicap (approx.)")).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link", { name: /reserve polo/i })
        .some((link) => link.getAttribute("href") === "/shop/reserve-polo")
    ).toBe(true);

    await user.click(await screen.findByRole("button", { name: "View Rounds" }));

    expect(screen.getByText("Round History")).toBeInTheDocument();
    expect(screen.getByText("73.4 / 132")).toBeInTheDocument();

    const table = screen.getByRole("table");
    let rows = within(table).getAllByRole("row");
    expect(within(rows[1]).getByText("82")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /score/i }));
    await user.click(screen.getByRole("button", { name: /score/i }));

    await waitFor(() => {
      rows = within(table).getAllByRole("row");
      expect(within(rows[1]).getByText("76")).toBeInTheDocument();
    });
  });
});
