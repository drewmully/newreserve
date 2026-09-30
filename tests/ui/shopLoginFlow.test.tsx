import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  replace: vi.fn(), complete: vi.fn().mockResolvedValue(undefined),
  setTier: vi.fn(), checkout: vi.fn(), completed: false,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/app/context/MembershipContext", () => ({
  useMembership: () => ({
    isSignedIn: true, authLoading: false, onboardingCompleted: mocks.completed,
    completeOnboarding: mocks.complete, setTier: mocks.setTier, email: "test@example.com",
  }),
}));
vi.mock("@/lib/firebase", () => ({
  auth: {}, isSignInWithEmailLink: () => false,
  confirmOTPSignIn: vi.fn(), signInWithGoogle: vi.fn(),
}));
vi.mock("@/lib/shopifyCheckout", () => ({ createMembershipCheckout: mocks.checkout }));
import LoginPage from "@/app/login/page";
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.completed = false;
});
describe("shop login does not enroll shoppers", () => {
  it("returns to the shop instead of applying stale membership onboarding", async () => {
    window.history.replaceState({}, "", "/login?returnTo=%2Fshop%23edit");
    localStorage.setItem("pending_onboarding_data", JSON.stringify({ selectedTier: "member" }));
    render(<LoginPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/shop#edit"));
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("retains the default member sign-in path", async () => {
    mocks.completed = true;
    window.history.replaceState({}, "", "/login");
    render(<LoginPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/home"));
  });
  it("retains paid membership onboarding priority", async () => {
    window.history.replaceState({}, "", "/login?paid=1&returnTo=%2Fshop");
    localStorage.setItem("pending_onboarding_data", JSON.stringify({ selectedTier: "member", username: "test", onboardingProfile: {} }));
    render(<LoginPage />);
    await waitFor(() => expect(mocks.complete).toHaveBeenCalled());
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalledWith("/shop");
  });
});
