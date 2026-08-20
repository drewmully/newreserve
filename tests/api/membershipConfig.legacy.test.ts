import { describe, expect, it } from "vitest";

import {
  SHOPIFY_MEMBERSHIP_PLANS,
  extractVariantIdFromLoopSubscription,
  isLegacyVariantId,
  resolveVariantIdFromSellingPlanId,
  resolveMemberTierFromVariantId,
} from "@/lib/membershipConfig";

const LEGACY_BACK9_VARIANT_ID = 47601025679552; // matches DEFAULT_MEMBER_LEGACY_VARIANT_IDS

describe("legacy → Reserve upgrade helpers", () => {
  it("detects the legacy Back 9 variant", () => {
    expect(isLegacyVariantId(LEGACY_BACK9_VARIANT_ID)).toBe(true);
    expect(isLegacyVariantId(`gid://shopify/ProductVariant/${LEGACY_BACK9_VARIANT_ID}`)).toBe(true);
    expect(isLegacyVariantId(SHOPIFY_MEMBERSHIP_PLANS.member.variantId)).toBe(false);
    expect(isLegacyVariantId(null)).toBe(false);
    expect(isLegacyVariantId("")).toBe(false);
  });

  it("treats the legacy variant as the 'member' tier (preserves benefits)", () => {
    expect(resolveMemberTierFromVariantId(LEGACY_BACK9_VARIANT_ID)).toBe("member");
  });

  it("maps each Reserve selling plan back to its target variant", () => {
    const access = SHOPIFY_MEMBERSHIP_PLANS.access;
    const member = SHOPIFY_MEMBERSHIP_PLANS.member;
    expect(resolveVariantIdFromSellingPlanId(access.sellingPlanId)).toBe(access.variantId);
    expect(resolveVariantIdFromSellingPlanId(member.sellingPlanId)).toBe(member.variantId);
    expect(resolveVariantIdFromSellingPlanId(`gid://shopify/SellingPlan/${member.sellingPlanId}`))
      .toBe(member.variantId);
    expect(resolveVariantIdFromSellingPlanId(999)).toBeNull();
    expect(resolveVariantIdFromSellingPlanId(null)).toBeNull();
  });

  it("extracts the variant id from various Loop subscription shapes", () => {
    expect(
      extractVariantIdFromLoopSubscription({
        lines: [{ variantShopifyId: LEGACY_BACK9_VARIANT_ID }],
      })
    ).toBe(String(LEGACY_BACK9_VARIANT_ID));

    expect(
      extractVariantIdFromLoopSubscription({
        shopify_variant_id: SHOPIFY_MEMBERSHIP_PLANS.member.variantId,
      })
    ).toBe(String(SHOPIFY_MEMBERSHIP_PLANS.member.variantId));

    expect(
      extractVariantIdFromLoopSubscription({
        variant_id: `gid://shopify/ProductVariant/${SHOPIFY_MEMBERSHIP_PLANS.access.variantId}`,
      })
    ).toBe(String(SHOPIFY_MEMBERSHIP_PLANS.access.variantId));

    expect(extractVariantIdFromLoopSubscription(null)).toBeNull();
    expect(extractVariantIdFromLoopSubscription({})).toBeNull();
  });
});
