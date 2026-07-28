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
  /** Consolidated hero subcopy paragraph. */
  subheader: string;
  /** Primary CTA button label. */
  ctaLabel: string;
}

export const HERO_PERSONAS: readonly Persona[] = [
  {
    key: "casual",
    tab: "Myself · casual",
    subheader:
      "A quarterly edit of premium apparel, handpicked for your game. No two edits are the same. Ships within 1 business day. Cancel anytime.",
    ctaLabel: "Get Started · 60s",
  },
  {
    key: "serious",
    tab: "Myself · serious",
    subheader:
      "For the guy who plays 36 on Saturdays. Every quarter our team pulls 4 to 6 pieces from Greyson, Rhone, and 20+ brands. Ships within 1 business day. Cancel anytime.",
    ctaLabel: "Build my edit · 60s",
  },
  {
    key: "gift",
    tab: "A gift",
    subheader:
      "The move for the golfer who has everything. Pick a shirt size, add a note, and we'll ship the first edit within 1 business day. Cancel anytime.",
    ctaLabel: "Gift a quarter →",
  },
] as const;
