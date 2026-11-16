import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), confirm: vi.fn(), pathname: "/" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }), usePathname: () => mocks.pathname }));
vi.mock("@/lib/firebase", () => ({
  auth: {},
  isSignInWithEmailLink: (_a: unknown, href: string) => href.includes("oobCode="),
  confirmOTPSignIn: mocks.confirm,
}));
import { EmailLinkHandler } from "@/app/components/EmailLinkHandler";

const QUERY = "?apiKey=k&oobCode=CODE&mode=signIn&lang=en";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.pathname = "/shop";
  window.history.replaceState({}, "", `/shop${QUERY}`);
});

describe("EmailLinkHandler", () => {
  it("hands a different-device link to /login with the link query intact", async () => {
    render(<EmailLinkHandler />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(`/login${QUERY}`));
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("sends a dead link to /login (which shows the fresh-link recovery) without retrying it", async () => {
    localStorage.setItem("emailForSignIn", "a@b.co");
    mocks.confirm.mockRejectedValue(Object.assign(new Error("x"), { code: "auth/expired-action-code" }));
    render(<EmailLinkHandler />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(`/login${QUERY}`));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it("signs in and goes home on success", async () => {
    localStorage.setItem("emailForSignIn", "a@b.co");
    mocks.confirm.mockResolvedValue(undefined);
    render(<EmailLinkHandler />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
  });

  it("does nothing on /login", async () => {
    mocks.pathname = "/login";
    render(<EmailLinkHandler />);
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
