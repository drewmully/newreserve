import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";

const mocks = vi.hoisted(() => ({ membership: {} as Record<string, unknown>, sendOTPEmail: vi.fn() }));
vi.mock("@/app/context/MembershipContext", () => ({ useMembership: () => mocks.membership }));
vi.mock("@/lib/firebase", () => ({ sendOTPEmail: mocks.sendOTPEmail }));

import { SubscriptionManagerModal } from "@/app/account/SubscriptionManagerModal";

const user = {
  uid: "u1",
  email: "new@example.com",
  getIdToken: vi.fn().mockResolvedValue("id-token"),
} as unknown as User;
const res = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

beforeEach(() => {
  mocks.sendOTPEmail.mockReset().mockResolvedValue(undefined);
  mocks.membership = { user, acceptShopifySubscriptions: vi.fn(), refreshShopifySubscriptions: vi.fn() };
  window.history.replaceState(null, "", "/account");
});

describe("Shopify connect for unverified MyMully emails", () => {
  it("offers a verification link instead of a dead-end message", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(res({ needsConnection: true, error: "Connect your Shopify account." }, false, 401))
      .mockResolvedValueOnce(res({ error: "Sign in with your Mully email link before connecting Shopify.", code: "verify_email" }, false, 403));
    vi.stubGlobal("fetch", fetch);

    render(<SubscriptionManagerModal provider="shopify" open onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Shopify account" }));

    expect(await screen.findByText("Please verify your MyMully email before connecting Shopify.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send verification link" }));

    await waitFor(() => expect(mocks.sendOTPEmail).toHaveBeenCalledWith("new@example.com"));
    expect(await screen.findByText(/We sent a sign-in link to new@example.com/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend verification link" })).toBeInTheDocument();
  });

  it("shows the button when returning from the callback with ?shopify=verify_email", async () => {
    window.history.replaceState(null, "", "/account?manage=shopify&shopify=verify_email");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ needsConnection: true, error: "Connect your Shopify account." }, false, 401)));
    render(<SubscriptionManagerModal provider="shopify" open onClose={() => {}} />);
    expect(await screen.findByRole("button", { name: "Send verification link" })).toBeInTheDocument();
  });
});
