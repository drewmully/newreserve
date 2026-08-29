/**
 * Mully reassurance bullets — Checkout UI Extension
 *
 * Renders product-aware trust bullets in the Shopify Plus checkout cart
 * summary panel, directly beneath the line items. Routing:
 *
 *   1. `funnel=stylegame` cart attribute OR a line on the Style Game selling
 *      plan → STYLEGAME_BULLETS + "$5 today, $250 at cycle 2" heading. This
 *      is the anti-refund guardrail for the Style Game acquisition funnel:
 *      the buyer just paid $5, and we need to reassure them exactly what
 *      that gets them and when the next charge happens.
 *   2. Reserve Member variant 47601025122496 → quarterly curation bullets
 *      (7-day ship, free exchanges, cancel after Q1, 96% renew).
 *   3. Reserve Access variant 47601025482944 → annual-membership bullets.
 *   4. Anything else → generic reassurance bullets.
 *
 * No network calls — copy is local. Never blocks checkout progress.
 */

import {
  reactExtension,
  useApi,
  useSubscription,
  BlockStack,
  Text,
  View,
  Divider,
} from "@shopify/ui-extensions-react/checkout";
import React from "react";

// Variant IDs (numeric, as they appear in cart line merchandise.id GIDs).
const RESERVE_MEMBER_VARIANT = "47601025122496";
const RESERVE_ACCESS_VARIANT = "47601025482944";
// Style Game selling plan — same product+variant as Reserve Member, but the
// $245-off-first-cycle plan created for the acquisition funnel.
const STYLEGAME_SELLING_PLAN = "3671163072";
// Style Game funnel cart-attribute marker set by /api/stylegame/checkout.
const STYLEGAME_FUNNEL_ATTR = "funnel";
const STYLEGAME_FUNNEL_VALUE = "stylegame";

interface Bullet {
  key: string;
  text: string;
}

const MEMBER_BULLETS: Bullet[] = [
  { key: "retail_value", text: "✓  $300+ in retail, sourced from the brands" },
  { key: "ships_7_days", text: "✓  Ships in 7 days" },
  { key: "free_exchanges", text: "✓  Free size exchanges" },
  { key: "cancel_after_q1", text: "✓  Cancel anytime after your first quarter" },
  { key: "renew_rate", text: "✓  96% of members renew" },
];

const ACCESS_BULLETS: Bullet[] = [
  { key: "annual_drops", text: "✓  Annual access to member-only drops" },
  { key: "partner_discounts", text: "✓  Partner discounts on top golf brands" },
  { key: "cancel_anytime", text: "✓  Cancel anytime" },
];

const GENERIC_BULLETS: Bullet[] = [
  { key: "secure_checkout", text: "✓  Secure checkout" },
  { key: "free_exchanges", text: "✓  Free size exchanges" },
  { key: "us_support", text: "✓  US-based support" },
];

// STYLE GAME — the anti-refund guardrail.
// Every bullet answers a question we do NOT want landing in support:
//   "Wait, I thought this was just $5?"
//   "When am I getting charged $250?"
//   "Can I back out if I don't like the picks?"
const STYLEGAME_BULLETS: Bullet[] = [
  {
    key: "today_charge",
    text: "✓  Today: $5 for your stylist review. That's it.",
  },
  {
    key: "stylist_picks",
    text: "✓  Your stylist hand-picks 4 pieces from your Style Game profile",
  },
  {
    key: "approve_first",
    text: "✓  You approve the picks by email before anything ships",
  },
  {
    key: "quarterly_charge",
    text: "✓  Only after you approve: $250 for the full quarterly box",
  },
  {
    key: "walk_away",
    text: "✓  Don't like the picks? Reply \u201cno thanks\u201d — you keep the $5 review, no further charge",
  },
  {
    key: "free_exchanges",
    text: "✓  Free size exchanges once your box ships",
  },
];

/**
 * Extract numeric variant id from a Shopify GID like
 * "gid://shopify/ProductVariant/47601025122496".
 */
function variantIdFromGid(gid: string | undefined | null): string | null {
  if (!gid) return null;
  const parts = gid.split("/");
  return parts[parts.length - 1] || null;
}

function pickBullets(
  variantIds: string[],
  sellingPlanIds: string[],
  isStylegameFunnel: boolean,
): {
  bullets: Bullet[];
  heading: string;
} {
  // 1. Style Game funnel takes precedence over the generic Reserve Member
  //    match because the variant is the same, only the selling plan differs.
  if (
    isStylegameFunnel ||
    sellingPlanIds.includes(STYLEGAME_SELLING_PLAN)
  ) {
    return {
      bullets: STYLEGAME_BULLETS,
      heading: "Here's exactly what happens next",
    };
  }
  if (variantIds.includes(RESERVE_MEMBER_VARIANT)) {
    return { bullets: MEMBER_BULLETS, heading: "Your Mully Member benefits" };
  }
  if (variantIds.includes(RESERVE_ACCESS_VARIANT)) {
    return { bullets: ACCESS_BULLETS, heading: "Your Mully Access benefits" };
  }
  return { bullets: GENERIC_BULLETS, heading: "What you can count on" };
}

function Extension() {
  const { lines, attributes } =
    useApi<"purchase.checkout.cart-line-list.render-after">();
  // In API 2026-04, `lines` and `attributes` are SubscribableSignalLikes.
  // Read them via useSubscription so the component re-renders when the
  // cart or its attributes change.
  const cartLines = useSubscription(lines) ?? [];
  const cartAttributes = useSubscription(attributes) ?? [];

  const variantIds = cartLines
    .map((line) => variantIdFromGid(line.merchandise?.id))
    .filter((id): id is string => Boolean(id));

  // sellingPlan can live on line.sellingPlanAllocation.sellingPlan.id
  // depending on API version. We defensively read the most common shapes.
  const sellingPlanIds = cartLines
    .map((line) => {
      const l = line as unknown as {
        sellingPlanAllocation?: { sellingPlan?: { id?: string } };
      };
      const gid = l.sellingPlanAllocation?.sellingPlan?.id;
      return variantIdFromGid(gid);
    })
    .filter((id): id is string => Boolean(id));

  const isStylegameFunnel = cartAttributes.some(
    (a) =>
      a?.key === STYLEGAME_FUNNEL_ATTR && a?.value === STYLEGAME_FUNNEL_VALUE,
  );

  const { bullets, heading } = pickBullets(
    variantIds,
    sellingPlanIds,
    isStylegameFunnel,
  );

  return (
    <View padding="base" border="base" cornerRadius="base">
      <BlockStack spacing="tight">
        <Text size="medium" emphasis="bold">
          {heading}
        </Text>
        <Divider />
        {bullets.map((bullet) => (
          <Text key={bullet.key} size="small">{bullet.text}</Text>
        ))}
      </BlockStack>
    </View>
  );
}

export default reactExtension(
  "purchase.checkout.cart-line-list.render-after",
  () => <Extension />,
);
