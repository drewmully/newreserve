/**
 * Mully RESERVE acquisition nurture sequence.
 *
 * Triggered when a visitor completes the pre-checkout style quiz with email
 * consent AND is not already an active subscriber. Goal: convert quiz finishers
 * into a $250/qtr Reserve members within ~10 days.
 *
 * Tone (Drew's instructions, verbatim):
 *   - Premium gift-led, NEVER discounted.
 *   - "Have a guy who handles your golf wardrobe."
 *   - 96% renewal, $300+ value for $250, rangefinder welcome gift yours-to-keep.
 *   - Audience: man 35+, doesn't read fluff. Short. Visual. Load-bearing words only.
 *
 * Plain text — Resend's link rewriter handles attribution UTMs automatically
 * (utm_campaign=flow_reserve via the engine's `tags` array; we add
 * utm_content=step_N).
 */

import type { EmailTemplate, EmailTemplateContext } from "./types";

function hi(firstName: string | null, alt?: string): string {
  if (firstName) return `Hey ${firstName},`;
  return alt ?? "Hey there,";
}

// Generic LP — fallback only when a recipient somehow has no profileId.
// Real recipients land on their personalized reveal page (see revealUrl).
const RESERVE_URL_FALLBACK = "https://mymully.com/lp/subscription";
const REVEAL_BASE = "https://mymully.com/lp/reserve/reveal";
const REVIEWS_LINE = "Renewal rate: 96%. The members who get one almost never leave.";

/**
 * Builds the per-recipient "see your edit" link.
 *
 * Resend's link-rewriter will already stamp utm_campaign=flow_reserve and
 * utm_content=step_N from the engine's tags (see sequences.ts). We add
 * `attributed=email` as a stable, click-side marker so the reveal page's
 * client-side analytics can show "this view came from your nurture email"
 * independent of any UTM stripping by inbox proxies.
 */
function revealUrl(ctx: EmailTemplateContext | undefined): string {
  if (!ctx?.profileId) return RESERVE_URL_FALLBACK;
  return `${REVEAL_BASE}/${ctx.profileId}?attributed=email`;
}

// Email 1 — Immediate: reveal + gift offer (sent within ~1 hour of quiz complete)
export const reserve_1: EmailTemplate = (firstName, ctx) => ({
  subject: firstName
    ? `${firstName}, your Reserve edit is ready`
    : "Your Reserve edit is ready",
  text: `${hi(firstName)}

Based on your answers, I pulled a quarter's worth of pieces together for you. Two apparel picks, two accessories, and a rangefinder I'm including as a welcome gift.

You can see the edit here: ${revealUrl(ctx)}

A few things worth knowing:

- $300+ in retail. You pay $250.
- The rangefinder is yours to keep. Even if you cancel after the first quarter.
- Sizing is confirmed after checkout with a 60-second form. Nothing ships until I've got your fit right.

Reserve is quarterly. One ship, one charge, no surprises. We sell out every quarter, which is why I'm walking people through one at a time.

Take a look. I'm around if you have questions — just reply to this email.

Drew

P.S. ${REVIEWS_LINE}`,
});

// Email 2 — ~36h: care + service proof
export const reserve_2: EmailTemplate = (firstName, ctx) => ({
  subject: "How Reserve actually works",
  text: `${hi(firstName)}

Two questions I get a lot, so I'll just answer them up front.

1. "Do I have any say in what I get?"
Yes. After you join, we confirm sizing and walk through your preferences. The edit is curated FOR you — not pushed at you. If something isn't right, we swap it. No drama.

2. "What if I want to skip a quarter?"
You can. Pause, skip, change frequency — all of it lives in your account. We don't trap anyone. The reason 96% of members renew is because the gear is good, not because the unsubscribe button is hidden.

The first quarter is the proof. The rangefinder welcome gift is yours either way.

Your edit's still here: ${revealUrl(ctx)}

Drew`,
});

// Email 3 — ~5 days: value math, $300 for $250
export const reserve_3: EmailTemplate = (firstName, ctx) => ({
  subject: "$300 worth, $250 in",
  text: `${hi(firstName)}

The math on Reserve isn't complicated.

You pay $250 a quarter. The pieces inside are typically $300+ at retail, sourced directly from the brands. The first quarter also ships with a rangefinder welcome gift on top — yours to keep even if you cancel.

It's not a discount play. It's a curation play. You're paying for someone who actually knows the brands, the fabrics, and what works on a course versus what just looks good on Instagram, to do the work for you.

Most of our members tell me the same thing: they stopped browsing for golf clothes. The good stuff just shows up.

Your edit: ${revealUrl(ctx)}

Drew

P.S. If you'd rather just see the four pieces I picked for you, that page above shows the whole edit before you commit to anything.`,
});

// Email 4 — ~9 days: positioning + final gift reminder
export const reserve_4: EmailTemplate = (firstName, ctx) => ({
  subject: "The guy who handles your golf wardrobe",
  text: `${hi(firstName)}

A friend of mine put it this way last summer:

"Every guy with taste eventually has a guy. A guy who handles his suits. A guy who handles his car. Reserve is the guy who handles your golf wardrobe."

That's it. That's the whole thing.

You walk into the season looking sharp without having scrolled through twelve brand sites or guessed at sizing. You get gear you'd have picked for yourself, if you had the time. And once a quarter, a new edit shows up.

I built Reserve for the guy who's tired of doing this himself.

If that's you, the edit I pulled is still here: ${revealUrl(ctx)}

The rangefinder welcome gift goes with the first quarter. After that, this email goes quiet — you'll only hear from me if something changes.

Drew`,
});

export const RESERVE_TEMPLATES: EmailTemplate[] = [
  reserve_1,
  reserve_2,
  reserve_3,
  reserve_4,
];

// One-off abandon-quiz nudge — NOT part of the FLOW_STEPS array. Sent ad-hoc
// by the abandon-nudge cron when a visitor captured email but didn't finish.
//
// This one intentionally points at the generic LP — by definition the visitor
// didn't finish the quiz so there's no profileId / no edit to show yet.
export const reserve_abandon: EmailTemplate = (firstName) => ({
  subject: firstName ? `${firstName}, want me to finish your edit?` : "Want me to finish your edit?",
  text: `${hi(firstName)}

You got partway through the style quiz earlier but didn't finish. No pressure — I just need a couple more answers to actually put your Reserve edit together.

Picks up where you left off, takes about 30 seconds:
${RESERVE_URL_FALLBACK}

The rangefinder welcome gift is still on the table if you decide Reserve is for you.

Drew`,
});
