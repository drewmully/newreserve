/**
 * Style profile types for the Mully Reserve acquisition funnel.
 *
 * A `styleProfiles` doc is created when a visitor starts the pre-checkout
 * style quiz on the LP. Persisted progressively (per step) so partials are
 * recoverable and can be resumed. Lifecycle is separate from `users` /
 * `orders` — most docs will never convert and live in this collection until
 * an abandonment nudge has been sent (or never, if no email was captured).
 *
 * Engine integration:
 *   - On status='completed' the quiz API starts the `reserve` email flow in
 *     the existing `email_sequences` engine (see src/lib/email/sequences.ts).
 *   - On Shopify orders/paid webhook the matching profile (by lowercase email)
 *     flips to status='converted', the reserve sequence is force-completed,
 *     and the standard `member` onboarding flow takes over.
 */

import type { Timestamp } from "firebase-admin/firestore";

export type StyleBucket = "classic" | "modern" | "bold" | "quiet";

export type ProfileStatus =
  | "started"      // quiz_started fired; first answer saved
  | "completed"    // all required questions answered + email captured + consent
  | "abandoned"    // email captured but quiz not completed within 24h
  | "converted";   // matched to a Shopify order (orders-paid webhook)

export type FitPreference = "tailored" | "regular" | "relaxed";

export type CategoryPref =
  | "polos"
  | "layers"
  | "shorts_pants"
  | "outerwear"
  | "accessories";

export type PlayFrequency =
  | "weekly_plus"
  | "weekly"
  | "monthly"
  | "occasional";

/**
 * Source-of-truth shape stored in Firestore. Indexed fields are noted —
 * see firestore.indexes.json for the composite indexes the nurture cron
 * relies on.
 */
export interface StyleProfileDoc {
  profileId: string;
  /** Lowercased, trimmed. Optional until email-gate step. INDEXED. */
  email: string | null;
  /** Pre-email anonymous client id (cookie). Lets us merge if email arrives later. */
  anonId: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;

  styleBucket: StyleBucket | null;

  answers: {
    golfStyle: StyleBucket | null;
    categoryPrefs: CategoryPref[];
    fit: FitPreference | null;
    /** Free-text size labels — we don't validate against a size chart here;
     *  the post-checkout sizing form is the canonical source. */
    topSize: string | null;
    bottomSize: string | null;
    favoriteBrands: string[];
    playFrequency: PlayFrequency | null;
  };

  /** INDEXED (composite with nurtureStage). */
  status: ProfileStatus;
  emailCaptured: boolean;
  /** Explicit marketing-consent checkbox at the email gate. */
  consent: boolean;

  utm: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    content: string | null;
    term: string | null;
    gclid: string | null;
    referrer: string | null;
    landingPath: string | null;
  };

  /** Mirrors the email_sequences engine's lastSentStep for the `reserve` flow.
   *  Kept here so the admin/funnel views can render without joining. */
  nurtureStage: number;
  lastEmailedAt: Timestamp | null;

  shopifyOrderId: string | null;
  convertedAt: Timestamp | null;

  /** Set when the abandon-quiz nudge has been queued. Prevents double-nudges. */
  abandonNudgeSentAt: Timestamp | null;
}

export type StyleProfileInput = Partial<
  Omit<StyleProfileDoc, "createdAt" | "updatedAt" | "profileId">
>;

// ─── Bucket helpers ──────────────────────────────────────────────────────────

export const STYLE_BUCKETS: StyleBucket[] = ["classic", "modern", "bold", "quiet"];

export const STYLE_BUCKET_LABELS: Record<StyleBucket, string> = {
  classic: "Classic",
  modern: "Modern / Athletic",
  bold: "Bold / Statement",
  quiet: "Quiet / Understated",
};

/**
 * Short human prose used in personalized reveal + email hero copy.
 * Edit these once → it shows up everywhere.
 */
export const STYLE_BUCKET_VOICE: Record<StyleBucket, { headline: string; oneLiner: string }> = {
  classic: {
    headline: "Timeless, sharp, never trying too hard.",
    oneLiner:
      "Pieces that look right at every club and every age — the way golf style is supposed to look.",
  },
  modern: {
    headline: "Performance fabrics, clean silhouettes.",
    oneLiner:
      "Built to move. Tech materials, athletic cuts, current without chasing trends.",
  },
  bold: {
    headline: "A little louder. On purpose.",
    oneLiner:
      "Statement pieces and unexpected color — for the guy who'd rather be remembered than blend in.",
  },
  quiet: {
    headline: "Understated, considered, well-made.",
    oneLiner:
      "No logos screaming. Better fabrics, cleaner lines — confidence over decoration.",
  },
};
