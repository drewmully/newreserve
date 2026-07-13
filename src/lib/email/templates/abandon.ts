/**
 * Mully RESERVE post-checkout abandon recovery sequence.
 *
 * Triggered when a quiz-completed visitor reaches Shopify checkout
 * (`checkouts/create` webhook) but doesn't purchase. Halts the upstream
 * `reserve` acquisition nurture and switches to checkout-recovery copy —
 * recipient saw the price, started the form, and bailed. Different lever
 * than the upstream nurture: less "let me convince you," more "here's what's
 * waiting, take 90 seconds to finish."
 *
 * Halted by the Shopify orders/paid webhook via markProfilesConvertedByEmail
 * (which now matches `checkout_started` profiles too) + completeSequence.
 *
 * Tone (Drew's instructions, persistent):
 *   - Premium, never discount. Curation that rotates, no SKU guarantees.
 *   - Value anchor is $300+ retail for $250. Reassurance: free size exchanges,
 *     cancel after Q1. No welcome-gift promise (Founding 100 rangefinder
 *     retired 2026-07-13).
 *   - NEVER use "box" — use curation / edit / quarter / shipment / Reserve.
 */

import type { EmailTemplate } from "./types";

function hi(firstName: string | null, alt?: string): string {
  if (firstName) return `Hey ${firstName},`;
  return alt ?? "Hey there,";
}

const RESERVE_URL = "https://mymully.com/lp/subscription";

// Email 1 — ~1 hour after checkout_started: light touch, "you're almost there"
export const abandon_1: EmailTemplate = (firstName) => ({
  subject: firstName
    ? `${firstName}, your Reserve is held for you`
    : "Your Reserve is held for you",
  text: `${hi(firstName)}

Saw you started checkout on your Reserve. I'm holding the spot — quarters sell out, and yours is reserved while you finish.

A quick recap of what's on it:

- A quarter of curated apparel and accessories, picked to your style.
- $300+ in retail. You pay $250.
- Free size exchanges if a piece misses. Cancel anytime after the first quarter — no calls, no forms.
- Sizing locked in after checkout with a 60-second form. Nothing ships until I've got your fit right.

Finish here: ${RESERVE_URL}

Drew

P.S. If something held you up — sizing, timing, a question — just reply. I read every one.`,
});

// Email 2 — ~24h: answer the friction
export const abandon_2: EmailTemplate = (firstName) => ({
  subject: "Two things people usually ask",
  text: `${hi(firstName)}

If you're sitting on the checkout, it's usually one of two things. Let me knock both out.

1. "What if it doesn't fit?"
After checkout you fill a 60-second sizing form. Nothing ships until I've got your fit confirmed. If something arrives off, we swap it. No restocking fee, no fight.

2. "What if I want to skip a quarter?"
You can. Pause, skip, change frequency — all of it lives in your account. We don't trap anyone. 96% of members renew because the gear is good, not because the unsubscribe is hidden.

The first quarter is the proof. If Reserve isn't for you after it lands, cancel before Q2 — nothing sticky.

Pick up where you left off: ${RESERVE_URL}

Drew`,
});

// Email 3 — ~72h: last touch, "I'll let it go"
export const abandon_3: EmailTemplate = (firstName) => ({
  subject: "Letting your Reserve go",
  text: `${hi(firstName)}

I'm going to release your spot tomorrow so someone else can claim the quarter.

If you want to keep it, the edit's still here: ${RESERVE_URL}

If now's not the right time, that's fine — no follow-up after this. The quiz answers stay on file, and the $300+ retail-for-$250 quarter holds for the next opening if you come back.

Drew`,
});

export const ABANDON_TEMPLATES: EmailTemplate[] = [
  abandon_1,
  abandon_2,
  abandon_3,
];
