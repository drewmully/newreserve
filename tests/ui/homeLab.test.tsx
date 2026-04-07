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
  let dropDate = new Date("2030-05-15T21:00:00-04:00");

  const membershipState = {
    isSignedIn: true,
    authLoading: false,
    user: { getIdToken },
    username: "Santi",
    tier: "member",
    tierLabel: "Reserve Member",
    storeCredit: { balance_cents: 2400, currency: "USD" } as { balance_cents: number; currency: string } | null,
    subscriptions: { manage_url: null },
    onboardingProfile: {
      birthMonth: "3",
      birthDay: "12",
      birthYear: "1992",
      handicap: "8",
      privateClub: true,
      clubName: "Oakland Hills",
      vibeCheck: "move",
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
    clubStatus: "approved",
    interestedClubs: ["Oakland Hills", "Detroit Golf Club"],
    cartCount: 1,
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
    getDropDate: () => dropDate,
    setDropDate: (value: Date) => {
      dropDate = value;
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("next/image", () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt ?? ""} />,
}));

vi.mock("@/app/components/ClientComponents", () => ({
  ScrollReveal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/app/components/SlideCart", () => ({
  SlideCart: () => <div data-testid="slide-cart" />,
}));

vi.mock("@/app/components/UpgradeModal", () => ({
  UpgradeModal: ({ open }: { open: boolean }) => (open ? <div>Upgrade modal open</div> : null),
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
  getExclusiveDropDate: () => mocks.getDropDate(),
  formatExclusiveDropLabel: () => "Wednesday, May 15, 9:00 PM ET",
}));

async function loadPage() {
  const mod = await import("@/app/home-lab/page");
  return mod.default;
}

function makeJsonResponse<T>(body: T, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeWeatherResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  };
}

function formatRoundDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

const shopProducts = [
  {
    slug: "pro-polo",
    name: "Pro Polo",
    brand: "Greyson",
    collection: "Polos",
    price: 120,
    reservePrice: 88,
    images: ["https://cdn.shopify.com/s/files/1/0561/0530/4256/files/test-polo.jpg?v=1"],
    description: "Lightweight performance polo built for fast-moving rounds.",
    material: "",
    aboutBrand: "",
    whyWeLikeIt: "Clean collar, breathable hand, easy first pick for a walkable day.",
    sizing: "Available in S M L XL",
    variantId: "gid://shopify/ProductVariant/1",
    sourceCollections: ["reserve-pro-shop"],
  },
  {
    slug: "rain-layer",
    name: "Rain Layer",
    brand: "Holderness",
    collection: "Outerwear",
    price: 210,
    reservePrice: 172,
    images: ["https://cdn.shopify.com/s/files/1/0561/0530/4256/files/test-layer.jpg?v=1"],
    description: "Stretch shell for wind and shoulder-season golf.",
    material: "",
    aboutBrand: "",
    whyWeLikeIt: "Useful when wind is the whole story.",
    sizing: "Fits L and XL comfortably",
    variantId: "gid://shopify/ProductVariant/2",
    sourceCollections: ["private-releases"],
  },
  {
    slug: "course-cap",
    name: "Course Cap",
    brand: "Titleist",
    collection: "Accessories",
    price: 38,
    reservePrice: 28,
    images: ["https://cdn.shopify.com/s/files/1/0561/0530/4256/files/test-cap.jpg?v=1"],
    description: "Classic fit cap for travel and fast nine-hole evenings.",
    material: "",
    aboutBrand: "",
    whyWeLikeIt: "Easy add-on when the rest of the outfit is already solved.",
    sizing: "One size",
    variantId: "gid://shopify/ProductVariant/3",
    sourceCollections: ["reserve-pro-shop"],
  },
];

const communityPosts = [
  {
    id: "post-1",
    author: "Jack M.",
    avatar: "JM",
    timestamp: "2 hours ago",
    title: "Oakland Hills guest day - anyone in?",
    body: "Trying to pull together a foursome for next week.",
    likes: 18,
    tag: "Guest Play",
    comments: [{ id: "c1", author: "Mike", avatar: "MR", timestamp: "1 hour ago", body: "In.", likes: 1 }],
    images: [],
    videos: [],
  },
  {
    id: "post-2",
    author: "Sarah K.",
    avatar: "SK",
    timestamp: "5 hours ago",
    title: "Peter Millar sizing note",
    body: "Medium fits true for me and works well on-course.",
    likes: 12,
    tag: "Gear Talk",
    comments: [{ id: "c2", author: "Alex", avatar: "AP", timestamp: "4 hours ago", body: "Helpful.", likes: 0 }],
    images: [],
    videos: [],
  },
];

describe("home-lab page", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.setCartOpen.mockReset();
    mocks.addToCart.mockClear();
    mocks.refreshStoreCredit.mockClear();
    mocks.refreshSubscriptionStatus.mockClear();
    mocks.getIdToken.mockClear();
    mocks.getCollectionProducts.mockImplementation(async (handle: string) =>
      handle === "private-releases" ? [shopProducts[1]] : [shopProducts[0], shopProducts[2]]
    );

    mocks.membershipState.tier = "member";
    mocks.membershipState.tierLabel = "Reserve Member";
    mocks.membershipState.storeCredit = { balance_cents: 2400, currency: "USD" };
    mocks.setDropDate(new Date("2030-05-15T21:00:00-04:00"));

    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });

    Object.defineProperty(window.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_success: unknown, error: (error: unknown) => void) => error(new Error("denied")),
      },
    });
  });

  it("renders the experimental home with live sections and quick add", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/weather") {
        return makeJsonResponse(makeWeatherResponse());
      }
      if (url === "/api/community/posts") {
        return makeJsonResponse({ posts: communityPosts });
      }
      if (url === "/api/golf/rounds" && !init?.method) {
        return makeJsonResponse({
          rounds: [
            { id: "r1", date: "2026-03-28", course: "Oakland Hills", score: 79 },
            { id: "r2", date: "2026-03-20", course: "Oakland Hills", score: 82 },
          ],
        });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const HomeLabPage = await loadPage();
    const user = userEvent.setup();

    render(<HomeLabPage />);

    expect(await screen.findByText(/Your round, your locker, your club/i)).toBeInTheDocument();
    expect(await screen.findByText(/Today's Tee Sheet/i)).toBeInTheDocument();
    expect(await screen.findByText(/The Scorecard, rebuilt for momentum/i)).toBeInTheDocument();
    expect(await screen.findByText(/Make the shop feel like a caddie, not a catalog/i)).toBeInTheDocument();
    expect(await screen.findByText(/Community deserves more than a list of likes/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Quick add/i }));

    expect(mocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: expect.any(String),
        variantId: expect.any(String),
      })
    );
  });

  it("opens the round modal from the hero action and saves a round", async () => {
    mocks.membershipState.storeCredit = null;
    mocks.setDropDate(new Date("2020-05-15T21:00:00-04:00"));

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/weather") {
        return makeJsonResponse(
          makeWeatherResponse({
            temp: 64,
            feelsLike: 62,
            condition: "Clear",
            icon: "01d",
            windSpeed: 6,
            humidity: 41,
            uvIndex: 4,
            golfScore: 9,
            golfSummary: "Ideal for a round.",
          })
        );
      }
      if (url === "/api/community/posts") {
        return makeJsonResponse({ posts: communityPosts });
      }
      if (url === "/api/golf/rounds" && !init?.method) {
        return makeJsonResponse({ rounds: [] });
      }
      if (url === "/api/golf/rounds" && init?.method === "POST") {
        return makeJsonResponse(
          { round: { id: "r-new", date: "2026-03-30", course: "Oakland Hills South", score: 78 } },
          201
        );
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const HomeLabPage = await loadPage();
    const user = userEvent.setup();

    render(<HomeLabPage />);

    const heroAction = await screen.findByRole("button", { name: /Log your first round/i });
    await user.click(heroAction);

    expect(screen.getByText("Log a Round")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("e.g. Oakland Hills South"), "Oakland Hills South");
    await user.clear(screen.getByRole("spinbutton"));
    await user.type(screen.getByRole("spinbutton"), "78");
    await user.click(screen.getByRole("button", { name: /Save Round/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/golf/rounds",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer token-123",
          }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("Log a Round")).not.toBeInTheDocument();
    });

    expect(await screen.findByText("1 total")).toBeInTheDocument();
  });

  it("computes scorecard momentum from the rounds history", async () => {
    mocks.membershipState.storeCredit = null;
    mocks.setDropDate(new Date("2020-05-15T21:00:00-04:00"));

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const rounds = [
      { id: "r1", date: formatRoundDate(new Date(Date.UTC(year, month, 28))), course: "Oakland Hills North", score: 78 },
      { id: "r2", date: formatRoundDate(new Date(Date.UTC(year, month, 24))), course: "Oakland Hills North", score: 79 },
      { id: "r3", date: formatRoundDate(new Date(Date.UTC(year, month, 19))), course: "Oakland Hills South", score: 80 },
      { id: "r4", date: formatRoundDate(new Date(Date.UTC(year, month - 1, 22))), course: "Oakland Hills North", score: 77 },
      { id: "r5", date: formatRoundDate(new Date(Date.UTC(year, month - 1, 18))), course: "Oakland Hills North", score: 81 },
      { id: "r6", date: formatRoundDate(new Date(Date.UTC(year, month - 2, 27))), course: "Detroit Golf Club", score: 84 },
      { id: "r7", date: formatRoundDate(new Date(Date.UTC(year, month - 2, 23))), course: "Detroit Golf Club", score: 85 },
      { id: "r8", date: formatRoundDate(new Date(Date.UTC(year, month - 3, 20))), course: "Pine Lake", score: 83 },
      { id: "r9", date: formatRoundDate(new Date(Date.UTC(year, month - 3, 16))), course: "Oakland Hills South", score: 86 },
      { id: "r10", date: formatRoundDate(new Date(Date.UTC(year, month - 4, 12))), course: "Pine Lake", score: 82 },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/weather") return makeJsonResponse(makeWeatherResponse());
        if (url === "/api/community/posts") return makeJsonResponse({ posts: communityPosts });
        if (url === "/api/golf/rounds" && !init?.method) return makeJsonResponse({ rounds });
        throw new Error(`Unhandled fetch: ${url}`);
      })
    );

    const HomeLabPage = await loadPage();
    render(<HomeLabPage />);

    expect(await screen.findByText("79.0")).toBeInTheDocument();
    expect(screen.getByText("5.0 strokes better than the previous five rounds.")).toBeInTheDocument();
    expect(screen.getByText("Your latest scorecard came from Oakland Hills North.")).toBeInTheDocument();
    expect(screen.getByText("10 total")).toBeInTheDocument();

    const thisMonthCard = screen.getByText("This month").closest("div");
    const bestScoreCard = screen.getByText("Best score").closest("div");
    const homeTrackCard = screen.getByText("Home track").closest("div");

    expect(thisMonthCard).not.toBeNull();
    expect(bestScoreCard).not.toBeNull();
    expect(homeTrackCard).not.toBeNull();
    expect(within(thisMonthCard!).getByText("3")).toBeInTheDocument();
    expect(within(bestScoreCard!).getByText("77")).toBeInTheDocument();
    expect(within(homeTrackCard!).getByText("Oakland Hills Nort...")).toBeInTheDocument();
  });

  it("surfaces fit-aware personalization and curated product reasons", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/weather") return makeJsonResponse(makeWeatherResponse());
        if (url === "/api/community/posts") return makeJsonResponse({ posts: communityPosts });
        if (url === "/api/golf/rounds" && !init?.method) {
          return makeJsonResponse({
            rounds: [{ id: "r1", date: "2026-03-28", course: "Oakland Hills", score: 79 }],
          });
        }
        throw new Error(`Unhandled fetch: ${url}`);
      })
    );

    const HomeLabPage = await loadPage();
    render(<HomeLabPage />);

    expect(await screen.findByRole("heading", { name: "Rain Layer" })).toBeInTheDocument();
    expect(screen.getByText("Uses your L size profile where possible.")).toBeInTheDocument();
    expect(screen.getByText("Matched to your fast mover preference.")).toBeInTheDocument();
    expect(screen.getByText("Reserve pricing materially improves the value.")).toBeInTheDocument();
    expect(screen.getByText("4/4")).toBeInTheDocument();
    expect(screen.getByText("Fit profile completion: 100%")).toBeInTheDocument();
    expect(screen.getByText("Current style leaning: Fast mover")).toBeInTheDocument();
    expect(screen.getByText("Reserve access: Unlocked")).toBeInTheDocument();

    const shirtCard = screen.getByText("Shirt").closest("div");
    const vibeCard = screen.getByText("Vibe").closest("div");
    const clubCard = screen.getByText("Club").closest("div");

    expect(shirtCard).not.toBeNull();
    expect(vibeCard).not.toBeNull();
    expect(clubCard).not.toBeNull();
    expect(within(shirtCard!).getByText("L")).toBeInTheDocument();
    expect(within(vibeCard!).getByText("Fast mover")).toBeInTheDocument();
    expect(within(clubCard!).getByText("Private club")).toBeInTheDocument();
    expect(screen.getAllByText("Oakland Hills").length).toBeGreaterThan(0);
  });
});
