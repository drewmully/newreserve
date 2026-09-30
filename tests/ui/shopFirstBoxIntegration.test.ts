import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { SHOPIFY_MEMBERSHIP_PLANS } from "@/lib/membershipConfig";
import type { FirstBoxItem } from "@/lib/shopFirstBoxCheckout";
vi.mock("@/lib/attribution",()=>({getStoredAttribution:()=>({}),attributionToCartAttributes:()=>[]}));
vi.mock("@/lib/shopifyCheckoutOrigin",()=>({buildCheckoutOriginAttributes:()=>[]}));
vi.mock("@/lib/analytics/journeyClient",()=>({recordJourneyCart:vi.fn().mockResolvedValue(undefined)}));
const plan=SHOPIFY_MEMBERSHIP_PLANS.member;
const items: FirstBoxItem[] = [
  {slot:"Top",variantId:"gid://shopify/ProductVariant/1",name:"Polo",size:"M"},
  {slot:"Bottom",variantId:"gid://shopify/ProductVariant/2",name:"Pant",size:"32"},
  {slot:"Layer",variantId:"gid://shopify/ProductVariant/3",name:"Vest",size:"M"},
];
const location = {origin:"https://www.mymully.com",href:"https://www.mymully.com/shop"};
let fetchMock: ReturnType<typeof vi.fn>;
function result(amount="250.00") {
  return {data:{cartCreate:{userErrors:[],cart:{
    id:"gid://shopify/Cart/test",checkoutUrl:"https://checkout.example.test/test",
    cost:{subtotalAmount:{amount,currencyCode:"USD"}},
    lines:{pageInfo:{hasNextPage:false},nodes:[
      {quantity:1,merchandise:{id:plan.merchandiseId,availableForSale:true},sellingPlanAllocation:{sellingPlan:{id:plan.sellingPlanGid}},cost:{totalAmount:{amount:"250.00",currencyCode:"USD"}}},
    ]},
  }}}};
}
beforeEach(()=>{
  location.href="https://www.mymully.com/shop";
  vi.stubEnv("NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN","example.myshopify.com");
  vi.stubEnv("NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN","test-public-token");
  vi.stubGlobal("window",{location,localStorage:{setItem:vi.fn()}});
  fetchMock=vi.fn().mockResolvedValue({json:async()=>result()});
  vi.stubGlobal("fetch",fetchMock);
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});
describe("Reserve checkout wiring",()=>{
  it("shows explicit first-shipment details while retaining order-level fulfillment metadata",async()=>{
    await createMembershipCheckout("member",{firstBoxItems:items,discountCodes:["BOGO15"],subscriptionLineAttributes:[{key:"Outfit Top",value:"must not recur"}]});
    const payload=JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.variables.lines).toHaveLength(1);
    expect(payload.variables.lines[0]).toEqual({merchandiseId:plan.merchandiseId,quantity:1,sellingPlanId:plan.sellingPlanGid,attributes:[
      {key:"First shipment only · Top",value:"Polo / M"},
      {key:"First shipment only · Bottom",value:"Pant / 32"},
      {key:"First shipment only · Layer",value:"Vest / M"},
      {key:"Future shipments",value:"New styles curated for you. $250 every 3 months (4x/year)."},
    ]});
    expect(payload.variables.discountCodes).toBeNull();
    expect(payload.variables.attributes).toContainEqual({key:"First box Top",value:"Polo / M (qty 1)"});
    expect(payload.variables.note).toContain("Top: Polo / M (qty 1)");
    expect(payload.variables.note).toContain("First shipment only");
    expect(location.href).toContain("https://checkout.example.test/test");
    expect(location.href).toContain("return_url=");
  });
  it("never redirects when Shopify changes the box price",async()=>{
    fetchMock.mockResolvedValue({json:async()=>result("500")});
    await expect(createMembershipCheckout("member",{firstBoxItems:items})).rejects.toThrow("No checkout was opened");
    expect(location.href).toBe("https://www.mymully.com/shop");
  });
  it("preserves existing subscription entry point lines, properties and discount behavior",async()=>{
    await createMembershipCheckout("member",{discountCodes:["EXISTING"],subscriptionLineAttributes:[{key:"Style",value:"Classic"}]});
    const payload=JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.variables.lines).toEqual([{merchandiseId:plan.merchandiseId,quantity:1,sellingPlanId:plan.sellingPlanGid,attributes:[{key:"Style",value:"Classic"}]}]);
    expect(payload.variables.discountCodes).toEqual(["EXISTING"]);
    expect(payload.query).not.toContain("lines(first: 10)");
  });
  it("rejects the annual tier and missing storefront configuration for this offer",async()=>{
    await expect(createMembershipCheckout("access",{firstBoxItems:items})).rejects.toThrow("quarterly");
    vi.stubEnv("NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN","");
    await expect(createMembershipCheckout("member",{firstBoxItems:items})).rejects.toThrow("temporarily unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
