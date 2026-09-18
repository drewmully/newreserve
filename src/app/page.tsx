/**
 * Homepage — canonical Mully landing page.
 *
 * 2026-09-18: consolidated to a single winning surface. Previously `/`
 * redirected to /lp/consult, where a mr_ab cookie split traffic 50/50 between
 * modal_quiz and inline_quiz arms. Data over 30 days showed inline_quiz won
 * top-of-funnel decisively (session→CTA click 1.70% vs 0.97% for modal_quiz
 * and 1.17% for /lp/discover). Winner is now `/` for everyone; /lp/consult,
 * /lp/discover, /lp/subscription 301 to `/` in middleware. Modal-quiz arm
 * and the mr_ab bucket cookie are retired.
 *
 * The reveal step (/lp/reserve/reveal/{profileId}) has been rebuilt as a
 * tier picker (Discovery $50 first / Signature $125 first / Reserve $250)
 * so the final click carries the discount lever that made /lp/discover win
 * on reveal→CTA click rate (41.4%).
 */

import type { Metadata } from "next";
import ConsultQuizFirstClient from "./lp/consult/ConsultQuizFirstClient";

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

export default function Home() {
  return <ConsultQuizFirstClient />;
}
