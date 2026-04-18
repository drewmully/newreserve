import { flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";

// Hero headline A/B test
export const heroHeadline = flag<"control" | "variant-a" | "variant-b">({
  key: "hero-headline",
  defaultValue: "control",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: process.env.FLAGS ? (vercelAdapter() as any) : undefined,
  decide() {
    return "control";
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: process.env.FLAGS ? (vercelAdapter() as any) : undefined,
  decide() {
    return "control";
  },
  options: [
    { value: "control", label: "Unlock Access" },
    { value: "variant-a", label: "Join Free" },
  ],
});
