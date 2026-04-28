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
  const mod = await import("@/app/mulligan/page");
  return mod.default;
}

async function advanceToPlanStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("First name"), "Jordan");
  await user.type(screen.getByLabelText("Last name"), "Spieth");
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
    expect(screen.getByRole("heading", { name: "Pick your way back in." })).toBeInTheDocument()
  );
}

describe("mulligan re-activation flow", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows the May ship-by and no-charge messaging on the welcome step", async () => {
    const MulliganPage = await loadPage();
    render(<MulliganPage />);

    expect(
      screen.getByText(/estimated to ship before the end of May/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not charged until your box is ready/i)
    ).toBeInTheDocument();
  });

  it("does not advance to success when the save request fails and stays on plan step", async () => {
    const user = userEvent.setup();
    const MulliganPage = await loadPage();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Unable to save mulligan" }),
    } as Response);

    render(<MulliganPage />);

    await advanceToPlanStep(user);
    await user.click(screen.getByRole("button", { name: /Reserve Access/i }));

    await waitFor(() =>
      expect(screen.getByText("Unable to save mulligan")).toBeInTheDocument()
    );
    expect(screen.getByRole("heading", { name: "Pick your way back in." })).toBeInTheDocument();
    expect(screen.queryByText("Welcome back.")).not.toBeInTheDocument();
  }, 10000);

  it("immediately submits when a plan card is clicked and advances on success", async () => {
    const user = userEvent.setup();
    const MulliganPage = await loadPage();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    render(<MulliganPage />);

    await advanceToPlanStep(user);

    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Reserve Member/i }));

    await waitFor(() =>
      expect(screen.getByText("Welcome back.")).toBeInTheDocument()
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/mulligan",
      expect.objectContaining({ method: "POST" })
    );
    const call = fetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      first_name: "Jordan",
      last_name: "Spieth",
      email: "member@example.com",
      gender: "Menswear",
      reactivation_choice: "member",
      source: "mulligan",
    });
  }, 10000);

  it("ignores additional plan clicks while a submission is in progress", async () => {
    const user = userEvent.setup();
    const MulliganPage = await loadPage();
    const fetchMock = vi.mocked(fetch);
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((res) => {
        resolve = res;
      })
    );

    render(<MulliganPage />);

    await advanceToPlanStep(user);
    await user.click(screen.getByRole("button", { name: /Reserve Member/i }));
    await user.click(screen.getByRole("button", { name: /Reserve Access/i }));
    await user.click(screen.getByRole("button", { name: /Not Right Now/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await waitFor(() =>
      expect(screen.getByText("Welcome back.")).toBeInTheDocument()
    );
  }, 10000);

  it("lets the user return to the plan step from the confirmation summary", async () => {
    const user = userEvent.setup();
    const MulliganPage = await loadPage();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    render(<MulliganPage />);

    await advanceToPlanStep(user);
    await user.click(screen.getByRole("button", { name: /Reserve Access/i }));

    await waitFor(() =>
      expect(screen.getByText("Welcome back.")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("mulligan-change-plan"));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Pick your way back in." })).toBeInTheDocument()
    );

    expect(screen.queryByText("Welcome back.")).not.toBeInTheDocument();
  }, 10000);
});
