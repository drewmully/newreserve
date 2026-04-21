import { flag, dedupe } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";
import { getFlagOverrides } from "./lib/flagOverrides";

/**
 * Cookie-based random assignment with override support.
 *
 * Reads a visitor bucket from the `mr_ab` cookie (0-99). If the cookie doesn't
 * exist yet, a random bucket is assigned via middleware so every visitor gets
 * a sticky bucket.
 *
 * On every flag read we also load the `flag_overrides` map from Supabase. If a
 * winning variant has been declared for the flag key, we return that instead
 * of the cookie-bucket value. This lets Drew (or the CRO cron) promote a winner
 * without a redeploy. The override map is cached for 60s at the module level.
 */
const identify = dedupe(
  async ({ cookies }: { cookies: { get: (name: string) => { value: string } | undefined } }) => {
    const raw = cookies.get("mr_ab")?.value;
    const bucket =
      raw !== undefined ? parseInt(raw, 10) : Math.floor(Math.random() * 100);
    const overrides = await getFlagOverrides();
    return { visitor: { bucket }, overrides };
  },
);

// Hero headline A/B test
export const heroHeadline = flag<"control" | "variant-a" | "variant-b">({
  key: "hero-headline",
  defaultValue: "control",
  identify,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: process.env.FLAGS ? (vercelAdapter() as any) : undefined,
  decide({ entities }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = entities as any;
    const forced = e?.overrides?.["hero-headline"];
    if (forced === "control" || forced === "variant-a" || forced === "variant-b") {
      return forced;
    }
    const bucket = e?.visitor?.bucket ?? 0;
    if (bucket < 34) return "control";
    if (bucket < 67) return "variant-a";
    return "variant-b";
  },
  options: [
    { value: "control", label: "Premium Golf. Members-Only Pricing." },
    {
      value: "variant-a",
      label: "The Golf Gear You Want. The Price You Deserve.",
    },
    {
      value: "variant-b",
      label: "Premium Gear. Insider Pricing. No Initiation Fee.",
    },
  ],
});

// Hero CTA text A/B test
export const heroCta = flag<"control" | "variant-a">({
  key: "hero-cta",
  defaultValue: "control",
  identify,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: process.env.FLAGS ? (vercelAdapter() as any) : undefined,
  decide({ entities }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = entities as any;
    const forced = e?.overrides?.["hero-cta"];
    if (forced === "control" || forced === "variant-a") return forced;
    const bucket = e?.visitor?.bucket ?? 0;
    return bucket < 50 ? "control" : "variant-a";
  },
  options: [
    { value: "control", label: "Unlock Access" },
    { value: "variant-a", label: "Join Free" },
  ],
});
