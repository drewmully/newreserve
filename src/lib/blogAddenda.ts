/**
 * Code-level additions to Supabase Journal posts (SEO tasks s06, s07, s09).
 * Kept in the repo so every change is a reviewable, revertible PR and the
 * live blog_posts rows stay untouched.
 *
 * Paragraph text supports one inline syntax: [label](/internal-path).
 * Only same-site paths starting with "/" become links.
 */
import type { BlogSection } from "@/app/blog/posts";

export type BlogAddendum =
  /** Append paragraphs to the end of an existing section, matched by heading. */
  | { kind: "append"; heading: string; paragraphs: string[] }
  /** Insert a new section after an existing heading (or at the end if null). */
  | { kind: "section"; after: string | null; section: BlogSection }
  /** Replace every paragraph of an existing section, matched by heading. */
  | { kind: "replace"; heading: string; paragraphs: string[] };

/** Post-level text overrides (intro, highlights, closing) for stale Supabase copy. */
export interface BlogPostOverride {
  intro?: string;
  highlights?: string[];
  closing?: string;
}

export const BLOG_ADDENDA: Record<string, BlogAddendum[]> = {
  // s09: answer "brands like peter millar" in the Greyson vs. Peter Millar post.
  // Every brand below is carried in the Mully Shop; copy is drawn from each PDP.
  "greyson-vs-peter-millar-golf-comparison": [
    {
      kind: "section",
      after: "On-Course Performance",
      section: {
        heading: "Brands like Peter Millar",
        paragraphs: [
          "Peter Millar's appeal is a polo that looks as right in the dining room as it does on the first tee. These brands, all carried in the [Mully Shop](/shop), cover the same ground from different angles.",
          "Rhone: The [Commuter Polo](/shop/rhone-commuter-polo) pairs four-way stretch with a wrinkle-releasing finish and a hidden-button collar. It is cut slim, closer to Crown Crafted than to Summer Comfort.",
          "Sloat: The [Merino Polo](/shop/sloat-merino-polo) is 200 gsm RWS-certified merino jersey sewn in Portugal. It is a natural-fiber answer to Peter Millar's performance jersey, with a soft drape that regulates temperature through a full round.",
          "Olydoe: The [OG Supima Hollow Polo](/shop/olydoe-og-supima-hollow-polo) uses American-grown Supima cotton with a hollow yarn that lets moisture move through. Softly structured, with fine stripes, for the golfer who wants cotton over synthetics.",
          "Technically Golf: The [Performance Polo](/shop/technically-golf-performance-polo) is lightweight nylon-spandex piqué with permanent collar stays, so the collar holds its shape from the first tee to the 19th hole.",
          "Quiet Golf: The [Remy Polo](/shop/quiet-golf-remy-polo-active-pique) is a 96% polyester, 4% spandex active piqué with a three-button collar and shell buttons. It is the closest match here to Peter Millar's poly-spandex stretch.",
          "Duck Head: The [Gold School Chino](/shop/duckhead-classic-fit-gold-school-chino-khaki) comes in a classic fit with your choice of waist and inseam, in khaki. It is the pant to wear with any of the polos above.",
        ],
      },
    },
    // s10: gift guide link.
    {
      kind: "append",
      heading: "Brands like Peter Millar",
      paragraphs: ["Shopping for a Peter Millar fan? The chino and several of these brands are in our [golf gifts for men](/shop/gifts), sorted by price."],
    },
  ],
  // s07: answer "golf mystery box" in the subscription comparison post.
  // Price intentionally links to /subscription (no hard-coded prices).
  "best-golf-subscription-boxes-2026-compared": [
    // 2026-11-11: retire "Mully Box" naming and old Reserve prices
    // ($125 / $94.99 per quarter, "$400+ saved", "starts free"). Pricing
    // links to /subscription instead of being hard-coded.
    {
      kind: "replace",
      heading: "Mully Reserve",
      paragraphs: [
        "Mully Reserve is structured differently from the other four. It is a styling subscription, not a blind box. You take a short style quiz on fit, sizing and the brands you already wear, and a Mully stylist builds a quarterly edit of 4 to 6 pieces from 20+ premium brands, including Greyson, Rhone, Quiet Golf, Field Day and Penfold. You see your picks before you commit, sizing is confirmed before anything ships, and you can cancel after your first quarter. Current plan pricing lives on the [Mully Reserve page](/subscription).",
        "The core value proposition is curation, not randomness. Members are not receiving clearance inventory from brands that need to move product. Every piece is chosen for your fit and the way you play, and if a size misses, we exchange it. This is the closest model to what Huckberry built in outdoor lifestyle: taste-forward curation from a curated set of brands. Best for: the golfer who cares about brand quality and wants to spend on gear he would have bought anyway, just less of it.",
      ],
    },
    {
      kind: "replace",
      heading: "Golfer's Box (Inside the Leather)",
      paragraphs: [
        "Inside the Leather offers three tiers: the Par Box, Gimme Box, and Eagle Box, with monthly or quarterly options starting around $75. The service positions itself on variety: each box includes a curated selection of golf gear, gadgets, accessories, and some apparel. The appeal is breadth. You might get a training aid, a new range finder pouch, branded socks, and a polo in the same box.",
        "The limitation is also breadth. When a box is trying to be everything, it rarely excels at any single category. The brands in the box are competent but not the premium labels that golfers with specific taste are seeking. Customer service has generally been well-reviewed, which puts it ahead of ShortPar4 in reliability. Best for: golfers who enjoy the surprise element and want a mix of gear and gadgets rather than a purely apparel-focused membership.",
        "The honest summary: if brand quality is the deciding factor, Mully Reserve is not close competition for the others on this list: it is a different category. Golfers who want a stylist-picked edit from brands like Greyson, Rhone and Quiet Golf, fitted to their size, have one clear option.",
      ],
    },
    {
      kind: "section",
      after: "Golfer's Box (Inside the Leather)",
      section: {
        heading: "The Golf Mystery Box, Explained",
        paragraphs: [
          "A golf mystery box ships a surprise assortment of apparel and gear chosen with nothing more than your size. The reveal is the fun part. The catch is the hit rate: a polo in a color you would never pick still counts toward the box value, and past-season stock is how most mystery boxes keep that number high.",
          "Mully Reserve runs the other way. It is a quarterly box: one curated shipment each season. A stylist picks every piece after a short style quiz on fit, sizing and the brands you already wear, and your fit is confirmed before anything ships. The surprise is the brand you had not tried yet, not whether the polo fits.",
          "Current plan pricing lives on the [Mully Reserve page](/subscription).",
          // s10: gift guide link.
          "Buying for a golfer instead of yourself? Our [golf gifts for men](/shop/gifts) are picked by Mully and sorted by price.",
          // Gift a Season: subscription-gift intent.
          "Want to give Reserve itself? [Gift a Season](/lp/gift-season) is a one-time prepaid golf gift subscription: 1, 2 or 4 seasons in his sizes, and it never renews.",
        ],
      },
    },
  ],
  // s10: gift guide links in the polo, layering and belt posts.
  "best-golf-polos-2026-quiet-golf-rhone": [
    {
      kind: "append",
      heading: "The Reserve ranking: the three-piece polo lineup I would buy",
      paragraphs: ["Polos are a summer gift. For December, our [golf gifts for men](/shop/gifts) lean on long sleeve polos, vests and quarter zips."],
    },
  ],
  "golf-quarter-zip-vs-hoodie": [
    {
      kind: "append",
      heading: "When a quarter zip is the right answer",
      paragraphs: ["A quarter zip is also one of the safest gifts for a golfer, and our [golf gifts for men](/shop/gifts) carry them from Rhone, Olydoe and Sloat."],
    },
    // 2026-11-11: category page link (collection SEO).
    {
      kind: "append",
      heading: "When a quarter zip is the right answer",
      paragraphs: ["Every quarter-zip and half-zip we carry, with in-stock sizes first, is on one page: [golf quarter-zips for men](/shop/quarter-zips)."],
    },
  ],
  // 2026-11-11: category page links (collection SEO).
  "golf-capsule-wardrobe-12-essential-pieces": [
    {
      kind: "append",
      heading: "The Outer Layer: Quarter-Zip and Vest",
      paragraphs: ["Shop the layer from what is in stock now: [golf vests for men](/shop/vests) in down, quilted and merino, and [golf quarter-zips](/shop/quarter-zips) from Rhone, Olydoe and Technically Golf."],
    },
  ],
  "major-week-layering-system-golf-2026": [
    {
      kind: "append",
      heading: "Layer 2: the mid layer that actually swings",
      paragraphs: ["For the mid layer, start with [golf quarter-zips](/shop/quarter-zips). For core warmth without sleeves, add one of our [golf vests](/shop/vests)."],
    },
  ],
  "best-golf-belt-2026-braided-leather-stretch": [
    {
      kind: "append",
      heading: "How to choose the right belt: sizing, buckle, and materials",
      paragraphs: ["A braided stretch belt is also one of the easier [golf gifts under $100](/shop/gifts/under-100), since the weave forgives a guess on his size."],
    },
  ],
  // s06: internal link from the dress code post to the restored hat guide.
  "what-to-wear-private-golf-club-dress-code": [
    {
      kind: "append",
      heading: "On the Golf Course",
      paragraphs: [
        "Hats get their own guide: [Choosing the Perfect Golf Hat](/blogs/news/choosing-the-perfect-golf-hat-tips-for-comfort-and-performance).",
      ],
    },
  ],
};

/**
 * Code-level additions to restored archive posts (/blogs/news/<handle>),
 * whose body is Shopify HTML. Each paragraph renders after the body and
 * supports the same [label](/internal-path) syntax.
 */
export const ARCHIVE_ADDENDA: Record<string, string[]> = {
  // s10: gift guide links.
  "the-fix-heres-how-to-finally-stop-hitting-the-ball-off-the-hosel": [
    "For the golfer on your list who is grinding through this at the range, our [golf gifts under $100](/shop/gifts/under-100) include a Penfold shag bag with room for a hundred practice balls.",
  ],
  "golf-outing-ideas-35-formats-themes-contests-and-extras-with-a-planning-checklist": [
    "Need prizes for the contests? Our [golf gifts under $100](/shop/gifts/under-100) cover tour towels, hats and bag organizers.",
  ],
};

export const BLOG_POST_OVERRIDES: Record<string, BlogPostOverride> = {
  "best-golf-subscription-boxes-2026-compared": {
    intro: "Golf subscription boxes have become a legitimate market. The range now runs from low-cost monthly community memberships to quarterly, stylist-curated apparel edits for golfers who care about what they wear. The quality gap between the best and worst options is significant, and the marketing from most providers does not help you find the distinction. Here is what each of these five services actually delivers.",
    highlights: [
      "Five honest profiles of the major golf subscription services: price, brand quality, and what you actually get",
      "ShortPar4's BBB rating and customer service issues, stated plainly",
      "Mully Reserve's specific differentiator: a stylist-picked edit from 20+ premium brands, not mass-market closeouts",
    ],
    closing: "The subscription box you choose should reflect what you actually value: community, brand quality, variety, or price. If stylist-picked, multi-brand curation matters to you, Mully Reserve is the answer. Take the style quiz at mymully.com/subscription.",
  },
};

export function applyAddenda(slug: string, sections: BlogSection[]): BlogSection[] {
  const adds = BLOG_ADDENDA[slug];
  if (!adds?.length) return sections;
  let out = sections.map((s) => ({ ...s, paragraphs: [...s.paragraphs] }));
  for (const a of adds) {
    if (a.kind === "append") {
      const target = out.find((s) => s.heading === a.heading);
      if (target) target.paragraphs.push(...a.paragraphs);
    } else if (a.kind === "replace") {
      const target = out.find((s) => s.heading === a.heading);
      if (target) target.paragraphs = [...a.paragraphs];
    } else {
      const i = a.after === null ? -1 : out.findIndex((s) => s.heading === a.after);
      if (i === -1) out = [...out, a.section];
      else out = [...out.slice(0, i + 1), a.section, ...out.slice(i + 1)];
    }
  }
  return out;
}
