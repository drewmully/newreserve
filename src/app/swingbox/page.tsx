import type { Metadata } from "next";
import SwingBoxGate from "./SwingBoxGate";

/**
 * /swingbox
 *
 * Private pitch page for a Swing Box collab with Irving Fryar Jr.
 * (@fryarfitnessgolf). Not linked from anywhere. Client-side password
 * gate ("demo") in front of a static visual mockup. No CTAs are wired
 * up — this is purely a visual for a creator pitch.
 *
 * When this either goes live or gets killed, delete the whole
 * src/app/swingbox/ directory and public/swingbox/.
 */

export const metadata: Metadata = {
  title: "The Swing Box — Preview",
  description: "Private preview.",
  robots: { index: false, follow: false, nocache: true },
};

export default function Page() {
  return <SwingBoxGate />;
}
