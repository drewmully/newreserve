import { describe, it, expect } from "vitest";
import { firstBoxAttributes, assertFirstBoxCart, type FirstBoxItem, type FirstBoxCart } from "@/lib/shopFirstBoxCheckout";
const reserve = "gid://shopify/ProductVariant/99";
const plan = "gid://shopify/SellingPlan/77";
const items: FirstBoxItem[] = [
  {slot:"Top",variantId:"gid://shopify/ProductVariant/1",name:"Polo",size:"M"},
  {slot:"Bottom",variantId:"gid://shopify/ProductVariant/2",name:"Pant",size:"32"},
  {slot:"Layer",variantId:"gid://shopify/ProductVariant/3",name:"Vest",size:"M"},
];
function cart(): FirstBoxCart {
  return {
    cost:{subtotalAmount:{amount:"299.95",currencyCode:"USD"}},
    lines:{pageInfo:{hasNextPage:false},nodes:[
      {quantity:1,merchandise:{id:reserve,availableForSale:true},sellingPlanAllocation:{sellingPlan:{id:plan}},cost:{totalAmount:{amount:"299.95",currencyCode:"USD"}}},
    ]},
  };
}
describe("Reserve box with initial-order instructions", () => {
  it("preserves three exact selections and sizes as order attributes, not priced lines", () => {
    const attrs = firstBoxAttributes(items,reserve);
    expect(attrs).toContainEqual({key:"First box Top",value:"Polo / M (qty 1)"});
    expect(attrs).toContainEqual({key:"_first_box_bottom_variant",value:items[1].variantId});
    expect(attrs).toHaveLength(8);
    expect(attrs.some(a => "sellingPlanId" in a || "merchandiseId" in a)).toBe(false);
  });
  it("rejects missing, duplicate, malformed or subscription-as-outfit selections", () => {
    for (const input of [items.slice(1),[items[0],items[0],items[2]],[...items.slice(0,2),{...items[2],variantId:reserve}],[...items.slice(0,2),{...items[2],size:""}]]) {
      expect(()=>firstBoxAttributes(input,reserve)).toThrow();
    }
  });
  it("accepts a single undiscounted $299.95 Reserve line, without checking garment counts", () => {
    expect(()=>assertFirstBoxCart(cart(),reserve,plan)).not.toThrow();
  });
  it.each(["retail extra","discounted subscription","missing plan","wrong plan","missing line","extra line","wrong currency","box unavailable","changed variant","wrong quantity","truncated"] as const)("fails closed on %s", kind => {
    const c = cart();
    if(kind==="retail extra") c.cost.subtotalAmount.amount="364";
    if(kind==="discounted subscription") c.lines.nodes[0].cost.totalAmount.amount="150";
    if(kind==="missing plan") c.lines.nodes[0].sellingPlanAllocation=null;
    if(kind==="wrong plan") c.lines.nodes[0].sellingPlanAllocation={sellingPlan:{id:"other"}};
    if(kind==="missing line") c.lines.nodes.pop();
    if(kind==="extra line") c.lines.nodes.push(c.lines.nodes[0]);
    if(kind==="wrong currency") c.cost.subtotalAmount.currencyCode="CAD";
    if(kind==="box unavailable") c.lines.nodes[0].merchandise.availableForSale=false;
    if(kind==="changed variant") c.lines.nodes[0].merchandise.id="other";
    if(kind==="wrong quantity") c.lines.nodes[0].quantity=2;
    if(kind==="truncated") c.lines.pageInfo.hasNextPage=true;
    expect(()=>assertFirstBoxCart(c,reserve,plan)).toThrow(/No checkout was opened/);
  });
});
