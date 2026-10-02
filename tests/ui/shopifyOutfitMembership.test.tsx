import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SHOPIFY_OUTFIT_SUBSCRIPTION, SHOPIFY_MEMBERSHIP_PLANS, LOOP_CHANGE_PLAN_OPTIONS, resolveMemberTierFromVariantId, isSupportedSellingPlanId } from "@/lib/membershipConfig";
import { outfitMembershipFromPaidOrder, readShopifyOutfitMembership } from "@/lib/shopifyOutfitMembership";
import { ShopifyOutfitMembershipCard } from "@/app/account/ShopifyOutfitMembershipCard";

const order = {
  id: 123,
  processed_at: "2026-10-02T14:00:00Z",
  currency: "USD",
  line_items: [{variant_id: 50408581267648, quantity: 1, price: "299.95"}],
};

describe("Shopify outfit subscription account bridge", () => {
  it("recognizes numeric and GID variants as members without changing Loop plans", () => {
    expect(resolveMemberTierFromVariantId(50408581267648)).toBe("member");
    expect(resolveMemberTierFromVariantId(SHOPIFY_OUTFIT_SUBSCRIPTION.merchandiseId)).toBe("member");
    expect(SHOPIFY_MEMBERSHIP_PLANS.member.variantId).not.toBe(50408581267648);
    expect(isSupportedSellingPlanId(6627721408)).toBe(false);
    expect(LOOP_CHANGE_PLAN_OPTIONS.some(p => p.sellingPlanShopifyId === 6627721408)).toBe(false);
  });
  it("records a paid enrollment or renewal without fabricating live contract status", () => {
    const receipt = outfitMembershipFromPaidOrder(order);
    expect(receipt).toEqual({
      provider:"shopify", variant_id:50408581267648, order_id:"123",
      paid_at:"2026-10-02T14:00:00.000Z", amount:"299.95", currency:"USD",
    });
    expect(receipt).not.toHaveProperty("status");
    expect(receipt).not.toHaveProperty("nextBillingDate");
    expect(readShopifyOutfitMembership(receipt)).toEqual(receipt);
    expect(outfitMembershipFromPaidOrder({...order,id:456})).toMatchObject({order_id:"456"});
  });
  it("does not mark retail, giftless/free, malformed or old Loop purchases as Shopify outfits", () => {
    expect(outfitMembershipFromPaidOrder({...order,line_items:[{variant_id:47601025122496,quantity:1,price:"249"}]})).toBeNull();
    expect(outfitMembershipFromPaidOrder({...order,processed_at:"bad"})).toBeNull();
    expect(outfitMembershipFromPaidOrder({...order,line_items:[{...order.line_items[0],price:"0"}]})).toBeNull();
    expect(readShopifyOutfitMembership({provider:"shopify"})).toBeNull();
  });
  it("opens the in-site manager instead of redirecting to a hosted account portal", () => {
    const manage = vi.fn();
    render(<ShopifyOutfitMembershipCard membership={outfitMembershipFromPaidOrder(order)!} onManage={manage}/>);
    fireEvent.click(screen.getByRole("button",{name:"Manage subscription"}));
    expect(manage).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Item price before discounts: $299.95")).toBeInTheDocument();
    expect(screen.queryByText(/Last payment/)).not.toBeInTheDocument();
    expect(screen.getByText(/same Shopify email you used at checkout/)).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });
});
