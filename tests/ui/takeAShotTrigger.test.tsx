import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEYS } from "@/lib/takeAShot/popupRules";

const membership = { cartOpen: false, cartCount: 0, user: null as unknown, tier: "free" };
vi.mock("next/navigation", () => ({ usePathname: () => "/shop" }));
vi.mock("@/app/context/MembershipContext", () => ({ useMembership: () => membership }));
const trackEvent = vi.fn();
vi.mock("@/lib/tracking", () => ({ getClientAnonymousId: () => "anon-12345", trackEvent: (...a: unknown[]) => trackEvent(...a) }));
vi.mock("@/lib/takeAShot/game/game.js", () => ({ mount: () => () => {} }));

const events = () => trackEvent.mock.calls.map(([name, payload]) => ({ name, props: payload?.properties ?? {} }));
const event = (name: string) => events().find((e) => e.name === name);

beforeEach(() => {
  vi.resetModules();
  trackEvent.mockClear();
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

  it("auto-opens after 10s and 30% scroll with trigger timer_scroll and reports eligibility", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 3000 });
    const onOpen = await renderTrigger();
    act(() => { window.scrollY = 1000; window.dispatchEvent(new Event("scroll")); });
    act(() => { vi.advanceTimersByTime(9_000); });
    expect(onOpen).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(onOpen).toHaveBeenCalledWith("timer_scroll");
    expect(event("popup_eligible")?.props).toMatchObject({ variant: "take-a-shot", page_kind: "home", device: "desktop" });
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
    expect(event("popup_view")?.props).toMatchObject({ trigger_type: "exit_intent", device: "desktop", step: "landing", variant: "take-a-shot" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(event("popup_close")?.props).toMatchObject({ step: "landing", trigger_type: "exit_intent", played: false });
    expect(Number(localStorage.getItem(KEYS.closedUnplayed))).toBeGreaterThan(0);
  });

  it("sends the posthog distinct id with the signup", async () => {
    (window as unknown as { posthog: unknown }).posthog = { get_distinct_id: () => "ph-distinct-123" };
    const { TakeAShotModal } = await import("@/app/shop/components/takeAShot/TakeAShotModal");
    render(<TakeAShotModal openSignal={1} trigger="launcher" />);
    fireEvent.click(screen.getByRole("button", { name: "Take a Shot" }));
    expect(event("take_a_shot_start")?.props).toMatchObject({ trigger_type: "launcher", step: "landing" });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "player@example.com" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "Next" }).closest("form")!);
    await waitFor(() => expect(event("take_a_shot_email_submitted")).toBeTruthy());
    const body = JSON.parse(vi.mocked(fetch).mock.calls.find(([u]) => String(u).endsWith("/check"))![1]!.body as string);
    expect(body).toMatchObject({ phId: "ph-distinct-123", deviceId: "anon-12345" });
    expect(event("take_a_shot_email_submitted")?.props).toMatchObject({ device: "desktop", trigger_type: "launcher", step: "email" });
  });
});
