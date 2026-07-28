/**
 * /lp/consult
 *
 * Direct-response landing page whose single goal is a phone-number opt-in.
 * The offer: a free style consult from Martine, Mully's head stylist,
 * delivered over text. If they become a Reserve or Access member, Drew
 * manually applies a $50 Pro Shop credit to their account.
 *
 * Why this page exists:
 *   SMS-consent capture at Shopify checkout is rare. This LP is the
 *   dedicated top-of-funnel path for the mully-sms-agent Martine flow.
 *   Every submission triggers /api/consult, which registers the SMS
 *   marketing consent on Shopify AND fires an enroll webhook to the
 *   mully-sms-agent (segment=consult_landing), which sends the first
 *   two Martine messages within ~90 seconds.
 *
 * Design system:
 *   Reuses the /lp/subscription palette (bone/forest/ember/charcoal +
 *   font-serif). Reuses ReviewsBlock for Junip social proof. The Martine
 *   card mirrors the CuratorStrip pattern from Reserve.
 *
 * Mobile-first: the hero form is inline (no scroll to CTA), touch
 * targets 48px+, phone input uses inputmode/autocomplete for OS auto-fill.
 * No modals, no interstitials.
 *
 * Voice rules (from mully-sales-playbook):
 *   No "box." No "Mullybox." Reserve is $250. No em dashes. No
 *   "elevate your game," "next level," "premium quality." Lead with
 *   the concrete fact.
 */

import type { Metadata } from "next";
import { cookies } from "next/headers";
import ConsultLPClient from "./ConsultLPClient";
import ConsultQuizFirstClient from "./ConsultQuizFirstClient";

export const metadata: Metadata = {
  title: "Free style consult with Martine — Mully",
  description:
    "Martine, head stylist at Mully, will text you personally to build your profile and hand-pick a few pieces worth looking at. $50 Pro Shop credit reserved for Mully members.",
  openGraph: {
    title: "Free style consult with Martine — Mully",
    description:
      "A personal text conversation with Martine, head stylist at Mully. Build your profile, get hand-picked recommendations, $50 Pro Shop credit as a member.",
    images: ["/founders/martine-hero.webp"],
  },
};

export default async function ConsultLPPage() {
  // A/B bucket for the phone-gated vs quiz-first split. Middleware sets
  // `mr_ab` (0..99) on first visit, so by the time we render this page it's
  // guaranteed to exist. Reading it server-side keeps the initial paint on
  // the correct arm and avoids a client-side flip.
  //
  //   0..49  → phone_gated (ConsultLPClient: hero + CTA → Step-0 modal → quiz)
  //   50..99 → quiz_first  (ConsultQuizFirstClient: quiz inline as the hero,
  //                          no modal, no phone collection anywhere)
  //
  // Both arms complete at the same reveal brick (/lp/reserve/reveal/{id})
  // and fire lp_consult_view stamped with `variant` so PostHog can split
  // funnels without a second event name.
  const store = await cookies();
  const raw = store.get("mr_ab")?.value;
  const bucket = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  if (bucket !== null && bucket >= 50) {
    return <ConsultQuizFirstClient />;
  }
  return <ConsultLPClient variant="phone_gated" />;
}
