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

export default async function ConsultLPPage({
  searchParams,
}: {
  searchParams?: Promise<{ arm?: string }>;
}) {
  // A/B bucket for the modal-quiz vs inline-quiz split. Middleware sets
  // `mr_ab` (0..99) on first visit, so by the time we render this page it's
  // guaranteed to exist. Reading it server-side keeps the initial paint on
  // the correct arm and avoids a client-side flip.
  //
  //   0..49  → modal_quiz  (ConsultLPClient: full editorial LP + sticky
  //                        opens the modal quiz)
  //   50..99 → inline_quiz (ConsultQuizFirstClient: quiz inline as the hero)
  //
  // Neither arm collects a phone number — the outcome measures modal vs
  // inline as the quiz container. Both arms complete at the same reveal
  // brick (/lp/reserve/reveal/{id}) and fire lp_consult_view stamped with
  // `variant` so PostHog can split funnels without a second event name.
  //
  // QA / manual override: appending ?arm=modal_quiz or ?arm=inline_quiz to
  // the URL forces that arm for this request (does NOT mutate the mr_ab
  // cookie). Non-matching values are ignored. Useful for previewing an arm
  // on a device already bucketed to the other side.
  const params = (await searchParams) ?? {};
  const override =
    params.arm === "modal_quiz" || params.arm === "inline_quiz"
      ? params.arm
      : null;

  const store = await cookies();
  const raw = store.get("mr_ab")?.value;
  const bucket = raw && /^\d+$/.test(raw) ? Number(raw) : null;

  const arm =
    override ??
    (bucket !== null && bucket >= 50 ? "inline_quiz" : "modal_quiz");

  if (arm === "inline_quiz") {
    return <ConsultQuizFirstClient />;
  }
  return <ConsultLPClient variant="modal_quiz" />;
}
