/**
 * /lp/consult — DEPRECATED route (2026-09-18).
 *
 * Middleware 301s this path to `/`. This component exists as a defensive
 * fallback if middleware is bypassed (e.g. maintenance rewrites or config
 * regressions). It renders the same content as `/` — the inline-quiz LP
 * that won the 30-day A/B decisively.
 *
 * The prior modal_quiz arm and the mr_ab bucket cookie split have been
 * removed. ConsultLPClient.tsx (the modal-quiz arm) is dead code and safe
 * to delete once ad platforms and email campaigns are updated to point at
 * `/` directly.
 */

import type { Metadata } from "next";
import ConsultQuizFirstClient from "./ConsultQuizFirstClient";

export const metadata: Metadata = {
  title: "Mully — Personalized golf apparel, curated by hand",
  description:
    "Take the 60-second style quiz and see your quarterly picks before you commit. $250 / quarter, cancel after your first, 96% renewal.",
  openGraph: {
    title: "Mully — Personalized golf apparel, curated by hand",
    description:
      "Take the 60-second style quiz and see your quarterly picks before you commit. $250 / quarter, cancel after your first, 96% renewal.",
    images: ["/founders/martine-hero.webp"],
  },
};

export default function ConsultLPPage() {
  return <ConsultQuizFirstClient />;
}
