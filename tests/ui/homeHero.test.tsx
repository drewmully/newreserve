import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ph = vi.hoisted(() => ({
  __loaded: true,
  capture: vi.fn(),
  register: vi.fn(),
  getFeatureFlag: vi.fn(),
  onFeatureFlags: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: ph }));
const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tracking", () => ({ trackEvent: track }));

import { HomeHeroExperiment } from "@/app/shop/components/HomeHeroExperiment";
import {
  HOME_HERO_CART_ATTR,
  HOME_HERO_FLAG,
  HOME_HERO_NEW_H1,
  HOME_HERO_RESERVE_IMAGES,
  HOME_HERO_SHOP_IMAGES,
  HOME_HERO_STORAGE_KEY,
  formatHeroPrice,
} from "@/lib/homeHero";
import { attributionToCartAttributes } from "@/lib/attribution";

const Control = () => (
  <section id="hero"><h1>The Fall Edit</h1><a href="#edit" data-hero-cta="control_shop">[ shop ]</a></section>
);

function hero(price: string | null = "$250") {
  return <HomeHeroExperiment season="fall" reservePrice={price}><Control /></HomeHeroExperiment>;
}

function flagResolves(value: string | undefined) {
  ph.getFeatureFlag.mockReturnValue(value);
  ph.onFeatureFlags.mockImplementation((cb: () => void) => { cb(); return () => {}; });
}

beforeEach(() => {
  vi.clearAllMocks();
  ph.__loaded = true;
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => vi.useRealTimers());

describe("home_hero_dual server HTML", () => {
  it("renders control as the only h1, with dual cards hidden but linked", () => {
    const html = renderToString(hero());
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html).toContain("The Fall Edit");
    expect(html).toMatch(/<div class="hh-dual" hidden/);
    expect(html).toContain('href="/shop"');
    expect(html).toContain('href="/subscription"');
    expect(html).toContain('href="/shop/gifts"');
    expect(html).toContain("quarter");
  });

  it("has no em dashes and no hard-coded price in the dual copy", () => {
    const html = renderToString(hero(null));
    expect(html).not.toContain("\u2014");
    expect(html).not.toMatch(/\$\d/);
    expect(renderToString(hero("$275"))).toContain("$275 a quarter");
  });

  it("uses real packshot files only", () => {
    for (const img of [...HOME_HERO_SHOP_IMAGES, ...HOME_HERO_RESERVE_IMAGES]) {
      expect(img.src).toMatch(/^\/home-hero\/[a-z-]+\.webp$/);
    }
  });
});

describe("home_hero_dual client", () => {
  it("swaps to dual with the new h1 when bucketed and records exposure", async () => {
    flagResolves("dual");
    await act(async () => { render(hero()); });
    expect(ph.getFeatureFlag).toHaveBeenCalledWith(HOME_HERO_FLAG);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(HOME_HERO_NEW_H1);
    expect(screen.queryByText("The Fall Edit", { selector: "h1" })).toBeNull();
    expect(ph.capture).toHaveBeenCalledWith("home_hero_exposure", { variant: "dual" }, expect.anything());
    expect(window.localStorage.getItem(HOME_HERO_STORAGE_KEY)).toBe("dual");
  });

  it("keeps control for control arm, missing flag, bots and no PostHog", async () => {
    flagResolves("control");
    await act(async () => { render(hero()); });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The Fall Edit");
    expect(window.localStorage.getItem(HOME_HERO_STORAGE_KEY)).toBe("control");

    vi.clearAllMocks(); window.localStorage.clear();
    flagResolves(undefined);
    const r2 = render(hero());
    expect(r2.container.querySelector(".hh-dual")).toHaveAttribute("hidden");
    expect(ph.capture).not.toHaveBeenCalled();
    r2.unmount();

    vi.clearAllMocks();
    const ua = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (compatible; Googlebot/2.1)");
    flagResolves("dual");
    const r3 = render(hero());
    expect(ph.onFeatureFlags).not.toHaveBeenCalled();
    expect(r3.container.querySelector(".hh-dual")).toHaveAttribute("hidden");
    ua.mockRestore();
    r3.unmount();

    ph.__loaded = false;
    const r4 = render(hero());
    expect(r4.container.querySelector(".hh-dual")).toHaveAttribute("hidden");
  });

  it("supports the ?hh= QA override", async () => {
    window.history.replaceState(null, "", "/?hh=dual");
    await act(async () => { render(hero()); });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(HOME_HERO_NEW_H1);
    expect(ph.capture).toHaveBeenCalledWith("home_hero_exposure", { variant: "dual", hh_override: true }, expect.anything());
  });

  it("tracks hero_cta_click with cta and variant", async () => {
    window.history.replaceState(null, "", "/?hh=dual");
    await act(async () => { render(hero()); });
    fireEvent.click(screen.getByRole("link", { name: "Build your Reserve" }));
    expect(track).toHaveBeenCalledWith("hero_cta_click", { properties: expect.objectContaining({ cta: "reserve", href: "/subscription", variant: "dual" }) });
  });

  it("forwards the arm as a cart attribute", () => {
    window.localStorage.setItem(HOME_HERO_STORAGE_KEY, "dual");
    expect(attributionToCartAttributes({})).toContainEqual({ key: HOME_HERO_CART_ATTR, value: "dual" });
    window.localStorage.removeItem(HOME_HERO_STORAGE_KEY);
    expect(attributionToCartAttributes({}).some(a => a.key === HOME_HERO_CART_ATTR)).toBe(false);
  });

  it("formats live prices", () => {
    expect(formatHeroPrice("250.0")).toBe("$250");
    expect(formatHeroPrice("249.5")).toBe("$249.50");
    expect(formatHeroPrice(null)).toBeNull();
    expect(formatHeroPrice("0")).toBeNull();
  });
});
