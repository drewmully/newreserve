import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompactVariantPicker } from "@/app/shop/components/CompactVariantPicker";
import type { ShopifyProduct } from "@/lib/shopify";

const product = {
  variants: [
    ["Navy", "30", "30"], ["Navy", "30", "32"], ["Navy", "32", "32"],
    ["Stone", "34", "34"],
  ].map(([color, size, inseam], index) => ({
    id: String(index), availableForSale: true, currentlyNotInStock: true,
    selectedOptions: [{name:"Color",value:color},{name:"Size",value:size},{name:"Inseam",value:inseam}],
  })),
} as ShopifyProduct;

describe("compact exact variant selection", () => {
  it("requires waist and inseam and resolves the exact preorder variant", () => {
    const change = vi.fn();
    render(<CompactVariantPicker product={product} value="" onChange={change} />);
    fireEvent.click(screen.getByRole("group", {name:"Waist"}).querySelector('[data-size="30"]')!);
    expect(change).toHaveBeenLastCalledWith("");
    fireEvent.click(screen.getByRole("group", {name:"Inseam"}).querySelector('[data-size="32"]')!);
    expect(change).toHaveBeenLastCalledWith("1");
  });
  it("clears incompatible selections when changing to a different color run", () => {
    const change = vi.fn();
    render(<CompactVariantPicker product={product} value="1" onChange={change} />);
    fireEvent.click(screen.getByRole("button", {name:"Stone"}));
    expect(change).toHaveBeenLastCalledWith("");
    fireEvent.click(screen.getByRole("group", {name:"Waist"}).querySelector('[data-size="34"]')!);
    fireEvent.click(screen.getByRole("group", {name:"Inseam"}).querySelector('[data-size="34"]')!);
    expect(change).toHaveBeenLastCalledWith("3");
  });
  it("disables unavailable variants for individual purchases", () => {
    render(<CompactVariantPicker product={{...product, variants:product.variants.map(v=>({...v,availableForSale:false}))}} value="" onChange={vi.fn()} />);
    expect(screen.getByRole("group", {name:"Waist"}).querySelector('[data-size="30"]')).toBeDisabled();
  });
});
