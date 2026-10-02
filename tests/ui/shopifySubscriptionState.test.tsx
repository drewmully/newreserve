import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { User } from "firebase/auth";
import { useShopifySubscriptions, type ShopifySubscription } from "@/app/context/useShopifySubscriptions";
import { ShopifyOutfitMembershipCard } from "@/app/account/ShopifyOutfitMembershipCard";
import { outfitMembershipFromPaidOrder } from "@/lib/shopifyOutfitMembership";

const mocks = vi.hoisted(() => ({ membership: {} as Record<string, unknown> }));
vi.mock("@/app/context/MembershipContext", () => ({ useMembership: () => mocks.membership }));
import { SubscriptionManagerModal } from "@/app/account/SubscriptionManagerModal";

const user = { uid: "test-user", getIdToken: vi.fn().mockResolvedValue("test-token") } as unknown as User;
const contract: ShopifySubscription = {
  id: "gid://shopify/SubscriptionContract/123", status: "ACTIVE", title: "Seasonal Edit",
  price: 299.95, currency: "USD", nextBillingDateEpoch: 1798880400, interval: "MONTH", intervalCount: 3,
};
const receipt = outfitMembershipFromPaidOrder({
  id: 123, processed_at: "2026-10-02T14:00:00Z", currency: "USD",
  line_items: [{ variant_id: 50408581267648, quantity: 1, price: "299.95" }],
})!;
const response = (contracts = [contract]) => ({ ok: true, json: async () => ({ subscriptions: contracts }) });
afterEach(() => { vi.unstubAllGlobals(); });

function Harness() {
  const native = useShopifySubscriptions(user, true);
  const [open, setOpen] = useState(false);
  mocks.membership = { user, ...native };
  return <>
    <ShopifyOutfitMembershipCard membership={receipt} live={native.shopifySubscriptions}
      onManage={() => setOpen(true)} onRefresh={native.refreshShopifySubscriptions} />
    <SubscriptionManagerModal provider="shopify" open={open} onClose={() => setOpen(false)} />
  </>;
}

describe("shared native subscription status", () => {
  it("updates the surrounding card before cancellation closes, even when readback fails", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response()) // Provider read
      .mockResolvedValueOnce(response()) // Modal read
      .mockResolvedValueOnce({ ok: true, json: async () => ({ contract: { id: contract.id, status: "CANCELLED" } }) })
      .mockRejectedValueOnce(new Error("offline")); // Post-mutation readback
    vi.stubGlobal("fetch", fetch);
    render(<Harness />);
    expect(await screen.findByText("Status: Active")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage subscription" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel Subscription" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Status: Cancelled (last confirmed)")).toBeInTheDocument();
    expect(screen.getByText(/Already-paid orders are unaffected/)).toBeInTheDocument();
    expect(screen.queryByText(/Next renewal:/)).not.toBeInTheDocument();
    expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });

  it("shows a confirmed cancellation and an explicit new-purchase path, never an automatic reactivation", () => {
    render(<ShopifyOutfitMembershipCard membership={receipt} onManage={vi.fn()}
      live={{ contracts: [{ ...contract, status: "CANCELLED" }], state: "ready", stale: false }} />);
    expect(screen.getByText("Status: Cancelled")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a new subscription" })).toHaveAttribute("href", "/shop#outfit");
    expect(screen.getByText(/new paid subscription/)).toBeInTheDocument();
    expect(screen.queryByText(/Next renewal:/)).not.toBeInTheDocument();
  });

  it("does not offer another subscription if a second contract is active or paused", () => {
    render(<ShopifyOutfitMembershipCard membership={receipt} onManage={vi.fn()}
      live={{ contracts: [{ ...contract, status: "CANCELLED" }, { ...contract, id: "another", status: "PAUSED" }], state: "ready", stale: false }} />);
    expect(screen.queryByRole("link", { name: "Start a new subscription" })).not.toBeInTheDocument();
    expect(screen.getByText("Automatic renewals are paused.")).toBeInTheDocument();
    expect(screen.queryByText(/Next renewal:/)).not.toBeInTheDocument();
  });

  it("does not label the paid receipt as an active contract when connection is missing", () => {
    render(<ShopifyOutfitMembershipCard membership={receipt} onManage={vi.fn()}
      live={{ contracts: [], state: "connection_required", stale: true }} />);
    expect(screen.getByRole("button", { name: "Connect Shopify account" })).toBeInTheDocument();
    expect(screen.queryByText(/Status: Active/)).not.toBeInTheDocument();
  });

  it("ignores an in-flight old read after the mutation result is confirmed", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(r => { resolve = r; })));
    const { result } = renderHook(() => useShopifySubscriptions(user, true));
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    act(() => result.current.acceptShopifySubscriptions([{ ...contract, status: "CANCELLED" }]));
    await act(async () => { resolve(response()); });
    expect(result.current.shopifySubscriptions.contracts[0].status).toBe("CANCELLED");
  });

  it("refreshes on focus and hides customer state immediately after sign-out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response([{ ...contract, status: "CANCELLED" }])));
    const { result, rerender } = renderHook(({ current }: { current: User | null }) => useShopifySubscriptions(current, true), { initialProps: { current: user as User | null } });
    await waitFor(() => expect(result.current.shopifySubscriptions.state).toBe("ready"));
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(result.current.shopifySubscriptions.contracts[0].status).toBe("CANCELLED"));
    rerender({ current: null });
    expect(result.current.shopifySubscriptions.contracts).toEqual([]);
  });
});
