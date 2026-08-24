import type { Metadata } from "next";
import SwingBoxLanding from "./SwingBoxLanding";

/**
 * /swingbox
 *
 * Public pre-sale landing page for The Swing Box (Founding 100 cohort)
 * with Irving Fryar Jr. (@fryarfitnessgolf). Ships October. Community
 * kicks off the same month. First 100 members lock the founding rate
 * for life; price steps up 15% once the cohort fills.
 */

export const metadata: Metadata = {
  title: "The Swing Box: Founding 100 Pre-Sale",
  description:
    "Offseason mobility for golfers, led by Irving Fryar Jr. Ships October. Founding 100 members lock the rate for life.",
};

export default function Page() {
  return <SwingBoxLanding />;
}
