import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/shop" }));
vi.mock("@/app/context/MembershipContext", () => ({ useMembership: () => ({ cartOpen: false, cartCount: 0 }) }));
vi.mock("@/lib/tracking", () => ({ getClientAnonymousId: () => "anon-1", trackEvent: vi.fn() }));
const gameState = vi.hoisted(() => ({
  opts: null as Record<string, unknown> | null,
  extend: vi.fn(), finish: vi.fn(),
}));
vi.mock("@/lib/takeAShot/game/game.js", () => ({
  mount: (_root: HTMLElement, opts: Record<string, unknown>) => {
    gameState.opts = opts;
    return Object.assign(() => {}, { extend: gameState.extend, finish: gameState.finish });
  },
}));

type Opts = { callback: (t: string) => void };
let widget: Opts | null;
const turnstile = { render: vi.fn((_el: HTMLElement, o: Opts) => { widget = o; return "w1"; }), reset: vi.fn(), remove: vi.fn() };
const session = { sid: "s1", pin: 0, winds: [{ mph: 8, dirDeg: 90 }], shots: 1, floor: 10, results: [] };
const firstClaim = { code: "SHOT20-ABC123", pct: 20, won: true, expiresAt: "2026-11-25T00:00:00.000Z" };

async function openToEmail() {
  const { TakeAShotModal } = await import("@/app/shop/components/takeAShot/TakeAShotModal");
  render(<TakeAShotModal openSignal={1} />);
  expect(screen.getByRole("heading", { name: "Take a shot at 30% off." })).toBeInTheDocument();
  expect(screen.getByText("10% just for playing")).toBeInTheDocument();
  expect(screen.getByText("Up to 30% with your best shot")).toBeInTheDocument();
  expect(screen.queryByText(/^15%/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Take a Shot" }));
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "player@example.com" } });
  fireEvent.click(screen.getByRole("checkbox"));
}
const submitEmail = () => fireEvent.submit(screen.getByRole("button", { name: /Take my shot|Checking/ }).closest("form")!);
const calls = (route: string) => vi.mocked(fetch).mock.calls.filter(([u]) => String(u).endsWith(`/${route}`));
const body = (route: string, i = 0) => JSON.parse(calls(route)[i][1]!.body as string);

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
  widget = null; turnstile.render.mockClear(); turnstile.reset.mockClear();
  gameState.opts = null; gameState.extend.mockClear(); gameState.finish.mockClear();
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("turnstile", turnstile);
  vi.stubGlobal("fetch", vi.fn(async (u: string) => ({
    ok: true,
    json: async () => {
      const url = String(u);
      if (url.endsWith("/check")) return { status: "ok" };
      if (url.endsWith("/upgrade")) return { status: "resume", session: { ...session, shots: 3, floor: 15 }, claim: firstClaim };
      if (url.endsWith("/keep")) return { status: "ok" };
      if (url.endsWith("/storefront")) return {};
      return { status: "new", session, claim: null };
    },
  })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Take a Shot email step and Turnstile", () => {
  it("renders the widget on the email step, with the hole loading copy", async () => {
    await openToEmail();
    expect(screen.getByText("The hole is loading while you type.")).toBeInTheDocument();
    expect(screen.queryByText(/About 1 email a week/)).toBeNull();
    expect(screen.queryByPlaceholderText("(555) 555-0123")).toBeNull();
    expect(turnstile.render).toHaveBeenCalledTimes(1);
    expect(turnstile.render.mock.calls[0][1]).toMatchObject({ sitekey: "test-site-key", appearance: "always" });
  });

  it("waits for the token with a Checking state, then starts an email-only session", async () => {
    await openToEmail();
    submitEmail();
    await screen.findByRole("button", { name: /Checking/ });
    expect(calls("session")).toHaveLength(0);
    act(() => widget!.callback("tok-1"));
    await waitFor(() => expect(calls("session")).toHaveLength(1));
    expect(body("session")).toMatchObject({ turnstileToken: "tok-1", phone: null, smsConsent: false, emailConsent: true });
  });

  it("on turnstile_failed resets the widget, keeps the email, and waits for a fresh token", async () => {
    await openToEmail();
    act(() => widget!.callback("tok-1"));
    vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: true, json: async () => ({ status: "ok" }) }) as Response);
    vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: false, json: async () => ({ status: "error", code: "turnstile_failed", error: "x" }) }) as Response);
    submitEmail();
    await screen.findByText(/complete the check above/i);
    expect(turnstile.reset).toHaveBeenCalledWith("w1");
    expect(screen.getByPlaceholderText("you@example.com")).toHaveValue("player@example.com");
    submitEmail();
    await screen.findByRole("button", { name: /Checking/ });
    act(() => widget!.callback("tok-2"));
    await waitFor(() => expect(calls("session")).toHaveLength(2));
    expect(body("session", 1)).toMatchObject({ turnstileToken: "tok-2" });
  });
});

describe("Take a Shot phone ask after the first shot", () => {
  async function toAsk(firstPct = 20) {
    await openToEmail();
    act(() => widget!.callback("tok-1"));
    submitEmail();
    await waitFor(() => expect(gameState.opts).not.toBeNull());
    const opts = gameState.opts as { onFirstClaim: (c: unknown, b: unknown) => boolean; backend: { claim: () => Promise<unknown> } };
    await opts.backend.claim();
    expect(body("claim")).toMatchObject({ sid: "s1", upsell: true });
    let hidden = false;
    act(() => { hidden = opts.onFirstClaim(firstClaim, firstPct ? { pct: firstPct } : null); });
    expect(hidden).toBe(true);
  }

  it("shows the issued code before the ask, with consent unchecked under the phone field", async () => {
    await toAsk();
    expect(screen.getByText("SHOT20-ABC123")).toBeInTheDocument();
    expect(screen.getByText(/Reserve renewals bill at the regular/)).toBeInTheDocument();
    expect(screen.getByText("Nice shot. Want 2 more?")).toBeInTheDocument();
    expect(screen.getByText("Add your phone and your best of 3 counts, with at least 15% off.")).toBeInTheDocument();
    const sms = screen.getByRole("checkbox");
    expect(sms).not.toBeChecked();
    expect(screen.getByText(/not a condition of purchase/i)).toBeInTheDocument();
    const field = screen.getByPlaceholderText("(555) 555-0123");
    const button = screen.getByRole("button", { name: "Get 2 more shots" });
    expect(field.compareDocumentPosition(sms) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sms.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("drops 'Nice shot' after a miss", async () => {
    await toAsk(0);
    expect(screen.getByText("Want 2 more?")).toBeInTheDocument();
  });

  it("needs consent, then upgrades the same session to 3 shots", async () => {
    await toAsk();
    fireEvent.change(screen.getByPlaceholderText("(555) 555-0123"), { target: { value: "4155550134" } });
    fireEvent.submit(screen.getByRole("button", { name: "Get 2 more shots" }).closest("form")!);
    await screen.findByText(/Check the text box/);
    expect(calls("upgrade")).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "Get 2 more shots" }).closest("form")!);
    await waitFor(() => expect(gameState.extend).toHaveBeenCalledWith(expect.objectContaining({ shots: 3 })));
    expect(body("upgrade")).toMatchObject({ sid: "s1", smsConsent: true });
    expect(screen.queryByText("Get 2 more shots")).toBeNull();
    expect(calls("keep")).toHaveLength(0);
  });

  it("Keep my X% keeps the code and releases the hold", async () => {
    await toAsk();
    fireEvent.click(screen.getByRole("button", { name: "Keep my 20%" }));
    expect(gameState.finish).toHaveBeenCalledWith(firstClaim);
    await waitFor(() => expect(calls("keep")).toHaveLength(1));
    expect(body("keep")).toMatchObject({ sid: "s1" });
  });

  it("closing the modal at the ask also keeps the code", async () => {
    await toAsk();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(calls("keep")).toHaveLength(1));
  });
});
