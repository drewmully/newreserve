"use client";

import { useState } from "react";
import { useMembership } from "../context/MembershipContext";
import { ShopifyOutfitMembershipCard } from "./ShopifyOutfitMembershipCard";
import { SubscriptionManagerModal } from "./SubscriptionManagerModal";

/** Shared by account and dashboard. Mutation results update provider state before close. */
export function ShopifySubscriptionPanel() {
  const { subscriptions, shopifySubscriptions, refreshShopifySubscriptions } = useMembership();
  const [open, setOpen] = useState(false);
  const membership = subscriptions?.shopify_outfit;
  if (!membership) return null;
  return <>
    <ShopifyOutfitMembershipCard membership={membership} live={shopifySubscriptions}
      onRefresh={() => { void refreshShopifySubscriptions(); }} onManage={() => setOpen(true)} />
    <SubscriptionManagerModal provider="shopify" open={open} onClose={() => setOpen(false)} />
  </>;
}
