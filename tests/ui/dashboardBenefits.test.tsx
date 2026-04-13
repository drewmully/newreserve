import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  const setTier = vi.fn();
  const setCartOpen = vi.fn();
  const refreshStoreCredit = vi.fn().mockResolvedValue(undefined);
  const refreshSubscriptionStatus = vi.fn().mockResolvedValue(undefined);
  const getIdToken = vi.fn().mockResolvedValue("token-123");

  return {
    replace,
    setTier,
    setCartOpen,
    refreshStoreCredit,
    refreshSubscriptionStatus,
    getIdToken,
    membershipState: {
      isSignedIn: true,
      authLoading: false,
      user: { getIdToken },
      tier: "access",
      tierLabel: "Reserve Access",
      setTier,
      cartCount: 0,
      setCartOpen,
      refreshStoreCredit,
      refreshSubscriptionStatus,
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams("tab=benefits"),
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

vi.mock("@/app/context/MembershipContext", () => ({
  useMembership: () => mocks.membershipState,
}));

vi.mock("@/app/components/SlideCart", () => ({
  SlideCart: () => <div data-testid="slide-cart" />,
}));

vi.mock("@/app/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));

vi.mock("@/app/shop/components/ShopClient", () => ({
  ShopGrid: () => <div data-testid="shop-grid" />,
}));

vi.mock("@/lib/tracking", () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/shopify", () => ({
  PRO_SHOP_COLLECTION_HANDLE: "reserve-pro-shop",
  PRIVATE_RELEASES_COLLECTION_HANDLE: "private-releases",
  getCollectionProducts: vi.fn(),
  mergeCollectionProductsBySlug: vi.fn(),
}));

vi.mock("@/lib/dropConfig", () => ({
  getExclusiveDropDate: () => new Date("2030-05-15T21:00:00-04:00"),
  formatExclusiveDropLabel: () => "May 15",
}));

async function loadPage() {
  const mod = await import("@/app/dashboard/page");
  return mod.default;
}

describe("dashboard benefits", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.setTier.mockReset();
    mocks.setCartOpen.mockReset();
    mocks.getIdToken.mockClear();
    mocks.refreshStoreCredit.mockClear().mockResolvedValue(undefined);
    mocks.refreshSubscriptionStatus.mockClear().mockResolvedValue(undefined);
  });

  it("renders the new benefit list from the sheet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      })
    );

    const DashboardPage = await loadPage();
    render(<DashboardPage />);

    expect(await screen.findByText("V1+ Virtual Coaching")).toBeInTheDocument();
    expect(screen.getByText("Concierge Support")).toBeInTheDocument();
    expect(screen.getByText("Free 2-Day Shipping")).toBeInTheDocument();
    expect(screen.getByText("Far & Sure Golf Tours Credit")).toBeInTheDocument();
    expect(screen.getByText("Priority Drop Access")).toBeInTheDocument();

    expect(screen.queryByText("Reserve Pricing")).not.toBeInTheDocument();
    expect(screen.queryByText("Invite-Only Events")).not.toBeInTheDocument();
    expect(screen.queryByText("Partner Perks & Discounts")).not.toBeInTheDocument();
  });

  it("submits the Far & Sure credit form through the benefits API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, id: "evt_travel" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const DashboardPage = await loadPage();
    render(<DashboardPage />);

    await user.click(await screen.findByRole("button", { name: "Request Credit" }));
    expect(screen.getAllByText("Far & Sure Golf Tours Credit").length).toBeGreaterThan(1);

    await user.clear(screen.getByLabelText("# of golfers"));
    await user.type(screen.getByLabelText("# of golfers"), "4");
    await user.type(screen.getByLabelText("Budget per golfer"), "$2,500");
    await user.type(screen.getByLabelText("Dates"), "June 12-16");
    await user.type(screen.getByLabelText("Destination"), "Scotland");
    await user.type(screen.getByLabelText("Notes"), "Prefer links courses.");

    await user.click(screen.getByRole("button", { name: "Send Request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/benefits/interaction",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
          "Content-Type": "application/json",
        }),
      })
    ));

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({
      benefit: "far_sure_golf_tours_credit",
      action: "request",
      golfers: 4,
      budgetPerGolfer: "$2,500",
      dates: "June 12-16",
      destination: "Scotland",
      notes: "Prefer links courses.",
      source: "dashboard_benefits",
    });
  });

  it("requests V1+ review without allowing a toggle-off action", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, id: "evt_v1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const DashboardPage = await loadPage();
    render(<DashboardPage />);

    const v1Switch = await screen.findByRole("switch", { name: "Turn on V1+ Virtual Coaching" });
    await user.click(v1Switch);

    await waitFor(() =>
      expect(screen.getAllByText(
        "Your V1+ Virtual Coaching request is being reviewed. You will receive an email within 1-3 days with next steps."
      ).length).toBeGreaterThan(0)
    );

    expect(v1Switch).toBeDisabled();
    expect(v1Switch).toHaveAttribute("aria-checked", "true");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({
      benefit: "v1_virtual_coaching",
      action: "toggle",
      enabled: true,
      source: "dashboard_benefits",
    });
  });
});
