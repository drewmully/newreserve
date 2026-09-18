/**
 * /lp/subscription — DEPRECATED route (2026-09-18).
 *
 * Middleware 301s this path to `/`. Kept as a defensive fallback if
 * middleware is bypassed. Renders the winning inline-quiz LP directly.
 *
 * SubscriptionLPClient is dead code and safe to delete once inbound
 * links (email templates, /shop cross-sells) are updated. Keeping the
 * file for one deploy cycle so imports don't break.
 */

import type { Metadata } from "next";
import ConsultQuizFirstClient from "../consult/ConsultQuizFirstClient";

export const metadata: Metadata = {
  title: "Mully — Personalized golf apparel, curated by hand",
  description:
    "Take the 60-second style quiz and see your quarterly picks before you commit. $250 / quarter, cancel after your first, 96% renewal.",
};

export default function SubscriptionPage() {
  return <ConsultQuizFirstClient />;
}
