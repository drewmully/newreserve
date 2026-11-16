import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

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
      acceptShopifySubscriptions: vi.fn(),
      refreshShopifySubscriptions: vi.fn().mockResolvedValue(undefined),
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

vi.mock("@/app/shop/components/ShopPageShell", () => ({
  ShopPageShell: ({ children }: { children: ReactNode }) => <>{children}</>,
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

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

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

describe("native subscription management in the existing account modal", () => {
  const contract = {
    id: "gid://shopify/SubscriptionContract/123",
    status: "ACTIVE",
    price: 299.95,
    currency: "USD",
    nextBillingDateEpoch: 1798880400,
  };
  beforeEach(() => {
    mocks.getIdToken.mockResolvedValue("token-123");
  });

  it("shows native live details and sends pause only to the native endpoint", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ subscriptions: [contract] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ contract: { id: contract.id, status: "PAUSED" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ subscriptions: [{ ...contract, status: "PAUSED" }] }) });
    vi.stubGlobal("fetch", fetch);
    const { SubscriptionManagerModal } = await import("@/app/account/SubscriptionManagerModal");
    render(<SubscriptionManagerModal open provider="shopify" onClose={vi.fn()} />);
    expect(await screen.findByText("$299.95")).toBeInTheDocument();
    expect(screen.queryByText("Change Plan")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause Subscription" }));
    expect(await screen.findByRole("button", { name: "Resume Subscription" })).toBeInTheDocument();
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/shopify-customer/subscriptions/pause", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ contractId: contract.id }),
      headers: expect.objectContaining({ Authorization: "Bearer token-123" }),
    }));
  });

  it("offers account connection rather than a hosted management portal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ needsConnection: true, error: "Connect your Shopify account." }),
    }));
    const { SubscriptionManagerModal } = await import("@/app/account/SubscriptionManagerModal");
    render(<SubscriptionManagerModal open provider="shopify" onClose={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Connect Shopify account" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("reports a failed callback rather than hiding the failure behind a generic reconnect prompt", async () => {
    window.history.replaceState({}, "", "/account?manage=shopify&shopify=permissions_required");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ needsConnection: true, error: "Connect your Shopify account." }),
    }));
    const { SubscriptionManagerModal } = await import("@/app/account/SubscriptionManagerModal");
    render(<SubscriptionManagerModal open provider="shopify" onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("subscription access is not enabled");
  });

  it("does not close or report success after a failed cancellation", async () => {
    const onClose = vi.fn();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ subscriptions: [contract] }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Shopify could not cancel this subscription." }) }));
    const { SubscriptionManagerModal } = await import("@/app/account/SubscriptionManagerModal");
    render(<SubscriptionManagerModal open provider="shopify" onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel Subscription" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Cancel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Shopify could not cancel");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not offer unsupported reactivation for cancelled native contracts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ subscriptions: [{ ...contract, status: "CANCELLED" }] }),
    }));
    const { SubscriptionManagerModal } = await import("@/app/account/SubscriptionManagerModal");
    render(<SubscriptionManagerModal open provider="shopify" onClose={vi.fn()} />);
    expect(await screen.findByText(/There are no further automatic renewals/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reactivate Subscription" })).not.toBeInTheDocument();
  });
});

describe("order history dead ends", () => {
  beforeEach(() => {
    mocks.getIdToken.mockResolvedValue("token-123");
    mocks.signOut.mockClear();
  });

  it("offers a retry when the order fetch fails, and the retry reloads orders", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue({ ok: true, json: async () => ({ orders: [], source: "shopify" }) });
    vi.stubGlobal("fetch", fetchMock);
    const AccountPage = await loadPage();
    render(<AccountPage />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByText("Order history is temporarily unavailable")).toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("No orders yet")).toBeInTheDocument());
    expect(fetchMock.mock.calls.filter(([u]) => u === "/api/shopify/orders")).toHaveLength(2);
  });

  it("treats a non-OK orders response as unavailable rather than empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    const AccountPage = await loadPage();
    render(<AccountPage />);
    expect(await screen.findByText("Order history is temporarily unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No orders yet")).not.toBeInTheDocument();
  });

  it("explains the different-email case on an empty order list, with sign out and a prefilled support email", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ orders: [], source: "no_customer" }) }));
    const AccountPage = await loadPage();
    render(<AccountPage />);
    const help = await screen.findByTestId("different-email-help");
    expect(help.textContent).toMatch(/Bought with a different email\?/);
    expect(help.textContent).toContain("member@example.com");
    const contact = screen.getByRole("link", { name: "Contact us" }) as HTMLAnchorElement;
    expect(contact.href.startsWith("mailto:info@mymully.com?")).toBe(true);
    expect(decodeURIComponent(contact.href)).toContain("Account email: member@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(mocks.signOut).toHaveBeenCalled();
  });
});

describe("no subscription found", () => {
  it("explains the different-email case instead of dead-ending", async () => {
    const onClose = vi.fn();
    mocks.signOut.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ subscriptions: [] }) }));
    const { SubscriptionManagerModal } = await import("@/app/account/SubscriptionManagerModal");
    render(<SubscriptionManagerModal open provider="shopify" onClose={onClose} />);
    expect(await screen.findByText("No subscription found.")).toBeInTheDocument();
    const help = screen.getByTestId("different-email-help");
    expect(help.textContent).toContain("member@example.com");
    expect((screen.getByRole("link", { name: "Contact us" }) as HTMLAnchorElement).href).toMatch(/^mailto:info@mymully\.com\?/);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalled();
  });
});
