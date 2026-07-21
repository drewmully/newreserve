/**
 * Hero persona content shared by /lp/subscription and /lp/consult.
 *
 * Selecting a persona tab swaps the hero subheader, a one-line social-proof
 * stat, and the primary CTA label. The `gift` persona additionally routes the
 * CTA to the gift modal instead of the standard quiz launcher.
 */

export type PersonaKey = "casual" | "serious" | "gift";

export interface Persona {
  key: PersonaKey;
  /** Short tab label. */
  tab: string;
  /** Hero subheader copy. */
  subheader: string;
  /** Single-line social-proof callout under the subheader. */
  stat: string;
  /** Primary CTA button label. */
  ctaLabel: string;
}

export const HERO_PERSONAS: readonly Persona[] = [
  {
    key: "casual",
    tab: "Casual Golfer",
    subheader:
      "A quarterly edit of premium apparel, handpicked for your game. No two edits are the same. Get started if you want to be the most dialed in player in your clubhouse.",
    stat: "96% of members renew after their first quarter.",
    ctaLabel: "Get Started · 60s",
  },
  {
    key: "serious",
    tab: "Serious Player",
    subheader:
      "For the guy who plays 36 on Saturdays. Every quarter our team pulls 4 to 6 pieces from Greyson, Rhone, and 20+ brands to keep your rotation fresh.",
    stat: "Members average 18 to 24 new pieces a year.",
    ctaLabel: "Build my edit · 60s",
  },
  {
    key: "gift",
    tab: "Gift for a Golfer",
    subheader:
      "The move for the golfer who has everything. Pick a shirt size, add a note, and we ship the first edit within 1 business day.",
    stat: "Ships in 1 business day. Cancel anytime.",
    ctaLabel: "Gift a quarter →",
  },
] as const;
