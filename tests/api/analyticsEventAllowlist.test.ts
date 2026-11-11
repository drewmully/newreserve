import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * trackEvent() posts to /api/analytics/track, which answers 400 for any
 * event name missing from VALID_EVENTS, and trackEvent swallows the error.
 * That is how mully100_card_click went missing. This guard fails when a new
 * trackEvent("name") call lands without an allowlist entry.
 */
const ROOT = join(__dirname, "..", "..");
const route = readFileSync(join(ROOT, "src/app/api/analytics/track/route.ts"), "utf8");
const block = route.match(/const VALID_EVENTS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
const allowlist = new Set([...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]));
// Klaviyo-only lane events (route answers 200 when the lane is enabled).
const siteEvents = readFileSync(join(ROOT, "src/lib/klaviyo/siteEvents.ts"), "utf8");
const klaviyoOnlyBlock = siteEvents.match(/KLAVIYO_ONLY_EVENTS = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
for (const m of klaviyoOnlyBlock.matchAll(/"([a-z0-9_]+)"/g)) allowlist.add(m[1]);

// Pre-existing misses, reported to the owner and left out of this change.
const KNOWN_MISSING = new Set([
  "editorial_access_upsell_clicked", "editorial_access_upsell_dismissed", "editorial_add_to_cart",
  "editorial_card_click", "editorial_category_filter", "editorial_curated_shipments_click",
  "editorial_promoted_click", "editorial_read_more_toggle", "first_box_sized",
  "legacy_loop_login_provisioned", "lp_discover_closing_quiz_tapped",
  "magic_link_sent", "mully100_category_filter", "password_set", "profile_nudge_pick_plan_clicked",
  "proshop_back_in_stock_request", "shop_curated_shipments_click", "shop_outfit_reserve_clicked",
  "sponsorship_link_copied", "sponsorship_link_shared", "welcome_banner_dismissed",
  "curator_video_opened", "gift_checkout_initiated", "gift_modal_opened", "mini_quiz_completed",
  "mini_quiz_started",
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("analytics event allowlist", () => {
  it("accepts the pdp_complete_look events and mully100_card_click", () => {
    for (const e of [
      "complete_look_view", "complete_look_add", "cart_bogo_line_view", "cart_bogo_suggestion_add",
      "mully100_card_click", "bogo_nudge_viewed", "bogo_pick_opened", "bogo_pick_added",
      "first_order_shipping_revealed", "newsletter_signup", "reserve_added_to_cart",
      "pdp_gallery_swipe", "pdp_image_zoom",
    ]) expect(allowlist.has(e), e).toBe(true);
  });

  it("covers every trackEvent name used in src (no new silent drops)", () => {
    const used = new Set<string>();
    for (const f of files(join(ROOT, "src"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/trackEvent\(\s*"([a-z0-9_]+)"/g)) used.add(m[1]);
    }
    const missing = [...used].filter((e) => !allowlist.has(e) && !KNOWN_MISSING.has(e)).sort();
    expect(missing).toEqual([]);
  });
});
