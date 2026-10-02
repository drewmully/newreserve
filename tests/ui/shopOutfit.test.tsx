import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OUTFIT_SLOTS, OUTFIT_STORAGE_KEY, outfitEstimate, outfitLineAttributes, readOutfitGuide } from "@/lib/shopOutfit";
import type { ShopifyProduct } from "@/lib/shopify";
import { ShopOutfitBuilder } from "@/app/shop/components/ShopOutfitBuilder";
const mocks=vi.hoisted(()=>({add:vi.fn().mockResolvedValue(undefined),checkout:vi.fn().mockResolvedValue(undefined)}));
vi.mock("@/lib/shopifyCheckout",()=>({createMembershipCheckout:mocks.checkout}));
vi.mock("@/app/context/MembershipContext",()=>({useMembership:()=>({addItemsToCart:mocks.add})}));
vi.mock("@/lib/tracking",()=>({trackEvent:vi.fn()}));
const products=OUTFIT_SLOTS.flatMap((slot,i)=>slot.slugs.map((slug,j)=>({
  slug,name:`${slot.label} ${j+1}`,brand:"Test",images:["/piece.jpg"],price:[114,138,128][i],
  variants:["M","L"].map((size,k)=>({id:`gid://shopify/ProductVariant/${i+1}${j+1}${k+1}`,title:size,
    price:[114,138,128][i],selectedOptions:[{name:"Size",value:size}],availableForSale:true})),
}) as ShopifyProduct));
const byCategory=Object.fromEntries(OUTFIT_SLOTS.map(slot=>[slot.category,products.filter(p=>(slot.slugs as readonly string[]).includes(p.slug))]));
beforeEach(()=>{
  sessionStorage.clear();mocks.add.mockReset().mockResolvedValue(undefined);mocks.checkout.mockReset().mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","")};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute("open")};
});
function chooseSizes(){
  fireEvent.click(screen.getByRole("button",{name:"Choose my sizes →"}));
  fireEvent.click(within(screen.getByRole("group",{name:"Top & layer size"})).getByRole("button",{name:"M"}));
  fireEvent.click(within(screen.getByRole("group",{name:"Trouser size"})).getByRole("button",{name:"L"}));
  fireEvent.click(screen.getByRole("button",{name:"Review my outfit →"}));
}
describe("guided outfit flow",()=>{
  it("starts with one complete look, one CTA and no Reserve pitch",()=>{
    render(<ShopOutfitBuilder products={products} byCategory={byCategory}/>);
    expect(screen.getByRole("button",{name:"Choose my sizes →"})).toBeEnabled();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText(/Subscribe & save/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading",{name:"Your fall outfit, for less."})).toBeInTheDocument();
    expect(document.querySelector(".guided-total")).toBeNull();
    expect([...document.querySelectorAll(".guided-piece-price")].map(p=>p.textContent)).toEqual(["$114","$138","$128"]);
    expect(OUTFIT_SLOTS[2].slugs[0]).toBe("duckhead-fremont-sport-performance-quilted-vest-brandy-brown");
    expect(screen.getByText("15% off one piece with BOGO15. Applied in your bag.")).toBeInTheDocument();
  });
  it("requires explicit sizes, shares top/layer size, then sends three exact variants",()=>{
    render(<ShopOutfitBuilder products={products} byCategory={byCategory}/>);
    fireEvent.click(screen.getByRole("button",{name:"Choose my sizes →"}));
    expect(screen.getByRole("button",{name:"Review my outfit →"})).toBeDisabled();
    fireEvent.click(within(screen.getByRole("group",{name:"Top & layer size"})).getByRole("button",{name:"M"}));
    expect(screen.getByRole("button",{name:"Review my outfit →"})).toBeDisabled();
    fireEvent.click(within(screen.getByRole("group",{name:"Trouser size"})).getByRole("button",{name:"L"}));
    fireEvent.click(screen.getByRole("button",{name:"Review my outfit →"}));
    expect(screen.getByRole("radio",{name:/Just this time/})).toBeChecked();
    fireEvent.click(screen.getByRole("button",{name:"Add outfit to bag"}));
    expect(mocks.add).toHaveBeenCalledWith([
      expect.objectContaining({variantId:products[0].variants[0].id,variantTitle:"M"}),
      expect.objectContaining({variantId:products[2].variants[1].id,variantTitle:"L"}),
      expect.objectContaining({variantId:products[4].variants[0].id,variantTitle:"M"}),
    ]);
  });
  it("shows Reserve only at review and passes first-shipment selections",()=>{
    render(<ShopOutfitBuilder products={products} byCategory={byCategory}/>);chooseSizes();
    fireEvent.click(screen.getByRole("radio",{name:/Subscribe & save/}));
    fireEvent.click(screen.getByRole("button",{name:"Subscribe for $250 / season →"}));
    expect(mocks.checkout).toHaveBeenCalledWith("member",{firstBoxItems:[
      {slot:"Top",variantId:products[0].variants[0].id,name:products[0].name,size:"M"},
      {slot:"Bottom",variantId:products[2].variants[1].id,name:products[2].name,size:"L"},
      {slot:"Layer",variantId:products[4].variants[0].id,name:products[4].name,size:"M"},
    ]});
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("uses explicit waist and inseam buttons and hands off the exact trouser variant",()=>{
    const trousers={...products[2],variants:["32","34"].flatMap(waist=>["30","32"].map(inseam=>({
      ...products[2].variants[0],id:`gid://shopify/ProductVariant/${waist}${inseam}`,title:`${waist} / ${inseam}`,
      selectedOptions:[{name:"Size",value:waist},{name:"Inseam",value:inseam}],
    })))};
    render(<ShopOutfitBuilder products={products.map(p=>p.slug===trousers.slug?trousers:p)} byCategory={{}}/>);
    fireEvent.click(screen.getByRole("button",{name:"Choose my sizes →"}));
    fireEvent.click(within(screen.getByRole("group",{name:"Top & layer size"})).getByRole("button",{name:"M"}));
    const waist=within(screen.getByRole("group",{name:"Trouser waist"}));
    const inseam=within(screen.getByRole("group",{name:"Trouser inseam"}));
    expect(waist.getByRole("button",{name:"34"})).toHaveAttribute("aria-pressed","false");
    fireEvent.click(waist.getByRole("button",{name:"34"}));
    expect(screen.getByRole("button",{name:"Review my outfit →"})).toBeDisabled();
    fireEvent.click(inseam.getByRole("button",{name:"32"}));
    expect(waist.getByRole("button",{name:"34"})).toHaveAttribute("aria-pressed","true");
    fireEvent.click(screen.getByRole("button",{name:"Review my outfit →"}));
    fireEvent.click(screen.getByRole("button",{name:"Add outfit to bag"}));
    expect(mocks.add.mock.calls[0][0][1].variantId).toBe("gid://shopify/ProductVariant/3432");
  });
  it("allows different top and layer sizes without guessing",()=>{
    render(<ShopOutfitBuilder products={products} byCategory={byCategory}/>);
    fireEvent.click(screen.getByRole("button",{name:"Choose my sizes →"}));
    fireEvent.click(screen.getByLabelText("I wear different top and layer sizes"));
    fireEvent.change(screen.getByLabelText("Top size"),{target:{value:"M"}});
    fireEvent.change(screen.getByLabelText("Layer size"),{target:{value:"L"}});
    fireEvent.click(within(screen.getByRole("group",{name:"Trouser size"})).getByRole("button",{name:"M"}));
    fireEvent.click(screen.getByRole("button",{name:"Review my outfit →"}));
    fireEvent.click(screen.getByRole("button",{name:"Add outfit to bag"}));
    expect(mocks.add.mock.calls[0][0][2].variantId).toBe(products[4].variants[1].id);
  });
  it("shows errors instead of claiming checkout or cart success",async()=>{
    mocks.checkout.mockRejectedValueOnce(new Error("Could not confirm the first-box price."));
    render(<ShopOutfitBuilder products={products} byCategory={byCategory}/>);chooseSizes();
    fireEvent.click(screen.getByRole("radio",{name:/Subscribe & save/}));
    fireEvent.click(screen.getByRole("button",{name:"Subscribe for $250 / season →"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not confirm");
  });
  it("blocks unavailable one-time items but preserves Reserve instructions",()=>{
    const sold=products.map(p=>({...p,variants:p.variants.map(v=>({...v,availableForSale:false}))}));
    render(<ShopOutfitBuilder products={sold} byCategory={{}}/>);chooseSizes();
    expect(screen.getByRole("button",{name:"Selected sizes sold out"})).toBeDisabled();
    fireEvent.click(screen.getByRole("radio",{name:/Subscribe & save/}));
    fireEvent.click(screen.getByRole("button",{name:"Subscribe for $250 / season →"}));
    expect(mocks.checkout).toHaveBeenCalledOnce();
  });
  it("keeps product swapping optional and never borrows sizes from another product",()=>{
    render(<ShopOutfitBuilder products={products} byCategory={byCategory}/>);chooseSizes();
    fireEvent.click(screen.getByRole("button",{name:"Swap a piece or color ↗"}));
    fireEvent.click(screen.getByRole("button",{name:"Choose Top 2"}));
    fireEvent.click(screen.getByRole("button",{name:"Keep this look →"}));
    expect(screen.getByRole("button",{name:"Review my outfit →"})).toBeDisabled();
  });
  it("discounts exactly one lowest-priced item with cent rounding",()=>{
    expect(outfitEstimate([114,138,128])).toEqual({subtotal:380,savings:17.1,total:362.9});
    expect(outfitEstimate([19.99,20])).toEqual({subtotal:39.99,savings:3,total:36.99});
    expect(outfitEstimate([100]).total).toBe(100);expect(outfitEstimate([]).total).toBe(0);
    expect(outfitEstimate([100,100,100,100]).savings).toBe(15);
  });
  it("rejects stale style guides and retains exact checkout attributes",()=>{
    for(const value of ["bad",JSON.stringify({createdAt:0,items:[]})]){
      sessionStorage.setItem(OUTFIT_STORAGE_KEY,value);expect(readOutfitGuide()).toBeNull();
    }
    const guide={createdAt:Date.now(),items:[products[0],products[2],products[4]].map(p=>({
      slug:p.slug,name:p.name,brand:p.brand,image:p.images[0],variantId:p.variants[0].id,size:"M",
    }))};
    sessionStorage.setItem(OUTFIT_STORAGE_KEY,JSON.stringify(guide));expect(readOutfitGuide()).toEqual(guide);
    expect(outfitLineAttributes(guide)).toHaveLength(6);
  });
});
