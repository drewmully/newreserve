import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEYS } from "@/lib/takeAShot/popupRules";

const membership = { cartOpen: false, cartCount: 0, user: null as unknown, tier: "free" };
vi.mock("next/navigation", () => ({ usePathname: () => "/shop" }));
vi.mock("@/app/context/MembershipContext", () => ({ useMembership: () => membership }));
const trackEvent = vi.fn();
vi.mock("@/lib/tracking", () => ({ getClientAnonymousId: () => "anon-12345", trackEvent: (...a: unknown[]) => trackEvent(...a) }));
const gameOpts = vi.hoisted(() => ({ current: null as { gate: () => void } | null }));
vi.mock("@/lib/takeAShot/game/game.js", () => ({
  previewSession: () => ({ sid: "", pin: 0, winds: [{ mph: 8, dirDeg: 90 }], shots: 1, floor: 0, results: [] }),
  mount: (_r: HTMLElement, o: { gate: () => void }) => { gameOpts.current = o; return () => {}; },
}));

const events = () => trackEvent.mock.calls.map(([name, payload]) => ({ name, props: payload?.properties ?? {} }));
const event = (name: string) => events().find((e) => e.name === name);

beforeEach(() => {
  vi.resetModules();
  trackEvent.mockClear();
  gameOpts.current = null;
  localStorage.clear(); sessionStorage.clear();
  Object.assign(membership, { cartOpen: false, cartCount: 0, user: null, tier: "free" });
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "ok" }) })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function renderTrigger(onOpen = vi.fn()) {
  const { TakeAShotTrigger } = await import("@/app/shop/components/takeAShot/TakeAShotTrigger");
  render(<TakeAShotTrigger onOpen={onOpen} modalOpen={false} />);
  return onOpen;
}

describe("TakeAShotTrigger", () => {
  it("shows the bottom-left launcher on a first visit and opens with trigger launcher", async () => {
    const onOpen = await renderTrigger();
    fireEvent.click(screen.getByRole("button", { name: "Take a shot at 30% off" }));
    expect(onOpen).toHaveBeenCalledWith("launcher");
  });

  it("the launcher x hides it for 14 days", async () => {
    await renderTrigger();
    fireEvent.click(screen.getByRole("button", { name: "Hide Take a Shot" }));
    expect(screen.queryByRole("button", { name: "Take a shot at 30% off" })).toBeNull();
    const until = Number(localStorage.getItem(KEYS.launcherDismissed));
    expect(until - Date.now()).toBeGreaterThan(13 * 86_400_000);
  });

  it("auto-opens after 8s and 30% scroll with trigger timer_scroll and reports eligibility", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 3000 });
    const onOpen = await renderTrigger();
    act(() => { window.scrollY = 1000; window.dispatchEvent(new Event("scroll")); });
    act(() => { vi.advanceTimersByTime(7_000); });
    expect(onOpen).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(onOpen).toHaveBeenCalledWith("timer_scroll");
    expect(event("popup_eligible")?.props).toMatchObject({ variant: "take-a-shot", page_kind: "home", page_type: "home", device: "desktop" });
    expect(JSON.parse(localStorage.getItem(KEYS.autoOpens) ?? "[]")).toHaveLength(1);
  });

  it("suppresses and reports the reason for signed-up visitors and members", async () => {
    localStorage.setItem(KEYS.signedUp, JSON.stringify({ at: 1, source: "shop-newsletter" }));
    await renderTrigger();
    expect(event("popup_suppressed")?.props).toMatchObject({ reason: "signed_up" });
  });

  it("hides the launcher for Reserve members", async () => {
    membership.tier = "member";
    await renderTrigger();
    expect(screen.queryByRole("button", { name: "Take a shot at 30% off" })).toBeNull();
    expect(event("popup_suppressed")?.props).toMatchObject({ reason: "member" });
  });

  it("opens on mully:open-signup with trigger manual", async () => {
    const onOpen = await renderTrigger();
    act(() => { window.dispatchEvent(new Event("mully:open-signup")); });
    expect(onOpen).toHaveBeenCalledWith("manual");
  });
});

describe("TakeAShotModal tracking", () => {
  it("fires popup_view with trigger_type and device, and popup_close with the step", async () => {
    const { TakeAShotModal } = await import("@/app/shop/components/takeAShot/TakeAShotModal");
    render(<TakeAShotModal openSignal={1} trigger="exit_intent" />);
    expect(event("popup_view")?.props).toMatchObject({ trigger_type: "exit_intent", device: "desktop", step: "play", variant: "take-a-shot" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(event("popup_close")?.props).toMatchObject({ step: "play", trigger_type: "exit_intent", played: false });
    expect(Number(localStorage.getItem(KEYS.closedUnplayed))).toBeGreaterThan(0);
  });

  const respond = (routes: Record<string, unknown>) => vi.stubGlobal("fetch", vi.fn(async (u: string) => ({
    ok: true, json: async () => routes[String(u).split("/").pop()!] ?? { status: "ok" },
  })));
  const newSession = { status: "new", session: { sid: "s1", pin: 0, winds: [{ mph: 8, dirDeg: 90 }], shots: 1, floor: 10, results: [] }, claim: null };
  const leads = () => trackEvent.mock.calls.filter(([n]) => n === "take_a_shot_email_submitted");
  async function playEmail(trigger: "launcher" | "manual" = "launcher") {
    const { TakeAShotModal } = await import("@/app/shop/components/takeAShot/TakeAShotModal");
    render(<TakeAShotModal openSignal={1} trigger={trigger} />);
    await waitFor(() => expect(gameOpts.current).not.toBeNull());
    act(() => gameOpts.current!.gate());
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: " player@example.com " } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "See where it lands" }).closest("form")!);
  }

  it("sends the posthog distinct id with the signup; the gated swing is tracked", async () => {
    (window as unknown as { posthog: unknown }).posthog = { get_distinct_id: () => "ph-distinct-123" };
    respond({ session: newSession });
    await playEmail();
    expect(event("swing_attempt_gated")?.props).toMatchObject({ trigger_type: "launcher", step: "play" });
    await waitFor(() => expect(event("take_a_shot_email_submitted")).toBeTruthy());
    const body = JSON.parse(vi.mocked(fetch).mock.calls.find(([u]) => String(u).endsWith("/check"))![1]!.body as string);
    expect(body).toMatchObject({ phId: "ph-distinct-123", deviceId: "anon-12345" });
  });

  it("fires take_a_shot_email_submitted once, after the session opens, with the email for CAPI", async () => {
    respond({ session: newSession });
    await playEmail();
    await waitFor(() => expect(leads()).toHaveLength(1));
    const [, payload] = leads()[0];
    expect(payload.email).toBe("player@example.com");
    expect(payload.properties).toMatchObject({ device: "desktop", trigger_type: "launcher", step: "email" });
    expect(payload.properties.email).toBeUndefined();
    // It went out after /session answered, not at /check.
    const order = vi.mocked(fetch).mock.calls.map(([u]) => String(u).split("/").pop());
    expect(order).toContain("session");
    await new Promise((r) => setTimeout(r, 50));
    expect(leads()).toHaveLength(1);
  });

  it("never fires take_a_shot_email_submitted for an existing player", async () => {
    respond({ check: { status: "existing", claim: null } });
    await playEmail();
    await screen.findByText("You already took your shot.");
    expect(leads()).toHaveLength(0);
  });

  it("never fires it when the session itself answers existing", async () => {
    respond({ session: { status: "existing", claim: null } });
    await playEmail();
    await screen.findByText("You already took your shot.");
    expect(leads()).toHaveLength(0);
  });
});
