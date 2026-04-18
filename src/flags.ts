import { flag, dedupe } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";

/**
 * Cookie-based random assignment.
 * Reads a visitor bucket from the `mr_ab` cookie (0-99).
 * If the cookie doesn't exist yet, a random bucket is assigned via
 * the middleware (see middleware.ts) so every visitor gets a sticky bucket.
 */
const identify = dedupe(async ({ cookies }: { cookies: { get: (name: string) => { value: string } | undefined } }) => {
  const raw = cookies.get("mr_ab")?.value;
  const bucket = raw !== undefined ? parseInt(raw, 10) : Math.floor(Math.random() * 100);
  return { visitor: { bucket } };
});

// Hero headline A/B test
export const heroHeadline = flag<"control" | "variant-a" | "variant-b">({
  key: "hero-headline",
  defaultValue: "control",
  identify,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: process.env.FLAGS ? (vercelAdapter() as any) : undefined,
  decide({ entities }) {
    const bucket = entities?.visitor?.bucket ?? 0;
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
    const bucket = entities?.visitor?.bucket ?? 0;
    return bucket < 50 ? "control" : "variant-a";
  },
  options: [
    { value: "control", label: "Unlock Access" },
    { value: "variant-a", label: "Join Free" },
  ],
});
