import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/shop" }));
vi.mock("@/app/context/MembershipContext", () => ({ useMembership: () => ({ cartOpen: false, cartCount: 0 }) }));
vi.mock("@/lib/tracking", () => ({ getClientAnonymousId: () => "anon-1", trackEvent: vi.fn() }));
vi.mock("@/lib/takeAShot/game/game.js", () => ({ mount: () => () => {} }));

type Opts = { callback: (t: string) => void };
let widget: Opts | null;
const turnstile = { render: vi.fn((_el: HTMLElement, o: Opts) => { widget = o; return "w1"; }), reset: vi.fn(), remove: vi.fn() };
const session = { sid: "s1", pin: 0, winds: [{ mph: 8, dirDeg: 90 }], shots: 1, floor: 10, results: [] };

async function openToPhone() {
  const { TakeAShotModal } = await import("@/app/shop/components/takeAShot/TakeAShotModal");
  render(<TakeAShotModal openSignal={1} />);
  fireEvent.click(screen.getByRole("button", { name: "Take a Shot" }));
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "player@example.com" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(screen.getByRole("button", { name: "Next" }).closest("form")!);
  await screen.findByText(/Want 3 shots/);
}
const sessionCalls = () => vi.mocked(fetch).mock.calls.filter(([u]) => String(u).endsWith("/session"));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
  widget = null; turnstile.render.mockClear(); turnstile.reset.mockClear();
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("turnstile", turnstile);
  vi.stubGlobal("fetch", vi.fn(async (u: string) => ({
    ok: true, json: async () => (String(u).endsWith("/check") ? { status: "ok" } : { status: "new", session, claim: null }),
  })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Take a Shot Turnstile", () => {
  it("renders the widget visibly as soon as the phone step mounts", async () => {
    await openToPhone();
    expect(turnstile.render).toHaveBeenCalledTimes(1);
    expect(turnstile.render.mock.calls[0][1]).toMatchObject({ sitekey: "test-site-key", appearance: "always" });
  });

  it("waits for the token with a Checking state, then submits by itself", async () => {
    await openToPhone();
    fireEvent.click(screen.getByRole("button", { name: /Play with 1 shot/ }));
    expect(screen.getByRole("button", { name: /Checking/ })).toBeDisabled();
    expect(sessionCalls()).toHaveLength(0);
    act(() => widget!.callback("tok-1"));
    await waitFor(() => expect(sessionCalls()).toHaveLength(1));
    expect(JSON.parse(sessionCalls()[0][1]!.body as string)).toMatchObject({ turnstileToken: "tok-1", phone: null, emailConsent: true });
  });

  it("on turnstile_failed resets the widget and keeps the inputs", async () => {
    await openToPhone();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ status: "error", code: "turnstile_failed", error: "Please confirm you are not a robot and try again." }) } as Response);
    act(() => widget!.callback("tok-1"));
    fireEvent.change(screen.getByPlaceholderText("(555) 555-0123"), { target: { value: "4155550134" } });
    const sms = screen.getAllByRole("checkbox")[0];
    fireEvent.click(sms);
    fireEvent.submit(screen.getByRole("button", { name: /Get 3 shots/ }).closest("form")!);
    await screen.findByText(/complete the check above/i);
    expect(turnstile.reset).toHaveBeenCalledWith("w1");
    expect(screen.getByPlaceholderText("(555) 555-0123")).not.toHaveValue("");
    expect(sms).toBeChecked();
    // Next tap waits for a fresh token instead of reusing the spent one.
    fireEvent.submit(screen.getByRole("button", { name: /Get 3 shots/ }).closest("form")!);
    expect(screen.getByRole("button", { name: /Checking/ })).toBeDisabled();
    act(() => widget!.callback("tok-2"));
    await waitFor(() => expect(sessionCalls()).toHaveLength(2));
    expect(JSON.parse(sessionCalls()[1][1]!.body as string)).toMatchObject({ turnstileToken: "tok-2", smsConsent: true });
  });
});
