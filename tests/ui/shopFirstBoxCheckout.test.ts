import { describe, it, expect } from "vitest";
import { firstBoxLines, assertFirstBoxCart, type FirstBoxItem, type FirstBoxCart } from "@/lib/shopFirstBoxCheckout";
const reserve = "gid://shopify/ProductVariant/99";
const plan = "gid://shopify/SellingPlan/77";
const items: FirstBoxItem[] = [
  {slot:"Top",variantId:"gid://shopify/ProductVariant/1"},
  {slot:"Bottom",variantId:"gid://shopify/ProductVariant/2"},
  {slot:"Layer",variantId:"gid://shopify/ProductVariant/3"},
];
function cart(): FirstBoxCart {
  return {
    cost:{subtotalAmount:{amount:"250.00",currencyCode:"USD"}},
    lines:{pageInfo:{hasNextPage:false},nodes:[
      {quantity:1,merchandise:{id:reserve,availableForSale:true},sellingPlanAllocation:{sellingPlan:{id:plan}},cost:{totalAmount:{amount:"250.00",currencyCode:"USD"}}},
      ...items.map(i => ({quantity:1,merchandise:{id:i.variantId,availableForSale:true},sellingPlanAllocation:null,cost:{totalAmount:{amount:"0.00",currencyCode:"USD"}}})),
    ]},
  };
}
describe("first-box-only purchase semantics", () => {
  it("labels selected SKUs and never attaches their own selling plan", () => {
    const lines = firstBoxLines(items,reserve);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).not.toHaveProperty("sellingPlanId");
      expect(line.attributes).toContainEqual({key:"Shipment",value:"First box only"});
    }
  });
  it("rejects missing, duplicate, malformed or subscription-as-outfit variants", () => {
    for (const input of [items.slice(1),[items[0],items[0],items[2]],[...items.slice(0,2),{slot:"Layer" as const,variantId:reserve}],[...items.slice(0,2),{slot:"Layer" as const,variantId:"bad"}]]) {
      expect(()=>firstBoxLines(input,reserve)).toThrow();
    }
  });
  it("accepts only Shopify-confirmed $250 Reserve plus three included one-time lines", () => {
    expect(()=>assertFirstBoxCart(cart(),items,reserve,plan)).not.toThrow();
  });
  it.each(["retail extra","discounted subscription","recurring outfit","wrong plan","missing piece","extra piece","wrong currency","sold out","changed variant","wrong quantity","truncated"] as const)("fails closed on %s", kind => {
    const c = cart();
    if(kind==="retail extra") {c.lines.nodes[1].cost.totalAmount.amount="114";c.cost.subtotalAmount.amount="364";}
    if(kind==="discounted subscription") c.lines.nodes[0].cost.totalAmount.amount="150";
    if(kind==="recurring outfit") c.lines.nodes[1].sellingPlanAllocation={sellingPlan:{id:plan}};
    if(kind==="wrong plan") c.lines.nodes[0].sellingPlanAllocation={sellingPlan:{id:"other"}};
    if(kind==="missing piece") c.lines.nodes.pop();
    if(kind==="extra piece") c.lines.nodes.push(c.lines.nodes[1]);
    if(kind==="wrong currency") c.cost.subtotalAmount.currencyCode="CAD";
    if(kind==="sold out") c.lines.nodes[2].merchandise.availableForSale=false;
    if(kind==="changed variant") c.lines.nodes[2].merchandise.id="other";
    if(kind==="wrong quantity") c.lines.nodes[2].quantity=2;
    if(kind==="truncated") c.lines.pageInfo.hasNextPage=true;
    expect(()=>assertFirstBoxCart(c,items,reserve,plan)).toThrow(/No checkout was opened/);
  });
});
