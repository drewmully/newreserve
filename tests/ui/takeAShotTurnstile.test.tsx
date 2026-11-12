import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/shop" }));
vi.mock("@/app/context/MembershipContext", () => ({ useMembership: () => ({ cartOpen: false, cartCount: 0 }) }));
vi.mock("@/lib/tracking", () => ({ getClientAnonymousId: () => "anon-1", trackEvent: vi.fn() }));
const gameState = vi.hoisted(() => ({
  opts: null as Record<string, unknown> | null,
  fire: vi.fn(), ungate: vi.fn(), extend: vi.fn(), finish: vi.fn(),
}));
vi.mock("@/lib/takeAShot/game/game.js", () => ({
  previewSession: () => ({ sid: "", pin: 2, winds: [{ mph: 9, dirDeg: 45 }], shots: 1, floor: 0, results: [] }),
  mount: (_root: HTMLElement, opts: Record<string, unknown>) => {
    gameState.opts = opts;
    return Object.assign(() => {}, { fire: gameState.fire, ungate: gameState.ungate, extend: gameState.extend, finish: gameState.finish });
  },
}));

type Opts = { callback: (t: string) => void };
let widget: Opts | null;
const turnstile = { render: vi.fn((_el: HTMLElement, o: Opts) => { widget = o; return "w1"; }), reset: vi.fn(), remove: vi.fn() };
const session = { sid: "s1", pin: 0, winds: [{ mph: 8, dirDeg: 90 }], shots: 1, floor: 10, results: [] };
const keptClaim = { status: "claimed", code: "SHOT20-ABC123", pct: 20, won: true, expiresAt: "2026-11-25T00:00:00.000Z" };
type GameOpts = { gate: () => void; onLocked: (r: unknown) => void; backend: { claim: () => Promise<unknown> } };
const opts = () => gameState.opts as unknown as GameOpts;

/** Opens on the live hole, then the first swing brings up the email sheet. */
async function openToEmail() {
  const { TakeAShotModal } = await import("@/app/shop/components/takeAShot/TakeAShotModal");
  render(<TakeAShotModal openSignal={1} />);
  expect(screen.getByRole("heading", { name: "Take a shot at 30% off." })).toBeInTheDocument();
  expect(screen.getByText("10% just for playing")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Take a Shot" })).toBeNull();
  await waitFor(() => expect(gameState.opts).not.toBeNull());
  expect(screen.queryByRole("heading", { name: "Your shot is in the air." })).toBeNull();
  act(() => opts().gate());
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "player@example.com" } });
  fireEvent.click(screen.getByRole("checkbox"));
}
const submitEmail = () => fireEvent.submit(screen.getByRole("button", { name: /See where it lands|Checking/ }).closest("form")!);
const calls = (route: string) => vi.mocked(fetch).mock.calls.filter(([u]) => String(u).endsWith(`/${route}`));
const body = (route: string, i = 0) => JSON.parse(calls(route)[i][1]!.body as string);

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
  widget = null; turnstile.render.mockClear(); turnstile.reset.mockClear();
  gameState.opts = null; for (const f of [gameState.fire, gameState.ungate, gameState.extend, gameState.finish]) f.mockClear();
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("turnstile", turnstile);
  vi.stubGlobal("fetch", vi.fn(async (u: string) => ({
    ok: true,
    json: async () => {
      const url = String(u);
      if (url.endsWith("/check")) return { status: "ok" };
      if (url.endsWith("/upgrade")) return { status: "resume", session: { ...session, shots: 3, floor: 15 }, claim: null };
      if (url.endsWith("/keep")) return keptClaim;
      if (url.endsWith("/claim")) return { status: "locked", pct: 20, won: true };
      if (url.endsWith("/storefront")) return {};
      return { status: "new", session, claim: null };
    },
  })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Take a Shot game first, email sheet and Turnstile", () => {
  it("opens on the hole; the gated swing shows the email sheet with Turnstile and unchecked consent", async () => {
    const { TakeAShotModal } = await import("@/app/shop/components/takeAShot/TakeAShotModal");
    render(<TakeAShotModal openSignal={1} />);
    await waitFor(() => expect(gameState.opts).not.toBeNull());
    expect(typeof opts().gate).toBe("function");
    act(() => opts().gate());
    expect(screen.getByRole("heading", { name: "Your shot is in the air." })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "See where it lands" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("(555) 555-0123")).toBeNull();
    expect(turnstile.render).toHaveBeenCalledTimes(1);
    expect(turnstile.render.mock.calls[0][1]).toMatchObject({ sitekey: "test-site-key", appearance: "always" });
  });

  it("asks for email consent with the Agree wording", async () => {
    await openToEmail();
    fireEvent.click(screen.getByRole("checkbox"));
    submitEmail();
    await screen.findByText("Agree to emails so we can send your code.");
    expect(calls("session")).toHaveLength(0);
  });

  it("waits for the token, starts an email-only session on the previewed hole, then fires the same swing", async () => {
    await openToEmail();
    submitEmail();
    await screen.findByRole("button", { name: /Checking/ });
    expect(calls("session")).toHaveLength(0);
    act(() => widget!.callback("tok-1"));
    await waitFor(() => expect(gameState.fire).toHaveBeenCalledWith(session));
    expect(body("session")).toMatchObject({ turnstileToken: "tok-1", phone: null, smsConsent: false, emailConsent: true, preview: { pin: 2, mph: 9, dirDeg: 45 } });
  });

  it("Back to the hole releases the frozen swing", async () => {
    await openToEmail();
    fireEvent.click(screen.getByRole("button", { name: "Back to the hole" }));
    expect(gameState.ungate).toHaveBeenCalled();
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
    expect(gameState.fire).not.toHaveBeenCalled();
    submitEmail();
    await screen.findByRole("button", { name: /Checking/ });
    act(() => widget!.callback("tok-2"));
    await waitFor(() => expect(calls("session")).toHaveLength(2));
    expect(body("session", 1)).toMatchObject({ turnstileToken: "tok-2" });
  });
});

describe("Take a Shot phone ask after the first shot", () => {
  async function toAsk(won = true) {
    await openToEmail();
    act(() => widget!.callback("tok-1"));
    submitEmail();
    await waitFor(() => expect(gameState.fire).toHaveBeenCalled());
    const r = await opts().backend.claim();
    expect(body("claim")).toMatchObject({ sid: "s1", upsell: true });
    expect(r).toMatchObject({ status: "locked" });
    act(() => opts().onLocked({ status: "locked", pct: 20, won }));
  }

  it("shows the result only, no code, then the phone ask with consent unchecked under the field", async () => {
    await toAsk();
    expect(screen.getByRole("heading", { name: "Nice shot, 20% locked in" })).toBeInTheDocument();
    expect(screen.queryByText(/SHOT20/)).toBeNull();
    expect(screen.getByText("Add your phone for 2 more shots")).toBeInTheDocument();
    expect(screen.getByText("Best of 3 counts, with at least 15% off. Up to 30%.")).toBeInTheDocument();
    const sms = screen.getByRole("checkbox");
    expect(sms).not.toBeChecked();
    expect(screen.getByText(/not a condition of purchase/i)).toBeInTheDocument();
    const field = screen.getByPlaceholderText("(555) 555-0123");
    const button = screen.getByRole("button", { name: "Add phone for 2 more" });
    expect(field.compareDocumentPosition(sms) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sms.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(calls("keep")).toHaveLength(0);
  });

  it("drops 'Nice shot' after a miss", async () => {
    await toAsk(false);
    expect(screen.getByRole("heading", { name: "20% locked in" })).toBeInTheDocument();
  });

  it("needs consent, then upgrades the same session to 3 shots without a code", async () => {
    await toAsk();
    fireEvent.change(screen.getByPlaceholderText("(555) 555-0123"), { target: { value: "4155550134" } });
    fireEvent.submit(screen.getByRole("button", { name: "Add phone for 2 more" }).closest("form")!);
    await screen.findByText("Agree to texts to get more shots.");
    expect(calls("upgrade")).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "Add phone for 2 more" }).closest("form")!);
    await waitFor(() => expect(gameState.extend).toHaveBeenCalledWith(expect.objectContaining({ shots: 3 })));
    expect(body("upgrade")).toMatchObject({ sid: "s1", smsConsent: true });
    expect(screen.queryByText("Add phone for 2 more")).toBeNull();
    expect(calls("keep")).toHaveLength(0);
  });

  it("Keep my X% mints the one code and shows it", async () => {
    await toAsk();
    fireEvent.click(screen.getByRole("button", { name: "Keep my 20%" }));
    await waitFor(() => expect(gameState.finish).toHaveBeenCalledWith(keptClaim));
    expect(calls("keep")).toHaveLength(1);
    expect(body("keep")).toMatchObject({ sid: "s1" });
  });

  it("closing the modal at the ask keeps the locked percent", async () => {
    await toAsk();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(calls("keep")).toHaveLength(1));
  });
});
