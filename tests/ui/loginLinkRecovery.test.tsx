import type React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  sendOTPEmail: vi.fn(),
  confirm: vi.fn(),
  google: vi.fn(),
  googleRedirect: vi.fn(),
  completeRedirect: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/app/context/MembershipContext", () => ({
  useMembership: () => ({
    isSignedIn: false, authLoading: false, onboardingCompleted: false, tier: "free",
    completeOnboarding: vi.fn(), setTier: vi.fn(), email: null, sendOTPEmail: mocks.sendOTPEmail,
  }),
}));
vi.mock("@/lib/firebase", () => ({
  auth: {},
  isSignInWithEmailLink: (_a: unknown, href: string) => href.includes("oobCode="),
  confirmOTPSignIn: mocks.confirm,
  signInWithGoogle: mocks.google,
  signInWithGoogleRedirect: mocks.googleRedirect,
  completeGoogleRedirectSignIn: mocks.completeRedirect,
}));
vi.mock("@/lib/shopifyCheckout", () => ({ createMembershipCheckout: vi.fn() }));
vi.mock("@/app/shop/components/ShopPageShell", () => ({
  ShopPageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import LoginPage from "@/app/login/page";
import { DEAD_LINK_MESSAGE, WRONG_EMAIL_FOR_LINK_MESSAGE } from "@/app/login/loginErrors";

const LINK = "/login?returnTo=%2Fshop&apiKey=k&oobCode=DEADCODE&mode=signIn&lang=en";
const authErr = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mocks.completeRedirect.mockResolvedValue(null);
  mocks.sendOTPEmail.mockResolvedValue(undefined);
});

describe("expired / used email link recovery", () => {
  it.each(["auth/invalid-action-code", "auth/expired-action-code", "auth/internal-error"])(
    "%s: strips the code, shows the fresh-link form prefilled, and does not retry dead codes",
    async (code) => {
      window.history.replaceState({}, "", LINK);
      localStorage.setItem("emailForSignIn", "jane@example.com");
      mocks.confirm.mockRejectedValue(authErr(code));
      render(<LoginPage />);
      expect(await screen.findByText(DEAD_LINK_MESSAGE, {}, { timeout: 5000 })).toBeTruthy();
      expect(window.location.search).toBe("?returnTo=%2Fshop");
      expect((screen.getByPlaceholderText("you@example.com") as HTMLInputElement).value).toBe("jane@example.com");
      expect(screen.getByText("Get a new sign‑in link")).toBeTruthy();
      if (code !== "auth/internal-error") expect(mocks.confirm).toHaveBeenCalledTimes(1);
    },
    10000,
  );

  it("does not retry the dead code after a refresh", async () => {
    window.history.replaceState({}, "", LINK);
    localStorage.setItem("emailForSignIn", "jane@example.com");
    mocks.confirm.mockRejectedValue(authErr("auth/invalid-action-code"));
    const first = render(<LoginPage />);
    await screen.findByText(DEAD_LINK_MESSAGE);
    first.unmount();
    mocks.confirm.mockClear();
    render(<LoginPage />); // "refresh" on the cleaned URL
    await act(async () => {});
    expect(mocks.confirm).not.toHaveBeenCalled();
    // Email survives the refresh via sessionStorage.
    expect((screen.getByPlaceholderText("you@example.com") as HTMLInputElement).value).toBe("jane@example.com");
  });

  it("sends a fresh link to the lowercased, trimmed email", async () => {
    window.history.replaceState({}, "", "/login");
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "  Jane@Example.COM " } });
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(mocks.sendOTPEmail).toHaveBeenCalledWith("jane@example.com"));
    expect(await screen.findByText("Check your email")).toBeTruthy();
  });

  it("rejects an invalid email without calling Firebase", async () => {
    window.history.replaceState({}, "", "/login");
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "jane@example" } });
    fireEvent.click(screen.getByText("Continue"));
    expect(await screen.findByText("Please enter a valid email address.")).toBeTruthy();
    expect(mocks.sendOTPEmail).not.toHaveBeenCalled();
  });
});

describe("link opened on another device", () => {
  it("wrong email keeps the link usable and explains what to enter", async () => {
    window.history.replaceState({}, "", LINK);
    mocks.confirm.mockRejectedValueOnce(authErr("auth/invalid-email")).mockResolvedValueOnce(undefined);
    render(<LoginPage />);
    const input = await screen.findByPlaceholderText("you@example.com");
    fireEvent.change(input, { target: { value: "wrong@example.com" } });
    fireEvent.click(screen.getByText("Sign In"));
    expect(await screen.findByText(WRONG_EMAIL_FOR_LINK_MESSAGE)).toBeTruthy();
    expect(window.location.search).toContain("oobCode=DEADCODE");
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "Right@Example.com" } });
    fireEvent.click(screen.getByText("Sign In"));
    await waitFor(() => expect(mocks.confirm).toHaveBeenLastCalledWith("right@example.com", expect.stringContaining("oobCode=DEADCODE")));
  });

  it("expired link on another device falls back to the fresh-link form with that email", async () => {
    window.history.replaceState({}, "", LINK);
    mocks.confirm.mockRejectedValue(authErr("auth/expired-action-code"));
    render(<LoginPage />);
    fireEvent.change(await screen.findByPlaceholderText("you@example.com"), { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByText("Sign In"));
    expect(await screen.findByText(DEAD_LINK_MESSAGE)).toBeTruthy();
    expect(window.location.search).toBe("?returnTo=%2Fshop");
    expect((screen.getByPlaceholderText("you@example.com") as HTMLInputElement).value).toBe("jane@example.com");
  });

  it("'Send me a new link instead' leaves the link form", async () => {
    window.history.replaceState({}, "", LINK);
    render(<LoginPage />);
    fireEvent.click(await screen.findByText("Send me a new link instead"));
    expect(screen.getByText("Continue")).toBeTruthy();
    expect(window.location.search).toBe("?returnTo=%2Fshop");
  });
});

describe("Google sign-in errors", () => {
  it.each([
    ["auth/popup-closed-by-user", "The Google sign-in window was closed before it finished. Try again, or use the email link below."],
    ["auth/network-request-failed", "We couldn't reach the sign-in service. Check your connection and try again."],
    ["auth/account-exists-with-different-credential", "This email already has a Mully account with a different sign-in method. Use the email link below to sign in."],
  ])("%s shows clear copy", async (code, message) => {
    window.history.replaceState({}, "", "/login");
    mocks.google.mockRejectedValue(authErr(code));
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with Google"));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(mocks.googleRedirect).not.toHaveBeenCalled();
  });

  it.each(["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"])(
    "%s falls back to a full-page Google redirect",
    async (code) => {
      window.history.replaceState({}, "", "/login");
      mocks.google.mockRejectedValue(authErr(code));
      mocks.googleRedirect.mockResolvedValue(undefined);
      render(<LoginPage />);
      fireEvent.click(screen.getByText("Continue with Google"));
      await waitFor(() => expect(mocks.googleRedirect).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("surfaces an error from a completed Google redirect", async () => {
    window.history.replaceState({}, "", "/login");
    mocks.completeRedirect.mockRejectedValue(authErr("auth/account-exists-with-different-credential"));
    render(<LoginPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("in-app browsers get the open-in-Safari/Chrome hint and no redirect attempt", async () => {
    const ua = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0",
    );
    try {
      window.history.replaceState({}, "", "/login");
      mocks.google.mockRejectedValue(authErr("auth/operation-not-supported-in-this-environment"));
      render(<LoginPage />);
      expect(screen.getAllByText(/Open this page in Safari or Chrome/).length).toBeGreaterThan(0);
      fireEvent.click(screen.getByText("Continue with Google"));
      await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Safari or Chrome/));
      expect(mocks.googleRedirect).not.toHaveBeenCalled();
    } finally {
      ua.mockRestore();
    }
  });
});
