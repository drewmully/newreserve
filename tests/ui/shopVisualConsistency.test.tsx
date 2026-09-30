import { readFileSync } from "node:fs";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShopifyProduct } from "@/lib/shopify";
import { getSeasonalTheme } from "@/app/shop/seasonalTheme";
vi.mock("@/app/context/MembershipContext", () => ({ useMembership: () => ({ addItemsToCart: vi.fn() }) }));
vi.mock("@/app/shop/components/ScrollToTop", () => ({ ScrollToTop: () => null }));
vi.mock("@/app/shop/components/ShopPasswordGate", () => ({ ShopPasswordGate: () => null }));
vi.mock("@/app/shop/components/ShopOutfitBuilder", () => ({ ShopOutfitBuilder: () => <section id="outfit" /> }));
vi.mock("@/app/shop/components/ShopNewsletter", () => ({ ShopNewsletter: () => null }));
import { ShopLanding } from "@/app/shop/components/ShopLanding";
import prepared from "@/lib/shopProductPhotos.json";

const photo=prepared.find(p=>p.slug==="olydoe-og-supima-hollow-polo")!;
const product={
  slug:photo.slug, name:"Olydoe OG Supima Hollow Polo",brand:"Olydoe",
  images:[photo.catalogPrimary], price:110, description:"This long merchandising copy belongs on the product page.",
  variants:[{id:"gid://shopify/ProductVariant/1",title:"M",price:110,availableForSale:true,selectedOptions:[{name:"Size",value:"M"}]}],
} as ShopifyProduct;

describe("quiet shop visual contract",()=>{
  it("keeps the hero to one short seasonal headline and one action",()=>{
    const {container}=render(<ShopLanding products={[product]} productsByCategory={{}} theme={getSeasonalTheme(new Date(2026,8,30))} />);
    const hero=container.querySelector("#hero")!;
    expect(hero.textContent?.trim()).toBe("The Fall EditShop the edit");
    expect(hero.querySelectorAll("a")).toHaveLength(1);
    expect(hero.querySelector("img")).toHaveAttribute("src","/shop/hero-fall-2026.jpg");
    expect(container.querySelector(".shop-selection-note")).toBeNull();
  });
  it("uses a normalized packshot and retains accessible options",()=>{
    const show=vi.fn(function(this: HTMLDialogElement) { this.open=true; });
    HTMLDialogElement.prototype.showModal=show;
    const {container}=render(<ShopLanding products={[product]} productsByCategory={{}} theme={getSeasonalTheme()} />);
    expect(container.querySelector("#edit img")).toHaveAttribute("src",photo.prepared);
    expect(container.querySelectorAll("#edit .card__price")).toHaveLength(1);
    expect(container.querySelectorAll("#edit .card__quick")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button",{name:`View options for ${product.name}`}));
    expect(show).toHaveBeenCalledOnce();
    expect(screen.getByRole("combobox")).toHaveTextContent("M");
  });
  it("keeps footer grid syntax valid and separates the builder's layout rules",()=>{
    const footer=readFileSync("src/app/shop/components/ShopFooter.tsx","utf8");
    expect(footer).toContain("md:grid-cols-[2fr_1fr_1fr]");
    expect(footer).not.toContain("md:grid-cols-[2fr,1fr,1fr]");
    const css=readFileSync("src/app/shop/components/shop-first.css","utf8");
    expect(css).toContain(".sec:not(.outfit)");
    expect(css).toContain("grid-template-columns:repeat(4,minmax(0,1fr))");
    expect(css).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
  });
});
