/**
 * Order-level Take a Shot redemption props for the server-side "purchase"
 * event (orders-paid webhook > PostHog). Klaviyo's Placed Order is
 * Shopify-native and cannot carry these.
 *
 * line_type: "reserve" when every line is a Reserve plan, "retail" when none
 * is, "mixed" otherwise. is_reserve: any Reserve line on the order.
 */
import { resolveMemberTierFromVariantId } from "@/lib/membershipConfig";
import { CODE_RULES } from "./config";

const SHOT_CODE = new RegExp(`^${CODE_RULES.prefix}\\d{1,2}-[A-Z0-9]{4,12}$`, "i");

export type RedemptionProps = {
  take_a_shot_code: string | null;
  take_a_shot_percent: number | null;
  is_reserve: boolean;
  line_type: "retail" | "reserve" | "mixed" | null;
};

export function takeAShotRedemption(order: {
  discount_codes?: { code?: string | null }[] | null;
  line_items?: { variant_id?: number | string | null }[] | null;
}): RedemptionProps {
  const code = (order.discount_codes ?? []).map((d) => String(d?.code ?? "").trim()).find((c) => SHOT_CODE.test(c)) ?? null;
  const lines = order.line_items ?? [];
  const reserveLines = lines.filter((l) => resolveMemberTierFromVariantId(l.variant_id) !== null).length;
  const line_type = !lines.length ? null : reserveLines === lines.length ? "reserve" : reserveLines ? "mixed" : "retail";
  const pct = code ? Number(code.slice(CODE_RULES.prefix.length).split("-")[0]) : NaN;
  return {
    take_a_shot_code: code ? code.toUpperCase() : null,
    take_a_shot_percent: Number.isFinite(pct) ? pct : null,
    is_reserve: reserveLines > 0,
    line_type,
  };
}
