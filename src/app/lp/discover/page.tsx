/**
 * /lp/discover — DEPRECATED route (2026-09-18).
 *
 * Middleware 301s this path to `/`. Kept as a defensive fallback in case
 * middleware is bypassed. Renders the winning inline-quiz LP directly.
 *
 * The tier-picker mechanic that made /lp/discover win reveal→CTA click
 * rate has been relocated to the reveal page for ALL traffic, so no
 * discover-specific pre-quiz tier UI is served anymore. DiscoverLPClient
 * is dead code and safe to delete.
 */

import type { Metadata } from "next";
import ConsultQuizFirstClient from "../consult/ConsultQuizFirstClient";

export const metadata: Metadata = {
  title: "Mully — Personalized golf apparel, curated by hand",
  description:
    "Take the 60-second style quiz and see your quarterly picks before you commit. $250 / quarter, cancel after your first, 96% renewal.",
};

export default function DiscoverPage() {
  return <ConsultQuizFirstClient />;
}
