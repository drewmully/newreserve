import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopifyProduct } from "@/lib/shopify";

const mocks = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/app/context/MembershipContext", () => ({ useMembership: () => ({ addItemsToCart: vi.fn() }) }));
vi.mock("@/lib/tracking", () => ({ trackEvent: mocks.track, getClientAnonymousId: () => "anon-test" }));
vi.mock("@/app/shop/components/useCompleteLookVariant", () => ({ useCompleteLookVariant: () => null }));
import { ShopPDPClient } from "@/app/shop/components/ShopPDPClient";

const images = ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg", "https://cdn.shopify.com/c.jpg"];
const product = {
  slug: "olydoe-merino-ponte-vest", name: "Olydoe Merino Ponte Vest", brand: "Olydoe", collection: "Vests",
  price: 165, reservePrice: 165, variantId: "gid://shopify/ProductVariant/1",
  images, description: "A vest.", material: "Merino", aboutBrand: "", whyWeLikeIt: "", sizing: "",
  options: [{ name: "Size", values: ["M", "L"] }],
  variants: ["M", "L"].map((size, i) => ({
    id: `gid://shopify/ProductVariant/${i + 1}`, title: size, price: 165, reservePrice: 165,
    availableForSale: true, currentlyNotInStock: false, selectedOptions: [{ name: "Size", value: size }],
  })),
} as ShopifyProduct;

const events = (name: string) => mocks.track.mock.calls.filter(([n]) => n === name);

beforeEach(() => {
  mocks.track.mockReset();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  Element.prototype.scrollTo = function (this: Element, opts?: ScrollToOptions | number) {
    if (typeof opts === "object" && opts.left !== undefined) (this as HTMLElement).scrollLeft = opts.left;
  } as Element["scrollTo"];
});

describe("PDP gallery", () => {
  it("renders every photo in a swipe track, first eager and the rest lazy", () => {
    render(<ShopPDPClient product={product} initialSelection={{}} accent="#4a3528" />);
    const track = screen.getByTestId("pdp-gallery-mobile");
    const imgs = within(track).getAllByRole("img");
    expect(imgs).toHaveLength(3);
    expect(imgs[0]).toHaveAttribute("loading", "eager");
    expect(imgs[0]).toHaveAttribute("fetchpriority", "high");
    expect(imgs[1]).toHaveAttribute("loading", "lazy");
    expect(within(track).getByText("1 / 3")).toBeInTheDocument();
  });

  it("fires pdp_gallery_swipe once, on the first swipe", () => {
    render(<ShopPDPClient product={product} initialSelection={{}} accent="#4a3528" />);
    const region = screen.getByRole("region", { name: /photos/ });
    Object.defineProperty(region, "clientWidth", { value: 300, configurable: true });
    region.scrollLeft = 300; fireEvent.scroll(region);
    region.scrollLeft = 600; fireEvent.scroll(region);
    expect(events("pdp_gallery_swipe")).toEqual([["pdp_gallery_swipe", { properties: { product_slug: product.slug, index: 1 } }]]);
    expect(within(screen.getByTestId("pdp-gallery-mobile")).getByText("3 / 3")).toBeInTheDocument();
  });

  it("opens the lightbox from a gallery or detail image, locks scroll, closes on Esc", () => {
    render(<ShopPDPClient product={product} initialSelection={{}} accent="#4a3528" />);
    fireEvent.click(screen.getByRole("button", { name: "Enlarge Olydoe Merino Ponte Vest photo 2 of 3" }));
    const box = screen.getByTestId("pdp-lightbox");
    expect(box).toHaveAttribute("aria-modal", "true");
    expect(within(box).getByText("2 / 3")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    expect(events("pdp_image_zoom")).toEqual([["pdp_image_zoom", { properties: { product_slug: product.slug, index: 1 } }]]);

    act(() => { fireEvent.keyDown(window, { key: "ArrowRight" }); });
    expect(within(box).getByText("3 / 3")).toBeInTheDocument();
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(screen.queryByTestId("pdp-lightbox")).toBeNull();
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Enlarge Olydoe Merino Ponte Vest detail 2" }));
    expect(within(screen.getByTestId("pdp-lightbox")).getByText("3 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close photos" }));
    expect(screen.queryByTestId("pdp-lightbox")).toBeNull();
  });
});
