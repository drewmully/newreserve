import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  const getIdToken = vi.fn().mockResolvedValue("token-123");
  const refreshStoreCredit = vi.fn().mockResolvedValue(undefined);
  const refreshSubscriptionStatus = vi.fn().mockResolvedValue(undefined);
  const signOut = vi.fn().mockResolvedValue(undefined);
  const saveUsername = vi.fn().mockResolvedValue(undefined);
  const saveMessagingPreferences = vi.fn().mockResolvedValue(undefined);
  const setTier = vi.fn();
  const setFitProfile = vi.fn();

  return {
    replace,
    getIdToken,
    refreshStoreCredit,
    refreshSubscriptionStatus,
    signOut,
    saveUsername,
    saveMessagingPreferences,
    setTier,
    setFitProfile,
    membershipState: {
      user: { getIdToken },
      isSignedIn: true,
      authLoading: false,
      email: "member@example.com",
      username: "Santi",
      saveUsername,
      tier: "member",
      tierLabel: "Reserve Member",
      setTier,
      fitProfile: {
        shirtSize: "L",
        gloveHand: "Right",
        gloveSize: "M",
        waistSize: "34",
        pantsInseam: '32"',
        shortsInseam: '9"',
        shoeSize: "10.5",
      },
      setFitProfile,
      signOut,
      storeCredit: {
        balance_cents: 4200,
        currency: "USD",
        source: "cache",
        isStale: true,
      },
      subscriptions: {
        mullybox_active: true,
        status: "ACTIVE",
        total_subscription_count: 1,
        active_subscription_ids: ["sub_1"],
        manage_url: null,
        next_unblock_url: null,
        source: "cache",
        isStale: true,
      },
      refreshStoreCredit,
      refreshSubscriptionStatus,
      messagingPreferences: {
        email_marketing: true,
        sms_marketing: false,
      },
      saveMessagingPreferences,
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/app/context/MembershipContext", () => ({
  useMembership: () => mocks.membershipState,
}));

vi.mock("@/lib/tracking", () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/app/components/SlideCart", () => ({
  SlideCart: () => <div data-testid="slide-cart" />,
}));

vi.mock("@/app/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
  PillButton: () => null,
  FIT_SHIRT_SIZES: [],
  FIT_GLOVE_HANDS: [],
  FIT_GLOVE_SIZES: [],
  FIT_WAIST_SIZES: [],
  FIT_SHOE_SIZES: [],
  FIT_PANTS_INSEAMS: [],
  FIT_SHORTS_INSEAMS: [],
}));

vi.mock("@/app/components/ClubhouseNav", () => ({
  ClubhouseNav: () => <div>ClubhouseNav</div>,
  ClubhouseBottomNav: () => <div>ClubhouseBottomNav</div>,
}));

async function loadPage() {
  const mod = await import("@/app/account/page");
  return mod.default;
}

describe("account stale-state messaging", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.getIdToken.mockResolvedValue("token-123");
    mocks.refreshStoreCredit.mockReset().mockResolvedValue(undefined);
    mocks.refreshSubscriptionStatus.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ orders: [], source: "unavailable" }),
      })
    );
  });

  it("surfaces stale wallet, subscription, and order states instead of rendering them as definitive", async () => {
    const AccountPage = await loadPage();

    render(<AccountPage />);

    await waitFor(() =>
      expect(screen.getByText("Showing your last synced balance while Shopify reconnects.")).toBeInTheDocument()
    );

    expect(
      screen.getByText("Showing your last known membership state while Loop reconnects.")
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText("Order history is temporarily unavailable")).toBeInTheDocument()
    );

    expect(
      screen.getByText("We couldn’t reach Shopify just now. Try again in a moment.")
    ).toBeInTheDocument();
  });
});
