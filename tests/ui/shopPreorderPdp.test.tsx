import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopifyProduct } from "@/lib/shopify";
const mocks=vi.hoisted(()=>({add:vi.fn().mockResolvedValue(undefined)}));
vi.mock("@/app/context/MembershipContext",()=>({useMembership:()=>({addItemsToCart:mocks.add})}));
vi.mock("@/lib/tracking",()=>({trackEvent:vi.fn()}));
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
beforeEach(()=>mocks.add.mockReset().mockResolvedValue(undefined));
describe("PDP preorders",()=>{
 it("never substitutes another size for a combination that does not exist",async()=>{
  render(<ShopPDPClient product={product} initialSelection={{}} accent="#4a3528" />);
  fireEvent.click(screen.getByRole("button",{name:"Stone"}));
  expect(screen.getByRole("button",{name:/Unavailable.*Choose another/})).toBeDisabled();
  expect(mocks.add).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"L"}));
  fireEvent.click(screen.getByRole("button",{name:/Preorder.*Ships in about 2 weeks/}));
  await waitFor(()=>expect(mocks.add).toHaveBeenCalledWith([expect.objectContaining({variantId:"gid://shopify/ProductVariant/2",variantTitle:"Stone / L"})]));
 });
 it("shows a failed Shopify add instead of claiming the preorder succeeded",async()=>{
  mocks.add.mockRejectedValueOnce(new Error("Stock changed"));
  render(<ShopPDPClient product={product} initialSelection={{}} accent="#4a3528" />);
  fireEvent.click(screen.getByRole("button",{name:/Preorder.*Ships in about 2 weeks/}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not add");
 });
});
