import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracking", () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/firebase", () => ({
  auth: null,
  db: null,
  storage: null,
  syncUserProfile: vi.fn(),
  sendOTPEmail: vi.fn(),
  confirmOTPSignIn: vi.fn(),
}));

async function loadPage() {
  const mod = await import("@/app/reservecard/page");
  return mod.default;
}

async function advanceToPlanStep(user: ReturnType<typeof userEvent.setup>) {
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

  it("does not advance to success when the save request fails and stays on plan step", async () => {
    const user = userEvent.setup();
    const ReserveCardPage = await loadPage();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Unable to save reserve card" }),
    } as Response);

    render(<ReserveCardPage />);

    await advanceToPlanStep(user);
    await user.click(screen.getByRole("button", { name: /Reserve Access/i }));

    await waitFor(() =>
      expect(screen.getByText("Unable to save reserve card")).toBeInTheDocument()
    );
    expect(screen.getByRole("heading", { name: "Choose your plan." })).toBeInTheDocument();
    expect(screen.queryByText("You’re all set.")).not.toBeInTheDocument();
  }, 10000);

  it("immediately submits when a plan card is clicked and advances on success", async () => {
    const user = userEvent.setup();
    const ReserveCardPage = await loadPage();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    render(<ReserveCardPage />);

    await advanceToPlanStep(user);

    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Reserve Member/i }));

    await waitFor(() =>
      expect(screen.getByText("You’re all set.")).toBeInTheDocument()
    );
    expect(screen.getByText(/Thanks for updating your profile\./)).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      email: "member@example.com",
      gender: "Menswear",
      selected_plan: "member",
      source: "reserve_card_qr",
    });
  }, 10000);

  it("ignores additional plan clicks while a submission is in progress", async () => {
    const user = userEvent.setup();
    const ReserveCardPage = await loadPage();
    const fetchMock = vi.mocked(fetch);
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((res) => {
        resolve = res;
      })
    );

    render(<ReserveCardPage />);

    await advanceToPlanStep(user);
    await user.click(screen.getByRole("button", { name: /Reserve Member/i }));
    await user.click(screen.getByRole("button", { name: /Reserve Access/i }));
    await user.click(screen.getByRole("button", { name: /Keep Current Plan/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await waitFor(() =>
      expect(screen.getByText("You’re all set.")).toBeInTheDocument()
    );
  }, 10000);

  it("lets the user return to the plan step from the confirmation summary", async () => {
    const user = userEvent.setup();
    const ReserveCardPage = await loadPage();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    render(<ReserveCardPage />);

    await advanceToPlanStep(user);
    await user.click(screen.getByRole("button", { name: /Reserve Access/i }));

    await waitFor(() =>
      expect(screen.getByText("You’re all set.")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("reserve-card-change-plan"));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Choose your plan." })).toBeInTheDocument()
    );

    expect(screen.queryByText("You’re all set.")).not.toBeInTheDocument();
  }, 10000);
});
