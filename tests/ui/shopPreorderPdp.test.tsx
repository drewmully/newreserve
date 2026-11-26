import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopifyProduct } from "@/lib/shopify";
const mocks=vi.hoisted(()=>({add:vi.fn().mockResolvedValue(undefined)}));
vi.mock("@/app/context/MembershipContext",()=>({useMembership:()=>({addItemsToCart:mocks.add})}));
vi.mock("@/lib/tracking",()=>({trackEvent:vi.fn(),getClientAnonymousId:()=>"anon-test"}));
import { ShopPDPClient } from "@/app/shop/components/ShopPDPClient";
const product={
 slug:"test-polo",name:"Test polo",brand:"Test",collection:"Tops",price:100,reservePrice:100,variantId:"gid://shopify/ProductVariant/1",
 images:[],description:"A polo.",material:"Cotton",aboutBrand:"",whyWeLikeIt:"",sizing:"Regular fit.",
 options:[{name:"Color",values:["Navy","Stone"]},{name:"Size",values:["M","L"]}],
 variants:[["Navy","M"],["Stone","L"]].map(([color,size],i)=>({
  id:`gid://shopify/ProductVariant/${i+1}`,title:`${color} / ${size}`,price:100,reservePrice:100,
  availableForSale:true,currentlyNotInStock:true,
  selectedOptions:[{name:"Color",value:color},{name:"Size",value:size}],
 })),
} as ShopifyProduct;
beforeEach(()=>{mocks.add.mockReset().mockResolvedValue(undefined);Element.prototype.scrollIntoView=vi.fn();});
describe("PDP preorders",()=>{
 it("opens with no size chosen and points the CTA at the size grid",()=>{
  render(<ShopPDPClient product={product} initialSelection={{}} accent="#4a3528" />);
  const cta=screen.getByRole("button",{name:"Select a size"});
  expect(cta).toHaveAttribute("data-cta-state","select-option");
  expect(screen.getByText("Choose a size")).toBeInTheDocument();
  fireEvent.click(cta);
  expect(mocks.add).not.toHaveBeenCalled();
  expect(document.activeElement?.closest("[data-option-group]")).not.toBeNull();
 });
 it("never substitutes another size for a combination that does not exist",async()=>{
  render(<ShopPDPClient product={product} initialSelection={{}} accent="#4a3528" />);
  fireEvent.click(screen.getByRole("button",{name:"M"}));
  fireEvent.click(screen.getByRole("button",{name:"Stone"}));
  // Stone only comes in L: the M pick must not silently carry over.
  expect(screen.queryByRole("button",{name:/Pre-order|Add to cart/})).toBeNull();
  expect(screen.getByRole("button",{name:"Select a size"})).toBeInTheDocument();
  expect(mocks.add).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"L"}));
  fireEvent.click(screen.getByRole("button",{name:/Pre-order · Ships/}));
  await waitFor(()=>expect(mocks.add).toHaveBeenCalledWith([expect.objectContaining({variantId:"gid://shopify/ProductVariant/2",variantTitle:"Stone / L"})]));
 });
 it("shows a failed Shopify add instead of claiming the preorder succeeded",async()=>{
  mocks.add.mockRejectedValueOnce(new Error("Stock changed"));
  render(<ShopPDPClient product={product} initialSelection={{Color:"Navy",Size:"M"}} accent="#4a3528" />);
  fireEvent.click(screen.getByRole("button",{name:/Pre-order · Ships/}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not add");
 });
 it("shows the support email in the trust strip",()=>{
  render(<ShopPDPClient product={product} initialSelection={{}} accent="#4a3528" />);
  expect(screen.getByText("info@mymully.com")).toBeInTheDocument();
 });
});
