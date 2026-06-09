/**
 * Mully reassurance bullets — Checkout UI Extension
 *
 * Renders product-aware trust bullets in the Shopify Plus checkout cart
 * summary panel, directly beneath the line items. Variant detection drives
 * the copy:
 *
 *   - 47601025122496 → Reserve Member (quarterly curation): rangefinder
 *     welcome gift, 7-day ship, free exchanges, cancel after Q1, 96% renew
 *   - 47601025482944 → Reserve Access (annual membership): member-only
 *     drops, partner discounts, cancel anytime
 *   - anything else  → generic reassurance bullets
 *
 * No network calls — copy is local. Never blocks checkout progress.
 */

import {
  reactExtension,
  useApi,
  BlockStack,
  InlineStack,
  Icon,
  Text,
  View,
  Divider,
} from "@shopify/ui-extensions-react/checkout";
import React from "react";

// Variant IDs (numeric, as they appear in cart line merchandise.id GIDs).
const RESERVE_MEMBER_VARIANT = "47601025122496";
const RESERVE_ACCESS_VARIANT = "47601025482944";

type BulletKey =
  | "rangefinder_gift"
  | "ships_7_days"
  | "free_exchanges"
  | "cancel_after_q1"
  | "renew_rate"
  | "annual_drops"
  | "partner_discounts"
  | "cancel_anytime"
  | "secure_checkout"
  | "us_support";

interface Bullet {
  key: BulletKey;
  icon:
    | "success"
    | "delivered"
    | "discount"
    | "calendar"
    | "star"
    | "gift"
    | "lock"
    | "chat";
  text: string;
}

const MEMBER_BULLETS: Bullet[] = [
  {
    key: "rangefinder_gift",
    icon: "gift",
    text: "Rangefinder welcome gift — yours to keep",
  },
  { key: "ships_7_days", icon: "delivered", text: "Ships in 7 days" },
  { key: "free_exchanges", icon: "success", text: "Free size exchanges" },
  {
    key: "cancel_after_q1",
    icon: "calendar",
    text: "Cancel anytime after your first quarter",
  },
  { key: "renew_rate", icon: "star", text: "96% of members renew" },
];

const ACCESS_BULLETS: Bullet[] = [
  {
    key: "annual_drops",
    icon: "star",
    text: "Annual access to member-only drops",
  },
  {
    key: "partner_discounts",
    icon: "discount",
    text: "Partner discounts on top golf brands",
  },
  { key: "cancel_anytime", icon: "calendar", text: "Cancel anytime" },
];

const GENERIC_BULLETS: Bullet[] = [
  { key: "secure_checkout", icon: "lock", text: "Secure checkout" },
  { key: "free_exchanges", icon: "success", text: "Free size exchanges" },
  { key: "us_support", icon: "chat", text: "US-based support" },
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

function pickBullets(variantIds: string[]): {
  bullets: Bullet[];
  heading: string;
} {
  if (variantIds.includes(RESERVE_MEMBER_VARIANT)) {
    return { bullets: MEMBER_BULLETS, heading: "Your Mully Member benefits" };
  }
  if (variantIds.includes(RESERVE_ACCESS_VARIANT)) {
    return { bullets: ACCESS_BULLETS, heading: "Your Mully Access benefits" };
  }
  return { bullets: GENERIC_BULLETS, heading: "What you can count on" };
}

function Extension() {
  const { lines } = useApi<"purchase.checkout.cart-line-list.render-after">();
  const cartLines = lines.current ?? [];

  const variantIds = cartLines
    .map((line) => variantIdFromGid(line.merchandise?.id))
    .filter((id): id is string => Boolean(id));

  const { bullets, heading } = pickBullets(variantIds);

  return (
    <View padding="base" border="base" cornerRadius="base">
      <BlockStack spacing="tight">
        <Text size="medium" emphasis="bold">
          {heading}
        </Text>
        <Divider />
        {bullets.map((bullet) => (
          <InlineStack key={bullet.key} spacing="tight" blockAlignment="center">
            <Icon source={bullet.icon} size="small" />
            <Text size="small">{bullet.text}</Text>
          </InlineStack>
        ))}
      </BlockStack>
    </View>
  );
}

export default reactExtension(
  "purchase.checkout.cart-line-list.render-after",
  () => <Extension />,
);
