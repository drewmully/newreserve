import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailCTA } from "@/app/components/EmailCTA";
import { PENDING_SIGN_IN_EMAIL_KEY } from "@/lib/pendingSignInEmail";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

describe("EmailCTA", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    sessionStorage.clear();
  });

  it("stores the entered email before navigating to login", async () => {
    render(<EmailCTA />);

    await userEvent.type(screen.getByPlaceholderText("Your email"), "member@example.com");
    await userEvent.click(screen.getByRole("button", { name: /unlock access/i }));

    expect(sessionStorage.getItem(PENDING_SIGN_IN_EMAIL_KEY)).toBe("member@example.com");
    expect(mocks.push).toHaveBeenCalledWith("/login");
  });
});
