import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  signInWithCustomToken: vi.fn(),
  trackEvent: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock("@/lib/tracking", () => ({ trackEvent: mocks.trackEvent }));
vi.mock("@/lib/takeAShot/popupRules", () => ({ markSignedUp: vi.fn() }));
vi.mock("@/lib/firebase", () => ({ auth: { name: "test-auth" } }));
vi.mock("firebase/auth", () => ({ signInWithCustomToken: mocks.signInWithCustomToken }));

import { EmailCTA, PENDING_ONBOARDING_EMAIL_KEY } from "@/app/components/EmailCTA";
import { PENDING_SIGN_IN_EMAIL_KEY } from "@/lib/pendingSignInEmail";

const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

function stubFetch(routes: Record<string, () => unknown>) {
  const fetch = vi.fn(async (url: string) => {
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    return handler();
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function submit(email: string) {
  render(<EmailCTA variant="hero" />);
  fireEvent.change(screen.getByPlaceholderText("Your email"), { target: { value: email } });
  fireEvent.submit(screen.getByPlaceholderText("Your email").closest("form")!);
}

beforeEach(() => {
  sessionStorage.clear();
  mocks.push.mockReset();
  mocks.signInWithCustomToken.mockReset();
});

describe("EmailCTA start-account routing", () => {
  it("routes { exists: true } from start-account to /login with the pending email, without signing in", async () => {
    const fetch = stubFetch({
      "/api/auth/check-email": () => json({ error: "Internal server error" }, false, 500),
      "/api/auth/check-loop-status": () => json({ paid: false }),
      "/api/auth/start-account": () => json({ exists: true }),
    });
    submit("returning@example.com");

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/login"));
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalledWith("/onboarding");
    expect(mocks.push).not.toHaveBeenCalledWith("/choose-plan");
    expect(sessionStorage.getItem(PENDING_SIGN_IN_EMAIL_KEY)).toBe("returning@example.com");
    expect(sessionStorage.getItem(PENDING_ONBOARDING_EMAIL_KEY)).toBe("returning@example.com");
    expect(mocks.signInWithCustomToken).not.toHaveBeenCalled();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/auth/check-email",
      "/api/auth/check-loop-status",
      "/api/auth/start-account",
    ]);
  });

  it("stores the pending email identically to the check-email exists path", async () => {
    stubFetch({ "/api/auth/check-email": () => json({ exists: true }) });
    submit("known@example.com");
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/login"));
    expect(sessionStorage.getItem(PENDING_SIGN_IN_EMAIL_KEY)).toBe("known@example.com");
  });

  it("still signs new users in with the custom token and routes to /choose-plan", async () => {
    stubFetch({
      "/api/auth/check-email": () => json({ exists: false }),
      "/api/auth/check-loop-status": () => json({ paid: false }),
      "/api/auth/start-account": () => json({ uid: "u1", customToken: "tok", isNewUser: true }),
    });
    mocks.signInWithCustomToken.mockResolvedValue({});
    submit("new@example.com");
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/choose-plan"));
    expect(mocks.signInWithCustomToken).toHaveBeenCalledWith({ name: "test-auth" }, "tok");
  });

  it("keeps the /onboarding fallback for start-account errors", async () => {
    stubFetch({
      "/api/auth/check-email": () => json({ exists: false }),
      "/api/auth/check-loop-status": () => json({ paid: false }),
      "/api/auth/start-account": () => json({ error: "Could not create account" }, false, 500),
    });
    submit("new@example.com");
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding"));
  });
});
