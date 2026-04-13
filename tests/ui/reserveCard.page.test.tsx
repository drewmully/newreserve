import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracking", () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

async function loadPage() {
  const mod = await import("@/app/reservecard/page");
  return mod.default;
}

async function advanceToConfirmationStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Your email"), "member@example.com");
  await user.click(screen.getByRole("button", { name: "Menswear" }));
  await user.click(screen.getByRole("button", { name: "Get Started" }));

  await user.click(screen.getByRole("button", { name: "XXL" }));
  await user.click(screen.getByRole("button", { name: "Left" }));
  await user.click(screen.getByRole("button", { name: "ML" }));
  await user.click(screen.getByRole("button", { name: "Next" }));

  await user.click(screen.getByRole("button", { name: "34" }));
  await user.click(screen.getByRole("button", { name: '32"' }));
  await user.click(screen.getByRole("button", { name: '9"' }));
  await user.click(screen.getByRole("button", { name: "10.5" }));
  await user.click(screen.getByRole("button", { name: "Next" }));

  await user.click(screen.getByRole("button", { name: "Skip" }));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Choose your plan." })).toBeInTheDocument()
  );
}

describe("reserve card submission flow", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("does not advance to success when the save request fails", async () => {
    const user = userEvent.setup();
    const ReserveCardPage = await loadPage();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Unable to save reserve card" }),
    } as Response);

    render(<ReserveCardPage />);

    await advanceToConfirmationStep(user);
    await user.click(screen.getByRole("button", { name: /Reserve Access/i }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(screen.getByText("Unable to save reserve card")).toBeInTheDocument()
    );
    expect(screen.getByRole("heading", { name: "Choose your plan." })).toBeInTheDocument();
    expect(screen.queryByText("You’re all set.")).not.toBeInTheDocument();
  }, 10000);

  it("advances to success when the save request succeeds", async () => {
    const user = userEvent.setup();
    const ReserveCardPage = await loadPage();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    render(<ReserveCardPage />);

    await advanceToConfirmationStep(user);
    await user.click(screen.getByRole("button", { name: /Reserve Member/i }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(screen.getByText("You’re all set.")).toBeInTheDocument()
    );
    expect(screen.getByText(/Thanks for updating your profile\./)).toBeInTheDocument();
  }, 10000);
});
