import { beforeEach, describe, expect, it, vi } from "vitest";
const api=vi.hoisted(()=>({update:vi.fn()}));
vi.mock("@/lib/shopify",()=>({cartDiscountCodesUpdate:api.update}));
import { applyShopRewards, SHOP_REWARD_STORAGE } from "@/lib/shopCartRewards";
import type { ShopifyCart } from "@/lib/shopify";
const cart = {id:"cart",lines:[],checkoutUrl:"https://checkout.test",currency:"USD",totalAmount:200,discountCodes:[]} as ShopifyCart;
beforeEach(()=>{localStorage.clear();api.update.mockReset();});
describe("Shopify-authoritative best offer",()=>{
  it("leaves ordinary carts alone without a reward or requested code",async()=>{
    expect(await applyShopRewards(cart)).toBe(cart);expect(api.update).not.toHaveBeenCalled();
  });
  it("submits BOGO15 and the reward together, retaining Shopify's actual winning price",async()=>{
    const code="MULLY-"+"A".repeat(24);
    localStorage.setItem(SHOP_REWARD_STORAGE,code);
    const winner={...cart,totalAmount:180,orderDiscountAmount:20,discountCodes:[{code,applicable:true},{code:"BOGO15",applicable:false}]};
    api.update.mockResolvedValue(winner);
    expect(await applyShopRewards(cart,"BOGO15")).toBe(winner);
    expect(api.update).toHaveBeenCalledWith("cart",["BOGO15",code]);
  });
  it("preserves a better BOGO or external code rather than applying local percentage estimates",async()=>{
    const code="MULLY-"+"B".repeat(24);
    localStorage.setItem(SHOP_REWARD_STORAGE,code);
    const winner={...cart,totalAmount:150,discountCodes:[{code:"BOGO15",applicable:true},{code,applicable:false}]};
    api.update.mockResolvedValue(winner);
    expect(await applyShopRewards({...cart,discountCodes:[{code:"OTHER",applicable:true}]})).toBe(winner);
    expect(api.update).toHaveBeenCalledWith("cart",["OTHER","BOGO15",code]);
  });
});
