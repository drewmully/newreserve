import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShopifyProduct } from "@/lib/shopify";
import { MysteryBundlePage, mysteryRetailValue } from "@/app/shop/components/MysteryBundlePage";

const variants = ["S", "M", "L"].map((size,i) => ({
  id:`gid://shopify/ProductVariant/${i+1}`,title:size,price:50,reservePrice:42.5,
  availableForSale:i !== 2,selectedOptions:[{name:"Size",value:size}],
}));
const product = {
  name:"Mystery Bundle - Closeout",slug:"mystery-bundle-closeout",brand:"Mully",
  price:50,description:"Guaranteed retail value exceeding $150.",variants,images:["https://example.com/image.jpg"],
} as ShopifyProduct;

describe("Mystery Bundle product page", () => {
  it("requires explicit size and adds only the exact selected variant", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    render(<MysteryBundlePage product={product} onAdd={add} onOpenBag={vi.fn()} preview />);
    expect(screen.getByRole("button",{name:"Choose your size"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"L, unavailable"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"M"}));
    fireEvent.click(screen.getByRole("button",{name:/Add to bag/}));
    await waitFor(() => expect(add).toHaveBeenCalledWith(variants[1]));
    expect(screen.getByText("Final sale. No returns.")).toBeInTheDocument();
    expect(screen.queryByText(/free returns/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/buy 2/i)).not.toBeInTheDocument();
  });
  it("preserves exact deep-linked selection and surfaces errors without claiming success", async () => {
    render(<MysteryBundlePage product={product} initialVariantId={variants[0].id}
      onAdd={vi.fn().mockRejectedValue(new Error("Unavailable"))} onOpenBag={vi.fn()} preview />);
    expect(screen.getByRole("button",{name:"S"})).toHaveAttribute("aria-pressed","true");
    fireEvent.click(screen.getByRole("button",{name:/Add to bag/}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again");
  });
  it("does not enable a sold-out variant from a URL", () => {
    render(<MysteryBundlePage product={product} initialVariantId={variants[2].id}
      onAdd={vi.fn()} onOpenBag={vi.fn()} />);
    expect(screen.getByRole("button",{name:/Size unavailable/})).toBeDisabled();
  });
  it("uses live price rather than a member discount or invented compare-at price", () => {
    render(<MysteryBundlePage product={{...product,price:60,variants:variants.map(v=>({...v,price:60}))}}
      initialVariantId={variants[0].id} onAdd={vi.fn()} onOpenBag={vi.fn()} />);
    expect(screen.getByRole("button",{name:/Add to bag · \$60/})).toBeEnabled();
    expect(document.querySelector("s")).toBeNull();
  });
  it("derives the retail-value claim from product copy and hides it when missing", () => {
    expect(mysteryRetailValue("Retail value exceeding $150.")).toBe(150);
    expect(mysteryRetailValue("Retail value over $1,000.")).toBe(1000);
    expect(mysteryRetailValue("An assortment of apparel.")).toBeNull();
  });
});
