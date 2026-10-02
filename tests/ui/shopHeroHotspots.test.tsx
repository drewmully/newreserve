import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopifyProduct } from "@/lib/shopify";
import { projectHeroPoint, SHOP_HERO_HOTSPOTS } from "@/lib/shopHeroHotspots";
import { getSeasonalTheme } from "@/app/shop/seasonalTheme";

const cart = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("@/app/context/MembershipContext", () => ({ useMembership: () => ({ addItemsToCart: cart.add }) }));
vi.mock("@/app/shop/components/ScrollToTop", () => ({ ScrollToTop: () => null }));
vi.mock("@/app/shop/components/ShopOutfitBuilder", () => ({ ShopOutfitBuilder: () => <section id="outfit" /> }));
vi.mock("@/app/shop/components/ShopNewsletter", () => ({ ShopNewsletter: () => null }));
import { ShopLanding } from "@/app/shop/components/ShopLanding";

const products = SHOP_HERO_HOTSPOTS.map((hotspot, i) => ({
  slug: hotspot.slug, name: i ? "Duckhead Classic Fit Gold School Chino - Khaki" : "Quiet Golf Remy Polo Active Pique",
  brand: i ? "Duckhead" : "Quiet Golf", price: i ? 118 : 114,
  images: [`https://example.test/catalog-${i}.jpg`], description: "",
  variants: [
    { id: `variant-${i}-s`, title: "S", price: 110, availableForSale: false, selectedOptions: [{ name: "Size", value: "S" }] },
    { id: `variant-${i}-m`, title: "M", price: i ? 118 : 114, availableForSale: !i, selectedOptions: [{ name: "Size", value: "M" }] },
  ],
})) as ShopifyProduct[];
const mount = (catalog = products) => {
  const view=render(<ShopLanding products={catalog} productsByCategory={{}} theme={getSeasonalTheme(new Date(2026, 8, 30))} />);
  view.container.querySelector("details.shop-hero-look")?.setAttribute("open","");
  return view;
};

let portrait = false;
let width = 1440;
let height = 604.8;

beforeEach(() => {
  portrait = false; width = 1440; height = 604.8;
  cart.add.mockReset().mockResolvedValue(undefined);
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockImplementation(() => portrait ? 1086 : 1672);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockImplementation(() => portrait ? 1448 : 941);
  vi.spyOn(HTMLImageElement.prototype, "currentSrc", "get").mockImplementation(() => portrait ? "/fall-firepit-mobile.webp" : "/fall-firepit-desktop.webp");
  vi.spyOn(HTMLImageElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    width, height, x: 0, y: 96, top: 96, left: 0, right: width, bottom: height + 96, toJSON: () => ({}),
  }));
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) {
    this.open = false; this.dispatchEvent(new Event("close"));
  });
});
afterEach(() => { vi.restoreAllMocks(); document.body.style.overflow = ""; });

describe("image-coordinate hotspots", () => {
  it("accounts for cover cropping and object-position rather than using viewport percentages", () => {
    expect(projectHeroPoint({ width: 200, height: 100, naturalWidth: 100, naturalHeight: 100, point: { x: .5, y: .5 }, positionY: .61 }))
      .toEqual({ x: 100, y: 39 });
    const mobile = projectHeroPoint({ width: 390, height: 520, naturalWidth: 1086, naturalHeight: 1448, point: { x: .61, y: .29 } });
    expect(mobile?.x).toBeCloseTo(237.9);
    expect(mobile?.y).toBeCloseTo(150.8);
  });
  it("hides unloaded and cropped-away points instead of placing inaccurate markers", () => {
    expect(projectHeroPoint({ width: 0, height: 0, naturalWidth: 0, naturalHeight: 0, point: { x: .5, y: .5 } })).toBeNull();
    expect(projectHeroPoint({ width: 400, height: 100, naturalWidth: 400, naturalHeight: 400, point: { x: .5, y: .01 } })).toBeNull();
  });
  it("uses a quiet expandable tray instead of markers on the distant figure", async () => {
    const {container}=mount();
    const button = await screen.findByRole("button", { name: "Shop Quiet Golf Polo" });
    expect(button.style.top).toBe("");
    expect(container.querySelector(".shop-hero-hotspot")).toBeNull();
    const tray=container.querySelector("details.shop-hero-look")!;
    fireEvent.keyDown(tray,{key:"Escape"});
    expect(tray).not.toHaveAttribute("open");
    expect(tray.querySelector("summary")).toHaveFocus();
  });
  it("omits a hotspot when its matching product is absent", async () => {
    mount([products[0]]);
    await screen.findByRole("button", { name: "Shop Quiet Golf Polo" });
    expect(screen.queryByRole("button", { name: "Shop Duckhead Chinos" })).not.toBeInTheDocument();
  });
});

describe("hero product purchase modal", () => {
  it("opens the real product and adds only the selected available variant through the existing cart", async () => {
    mount();
    const trigger = await screen.findByRole("button", { name: "Shop Quiet Golf Polo" });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: products[0].name });
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", products[0].images[0]);
    expect(within(dialog).getByText("$114")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Add to bag" })).toBeDisabled();
    expect(within(dialog).getByRole("option", { name: "S · Unavailable" })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "variant-0-m" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to bag" }));
    await waitFor(() => expect(cart.add).toHaveBeenCalledWith([expect.objectContaining({
      slug: products[0].slug, variantId: "variant-0-m", price: 114,
    })]));
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    expect(trigger).toHaveFocus();
  });
  it("truthfully displays sold-out chinos, source photo and styling note", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Shop Duckhead Chinos" }));
    const dialog = screen.getByRole("dialog", { name: products[1].name });
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", products[1].images[0]);
    expect(within(dialog).getByRole("status")).toHaveTextContent("Currently unavailable");
    expect(within(dialog).getByText(/Styled illustration/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Currently unavailable" })).toBeDisabled();
    expect(within(dialog).getByRole("link")).toHaveAttribute("href", `/shop/${products[1].slug}`);
    expect(cart.add).not.toHaveBeenCalled();
  });
  it("restores focus and page scroll after closing, and resets the size between products", async () => {
    mount();
    const trigger = await screen.findByRole("button", { name: "Shop Quiet Golf Polo" });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: products[0].name });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "variant-0-m" } });
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close product options" }));
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Shop Duckhead Chinos" }));
    expect(screen.getByRole("combobox")).toHaveValue("");
  });
  it("shows retryable cart errors without closing or falsely reporting success", async () => {
    cart.add.mockRejectedValueOnce(new Error("unavailable"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Shop Quiet Golf Polo" }));
    const dialog = screen.getByRole("dialog", { name: products[0].name });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "variant-0-m" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to bag" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Could not add");
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByRole("button", { name: "Add to bag" })).toBeEnabled();
  });
});
