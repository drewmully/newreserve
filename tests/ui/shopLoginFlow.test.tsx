import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  replace: vi.fn(), complete: vi.fn().mockResolvedValue(undefined),
  setTier: vi.fn(), checkout: vi.fn(), completed: false, tier: "free" as string,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/app/context/MembershipContext", () => ({
  useMembership: () => ({
    isSignedIn: true, authLoading: false, onboardingCompleted: mocks.completed,
    completeOnboarding: mocks.complete, setTier: mocks.setTier, email: "test@example.com",
    tier: mocks.tier, sendOTPEmail: vi.fn(),
  }),
}));
vi.mock("@/lib/firebase", () => ({
  auth: {}, isSignInWithEmailLink: () => false,
  confirmOTPSignIn: vi.fn(), signInWithGoogle: vi.fn(),
  signInWithGoogleRedirect: vi.fn(), completeGoogleRedirectSignIn: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/shopifyCheckout", () => ({ createMembershipCheckout: mocks.checkout }));
import LoginPage from "@/app/login/page";
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.completed = false;
  mocks.tier = "free";
  mocks.complete.mockResolvedValue(undefined);
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
  it("returns normal member sign-in to the shop homepage", async () => {
    mocks.completed = true;
    window.history.replaceState({}, "", "/login");
    render(<LoginPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
  });
  it("retains paid membership onboarding priority", async () => {
    window.history.replaceState({}, "", "/login?paid=1&returnTo=%2Fshop");
    localStorage.setItem("pending_onboarding_data", JSON.stringify({ selectedTier: "member", username: "test", onboardingProfile: {} }));
    render(<LoginPage />);
    await waitFor(() => expect(mocks.complete).toHaveBeenCalled());
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalledWith("/shop");
  });
  // Regression from 4e2dd3b: shopReturnFromLogin returned "/" for every
  // URL, so plain magic links never applied pending onboarding answers.
  it("applies pending onboarding on a plain /login magic link", async () => {
    window.history.replaceState({}, "", "/login");
    localStorage.setItem("pending_onboarding_data", JSON.stringify({
      selectedTier: "free", username: "jane", onboardingProfile: { goal: "x" }, phone: "+15555550123", smsOptIn: true,
    }));
    render(<LoginPage />);
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      username: "jane", phone: "+15555550123", smsOptIn: true,
    })));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
    expect(localStorage.getItem("pending_onboarding_data")).toBeNull();
    expect(mocks.setTier).toHaveBeenCalledWith("free");
  });
  it("sends a pending paid-tier pick to checkout after saving onboarding", async () => {
    window.history.replaceState({}, "", "/login");
    localStorage.setItem("pending_onboarding_data", JSON.stringify({ selectedTier: "member", username: "j", onboardingProfile: {} }));
    render(<LoginPage />);
    await waitFor(() => expect(mocks.checkout).toHaveBeenCalledWith("member"));
  });
  it("keeps the answers and goes to /onboarding when saving fails", async () => {
    mocks.complete.mockRejectedValue(new Error("permission-denied"));
    window.history.replaceState({}, "", "/login");
    localStorage.setItem("pending_onboarding_data", JSON.stringify({ selectedTier: "member", username: "j", onboardingProfile: {} }));
    render(<LoginPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/onboarding"));
    expect(localStorage.getItem("pending_onboarding_data")).not.toBeNull();
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.setTier).not.toHaveBeenCalled();
  });
  it("never sends an existing paid member back to checkout or downgrades them", async () => {
    mocks.tier = "member";
    window.history.replaceState({}, "", "/login");
    localStorage.setItem("pending_onboarding_data", JSON.stringify({ selectedTier: "access", username: "j", onboardingProfile: {} }));
    render(<LoginPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.setTier).not.toHaveBeenCalled();
  });
  it("drops unreadable leftovers instead of blocking sign-in", async () => {
    window.history.replaceState({}, "", "/login");
    localStorage.setItem("pending_onboarding_data", "{not json");
    render(<LoginPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
    expect(localStorage.getItem("pending_onboarding_data")).toBeNull();
  });
});
